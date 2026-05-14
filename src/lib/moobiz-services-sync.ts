/**
 * Sync Moobiz admin dispatcher → Supabase `moobiz_services` (reemplazo total).
 *
 * GET dispatcher: intento seguro `limit=2000` (una página); si falla/vacío/engaño → fallback 2×`limit=1000`.
 * Token: `MOOBIZ_SERVICES_TOKEN` o `getMoobizBearerForRequest()`; el GET usa `moobizFetchWithToken`
 * (401/403 o `not_logged` → login + `sync_state`, un reintento).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getMoobizBearerForRequest, moobizFetchWithToken, redactMoobizToken } from "@/lib/moobiz-auth";
import { formatApiError } from "@/lib/format-api-error";

const DISPATCHER_URL_DEFAULT = "https://app.moobiz.pe/api/admin/dispatcher";
const PAGE_LIMIT = 1000;
const SINGLE_PAGE_LIMIT = 2000;
const INSERT_BATCH = 1000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const t = value.trim();
    if (t.length > 0) return t;
  }
  return null;
}

function dispatcherUrl(): string {
  return getEnvTrimmed(["MOOBIZ_SERVICES_URL", "MOOBIZ_DISPATCHER_URL"]) ?? DISPATCHER_URL_DEFAULT;
}

export async function getTokenForServicesSync(): Promise<{ token: string; fromEnvOverride: boolean }> {
  const only = getEnvTrimmed(["MOOBIZ_SERVICES_TOKEN"]);
  if (only) {
    console.log("[services-sync] usando MOOBIZ_SERVICES_TOKEN:", redactMoobizToken(only));
    return { token: only, fromEnvOverride: true };
  }
  const token = await getMoobizBearerForRequest();
  return { token, fromEnvOverride: false };
}

type DispatcherApiBody = {
  ok?: unknown;
  total?: unknown;
  items?: unknown;
  msg?: unknown;
  error?: unknown;
};

function extractItems(body: DispatcherApiBody): unknown[] {
  const raw = body.items;
  return Array.isArray(raw) ? raw : [];
}

function extractTotal(body: DispatcherApiBody): number | null {
  const t = body.total;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string" && t.trim()) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchDispatcherPage(params: {
  token: string;
  offset: number;
  limit?: number;
}): Promise<DispatcherApiBody> {
  const limit = params.limit ?? PAGE_LIMIT;
  const url = new URL(dispatcherUrl());
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(params.offset));

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

  const res = await moobizFetchWithToken(url.toString(), init, params.token);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MOOBIZ_DISPATCHER_FETCH: HTTP ${res.status} — ${text.slice(0, 400)}`);
  }
  let body: DispatcherApiBody;
  try {
    body = (text ? JSON.parse(text) : {}) as DispatcherApiBody;
  } catch {
    throw new Error(`MOOBIZ_DISPATCHER_FETCH: respuesta no JSON — ${text.slice(0, 300)}`);
  }
  if (body.ok !== true) {
    const msg =
      typeof body.msg === "string"
        ? body.msg
        : typeof body.error === "string"
          ? body.error
          : JSON.stringify(body).slice(0, 300);
    throw new Error(`MOOBIZ_DISPATCHER_FETCH: ok!=true — ${msg}`);
  }
  return body;
}

export function mapServiceRow(raw: Record<string, unknown>): { id: string; state: string; raw: Record<string, unknown> } | null {
  if (raw.id === undefined || raw.id === null) return null;
  const id = String(raw.id).trim();
  if (!id) return null;
  return {
    id,
    state: String(raw.state ?? ""),
    raw,
  };
}

function mergeDispatcherItemsIntoById(
  byId: Map<string, { id: string; state: string; raw: Record<string, unknown> }>,
  items: Record<string, unknown>[],
): number {
  let rawMappedRows = 0;
  for (const item of items) {
    const row = mapServiceRow(item);
    if (row) {
      rawMappedRows += 1;
      byId.set(row.id, row);
    }
  }
  return rawMappedRows;
}

type DispatcherDownloadPack = {
  rows: { id: string; state: string; raw: Record<string, unknown> }[];
  uniqueCount: number;
  rawMappedRows: number;
  totalReported: number | null;
  pages: number;
  reachedFetchCap: boolean;
  fetchMode: "single_2000" | "paged_1000";
};

async function downloadDispatcherServicesPaged1000(token: string): Promise<DispatcherDownloadPack> {
  console.info("[services-sync] Descarga modo páginas de 1000 (fallback clásico)…");
  const byId = new Map<string, { id: string; state: string; raw: Record<string, unknown> }>();
  let rawMappedRows = 0;
  let pages = 0;

  const body1 = await fetchDispatcherPage({ token, offset: 0, limit: PAGE_LIMIT });
  pages = 1;
  const totalReported = extractTotal(body1);
  const items1 = extractItems(body1) as Record<string, unknown>[];
  console.log(`[services-sync][AUDIT] GET offset=0: limit=${PAGE_LIMIT}, ítems=${items1.length}`);
  rawMappedRows += mergeDispatcherItemsIntoById(byId, items1);

  if (typeof totalReported === "number" && totalReported > PAGE_LIMIT) {
    const body2 = await fetchDispatcherPage({ token, offset: PAGE_LIMIT, limit: PAGE_LIMIT });
    pages = 2;
    const items2 = extractItems(body2) as Record<string, unknown>[];
    console.log(`[services-sync][AUDIT] GET offset=${PAGE_LIMIT}: ítems=${items2.length}`);
    rawMappedRows += mergeDispatcherItemsIntoById(byId, items2);
  }

  const rows = [...byId.values()];
  const dupesRemoved = rawMappedRows - rows.length;
  if (dupesRemoved > 0) {
    console.log(
      `[services-sync][AUDIT] Dedupe final: ${rawMappedRows} filas mapeadas → ${rows.length} únicos (eliminados ${dupesRemoved} duplicados por id).`,
    );
  }

  const reachedFetchCap =
    typeof totalReported === "number" && totalReported > PAGE_LIMIT * pages;

  return {
    rows,
    uniqueCount: rows.length,
    rawMappedRows,
    totalReported,
    pages,
    reachedFetchCap,
    fetchMode: "paged_1000",
  };
}

async function tryDownloadSinglePage2000(
  token: string,
): Promise<{ ok: true; pack: DispatcherDownloadPack } | { ok: false; reason: string }> {
  let body: DispatcherApiBody;
  try {
    body = await fetchDispatcherPage({ token, offset: 0, limit: SINGLE_PAGE_LIMIT });
  } catch (e) {
    const msg = formatApiError(e);
    return { ok: false, reason: `fetch_error: ${msg}` };
  }

  if (!body || body.ok !== true) {
    return { ok: false, reason: "ok_not_true" };
  }

  const totalReported = extractTotal(body);
  const items = extractItems(body) as Record<string, unknown>[];
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "empty_items" };
  }

  if (typeof totalReported === "number" && Number.isFinite(totalReported) && totalReported > SINGLE_PAGE_LIMIT) {
    return { ok: false, reason: `total_gt_limit (${totalReported} > ${SINGLE_PAGE_LIMIT})` };
  }

  if (
    typeof totalReported === "number" &&
    Number.isFinite(totalReported) &&
    totalReported > items.length
  ) {
    return {
      ok: false,
      reason: `api_total_exceeds_items (total=${totalReported} items_len=${items.length})`,
    };
  }

  const byId = new Map<string, { id: string; state: string; raw: Record<string, unknown> }>();
  const rawMappedRows = mergeDispatcherItemsIntoById(byId, items);
  const rows = [...byId.values()];
  if (rows.length === 0) {
    return { ok: false, reason: "no_valid_rows_after_map" };
  }

  const dupesRemoved = rawMappedRows - rows.length;
  if (dupesRemoved > 0) {
    console.log(
      `[services-sync][AUDIT] Dedupe (página única): ${rawMappedRows} filas mapeadas → ${rows.length} únicos (eliminados ${dupesRemoved} duplicados por id).`,
    );
  }

  const reachedFetchCap =
    typeof totalReported === "number" && Number.isFinite(totalReported) && totalReported > SINGLE_PAGE_LIMIT;

  return {
    ok: true,
    pack: {
      rows,
      uniqueCount: rows.length,
      rawMappedRows,
      totalReported,
      pages: 1,
      reachedFetchCap,
      fetchMode: "single_2000",
    },
  };
}

async function downloadDispatcherServicesSmart(token: string): Promise<DispatcherDownloadPack> {
  console.info("[services-sync] Intentando página única de 2000 (limit=2000, offset=0)…");
  const single = await tryDownloadSinglePage2000(token);
  if (single.ok) {
    console.info(
      `[services-sync] Página única de 2000 aceptada: únicos=${single.pack.uniqueCount}, total API=${single.pack.totalReported ?? "null"}, rawMapped=${single.pack.rawMappedRows}`,
    );
    return single.pack;
  }
  console.warn(`[services-sync] Fallback activado: volviendo a páginas de 1000 — motivo: ${single.reason}`);
  return downloadDispatcherServicesPaged1000(token);
}

export type MoobizServicesSyncResult =
  | {
      ok: true;
      deleted: number;
      inserted: number;
      pages: number;
      validationErrors?: string[];
      fetchMode?: "single_2000" | "paged_1000";
    }
  | {
      ok: false;
      conflict: true;
      reason: "sync_already_running";
      deleted: 0;
      inserted: 0;
      pages: 0;
    };

const SYNC_GUARD_REASON = "api_sync_guard_active" as const;

async function replaceAllServices(
  supabase: SupabaseClient<any, "public", any>,
  rows: { id: string; state: string; raw: Record<string, unknown> }[],
): Promise<{ deleted: number; inserted: number }> {
  const { data: deletedRows, error: deleteError } = await supabase
    .from("moobiz_services")
    .delete()
    .neq("id", "")
    .select("id");

  if (deleteError) {
    throw new Error(`Supabase DELETE moobiz_services: ${deleteError.message}`);
  }

  const deleted = Array.isArray(deletedRows) ? deletedRows.length : 0;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from("moobiz_services").insert(batch);
    if (error) {
      throw new Error(`Supabase INSERT moobiz_services (lote ${i / INSERT_BATCH + 1}): ${error.message}`);
    }
    inserted += batch.length;
  }

  return { deleted, inserted };
}

async function countServicesInDb(supabase: SupabaseClient<any, "public", any>): Promise<number> {
  const { count, error } = await supabase.from("moobiz_services").select("*", { count: "exact", head: true });
  if (error) throw new Error(`Supabase COUNT moobiz_services: ${error.message}`);
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

export async function writeServicesSyncMonitor(payload: {
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
    last_id: "moobiz_services",
    error_message: payload.error_message,
  };
  const { error } = await supabase.from("sync_monitor").insert(body);
  if (error) {
    console.error("[services-sync] sync_monitor:", formatApiError(error));
  }
}

export async function runMoobizServicesSync(): Promise<MoobizServicesSyncResult> {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- START guard: abort if a recent run is still 'running' (narrow reason to avoid stale CI fetch_start rows) --
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: running, error: rErr } = await supabase
    .from("sync_monitor")
    .select("id,created_at")
    .eq("last_id", "moobiz_services")
    .eq("status", "running")
    .eq("reason_for_stop", SYNC_GUARD_REASON)
    .gte("created_at", since)
    .limit(1);

  if (rErr) {
    console.warn("[services-sync] sync guard: could not check sync_monitor", rErr);
  } else if (running && running.length > 0) {
    console.info("[services-sync] sync guard: another moobiz_services sync is running — aborting this request");
    return { ok: false, conflict: true, reason: "sync_already_running", deleted: 0, inserted: 0, pages: 0 };
  }
  // -- END guard --

  let lockRowId: string | null = null;
  const { data: lockIns, error: lockErr } = await supabase
    .from("sync_monitor")
    .insert({
      status: "running",
      records_procesados: 0,
      records_inserted: 0,
      registros_nuevos_estimados: null,
      registros_actualizados_estimados: null,
      reason_for_stop: SYNC_GUARD_REASON,
      pages_queried: 0,
      last_id: "moobiz_services",
      error_message: null,
    })
    .select("id")
    .maybeSingle();
  if (lockErr) {
    console.warn("[services-sync] sync guard: could not insert lock row", lockErr);
  } else if (lockIns && typeof lockIns === "object" && "id" in lockIns) {
    lockRowId = String((lockIns as { id: unknown }).id ?? "").trim() || null;
  }

  let pagesQueried = 0;

  try {
    console.log("[services-sync][AUDIT] inicio runMoobizServicesSync destino=public.moobiz_services");
    const { token } = await getTokenForServicesSync();

    const dl = await downloadDispatcherServicesSmart(token);
    pagesQueried = dl.pages;
    const rows = dl.rows;
    const totalReported = dl.totalReported;

    console.log(
      `[services-sync][AUDIT] modo=${dl.fetchMode} registros_validos=${rows.length} totalReported=${totalReported ?? "null"} rawMapped=${dl.rawMappedRows}`,
    );

    if (rows.length === 0) {
      throw new Error("MOOBIZ_SERVICES_SYNC: la API no devolvió ningún servicio válido (id requerido).");
    }

    const { deleted, inserted } = await replaceAllServices(supabase, rows);
    const finalDbCount = await countServicesInDb(supabase);
    console.log(
      `[services-sync][AUDIT] escritura destino=public.moobiz_services deleted=${deleted} inserted=${inserted} finalCount=${finalDbCount}`,
    );

    const validationErrors: string[] = [];
    if (totalReported !== null && totalReported !== rows.length) {
      validationErrors.push(
        `La API declaró total=${totalReported} pero se consolidaron ${rows.length} servicios únicos (Δ ${totalReported - rows.length}).`,
      );
    }
    if (dl.rawMappedRows > dl.uniqueCount) {
      validationErrors.push(
        `Ítems mapeados: ${dl.rawMappedRows}; únicos tras dedupe: ${dl.uniqueCount} (ids repetidos en la API).`,
      );
    }
    if (inserted !== rows.length) {
      validationErrors.push(`Se insertaron ${inserted} filas; se esperaban ${rows.length}.`);
    }
    if (finalDbCount !== rows.length) {
      validationErrors.push(
        `Conteo en Supabase tras reemplazo (${finalDbCount}) ≠ servicios únicos descargados (${rows.length}).`,
      );
    }
    if (dl.reachedFetchCap) {
      const maxR =
        dl.fetchMode === "single_2000" ? SINGLE_PAGE_LIMIT * dl.pages : PAGE_LIMIT * dl.pages;
      validationErrors.push(
        `La API declara total=${totalReported} superior a ${maxR} filas descargables (${dl.fetchMode}).`,
      );
    }

    const validationOk = validationErrors.length === 0;
    const warningText = validationErrors.length ? `[WARNING] ${validationErrors.join(" | ")}` : null;
    const modeTag = dl.fetchMode === "single_2000" ? "single2000" : "paged1000";
    const reasonStop = validationOk ? `full_replace_ok_${modeTag}` : `full_replace_ok_with_warnings_${modeTag}`;

    await writeServicesSyncMonitor({
      status: "success",
      records_procesados: rows.length,
      records_inserted: inserted,
      reason_for_stop: reasonStop,
      pages_queried: pagesQueried,
      error_message: warningText,
    });

    return {
      ok: true,
      deleted,
      inserted,
      pages: pagesQueried,
      validationErrors: validationOk ? undefined : validationErrors,
      fetchMode: dl.fetchMode,
    };
  } catch (err) {
    const msg = formatApiError(err);
    const authRenewalFailed =
      (err instanceof Error && err.message === "Error 401 tras intento de renovación") ||
      msg.includes("Error 401 tras intento de renovación");
    await writeServicesSyncMonitor({
      status: "error",
      records_procesados: 0,
      records_inserted: 0,
      reason_for_stop: authRenewalFailed ? "moobiz_auth_401_after_refresh" : "sync_exception",
      pages_queried: pagesQueried,
      error_message: authRenewalFailed ? "Error 401 tras intento de renovación" : msg,
    });
    throw err;
  } finally {
    if (lockRowId) {
      const { error: delErr } = await supabase.from("sync_monitor").delete().eq("id", lockRowId);
      if (delErr) {
        console.warn("[services-sync] sync guard: could not delete lock row", delErr);
      }
    }
  }
}
