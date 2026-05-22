import { NextRequest, NextResponse } from "next/server";

import { fetchSolicitanteFilterOptionsFromV31 } from "@/lib/control-operaciones-solicitante-filter-query";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const week = request.nextUrl.searchParams.get("week")?.trim() || null;
    const pool = getMoobizViewsPool();
    const data = await fetchSolicitanteFilterOptionsFromV31(pool, week);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[filters/solicitante]", err);
    return NextResponse.json({ ok: false, error: message || "fallback" }, { status: 500 });
  }
}
