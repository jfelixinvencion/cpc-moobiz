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
    const pool = getMoobizViewsPool();
    const data = await searchCompaniesInVista(pool, q);
    return clientBucketsJson({ data });
  } catch (error) {
    return clientBucketsErrorResponse(error);
  }
}
