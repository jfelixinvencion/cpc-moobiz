import { NextRequest } from "next/server";

import {
  productividadError,
  productividadJson,
  rowsToCsv,
} from "@/lib/productividad-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { parseProductividadParams } from "@/lib/productividad-logs-params";
import {
  runProductividadUserChart,
  runProductividadUserChartExport,
} from "@/lib/productividad-logs-query";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsed = parseProductividadParams(url.searchParams);
    const pool = getMoobizViewsPool();

    if (url.searchParams.get("export") === "csv") {
      const rows = await runProductividadUserChartExport(pool, parsed);
      const csv = rowsToCsv(
        ["us_name", "type_log_name", "cnt", "buckets", "total_per_user"],
        rows.map((r) => ({
          us_name: r.us_name,
          type_log_name: r.type_log_name,
          cnt: r.cnt,
          buckets: r.buckets,
          total_per_user: r.total_per_user,
        })),
      );
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="productividad-usuarios.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    const { rows, totalUsers } = await runProductividadUserChart(pool, parsed);
    return productividadJson({ rows, totalUsers });
  } catch (err) {
    return productividadError(err instanceof Error ? err.message : String(err));
  }
}
