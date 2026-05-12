import { NextResponse } from "next/server";

import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { runServicesMoobizFilterOptions } from "@/lib/services-moobiz-dashboard-query";

export const runtime = "nodejs";

const CACHE =
  "s-maxage=300, stale-while-revalidate=60" as const;

export async function GET() {
  try {
    const pool = getMoobizViewsPool();
    const body = await runServicesMoobizFilterOptions(pool);
    return NextResponse.json(body, {
      headers: { "Cache-Control": CACHE },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: msg,
        estados: [],
        creados_por: [],
        productos: [],
        empresas: [],
        sucursales: ["LIMA", "PROVINCIA"],
        conductor_categories: ["APOYO LIMA", "APOYO PROVINCIA", "AFILIADO"],
        months: [],
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
