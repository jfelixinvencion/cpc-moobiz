/**
 * Sync Moobiz admin dispatcher → Supabase `moobiz_services` (reemplazo total).
 *
 * GET https://app.moobiz.pe/api/admin/dispatcher?limit=1000&offset=0 (+ segunda página si total > 1000).
 * Token: mismo criterio que conductores (`getTokenForDriversSync`).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTokenForDriversSync } from "@/lib/moobiz-drivers-sync";

const DISPATCHER_URL_DEFAULT = "https://app.moobiz.pe/api/admin/dispatcher";
const PAGE_LIMIT = 1000;
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
}): Promise<DispatcherApiBody> {
  const url = new URL(dispatcherUrl());
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("offset", String(params.offset));

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

export type MoobizServicesSyncResult = {
  ok: boolean;
  deleted: number;
  inserted: number;
  pages: number;
};

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

export async function runMoobizServicesSync(): Promise<MoobizServicesSyncResult> {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { token } = await getTokenForDriversSync();

  const body1 = await fetchDispatcherPage({ token, offset: 0 });
  const totalReported = extractTotal(body1);
  const items1 = extractItems(body1) as Record<string, unknown>[];
  let pages = 1;

  const byId = new Map<string, { id: string; state: string; raw: Record<string, unknown> }>();
  for (const item of items1) {
    const row = mapServiceRow(item);
    if (row) byId.set(row.id, row);
  }

  if (typeof totalReported === "number" && totalReported > PAGE_LIMIT) {
    const body2 = await fetchDispatcherPage({ token, offset: PAGE_LIMIT });
    pages = 2;
    const items2 = extractItems(body2) as Record<string, unknown>[];
    for (const item of items2) {
      const row = mapServiceRow(item);
      if (row) byId.set(row.id, row);
    }
  }

  const rows = [...byId.values()];

  if (rows.length === 0) {
    throw new Error("MOOBIZ_SERVICES_SYNC: la API no devolvió ningún servicio válido (id requerido).");
  }

  const { deleted, inserted } = await replaceAllServices(supabase, rows);

  return {
    ok: true,
    deleted,
    inserted,
    pages,
  };
}
