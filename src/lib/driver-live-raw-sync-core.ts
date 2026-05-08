/**
 * Núcleo del volcado live/vehicles (sin importar moobiz-services-sync) para tests con node --test
 * y para el wrapper de producción.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDriverKeyFromLiveVehicleItem,
  extractItemsFromLiveVehiclesResponse,
  normalizeAvailabilityFromItem,
} from "./driver-live-vehicles-parse.ts";
import { formatApiError } from "./format-api-error.ts";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const LIVE_VEHICLES_MASS_URL =
  "https://app.moobiz.pe/api/admin/live/vehicles?query=&show_destinations=true";

export type DriverLiveRawRpcRow = {
  driver_key: string;
  raw: Record<string, unknown>;
  availability: string;
};

export function buildDriverLiveRawRpcPayload(moobizItems: unknown[]): DriverLiveRawRpcRow[] {
  const byKey = new Map<string, DriverLiveRawRpcRow>();
  for (const item of moobizItems) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const driver_key = buildDriverKeyFromLiveVehicleItem(rec);
    if (!driver_key) continue;
    byKey.set(driver_key, {
      driver_key,
      raw: rec,
      availability: normalizeAvailabilityFromItem(rec),
    });
  }
  return [...byKey.values()];
}

type MoobizLiveVehiclesBody = {
  ok?: unknown;
  items?: unknown;
  msg?: unknown;
  error?: unknown;
};

function parseMoobizLiveVehiclesJson(text: string): MoobizLiveVehiclesBody {
  try {
    return (text ? JSON.parse(text) : {}) as MoobizLiveVehiclesBody;
  } catch {
    throw new Error(`MOOBIZ_LIVE_VEHICLES_FETCH: respuesta no JSON — ${text.slice(0, 300)}`);
  }
}

export function parseRpcRefreshResult(data: unknown): { total: number; inserted: number } {
  if (!data || typeof data !== "object") return { total: 0, inserted: 0 };
  const o = data as Record<string, unknown>;
  const total = typeof o.total === "number" && Number.isFinite(o.total) ? o.total : Number(o.total) || 0;
  const inserted =
    typeof o.inserted === "number" && Number.isFinite(o.inserted) ? o.inserted : Number(o.inserted) || 0;
  return { total, inserted };
}

export type DriverLiveRawRefreshDeps = {
  getTokenForServicesSync: () => Promise<{ token: string; fromEnvOverride: boolean }>;
  moobizFetchWithToken: (
    url: string | URL,
    init: RequestInit | undefined,
    bearerToken: string,
  ) => Promise<Response>;
  createServiceSupabase: () => SupabaseClient;
  writeDriverLiveRawSyncMonitor: (payload: {
    status: string;
    records_procesados: number;
    records_inserted: number;
    reason_for_stop: string;
    pages_queried: number;
    error_message: string | null;
  }) => Promise<void>;
};

export type DriverLiveRawRefreshResult = {
  ok: boolean;
  total: number;
  inserted: number;
  elapsed_ms: number;
  validationErrors?: string[];
};

/**
 * Descarga live/vehicles (query vacío), persiste vía RPC y registra sync_monitor.
 */
export async function runDriverLiveRawRefreshCore(
  d: DriverLiveRawRefreshDeps,
): Promise<DriverLiveRawRefreshResult> {
  const t0 = Date.now();
  let pagesQueried = 0;

  try {
    console.log("[driver-live-raw-sync][AUDIT] inicio runDriverLiveRawRefresh destino=public.driver_live_raw");
    const { token } = await d.getTokenForServicesSync();

    const init: RequestInit = {
      method: "GET",
      headers: {
        Accept: "application/json",
        Origin: "https://app.moobiz.pe",
        Referer: "https://app.moobiz.pe/",
        "User-Agent": CHROME_UA,
      },
      cache: "no-store",
    };

    const res = await d.moobizFetchWithToken(LIVE_VEHICLES_MASS_URL, init, token);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MOOBIZ_LIVE_VEHICLES_FETCH: HTTP ${res.status} — ${text.slice(0, 400)}`);
    }

    const body = parseMoobizLiveVehiclesJson(text);
    if (body.ok !== true) {
      const msg =
        typeof body.msg === "string"
          ? body.msg
          : typeof body.error === "string"
            ? body.error
            : JSON.stringify(body).slice(0, 300);
      throw new Error(`MOOBIZ_LIVE_VEHICLES_FETCH: ok!=true — ${msg}`);
    }

    pagesQueried = 1;
    const moobizItems = extractItemsFromLiveVehiclesResponse(body);
    console.log(`[driver-live-raw-sync][AUDIT] items en JSON=${moobizItems.length}`);

    if (moobizItems.length === 0) {
      throw new Error(
        "MOOBIZ_DRIVER_LIVE_RAW: la API no devolvió ningún ítem en items[] (volcado abortado para no TRUNCATE vacío).",
      );
    }

    const rpcPayload = buildDriverLiveRawRpcPayload(moobizItems);
    if (rpcPayload.length === 0) {
      throw new Error(
        "MOOBIZ_DRIVER_LIVE_RAW: ningún vehículo válido (driver_key) tras normalizar la respuesta.",
      );
    }

    const supabase = d.createServiceSupabase();
    const { data: rpcData, error: rpcError } = await supabase.rpc("refresh_driver_live_raw", {
      items: rpcPayload,
    });

    if (rpcError) {
      throw new Error(`Supabase RPC refresh_driver_live_raw: ${formatApiError(rpcError)}`);
    }

    const { total: rpcTotal, inserted } = parseRpcRefreshResult(rpcData);
    console.log(
      `[driver-live-raw-sync][AUDIT] RPC total=${rpcTotal} inserted=${inserted} filasPayload=${rpcPayload.length}`,
    );

    const validationErrors: string[] = [];
    if (inserted !== rpcPayload.length) {
      validationErrors.push(`RPC insertó ${inserted} filas; se enviaron ${rpcPayload.length} filas únicas.`);
    }
    if (rpcTotal !== rpcPayload.length) {
      validationErrors.push(
        `RPC declaró total=${rpcTotal} pero el array RPC tiene longitud ${rpcPayload.length}.`,
      );
    }

    const validationOk = validationErrors.length === 0;
    const elapsed_ms = Date.now() - t0;

    await d.writeDriverLiveRawSyncMonitor({
      status: validationOk ? "success" : "error",
      records_procesados: moobizItems.length,
      records_inserted: inserted,
      reason_for_stop: validationOk ? `full_replace_ok_${pagesQueried}p` : "full_replace_validation_failed",
      pages_queried: pagesQueried,
      error_message: validationOk ? null : validationErrors.join(" "),
    });

    return {
      ok: validationOk,
      total: moobizItems.length,
      inserted,
      elapsed_ms,
      validationErrors: validationOk ? undefined : validationErrors,
    };
  } catch (err) {
    const msg = formatApiError(err);
    const authRenewalFailed =
      (err instanceof Error && err.message === "Error 401 tras intento de renovación") ||
      msg.includes("Error 401 tras intento de renovación");
    await d.writeDriverLiveRawSyncMonitor({
      status: "error",
      records_procesados: 0,
      records_inserted: 0,
      reason_for_stop: authRenewalFailed ? "moobiz_auth_401_after_refresh" : "sync_exception",
      pages_queried: pagesQueried,
      error_message: authRenewalFailed ? "Error 401 tras intento de renovación" : msg,
    });
    throw err;
  }
}
