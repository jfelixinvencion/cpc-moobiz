import { NextRequest } from "next/server";

import {
  buildReservasExportCsv,
  parseReservasAggregationParams,
  runReservasAggregations,
} from "@/lib/aggregations-reservas";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { reservasError } from "@/lib/reservas-api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    assertQualityReadAccess(req);
    const url = new URL(req.url);
    const chartRaw = url.searchParams.get("chart")?.trim();
    if (chartRaw !== "1" && chartRaw !== "2" && chartRaw !== "3" && chartRaw !== "all") {
      return reservasError("Query param chart must be 1, 2, 3 or all", 400);
    }

    const parsed = parseReservasAggregationParams(url.searchParams);
    const pool = getMoobizViewsPool();
    const data = await runReservasAggregations(pool, parsed);
    const includePercent = url.searchParams.get("include_percent") === "1";

    if (chartRaw === "all") {
      const parts = (["1", "2", "3"] as const).map((c) =>
        buildReservasExportCsv(c, data, includePercent),
      );
      const csv = parts.map((p) => `# ${p.filename}\n${p.csv}`).join("\n\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="reservas-charts-all.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    const { filename, csv } = buildReservasExportCsv(chartRaw, data, includePercent);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AUTH_REQUIRED")) {
      return reservasError("Unauthorized", 401);
    }
    console.error("[dashboard/reservas/export]", msg);
    return reservasError("Failed to export reservas data", 500);
  }
}
