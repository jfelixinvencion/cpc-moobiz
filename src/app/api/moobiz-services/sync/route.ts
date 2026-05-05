import { NextRequest, NextResponse } from "next/server";
import { formatApiError } from "@/lib/format-api-error";
import { assertQualityWriteAccess } from "@/lib/panel-session";
import { runMoobizServicesSync } from "@/lib/moobiz-services-sync";

export const runtime = "nodejs";

/** Sync manual Moobiz dispatcher → `moobiz_services` (token solo en servidor). */
export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const result = await runMoobizServicesSync();
    const status = result.ok ? 200 : 422;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
