import { NextRequest } from "next/server";

import {
  parseReservasAggregationParams,
  runReservasAggregations,
} from "@/lib/aggregations-reservas";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { reservasError, reservasJson } from "@/lib/reservas-api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    assertQualityReadAccess(req);
    const parsed = parseReservasAggregationParams(new URL(req.url).searchParams);
    const pool = getMoobizViewsPool();
    const body = await runReservasAggregations(pool, parsed);
    return reservasJson(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AUTH_REQUIRED")) {
      return reservasError("Unauthorized", 401);
    }
    console.error("[dashboard/reservas/aggregations]", msg);
    return reservasError("Failed to load reservas aggregations", 500);
  }
}
