import { NextRequest, NextResponse } from "next/server";
import { formatApiError } from "@/lib/format-api-error";
import { assertQualityWriteAccess } from "@/lib/panel-session";
import { runMoobizDriversSync } from "@/lib/moobiz-drivers-sync";

export const runtime = "nodejs";

/** Sync manual Moobiz → `moobiz_drivers` (token solo en servidor). */
export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const result = await runMoobizDriversSync();
    const status = result.ok ? 200 : 422;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
