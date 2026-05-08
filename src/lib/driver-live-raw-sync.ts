/**
 * Volcado masivo Moobiz live/vehicles → RPC public.refresh_driver_live_raw.
 * Token y fetch: misma política que moobiz_services (getTokenForServicesSync + moobizFetchWithToken).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { writeDriverLiveRawSyncMonitor } from "./driver-live-raw-sync-monitor.ts";
import {
  runDriverLiveRawRefreshCore,
  type DriverLiveRawRefreshDeps,
  type DriverLiveRawRefreshResult,
  LIVE_VEHICLES_MASS_URL,
  buildDriverLiveRawRpcPayload,
  parseRpcRefreshResult,
} from "./driver-live-raw-sync-core.ts";
import { moobizFetchWithToken } from "./moobiz-auth.ts";
import { getTokenForServicesSync } from "./moobiz-services-sync.ts";

export {
  LIVE_VEHICLES_MASS_URL,
  buildDriverLiveRawRpcPayload,
  parseRpcRefreshResult,
  runDriverLiveRawRefreshCore,
  type DriverLiveRawRefreshDeps,
  type DriverLiveRawRefreshResult,
  type DriverLiveRawRpcRow,
} from "./driver-live-raw-sync-core.ts";

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const t = value.trim();
    if (t.length > 0) return t;
  }
  return null;
}

function buildDefaultDeps(): DriverLiveRawRefreshDeps {
  return {
    getTokenForServicesSync,
    moobizFetchWithToken,
    createServiceSupabase: (): SupabaseClient => {
      const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
      const serviceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
      if (!supabaseUrl || !serviceKey) {
        throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
      }
      return createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    },
    writeDriverLiveRawSyncMonitor,
  };
}

/**
 * Descarga live/vehicles (query vacío), persiste vía RPC y registra sync_monitor.
 * `deps` permite inyectar mocks en tests vía `runDriverLiveRawRefreshCore` (ver driver-live-raw-sync-core.ts).
 */
export async function runDriverLiveRawRefresh(
  deps: Partial<DriverLiveRawRefreshDeps> = {},
): Promise<DriverLiveRawRefreshResult> {
  return runDriverLiveRawRefreshCore({ ...buildDefaultDeps(), ...deps });
}
