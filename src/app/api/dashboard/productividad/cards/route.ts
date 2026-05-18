import { NextRequest } from "next/server";

import { productividadError, productividadJson } from "@/lib/productividad-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { parseProductividadParams } from "@/lib/productividad-logs-params";
import { runProductividadCards } from "@/lib/productividad-logs-query";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsed = parseProductividadParams(url.searchParams);
    const pool = getMoobizViewsPool();
    const cards = await runProductividadCards(pool, parsed);
    return productividadJson({ cards });
  } catch (err) {
    return productividadError(err instanceof Error ? err.message : String(err));
  }
}
