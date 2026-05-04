/**
 * Sync Moobiz admin operators → Supabase `moobiz_operators` (solo reemplazo total).
 *
 * Flujo: **un solo GET** con `limit` alto (por defecto **3000**).
 * dedupe por `id` → validar → RPC `moobiz_operators_full_replace` (TRUNCATE + INSERT).
 *
 * Token: `MOOBIZ_OPERATORS_TOKEN` o `getMoobizBearerForRequest()`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getMoobizBearerForRequest, redactMoobizToken } from "@/lib/moobiz-auth";
import { formatApiError } from "@/lib/format-api-error";

const OPERATORS_URL_DEFAULT = "https://app.moobiz.pe/api/admin/operators";

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

function operatorsUrl(): string {
  return getEnvTrimmed(["MOOBIZ_OPERATORS_URL"]) ?? OPERATORS_URL_DEFAULT;
}

/** Por defecto 3000 filas en un solo GET. Máximo 5000. */
export function operatorsPageSize(): number {
  const n = Number.parseInt(process.env.MOOBIZ_OPERATORS_PAGE_SIZE ?? "3000", 10);
  return Number.isFinite(n) && n >= 1 && n <= 5000 ? n : 3000;
}

export type MoobizOperatorsSyncResult = {
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

async function getTokenForOperatorsSync(): Promise<{ token: string; fromEnvOverride: boolean }> {
  const only = getEnvTrimmed(["MOOBIZ_OPERATORS_TOKEN"]);
  if (only) {
    console.log("[Operators sync] usando MOOBIZ_OPERATORS_TOKEN:", redactMoobizToken(only));
    return { token: only, fromEnvOverride: true };
  }
  const token = await getMoobizBearerForRequest();
  return { token, fromEnvOverride: false };
}

type OperatorsApiBody = {
  ok?: unknown;
  total?: unknown;
  items?: unknown;
  msg?: unknown;
  error?: unknown;
};

function extractItems(body: OperatorsApiBody): unknown[] {
  const raw = body.items;
  return Array.isArray(raw) ? raw : [];
}

function extractTotal(body: OperatorsApiBody): number | null {
  const t = body.total;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string" && t.trim()) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchOperatorsSingleLimit(params: {
  token: string;
  limit: number;
}): Promise<OperatorsApiBody> {
  const url = new URL(operatorsUrl());
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
    throw new Error(`MOOBIZ_OPERATORS_FETCH: HTTP ${res.status} — ${text.slice(0, 400)}`);
  }
  let body: OperatorsApiBody;
  try {
    body = (text ? JSON.parse(text) : {}) as OperatorsApiBody;
  } catch {
    throw new Error(`MOOBIZ_OPERATORS_FETCH: respuesta no JSON — ${text.slice(0, 300)}`);
  }
  if (body.ok !== true) {
    const msg =
      typeof body.msg === "string"
        ? body.msg
        : typeof body.error === "string"
          ? body.error
          : JSON.stringify(body).slice(0, 300);
    throw new Error(`MOOBIZ_OPERATORS_FETCH: ok!=true — ${msg}`);
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

export function mapOperatorRow(raw: Record<string, unknown>): Record<string, unknown> | null {
  const id = toTextId(raw.id);
  if (!id) return null;
  return {
    id,
    id_branch: toTextNullable(raw.id_branch),
    id_role: toTextNullable(raw.id_role),
    name: toTextNullable(raw.name),
    email: toTextNullable(raw.email),
    raw_data: raw,
  };
}

export type DownloadOperatorsResult = {
  rows: Record<string, unknown>[];
  uniqueCount: number;
  rawMappedRows: number;
  totalReported: number | null;
  pages: number;
  mode: "single_limit";
  reachedFetchCap: boolean;
};

export async function downloadAllOperatorsDeduped(token: string): Promise<DownloadOperatorsResult> {
  const limit = operatorsPageSize();
  const byId = new Map<string, Record<string, unknown>>();
  let rawMappedRows = 0;

  const body = await fetchOperatorsSingleLimit({ token, limit });
  const totalReported = extractTotal(body);
  const items = extractItems(body) as Record<string, unknown>[];
  const lastPageItemCount = items.length;

  console.log(`[Operators sync] GET único: limit=${limit}, ítems en respuesta=${items.length}`);

  const mapped = items.map(mapOperatorRow).filter(Boolean) as Record<string, unknown>[];
  console.log(`[Operators sync] Registros mapeables (con id)=${mapped.length}`);

  for (const row of mapped) {
    rawMappedRows += 1;
    byId.set(String(row.id), row);
  }

  const rows = [...byId.values()];
  const dupesRemoved = rawMappedRows - rows.length;
  if (dupesRemoved > 0) {
    console.log(
      `[Operators sync] Dedupe final: ${rawMappedRows} filas mapeadas → ${rows.length} únicos (eliminados ${dupesRemoved} duplicados por id).`,
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

async function replaceAllOperatorsRpc(
  supabase: SupabaseClient<any, "public", any>,
  rows: Record<string, unknown>[],
): Promise<number> {
  const { data, error } = await supabase.rpc("moobiz_operators_full_replace", {
    p_rows: rows as unknown as Record<string, unknown>[],
  });
  if (error) {
    throw new Error(
      `Supabase RPC moobiz_operators_full_replace: ${error.message}. ¿Aplicaste sql/20260504_moobiz_operators_full_replace_rpc.sql?`,
    );
  }
  return typeof data === "number" && Number.isFinite(data) ? data : rows.length;
}

async function countOperatorsInDb(supabase: SupabaseClient<any, "public", any>): Promise<number> {
  const { count, error } = await supabase
    .from("moobiz_operators")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`Supabase COUNT moobiz_operators: ${error.message}`);
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

export async function runMoobizOperatorsSync(): Promise<MoobizOperatorsSyncResult> {
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
    const { token } = await getTokenForOperatorsSync();
    const dl = await downloadAllOperatorsDeduped(token);
    pagesQueried = dl.pages;

    if (dl.uniqueCount === 0) {
      throw new Error(
        "MOOBIZ_OPERATORS_SYNC: la API no devolvió ningún operador válido; la tabla no se modifica.",
      );
    }

    const inserted = await replaceAllOperatorsRpc(supabase, dl.rows);
    const finalDbCount = await countOperatorsInDb(supabase);

    const validationErrors: string[] = [];
    if (dl.totalReported !== null && dl.totalReported !== dl.uniqueCount) {
      validationErrors.push(
        `La API declaró total=${dl.totalReported} pero se descargaron ${dl.uniqueCount} operadores únicos (diferencia ${dl.totalReported - dl.uniqueCount}).`,
      );
    }
    if (rawMappedRowsHasDupes(dl.rawMappedRows, dl.uniqueCount)) {
      validationErrors.push(
        `Filas mapeadas desde ítems: ${dl.rawMappedRows}; únicos tras dedupe: ${dl.uniqueCount} (hay duplicados por id en la API).`,
      );
    }
    if (finalDbCount !== dl.uniqueCount) {
      validationErrors.push(
        `Conteo en Supabase tras reemplazo (${finalDbCount}) ≠ operadores únicos descargados (${dl.uniqueCount}).`,
      );
    }
    if (inserted !== dl.uniqueCount) {
      validationErrors.push(
        `La RPC reportó ${inserted} filas insertadas; se esperaban ${dl.uniqueCount}.`,
      );
    }
    if (dl.reachedFetchCap) {
      validationErrors.push(
        `El GET único devolvió ${operatorsPageSize()} ítems (tope de limit) pero la API declara total=${dl.totalReported}; sube MOOBIZ_OPERATORS_PAGE_SIZE.`,
      );
    }

    const countMismatchWithApiTotal =
      dl.totalReported !== null && dl.totalReported !== dl.uniqueCount;
    const validationOk = validationErrors.length === 0;

    await writeOperatorsSyncMonitor({
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
    await writeOperatorsSyncMonitor({
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

export async function writeOperatorsSyncMonitor(payload: {
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
    last_id: "moobiz_operators",
    error_message: payload.error_message,
  };
  const { error } = await supabase.from("sync_monitor").insert(body);
  if (error) {
    console.error("[Operators sync] sync_monitor:", formatApiError(error));
  }
}
