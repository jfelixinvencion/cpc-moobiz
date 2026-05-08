import { createClient } from "@supabase/supabase-js";

import { formatApiError } from "./format-api-error.ts";

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const t = value.trim();
    if (t.length > 0) return t;
  }
  return null;
}

export async function writeDriverLiveRawSyncMonitor(payload: {
  status: string;
  records_procesados: number;
  records_inserted: number;
  reason_for_stop: string;
  pages_queried: number;
  error_message: string | null;
}): Promise<void> {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !serviceKey) return;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = {
    status: payload.status,
    records_procesados: payload.records_procesados,
    records_inserted: payload.records_inserted,
    registros_nuevos_estimados: null,
    registros_actualizados_estimados: null,
    reason_for_stop: payload.reason_for_stop,
    pages_queried: payload.pages_queried,
    last_id: "driver_live_raw",
    error_message: payload.error_message,
  };
  const { error } = await supabase.from("sync_monitor").insert(body);
  if (error) {
    console.error("[driver-live-raw-sync] sync_monitor:", formatApiError(error));
  }
}
