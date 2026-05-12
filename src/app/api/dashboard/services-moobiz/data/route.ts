import { NextRequest, NextResponse } from "next/server";

import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import {
  parseServicesMoobizParams,
  runServicesMoobizData,
} from "@/lib/services-moobiz-dashboard-query";

export const runtime = "nodejs";

const CACHE_OK = "s-maxage=60, stale-while-revalidate=30" as const;

export async function GET(req: NextRequest) {
  try {
    const pool = getMoobizViewsPool();
    const parsed = parseServicesMoobizParams(new URL(req.url).searchParams);
    const rows = await runServicesMoobizData(pool, parsed);
    return NextResponse.json({ data: rows }, {
      headers: { "Cache-Control": CACHE_OK },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg, data: [] },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
