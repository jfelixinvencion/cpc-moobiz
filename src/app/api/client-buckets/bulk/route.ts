import { NextRequest } from "next/server";

import {
  clientBucketsErrorResponse,
  clientBucketsJson,
} from "@/lib/client-buckets-api";
import type { ClientBucketBulkBody } from "@/lib/client-buckets-types";
import { bulkUpsertClientBuckets } from "@/lib/client-buckets";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import {
  assertQualityWriteAccess,
  getClientBucketsActorLabel,
} from "@/lib/panel-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertQualityWriteAccess(request);
    const body = (await request.json()) as ClientBucketBulkBody;
    const pool = getMoobizViewsPool();
    const data = await bulkUpsertClientBuckets(
      pool,
      body.co_ids,
      body.bucket_level,
      getClientBucketsActorLabel(),
      body.co_names,
    );
    return clientBucketsJson({ data });
  } catch (error) {
    return clientBucketsErrorResponse(error);
  }
}
