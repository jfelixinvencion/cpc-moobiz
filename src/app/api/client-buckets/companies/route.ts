import { NextRequest } from "next/server";

import {
  clientBucketsErrorResponse,
  clientBucketsJson,
} from "@/lib/client-buckets-api";
import { searchCompaniesInVista } from "@/lib/client-buckets";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    assertQualityReadAccess(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const offsetRaw = request.nextUrl.searchParams.get("offset");
    const limit = Math.min(
      50,
      Math.max(1, limitRaw ? Number(limitRaw) : 25),
    );
    const offset = Math.max(0, offsetRaw ? Number(offsetRaw) : 0);

    const pool = getMoobizViewsPool();
    const items = await searchCompaniesInVista(pool, q, limit);
    const slice = offset > 0 ? items.slice(offset) : items;

    return clientBucketsJson({
      data: slice,
      items: slice,
      total: slice.length,
      limit,
      offset,
    });
  } catch (error) {
    return clientBucketsErrorResponse(error);
  }
}
