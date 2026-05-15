import { NextRequest } from "next/server";

import {
  productividadError,
  productividadJson,
  rowsToCsv,
} from "@/lib/productividad-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { parseProductividadParams } from "@/lib/productividad-logs-params";
import { runProductividadByDate } from "@/lib/productividad-logs-query";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsed = parseProductividadParams(url.searchParams);
    const pool = getMoobizViewsPool();
    const rows = await runProductividadByDate(pool, parsed);

    if (url.searchParams.get("export") === "csv") {
      const csv = rowsToCsv(
        ["fecha", "cnt"],
        rows.map((r) => ({ fecha: r.fecha, cnt: r.cnt })),
      );
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="productividad-por-fecha.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    return productividadJson({ rows });
  } catch (err) {
    return productividadError(err instanceof Error ? err.message : String(err));
  }
}
