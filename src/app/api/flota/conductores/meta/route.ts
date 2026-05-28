import { NextRequest } from "next/server";

import { flotaError, flotaJson } from "@/lib/flota-api";
import { runFlotaConductoresMeta } from "@/lib/flota-conductores-query";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

/** Meta desde `reportes.mv_conductores` y semanas en `reportes.semaforo`. */
export async function GET(req: NextRequest) {
  try {
    assertQualityReadAccess(req);
    const pool = getMoobizViewsPool();
    const meta = await runFlotaConductoresMeta(pool);
    return flotaJson(meta);
  } catch (err) {
    return flotaError(err instanceof Error ? err.message : String(err));
  }
}
