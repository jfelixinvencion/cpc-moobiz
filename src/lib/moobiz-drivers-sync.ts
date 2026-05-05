/**
 * Sync Moobiz admin drivers → Supabase `moobiz_drivers` (solo reemplazo total).
 *
 * Flujo: **un solo GET** con `limit` alto (por defecto **3000**; probado: devuelve ~1814 ítems cuando `total=1814`).
 * La paginación `page` / `p` / `offset` en varias peticiones devolvió la misma ventana en secuencia; un único `limit=3000` trae el lote completo.
 * dedupe por `id` → validar → RPC `moobiz_drivers_full_replace` (TRUNCATE + INSERT).
 *
 * Token: `MOOBIZ_DRIVERS_TOKEN` o `getMoobizBearerForRequest()`; el GET usa `moobizFetchWithToken` (401/403 o `not_logged` → login + `sync_state`, un reintento).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getMoobizBearerForRequest, moobizFetchWithToken, redactMoobizToken } from "@/lib/moobiz-auth";
import { formatApiError } from "@/lib/format-api-error";

const DRIVERS_URL_DEFAULT = "https://app.moobiz.pe/api/admin/drivers";

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

function driversUrl(): string {
  return getEnvTrimmed(["MOOBIZ_DRIVERS_URL"]) ?? DRIVERS_URL_DEFAULT;
}

/** Por defecto 3000 filas en un solo GET (Moobiz devuelve todos los conductores &lt; limit). Máximo 5000. */
export function pageSize(): number {
  const n = Number.parseInt(process.env.MOOBIZ_DRIVERS_PAGE_SIZE ?? "3000", 10);
  return Number.isFinite(n) && n >= 1 && n <= 5000 ? n : 3000;
}

export type MoobizDriversSyncResult = {
  ok: boolean;
  fetched: number;
  upserted: number;
  finalDbCount: number;
  apiTotalDeclared: number | null;
  countMismatchWithApiTotal: boolean;
  rawRowsMapped: number;
  uniqueAfterDedupe: number;
  pages: number;
  mode: "single_limit";
  validationErrors: string[];
  reachedFetchCap: boolean;
};

export async function getTokenForDriversSync(): Promise<{ token: string; fromEnvOverride: boolean }> {
  const only = getEnvTrimmed(["MOOBIZ_DRIVERS_TOKEN"]);
  if (only) {
    console.log("[drivers-sync] usando MOOBIZ_DRIVERS_TOKEN:", redactMoobizToken(only));
    return { token: only, fromEnvOverride: true };
  }
  const token = await getMoobizBearerForRequest();
  return { token, fromEnvOverride: false };
}

type DriversApiBody = {
  ok?: unknown;
  total?: unknown;
  items?: unknown;
  msg?: unknown;
  error?: unknown;
};

function extractItems(body: DriversApiBody): unknown[] {
  const raw = body.items;
  return Array.isArray(raw) ? raw : [];
}

function extractTotal(body: DriversApiBody): number | null {
  const t = body.total;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string" && t.trim()) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchDriversSingleLimit(params: { token: string; limit: number }): Promise<DriversApiBody> {
  const url = new URL(driversUrl());
  url.searchParams.set("limit", String(params.limit));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "X-Auth-Token": params.token,
      Accept: "application/json",
      Origin: "https://app.moobiz.pe",
      Referer: "https://app.moobiz.pe/",
      "User-Agent": CHROME_UA,
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MOOBIZ_DRIVERS_FETCH: HTTP ${res.status} — ${text.slice(0, 400)}`);
  }
  let body: DriversApiBody;
  try {
    body = (text ? JSON.parse(text) : {}) as DriversApiBody;
  } catch {
    throw new Error(`MOOBIZ_DRIVERS_FETCH: respuesta no JSON — ${text.slice(0, 300)}`);
  }
  if (body.ok !== true) {
    const msg =
      typeof body.msg === "string"
        ? body.msg
        : typeof body.error === "string"
          ? body.error
          : JSON.stringify(body).slice(0, 300);
    throw new Error(`MOOBIZ_DRIVERS_FETCH: ok!=true — ${msg}`);
  }
  return body;
}

function toTextId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toTextNullable(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toBoolNullable(v: unknown): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return null;
}

export function mapDriverRow(raw: Record<string, unknown>): Record<string, unknown> | null {
  const id = toTextId(raw.id);
  if (!id) return null;
  return {
    id,
    id_branch: toTextNullable(raw.id_branch),
    id_role: toTextNullable(raw.id_role),
    id_company: toTextNullable(raw.id_company),
    id_company_area: toTextNullable(raw.id_company_area),
    show_data_fleets: toBoolNullable(raw.show_data_fleets),
    raw_data: raw,
  };
}

export type DownloadDriversResult = {
  rows: Record<string, unknown>[];
  uniqueCount: number;
  rawMappedRows: number;
  totalReported: number | null;
  pages: number;
  mode: "single_limit";
  reachedFetchCap: boolean;
};

/**
 * Una sola petición `limit` (sin `offset` / `page` / `p`). Dedupe por `id` (Map).
 * `reachedFetchCap`: la respuesta llenó `limit` ítems pero `total` de la API indica que faltan filas (sube `MOOBIZ_DRIVERS_PAGE_SIZE`).
 */
export async function downloadAllDriversDeduped(token: string): Promise<DownloadDriversResult> {
  const limit = pageSize();
  const byId = new Map<string, Record<string, unknown>>();
  let rawMappedRows = 0;

  const body = await fetchDriversSingleLimit({ token, limit });
  const totalReported = extractTotal(body);
  const items = extractItems(body) as Record<string, unknown>[];
  const lastPageItemCount = items.length;

  console.log(`[drivers-sync] GET único: limit=${limit}, ítems en respuesta=${items.length}`);

  const mapped = items.map(mapDriverRow).filter(Boolean) as Record<string, unknown>[];
  console.log(`[drivers-sync] Registros mapeables (con id)=${mapped.length}`);

  for (const row of mapped) {
    rawMappedRows += 1;
    byId.set(String(row.id), row);
  }

  const rows = [...byId.values()];
  const dupesRemoved = rawMappedRows - rows.length;
  if (dupesRemoved > 0) {
    console.log(
      `[drivers-sync] Dedupe final: ${rawMappedRows} filas mapeadas → ${rows.length} únicos (eliminados ${dupesRemoved} duplicados por id).`,
    );
  }

  const reachedFetchCap =
    lastPageItemCount >= limit &&
    totalReported !== null &&
    totalReported > lastPageItemCount;

  return {
    rows,
    uniqueCount: rows.length,
    rawMappedRows,
    totalReported,
    pages: 1,
    mode: "single_limit",
    reachedFetchCap,
  };
}

async function replaceAllDriversRpc(
  supabase: SupabaseClient<any, "public", any>,
  rows: Record<string, unknown>[],
): Promise<number> {
  const { data, error } = await supabase.rpc("moobiz_drivers_full_replace", {
    p_rows: rows as unknown as Record<string, unknown>[],
  });
  if (error) {
    throw new Error(
      `Supabase RPC moobiz_drivers_full_replace: ${error.message}. ¿Aplicaste sql/20260427_moobiz_drivers_full_replace_rpc.sql?`,
    );
  }
  return typeof data === "number" && Number.isFinite(data) ? data : rows.length;
}

async function countDriversInDb(supabase: SupabaseClient<any, "public", any>): Promise<number> {
  const { count, error } = await supabase
    .from("moobiz_drivers")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`Supabase COUNT moobiz_drivers: ${error.message}`);
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

/** @deprecated Usar `downloadAllDriversDeduped` + RPC; se mantiene por compatibilidad con diagnósticos. */
export async function fetchAllDriversFromMoobiz(): Promise<{
  rows: Record<string, unknown>[];
  totalReported: number | null;
  pages: number;
  mode: "single_limit";
}> {
  const { token } = await getTokenForDriversSync();
  const dl = await downloadAllDriversDeduped(token);
  return {
    rows: dl.rows,
    totalReported: dl.totalReported,
    pages: dl.pages,
    mode: dl.mode,
  };
}

export async function runMoobizDriversSync(): Promise<MoobizDriversSyncResult> {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let pagesQueried = 0;

  try {
    const { token } = await getTokenForDriversSync();
    const dl = await downloadAllDriversDeduped(token);
    pagesQueried = dl.pages;

    if (dl.uniqueCount === 0) {
      throw new Error(
        "MOOBIZ_DRIVERS_SYNC: la API no devolvió ningún conductor válido; la tabla no se modifica.",
      );
    }

    const inserted = await replaceAllDriversRpc(supabase, dl.rows);
    const finalDbCount = await countDriversInDb(supabase);

    const validationErrors: string[] = [];
    if (dl.totalReported !== null && dl.totalReported !== dl.uniqueCount) {
      validationErrors.push(
        `La API declaró total=${dl.totalReported} pero se descargaron ${dl.uniqueCount} conductores únicos (diferencia ${dl.totalReported - dl.uniqueCount}).`,
      );
    }
    if (rawMappedRowsHasDupes(dl.rawMappedRows, dl.uniqueCount)) {
      validationErrors.push(
        `Filas mapeadas desde ítems: ${dl.rawMappedRows}; únicos tras dedupe: ${dl.uniqueCount} (hay duplicados por id en la API).`,
      );
    }
    if (finalDbCount !== dl.uniqueCount) {
      validationErrors.push(
        `Conteo en Supabase tras reemplazo (${finalDbCount}) ≠ conductores únicos descargados (${dl.uniqueCount}).`,
      );
    }
    if (inserted !== dl.uniqueCount) {
      validationErrors.push(
        `La RPC reportó ${inserted} filas insertadas; se esperaban ${dl.uniqueCount}.`,
      );
    }
    if (dl.reachedFetchCap) {
      validationErrors.push(
        `El GET único devolvió ${pageSize()} ítems (tope de \`limit\`) pero la API declara total=${dl.totalReported}; sube MOOBIZ_DRIVERS_PAGE_SIZE o revisa paginación en Moobiz.`,
      );
    }

    const countMismatchWithApiTotal =
      dl.totalReported !== null && dl.totalReported !== dl.uniqueCount;
    const validationOk = validationErrors.length === 0;

    await writeDriversSyncMonitor({
      status: validationOk ? "success" : "error",
      records_procesados: dl.uniqueCount,
      records_inserted: inserted,
      reason_for_stop: validationOk
        ? `full_replace_ok_${dl.mode}`
        : `full_replace_validation_failed_${dl.mode}`,
      pages_queried: pagesQueried,
      error_message: validationOk ? null : validationErrors.join(" "),
    });

    return {
      ok: validationOk,
      fetched: dl.uniqueCount,
      upserted: inserted,
      finalDbCount,
      apiTotalDeclared: dl.totalReported,
      countMismatchWithApiTotal,
      rawRowsMapped: dl.rawMappedRows,
      uniqueAfterDedupe: dl.uniqueCount,
      pages: pagesQueried,
      mode: dl.mode,
      validationErrors,
      reachedFetchCap: dl.reachedFetchCap,
    };
  } catch (err) {
    const msg = formatApiError(err);
    const authRenewalFailed =
      (err instanceof Error && err.message === "Error 401 tras intento de renovación") ||
      msg.includes("Error 401 tras intento de renovación");
    await writeDriversSyncMonitor({
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

function rawMappedRowsHasDupes(raw: number, unique: number): boolean {
  return raw > unique;
}

export async function writeDriversSyncMonitor(payload: {
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
    last_id: "moobiz_drivers",
    error_message: payload.error_message,
  };
  const { error } = await supabase.from("sync_monitor").insert(body);
  if (error) {
    console.error("[drivers-sync] sync_monitor:", formatApiError(error));
  }
}
