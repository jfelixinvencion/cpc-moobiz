import { NextRequest } from "next/server";

import { flotaError, flotaJson } from "@/lib/flota-api";
import { parseFlotaConductoresParams } from "@/lib/flota-conductores-params";
import { runFlotaConductoresRows } from "@/lib/flota-conductores-query";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    assertQualityReadAccess(req);
    const parsed = parseFlotaConductoresParams(new URL(req.url).searchParams);
    const pool = getMoobizViewsPool();
    const { rows, total } = await runFlotaConductoresRows(pool, parsed);
    return flotaJson({ rows, total });
  } catch (err) {
    return flotaError(err instanceof Error ? err.message : String(err));
  }
}
