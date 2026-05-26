import { type NextRequest, NextResponse } from "next/server";
import { formatApiError } from "@/lib/format-api-error";
import { dispatchSyncHistoryWorkflow } from "@/lib/github-sync-history-workflow";
import { assertQualityWriteAccess } from "@/lib/panel-session";
import { runMoobizServicesSync } from "@/lib/moobiz-services-sync";

export const runtime = "nodejs";

async function readSyncTarget(request: NextRequest): Promise<"services" | "history"> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return "services";
  try {
    const body = (await request.json()) as { target?: unknown };
    return body?.target === "history" ? "history" : "services";
  } catch {
    return "services";
  }
}

/**
 * Sync manual: Moobiz dispatcher → `moobiz_services`, o disparo GitHub `sync-history` si `target: "history"`.
 * Historial (`target: "history"`): fechas Moobiz se normalizan en `scripts/sync_moobiz_history.js` vía `helpers/moobiz-dates.js` (Lima→UTC).
 */
export async function POST(request: NextRequest) {
  try {
    console.log("[services-sync][AUDIT] POST /api/moobiz-services/sync iniciado");
    assertQualityWriteAccess(request);
    const target = await readSyncTarget(request);

    if (target === "history") {
      console.log("[services-sync][AUDIT] modo=history workflow_dispatch sync-history.yml");
      await dispatchSyncHistoryWorkflow();
      return NextResponse.json({ ok: true, target: "history" as const }, { status: 200 });
    }

    const result = await runMoobizServicesSync();
    if ("conflict" in result && result.conflict) {
      console.info("[services-sync][AUDIT] sync guard: aborted (409 sync_already_running)");
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 });
    }
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
