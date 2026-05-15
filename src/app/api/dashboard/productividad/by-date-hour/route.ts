import { NextRequest } from "next/server";

import {
  productividadError,
  productividadJson,
  rowsToCsv,
} from "@/lib/productividad-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { parseProductividadParams } from "@/lib/productividad-logs-params";
import { runProductividadByDateHour } from "@/lib/productividad-logs-query";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsed = parseProductividadParams(url.searchParams);
    const pool = getMoobizViewsPool();
    const rows = await runProductividadByDateHour(pool, parsed);

    if (url.searchParams.get("export") === "csv") {
      const csv = rowsToCsv(
        ["fecha", "hora", "cnt"],
        rows.map((r) => ({ fecha: r.fecha, hora: r.hora, cnt: r.cnt })),
      );
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="productividad-fecha-hora.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    return productividadJson({ rows });
  } catch (err) {
    return productividadError(err instanceof Error ? err.message : String(err));
  }
}
