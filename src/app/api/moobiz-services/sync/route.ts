import { type NextRequest, NextResponse } from "next/server";
import { formatApiError } from "@/lib/format-api-error";
import { assertQualityWriteAccess } from "@/lib/panel-session";
import { runMoobizServicesSync } from "@/lib/moobiz-services-sync";

export const runtime = "nodejs";

/** Sync manual Moobiz dispatcher → `moobiz_services` (token solo en servidor). */
export async function POST(request: NextRequest) {
  try {
    console.log("[services-sync][AUDIT] POST /api/moobiz-services/sync iniciado");
    assertQualityWriteAccess(request);
    const result = await runMoobizServicesSync();
    const status = result.ok ? 200 : 422;
    console.log(
      `[services-sync][AUDIT] destino=public.moobiz_services processed=${result.inserted} inserted=${result.inserted} deleted=${result.deleted} ok=${result.ok} status=${status}`,
    );
    return NextResponse.json(result, { status });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    console.error(`[services-sync][AUDIT] fallo antes de persistir: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
