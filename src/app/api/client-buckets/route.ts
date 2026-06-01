import { NextRequest } from "next/server";

import {
  clientBucketsErrorResponse,
  clientBucketsJson,
} from "@/lib/client-buckets-api";
import type { ClientBucketUpsertBody } from "@/lib/client-buckets-types";
import {
  listClientBuckets,
  upsertClientBucket,
} from "@/lib/client-buckets";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import {
  assertQualityReadAccess,
  assertQualityWriteAccess,
  getClientBucketsActorLabel,
} from "@/lib/panel-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    assertQualityReadAccess(request);
    const pool = getMoobizViewsPool();
    const data = await listClientBuckets(pool);
    return clientBucketsJson({ data });
  } catch (error) {
    return clientBucketsErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertQualityWriteAccess(request);
    const body = (await request.json()) as ClientBucketUpsertBody;
    const pool = getMoobizViewsPool();
    const row = await upsertClientBucket(pool, body, getClientBucketsActorLabel());
    return clientBucketsJson({ data: row });
  } catch (error) {
    return clientBucketsErrorResponse(error);
  }
}
