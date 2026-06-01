import { NextRequest } from "next/server";

import {
  clientBucketsErrorResponse,
  clientBucketsJson,
} from "@/lib/client-buckets-api";
import { deleteClientBucket } from "@/lib/client-buckets";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityWriteAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ co_id: string }> };

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  try {
    assertQualityWriteAccess(request);
    const { co_id } = await context.params;
    const pool = getMoobizViewsPool();
    const deleted = await deleteClientBucket(pool, co_id);
    if (!deleted) {
      return clientBucketsJson({ error: "Asignación no encontrada." }, 404);
    }
    return clientBucketsJson({ ok: true });
  } catch (error) {
    return clientBucketsErrorResponse(error);
  }
}
