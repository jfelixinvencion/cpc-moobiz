import { type NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import { assertQualityWriteAccess } from "@/lib/panel-session";
import { runDriverLiveRawRefresh } from "@/lib/driver-live-raw-sync";

export const runtime = "nodejs";

/** Volcado masivo Moobiz live/vehicles → public.driver_live_raw (vía RPC). */
export async function POST(request: NextRequest) {
  try {
    console.log("[driver-live-raw-sync][AUDIT] POST /api/moobiz/refresh-gps-raw iniciado");
    assertQualityWriteAccess(request);
    const result = await runDriverLiveRawRefresh();
    const status = result.ok ? 200 : 422;
    console.log(
      `[driver-live-raw-sync][AUDIT] ok=${result.ok} total=${result.total} inserted=${result.inserted} elapsed_ms=${result.elapsed_ms} status=${status}`,
    );
    return NextResponse.json(result, { status });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    console.error(`[driver-live-raw-sync][AUDIT] fallo: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
