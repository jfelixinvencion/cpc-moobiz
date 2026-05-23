/**
 * Sync de historial Moobiz -> Supabase (public.moobiz_services_history).
 *
 * Modo normal (defecto): order_col=date_updated, order_dir=desc, date_from=hoy−20 (YYYY-MM-DD),
 * date_to=ahora (ISO), 2×2000 por defecto (NORMAL_PAGES_FIXED×NORMAL_LIMIT_FIXED; env override).
 * --limit / --page en CLI. --order-col / --order_col
 * para date_scheduled u date_updated. Dedupe, fetchExistingIdsChunked, upsert, last_run;
 * si order_col=date_updated también guarda moobiz_services_history_last_date_updated (máx.
 * date_updated del run). Sin overlaps en sync_state.
 *
 * Prueba rápida:
 *   DOTENV_CONFIG_PATH=.env.local node -r dotenv/config scripts/sync_moobiz_history.js --limit=20 --page=1 --print-sample
 */
// Carga .env.local SOLO si NO estamos en un entorno CI (ej. GitHub Actions)
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  // DOTENV_CONFIG_PATH permite Windows/PowerShell overrides si existe
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { randomUUID } = require("node:crypto");
const { ensureMoobizToken, redactToken } = require("../helpers/refresh_moobiz_token");
const { fetchWithRetry } = require("../helpers/moobiz_fetch_retry");
const { ensureEnv, getMoobizTokenFallback, getMoobizTokenFromSyncStateOnly, getSupabaseUrl } = require("./lib/env");

const EXIT_CODES = {
  MISSING_CRITICAL_ENVS: 2,
  TOKEN_MISSING: 3,
  TOKEN_INVALID_AFTER_RETRIES: 4,
  SYNC_FAILED: 5,
};

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_EMAIL = process.env.MOOBIZ_EMAIL;
const MOOBIZ_PASSWORD = process.env.MOOBIZ_PASSWORD;

function trimTrailingSlashes(s) {
  return String(s).replace(/\/+$/, "");
}

/** Host base como la UI (default https://app.moobiz.pe). */
const MOOBIZ_API_BASE_URL = trimTrailingSlashes(
  (process.env.MOOBIZ_API_BASE_URL && String(process.env.MOOBIZ_API_BASE_URL).trim()) ||
    "https://app.moobiz.pe",
);
/** URL completa del listado admin/services (override legacy con MOOBIZ_SERVICES_URL si existe). */
const MOOBIZ_SERVICES_URL =
  (process.env.MOOBIZ_SERVICES_URL && String(process.env.MOOBIZ_SERVICES_URL).trim()) ||
  `${MOOBIZ_API_BASE_URL}/api/admin/services`;
const ADMIN_LOGIN_URL = `${MOOBIZ_API_BASE_URL}/api/admin/login/login`;
const MOOBIZ_WEB_ORIGIN = MOOBIZ_API_BASE_URL;
/** Solo modo normal: marca de última corrida (no se usa como filtro). */
const LAST_RUN_KEY = "moobiz_services_history_last_run";
const LAST_DATE_UPDATED_KEY = "moobiz_services_history_last_date_updated";
// Leer límite y páginas desde variables de entorno (fallback: 2000×2 por corrida en modo normal).
const NORMAL_LIMIT_FIXED = Number(process.env.NORMAL_LIMIT_FIXED) || 2000;
const NORMAL_PAGES_FIXED = Number(process.env.NORMAL_PAGES_FIXED) || 2;
const NORMAL_DELAY_MS_FIXED = 200;

const PAGE_SIZE_DEFAULT = Number.parseInt(process.env.MOOBIZ_HISTORY_PAGE_SIZE || "", 10) || 1000;
const MAX_RECORDS_DEFAULT =
  Number.parseInt(process.env.MOOBIZ_HISTORY_MAX_RECORDS || "", 10) || 5000;
const MAX_PAGES_DEFAULT = Number.parseInt(process.env.MOOBIZ_HISTORY_MAX_PAGES || "", 10) || 2;
const OVERLAP_HOURS = 24;
const SUPABASE_BATCH_SIZE = 200;
const DELAY_MS_DEFAULT = Number.parseInt(process.env.MOOBIZ_HISTORY_DELAY_MS || "", 10) || 200;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseCliArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) {
      const key = raw.slice(2).trim();
      if (key) out[key] = "true";
      continue;
    }
    const key = raw.slice(2, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

const CLI_ARGS = parseCliArgs(process.argv.slice(2));
const RUN_MODE = String(CLI_ARGS.mode || "").trim().toLowerCase() || "normal";
const PAGES_BACKFILL_MODE = RUN_MODE === "pages_backfill";
const DATE_FROM_OVERRIDE = String(CLI_ARGS.date_from || "").trim();
const DATE_TO_OVERRIDE = String(CLI_ARGS.date_to || "").trim();
const SERVICE_ID_DEBUG = String(CLI_ARGS.id || "").trim();
const PRINT_SAMPLE =
  String(CLI_ARGS["print-sample"] || CLI_ARGS.print_sample || "").toLowerCase() === "true";
const MANUAL_RANGE_MODE = Boolean(DATE_FROM_OVERRIDE || DATE_TO_OVERRIDE);
const PAGE_SIZE = Number.parseInt(CLI_ARGS.page_size || "", 10) || PAGE_SIZE_DEFAULT;
const MAX_RECORDS = Number.parseInt(CLI_ARGS.max_records || "", 10) || MAX_RECORDS_DEFAULT;
const MAX_PAGES = Number.parseInt(CLI_ARGS.max_pages || "", 10) || MAX_PAGES_DEFAULT;
const DELAY_MS = Number.parseInt(CLI_ARGS.delay_ms || "", 10) || DELAY_MS_DEFAULT;
const BACKFILL_PAGES = PAGES_BACKFILL_MODE
  ? Number.parseInt(String(CLI_ARGS.pages || "").trim(), 10) || 20
  : 20;
const BACKFILL_LIMIT = PAGES_BACKFILL_MODE
  ? Number.parseInt(String(CLI_ARGS.limit || "").trim(), 10) || 1000
  : 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function fetchJsonOrThrow(url, options, label) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`${label} failed (${res.status}): ${await res.text()}`);
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

async function readSyncStateValue(key) {
  const rows = await fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/sync_state?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: supabaseHeaders() },
    `Read sync_state ${key}`,
  );
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const v = rows[0].value;
  return typeof v === "string" ? v.trim() : "";
}

async function writeSyncStateValue(key, value) {
  const trimmed = String(value ?? "").trim();
  await fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/sync_state`,
    {
      method: "POST",
      headers: supabaseHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      }),
      body: JSON.stringify({ key, value: trimmed }),
    },
    `Upsert sync_state ${key}`,
  );
}

async function moobizAdminLogin() {
  const username = typeof MOOBIZ_EMAIL === "string" ? MOOBIZ_EMAIL.trim() : "";
  const password = typeof MOOBIZ_PASSWORD === "string" ? MOOBIZ_PASSWORD.trim() : "";
  if (!username || !password) {
    throw new Error(
      "Faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD (requeridas para renovar token de historial).",
    );
  }

  const body = {
    username,
    password,
    uuid: randomUUID(),
    language: "es",
    os: "Windows",
    os_version: "10",
    device_brand: "Chrome",
    device_model: "147.0.0.0",
    app_version_code: 193,
    time_zone_offset: -5,
    user_agent: CHROME_UA,
    country_code: "US",
  };

  const res = await fetch(ADMIN_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: MOOBIZ_WEB_ORIGIN,
      Referer: `${MOOBIZ_WEB_ORIGIN}/`,
      "User-Agent": CHROME_UA,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MOOBIZ_LOGIN_FAILED: HTTP ${res.status} — ${text.slice(0, 400)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`MOOBIZ_LOGIN_FAILED: respuesta no JSON — ${text.slice(0, 300)}`);
  }

  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    const msg = typeof parsed.msg === "string" ? parsed.msg : "";
    throw new Error(
      `MOOBIZ_LOGIN_FAILED: sin token válido${msg ? ` — ${msg}` : ""} — ${text.slice(0, 280)}`,
    );
  }

  const token = parsed.token.trim();
  console.log("[history-sync] Login admin OK, token", redactToken(token));
  return token;
}

let moobizBearer = null;

async function ensureMoobizBearer() {
  if (moobizBearer && moobizBearer.trim()) return moobizBearer;
  const fromEnv = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (fromEnv) {
    moobizBearer = fromEnv;
    console.log("[history-sync] Bearer desde MOOBIZ_TOKEN:", redactToken(moobizBearer));
    return moobizBearer;
  }
  const fallback = await getMoobizTokenFallback();
  if (fallback) {
    moobizBearer = fallback;
    console.log("[history-sync] Bearer desde sync_state fallback:", redactToken(moobizBearer));
    return moobizBearer;
  }
  const fresh = await ensureMoobizToken();
  moobizBearer = fresh;
  console.log("[history-sync] Bearer resuelto por ensureMoobizToken:", redactToken(moobizBearer));
  return moobizBearer;
}

/** Modo one-time backfill: no lee ni escribe sync_state. */
async function ensureMoobizBearerNoSyncState() {
  if (moobizBearer && moobizBearer.trim()) return moobizBearer;
  const fresh = await moobizAdminLogin();
  moobizBearer = fresh;
  return moobizBearer;
}

function toIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Fecha calendario local YYYY-MM-DD (como envía la UI en date_from / date_to). */
function formatYyyyMmDdFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Hoy − N días en calendario local, YYYY-MM-DD (API). */
function ymdDaysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatYyyyMmDdFromDate(d);
}

/** Normaliza CLI/ISO a YYYY-MM-DD para el API. */
function toApiYyyyMmDd(value) {
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = toIsoDate(s);
  if (iso) return iso.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatYyyyMmDdFromDate(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function finalizedMsFromRaw(raw) {
  const iso =
    toIsoDate(raw?.date_finalized) ||
    toIsoDate(raw?.date_finished) ||
    toIsoDate(raw?.date_completed) ||
    toIsoDate(raw?.date_end);
  if (!iso) return NaN;
  return Date.parse(iso);
}

function parseMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Diagnóstico --print-sample (tolerar top-level o raw_data). */
function pickFechaProgramadaSample(r) {
  if (!r) return "";
  if (r.date_scheduled) return r.date_scheduled;
  const raw = r.raw_data;
  if (!raw || typeof raw !== "object") return "";
  return (
    toIsoDate(raw.date_scheduled) ||
    toIsoDate(raw.date_programmed) ||
    toIsoDate(raw.date_start) ||
    ""
  );
}

function pickFechaActualizadaSample(r) {
  if (!r) return "";
  const raw = r.raw_data;
  if (raw && typeof raw === "object") {
    const fromRaw =
      toIsoDate(raw.date_updated) ||
      toIsoDate(raw.updated_at) ||
      toIsoDate(raw.date_modified) ||
      toIsoDate(raw.modified_at) ||
      toIsoDate(raw.last_update) ||
      "";
    if (fromRaw) return fromRaw;
  }
  return "";
}

/** Mayor date_updated (ISO) entre filas dedupe; timestamps vía Date.parse (sync_state). */
function maxDateUpdatedIsoFromRows(rowsDedup) {
  if (!rowsDedup || rowsDedup.length === 0) return null;
  const cands = rowsDedup
    .map((r) => (r.raw_data && r.raw_data.date_updated) || r.date_updated)
    .slice(0, 50);
  console.log("[history-sync] candidatos date_updated:", cands);
  const maxTs = rowsDedup.reduce((acc, r) => {
    const cand =
      (r.raw_data && (r.raw_data.date_updated ?? r.raw_data["date_updated"])) || r.date_updated || null;
    if (cand == null || cand === "") return acc;
    const ts = Date.parse(String(cand));
    if (Number.isNaN(ts)) return acc;
    return acc === null || ts > acc ? ts : acc;
  }, null);
  return maxTs != null ? new Date(maxTs).toISOString() : null;
}

/** order_col permitido en modo normal (CLI --order-col= o --order_col=). */
function normalizeNormalOrderCol(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return "date_updated";
  if (v === "date_updated" || v === "date_scheduled") return v;
  return "date_updated";
}

function normalizeServiceRow(raw) {
  const idVal = raw.id ?? raw.service_id ?? raw.id_service ?? raw.idService;
  const id = toText(idVal);
  if (!id) return null;

  const finalized =
    toIsoDate(raw.date_finalized) ||
    toIsoDate(raw.date_finished) ||
    toIsoDate(raw.date_completed) ||
    toIsoDate(raw.date_end);
  const scheduled =
    toIsoDate(raw.date_scheduled) || toIsoDate(raw.date_programmed) || toIsoDate(raw.date_start);
  const userName =
    toText(raw.user_name) ||
    toText(raw.us_name) ||
    toText(raw.passenger_name) ||
    toText(raw.user?.name);
  const amount = parseMoney(raw.amount ?? raw.price ?? raw.total ?? raw.cost);
  const status = toText(raw.status ?? raw.state ?? raw.service_status);
  const serviceId = toText(raw.service_id ?? raw.id_service ?? raw.id ?? raw.idService);

  return {
    id,
    service_id: serviceId || id,
    date_finalized: finalized,
    date_scheduled: scheduled,
    status: status || null,
    user_name: userName || null,
    amount,
    raw_data: raw,
  };
}

/** Solo columnas persistibles en moobiz_services_history (sin metadatos internos). */
function stripHistoryRowForUpsert(row) {
  return {
    id: row.id,
    service_id: row.service_id,
    date_finalized: row.date_finalized,
    date_scheduled: row.date_scheduled,
    status: row.status,
    user_name: row.user_name,
    amount: row.amount,
    raw_data: row.raw_data,
  };
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.services)) return payload.services;
  return [];
}

async function fetchServicesPage({
  page,
  dateFrom,
  dateTo,
  limit,
  skipSyncStateToken,
  serviceId,
  /** Modo normal por defecto date_updated; backfill/manual/--id igual. */
  orderCol = "date_updated",
  orderDir = "desc",
}) {
  if (skipSyncStateToken) {
    await ensureMoobizBearerNoSyncState();
  } else {
    await ensureMoobizBearer();
  }

  const p = new URLSearchParams();
  p.set("limit", String(limit ?? PAGE_SIZE));
  p.set("page", String(page));
  if (dateFrom) p.set("date_from", dateFrom);
  if (dateTo) p.set("date_to", dateTo);
  if (serviceId) p.set("id", String(serviceId));
  p.set("order_col", orderCol);
  p.set("order_dir", orderDir);

  const url = `${MOOBIZ_SERVICES_URL}?${p.toString()}`;
  console.log(`[history-sync] GET (order_col=${orderCol} order_dir=${orderDir}): ${url}`);

  const buildHeaders = () => {
    const t = String(moobizBearer || "").trim();
    if (!t) {
      throw new Error("[history-sync] Bearer vacío al construir headers GET services.");
    }
    return {
      Authorization: `Bearer ${t}`,
      "X-Auth-Token": t,
      Accept: "application/json",
      Origin: MOOBIZ_WEB_ORIGIN,
      Referer: `${MOOBIZ_WEB_ORIGIN}/`,
      "User-Agent": CHROME_UA,
    };
  };
  const doFetch = () => {
    const t = String(moobizBearer || "").trim();
    if (!t) {
      throw new Error("[history-sync] Bearer vacío: no se puede llamar a /api/admin/services sin token.");
    }
    const authHeader = `Bearer ${t}`;
    console.log("[history-sync] REQUEST HEADERS:", {
      Authorization: authHeader.slice(0, 12) + "...",
      Accept: "application/json",
    });
    return fetchWithRetry(
      url,
      { method: "GET", headers: buildHeaders(), cache: "no-store" },
      { label: "history-sync:moobiz", retries: 3, backoffMs: [1000, 2000, 4000] },
    );
  };

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    console.warn(`[history-sync] Services HTTP ${res.status} (page ${page}) — renovando token…`);
    let fresh = null;
    if (skipSyncStateToken) {
      fresh = await ensureMoobizBearerNoSyncState();
    } else {
      try {
        fresh = await ensureMoobizToken();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[history-sync] ensureMoobizToken falló (${msg}) — intentando token desde sync_state…`);
        fresh = await getMoobizTokenFromSyncStateOnly();
      }
    }
    if (!fresh) {
      throw new Error(
        `Fetch services page ${page}: token invalid after retries (auth ${res.status}, sin token).`,
      );
    }
    moobizBearer = fresh;
    res = await doFetch();
    if ((res.status === 401 || res.status === 403) && !skipSyncStateToken) {
      console.warn(
        `[history-sync] Services HTTP ${res.status} (page ${page}) tras refresh — releyendo moobiz_token en sync_state…`,
      );
      const db = await getMoobizTokenFromSyncStateOnly();
      if (db && db !== moobizBearer) {
        moobizBearer = db;
        res = await doFetch();
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Fetch services page ${page}: token invalid after retries (auth ${res.status} tras renovación y sync_state).`,
      );
    }
  }

  if (!res.ok) {
    throw new Error(`Fetch services page ${page} failed (${res.status}): ${await res.text()}`);
  }

  const raw = await res.text();
  const parsed = raw ? JSON.parse(raw) : {};
  return extractItems(parsed);
}

async function upsertHistoryRows(rows) {
  if (rows.length === 0) return { processed: 0, countedByApi: null };
  let processed = 0;
  let countedByApi = 0;
  let countReliable = true;
  for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
    const batch = rows.slice(i, i + SUPABASE_BATCH_SIZE);
    const body = await fetchJsonOrThrow(
      `${SUPABASE_URL}/rest/v1/moobiz_services_history?on_conflict=id`,
      {
        method: "POST",
        headers: supabaseHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,count=exact,return=representation",
        }),
        body: JSON.stringify(batch),
      },
      `Upsert moobiz_services_history batch ${Math.floor(i / SUPABASE_BATCH_SIZE) + 1}`,
    );
    processed += batch.length;
    if (Array.isArray(body)) {
      countedByApi += body.length;
    } else {
      countReliable = false;
    }
  }
  return { processed, countedByApi: countReliable ? countedByApi : null };
}

/** IDs ya presentes en moobiz_services_history (lectura por trozos; modo normal usa 250). */
const EXISTING_IDS_CHUNK_SIZE_NORMAL = 250;

async function fetchExistingIdsChunked(ids) {
  const unique = [...new Set((ids || []).map((x) => String(x ?? "").trim()).filter(Boolean))];
  const existing = new Set();
  if (unique.length === 0) return existing;
  for (let i = 0; i < unique.length; i += EXISTING_IDS_CHUNK_SIZE_NORMAL) {
    const chunk = unique.slice(i, i + EXISTING_IDS_CHUNK_SIZE_NORMAL);
    const inList = chunk.map((id) => encodeURIComponent(id)).join(",");
    const rows = await fetchJsonOrThrow(
      `${SUPABASE_URL}/rest/v1/moobiz_services_history?id=in.(${inList})&select=id`,
      { headers: supabaseHeaders() },
      `Fetch existing moobiz_services_history ids chunk ${Math.floor(i / EXISTING_IDS_CHUNK_SIZE_NORMAL) + 1}`,
    );
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const id = row && typeof row.id === "string" ? row.id.trim() : "";
        if (id) existing.add(id);
      }
    }
  }
  return existing;
}

/** Cuenta cuántos de los ids ya existían en moobiz_services_history (solo lectura, en trozos). */
async function countExistingHistoryIds(ids) {
  const unique = [...new Set((ids || []).map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (unique.length === 0) return 0;
  const CHUNK = 100;
  let existing = 0;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const inList = chunk.map((id) => encodeURIComponent(id)).join(",");
    const rows = await fetchJsonOrThrow(
      `${SUPABASE_URL}/rest/v1/moobiz_services_history?id=in.(${inList})&select=id`,
      { headers: supabaseHeaders() },
      `Count existing moobiz_services_history ids chunk ${Math.floor(i / CHUNK) + 1}`,
    );
    if (Array.isArray(rows)) existing += rows.length;
  }
  return existing;
}

function computeCursorDate(rows, fallbackIso) {
  let max = fallbackIso ? Date.parse(fallbackIso) : NaN;
  for (const row of rows) {
    const t = row?.date_finalized ? Date.parse(row.date_finalized) : NaN;
    if (!Number.isNaN(t) && (Number.isNaN(max) || t > max)) max = t;
  }
  if (Number.isNaN(max)) return fallbackIso || null;
  return new Date(max).toISOString();
}

async function sync() {
  console.log("[history-sync] Iniciando sincronización de historial...");
  let status = "success";
  let recordsProcessed = 0;
  let recordsReturnedByUpsert = null;
  let registrosNuevosEstimados = null;
  let registrosActualizadosEstimados = null;
  let reasonForStop = null;
  let pagesQueried = 0;
  let errorMessage = null;
  let cursorAfter = "";

  try {
    ensureEnv(["SUPABASE_SERVICE_ROLE_KEY"]);
    if (!SUPABASE_URL || !String(SUPABASE_URL).trim()) {
      console.error("[history-sync] Falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL).");
      process.exit(EXIT_CODES.MISSING_CRITICAL_ENVS);
    }
    if (!SUPABASE_SERVICE_ROLE_KEY || !String(SUPABASE_SERVICE_ROLE_KEY).trim()) {
      console.error("[history-sync] Falta SUPABASE_SERVICE_ROLE_KEY.");
      process.exit(EXIT_CODES.MISSING_CRITICAL_ENVS);
    }

    moobizBearer = null;
    if (!PAGES_BACKFILL_MODE) {
      const initialToken = await ensureMoobizBearer();
      if (!initialToken) {
        console.error("[history-sync] No MOOBIZ_TOKEN disponible por env/sync_state.");
        process.exit(EXIT_CODES.TOKEN_MISSING);
      }
      moobizBearer = initialToken;
    }

    const date_to = new Date().toISOString();
    console.log(
      `[history-sync] date_to_utc=${date_to} date_to_local=${new Date(date_to).toLocaleString()}`,
    );

    if (RUN_MODE !== "normal" && RUN_MODE !== "pages_backfill") {
      throw new Error(`Modo no soportado: ${RUN_MODE}. Usa --mode=pages_backfill o sin --mode.`);
    }

    if (PAGES_BACKFILL_MODE) {
      const nowIso = new Date().toISOString();
      const mode = "pages_backfill";
      console.log(`[history-sync] modo=${mode} (one-time), sin cursor/sync_state`);
      console.log(
        `[history-sync] backfill por páginas: PAGE_SIZE=${BACKFILL_LIMIT}, MAX_PAGES=${BACKFILL_PAGES}, delay_ms=${DELAY_MS}`,
      );

      let totalCollected = 0;
      let totalUpserted = 0;
      let seenAnyPage = false;

      for (let page = 1; page <= BACKFILL_PAGES; page += 1) {
        const items = await fetchServicesPage({
          page,
          limit: BACKFILL_LIMIT,
          skipSyncStateToken: true,
        });
        pagesQueried = page;

        if (items.length === 0) {
          reasonForStop = "empty_page_response";
          break;
        }
        seenAnyPage = true;

        const pageRows = [];
        const seenPage = new Set();
        for (const raw of items) {
          const normalized = normalizeServiceRow(raw);
          if (!normalized) continue;
          if (seenPage.has(normalized.id)) continue;
          seenPage.add(normalized.id);
          pageRows.push(normalized);
        }

        const upsertStats = await upsertHistoryRows(pageRows);
        totalCollected += pageRows.length;
        totalUpserted += upsertStats.processed;
        recordsReturnedByUpsert =
          recordsReturnedByUpsert === null || upsertStats.countedByApi === null
            ? null
            : recordsReturnedByUpsert + upsertStats.countedByApi;

        console.log(
          `[history-sync] Página ${page}/${BACKFILL_PAGES}: +${pageRows.length} registros (Total: ${totalCollected})`,
        );

        if (items.length < BACKFILL_LIMIT) {
          reasonForStop = "partial_batch_last_page";
          break;
        }
        await sleep(DELAY_MS);
      }

      recordsProcessed = totalUpserted;
      registrosNuevosEstimados = null;
      registrosActualizadosEstimados = null;
      reasonForStop = reasonForStop || (seenAnyPage ? "max_pages_safety" : "empty_page_response");
      cursorAfter = "";

      console.log(
        JSON.stringify({
          status,
          mode,
          registros_procesados: recordsProcessed,
          filas_devueltas_upsert: recordsReturnedByUpsert,
          pages_queried: pagesQueried,
          date_from: null,
          date_to: nowIso,
          cursor_after: null,
        }),
      );
      console.log("[history-sync] ✅ Backfill por páginas completado");
      return;
    }

    if (SERVICE_ID_DEBUG) {
      if (!DATE_FROM_OVERRIDE || !DATE_TO_OVERRIDE) {
        throw new Error(
          "Con --id debes indicar --date_from=YYYY-MM-DD y --date_to=YYYY-MM-DD (igual que en la UI).",
        );
      }
      const mode = "single_id_debug";
      const dateFromYmd = toApiYyyyMmDd(DATE_FROM_OVERRIDE);
      const dateToYmd = toApiYyyyMmDd(DATE_TO_OVERRIDE);
      console.log(
        `[history-sync] modo=${mode} id=${SERVICE_ID_DEBUG} date_from=${dateFromYmd} date_to=${dateToYmd} base=${MOOBIZ_API_BASE_URL}`,
      );

      const items = await fetchServicesPage({
        page: 1,
        dateFrom: dateFromYmd,
        dateTo: dateToYmd,
        limit: PAGE_SIZE,
        skipSyncStateToken: false,
        serviceId: SERVICE_ID_DEBUG,
      });
      pagesQueried = 1;
      console.log(`[history-sync] ${mode}: API devolvió ${items.length} ítem(s).`);

      const pageRows = [];
      const seenPage = new Set();
      for (const raw of items) {
        const normalized = normalizeServiceRow(raw);
        if (!normalized) continue;
        if (seenPage.has(normalized.id)) continue;
        seenPage.add(normalized.id);
        pageRows.push(stripHistoryRowForUpsert(normalized));
      }

      const upsertStats = await upsertHistoryRows(pageRows);
      recordsProcessed = upsertStats.processed;
      recordsReturnedByUpsert = upsertStats.countedByApi;
      registrosNuevosEstimados = null;
      registrosActualizadosEstimados = null;
      reasonForStop = `single_id_debug;api_items=${items.length}`;
      cursorAfter = "";

      console.log(
        JSON.stringify({
          status,
          mode,
          id: SERVICE_ID_DEBUG,
          api_items: items.length,
          registros_procesados: recordsProcessed,
          filas_devueltas_upsert: recordsReturnedByUpsert,
          date_from: dateFromYmd,
          date_to: dateToYmd,
        }),
      );
      console.log("[history-sync] ✅ Modo --id completado");
      return;
    }

    if (MANUAL_RANGE_MODE && (!DATE_FROM_OVERRIDE || !DATE_TO_OVERRIDE)) {
      throw new Error(
        "Modo manual inválido: cuando uses argumentos debes enviar ambos --date_from y --date_to.",
      );
    }

    if (!MANUAL_RANGE_MODE) {
      const runStartedAt = new Date().toISOString();
      const mode = "normal_2pages";
      const normalOrderCol = normalizeNormalOrderCol(CLI_ARGS["order-col"] || CLI_ARGS.order_col);

      const parsedLimit = Number.parseInt(String(CLI_ARGS.limit || "").trim(), 10);
      const effectiveLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : NORMAL_LIMIT_FIXED;

      const parsedPageRounds = Number.parseInt(
        String(CLI_ARGS.page || CLI_ARGS.pages || "").trim(),
        10,
      );
      const effectivePageRounds =
        Number.isFinite(parsedPageRounds) && parsedPageRounds > 0
          ? Math.min(parsedPageRounds, 50)
          : NORMAL_PAGES_FIXED;

      const dateFromYmd = ymdDaysAgoLocal(20);

      console.log(
        `[history-sync] run params: order_col=${normalOrderCol} date_from=${dateFromYmd} date_to=${date_to} pages=${effectivePageRounds} limit=${effectiveLimit}`,
      );
      console.log(
        `[history-sync] modo=${mode} run_started_at=${runStartedAt} delay_ms=${NORMAL_DELAY_MS_FIXED} base=${MOOBIZ_API_BASE_URL}`,
      );

      const byId = new Map();

      for (let page = 1; page <= effectivePageRounds; page += 1) {
        const items = await fetchServicesPage({
          page,
          dateFrom: dateFromYmd,
          dateTo: date_to,
          limit: effectiveLimit,
          skipSyncStateToken: false,
          orderCol: normalOrderCol,
          orderDir: "desc",
        });
        pagesQueried = page;

        for (const raw of items) {
          const normalized = normalizeServiceRow(raw);
          if (!normalized) continue;
          byId.set(normalized.id, normalized);
        }

        console.log(
          `[history-sync] Página ${page}/${effectivePageRounds}: API_items=${items.length} ids_unicos_acum=${byId.size}`,
        );

        if (page < effectivePageRounds) await sleep(NORMAL_DELAY_MS_FIXED);
      }

      const collected = [...byId.values()];
      console.log(`[history-sync] filas unicas tras dedupe: ${collected.length}`);

      if (PRINT_SAMPLE) {
        console.log("[history-sync] SAMPLE first 20 (id, date_scheduled, date_updated):");
        const sampleFirst20 = collected.slice(0, 20).map((r) => ({
          id: r.id,
          date_scheduled: pickFechaProgramadaSample(r) || "",
          date_updated: pickFechaActualizadaSample(r) || "",
        }));
        if (typeof console.table === "function") {
          console.table(sampleFirst20);
        } else {
          console.log(JSON.stringify(sampleFirst20, null, 2));
        }
      }

      const idsToProcess = collected.map((r) => r.id);
      const total = idsToProcess.length;
      const existingIdsSet = await fetchExistingIdsChunked(idsToProcess);
      const actualizados = idsToProcess.filter((id) => existingIdsSet.has(id)).length;
      const nuevos = total - actualizados;
      registrosNuevosEstimados = nuevos;
      registrosActualizadosEstimados = actualizados;
      console.log(
        `[history-sync] métricas (pre-upsert, ids vs DB): total_ids=${total} existentes=${actualizados} registros_nuevos=${nuevos} registros_actualizados=${actualizados}`,
      );

      const rowsForUpsert = collected.map(stripHistoryRowForUpsert);
      const upsertStats = await upsertHistoryRows(rowsForUpsert);
      recordsProcessed = total;
      recordsReturnedByUpsert = upsertStats.countedByApi;

      if (recordsReturnedByUpsert === null) {
        console.log(
          "[history-sync] Supabase no devolvió conteo confiable de filas devueltas por upsert; sync_monitor usa nuevos/actualizados exactos del pre-chequeo.",
        );
      } else {
        console.log(
          `[history-sync] filas devueltas por upsert (representación API): ${recordsReturnedByUpsert}`,
        );
      }

      await writeSyncStateValue(LAST_RUN_KEY, runStartedAt);

      let lastDateUpdatedSaved = null;
      if (normalOrderCol === "date_updated") {
        const maxUpd = maxDateUpdatedIsoFromRows(collected);
        if (maxUpd) {
          await writeSyncStateValue(LAST_DATE_UPDATED_KEY, maxUpd);
          lastDateUpdatedSaved = maxUpd;
          console.log(`[history-sync] saved last_date_updated=${maxUpd}`);
        }
      }

      pagesQueried = effectivePageRounds;
      reasonForStop = `ok_2pages_sync;order_col=${normalOrderCol};nuevos=${nuevos};actualizados=${actualizados};run_started_at=${runStartedAt}`;
      cursorAfter = runStartedAt;

      console.log(
        JSON.stringify({
          status,
          mode,
          order_col: normalOrderCol,
          run_started_at: runStartedAt,
          registros_procesados: total,
          registros_nuevos_estimados: nuevos,
          registros_actualizados_estimados: actualizados,
          filas_devueltas_upsert: recordsReturnedByUpsert,
          pages_queried: effectivePageRounds,
          limit: effectiveLimit,
          date_from: dateFromYmd,
          date_to: date_to,
          last_run_saved_key: LAST_RUN_KEY,
          ...(normalOrderCol === "date_updated"
            ? {
                last_date_updated_key: LAST_DATE_UPDATED_KEY,
                last_date_updated_saved: lastDateUpdatedSaved,
              }
            : {}),
        }),
      );
      console.log("[history-sync] ✅ Sync completado");
      return;
    }

    const dateFromYmdManual = toApiYyyyMmDd(DATE_FROM_OVERRIDE);
    const dateToYmdManual = toApiYyyyMmDd(DATE_TO_OVERRIDE);
    const nowIso = new Date().toISOString();
    const mode = "manual_range";

    console.log(`[history-sync] modo=${mode} overlap_h=${OVERLAP_HOURS}`);
    console.log(
      `[history-sync] Iniciando barrido manual date_from=${dateFromYmdManual} date_to=${dateToYmdManual} base=${MOOBIZ_API_BASE_URL}`,
    );

    const effectivePageSize = PAGE_SIZE;
    const effectiveMaxPages = MAX_PAGES;
    const effectiveMaxRecords = MAX_RECORDS;
    console.log(
      `[history-sync] límites de seguridad: PAGE_SIZE=${effectivePageSize}, MAX_RECORDS=${effectiveMaxRecords}, MAX_PAGES=${effectiveMaxPages}, overlap_h=${OVERLAP_HOURS}, delay_ms=${DELAY_MS}`,
    );

    const collected = [];
    const seen = new Set();
    let page = 1;
    let continueLoop = true;
    const dateFromMs = dateFromYmdManual ? Date.parse(dateFromYmdManual) : NaN;

    while (continueLoop) {
      if (page > effectiveMaxPages) {
        console.warn(
          `[history-sync] corte de seguridad: se alcanzaron ${effectiveMaxPages} páginas (${effectiveMaxPages * effectivePageSize} registros teóricos) sin cerrar rango.`,
        );
        reasonForStop = "max_pages_safety";
        break;
      }
      const items = await fetchServicesPage({
        page,
        dateFrom: dateFromYmdManual || undefined,
        dateTo: dateToYmdManual,
        limit: effectivePageSize,
        skipSyncStateToken: false,
      });
      pagesQueried = page;
      if (items.length === 0) {
        reasonForStop = "empty_page_response";
        break;
      }

      let addedThisPage = 0;
      let oldestFinalizedInPage = NaN;
      for (const raw of items) {
        const ms = finalizedMsFromRaw(raw);
        if (!Number.isNaN(ms) && (Number.isNaN(oldestFinalizedInPage) || ms < oldestFinalizedInPage)) {
          oldestFinalizedInPage = ms;
        }

        const normalized = normalizeServiceRow(raw);
        if (!normalized) continue;
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        collected.push(normalized);
        addedThisPage += 1;
        if (collected.length >= effectiveMaxRecords) {
          continueLoop = false;
          break;
        }
      }
      console.log(
        `[history-sync] Página ${page}/${effectiveMaxPages}: +${addedThisPage} registros (Total acumulado: ${collected.length})`,
      );

      if (!continueLoop) {
        reasonForStop = "max_records_safety";
        break;
      }
      if (items.length < effectivePageSize) {
        reasonForStop = "partial_batch_last_page";
        break;
      }
      if (collected.length >= effectiveMaxRecords) {
        console.warn(`[history-sync] corte de seguridad: MAX_RECORDS=${effectiveMaxRecords} alcanzado.`);
        reasonForStop = "max_records_safety";
        break;
      }
      if (!Number.isNaN(dateFromMs) && !Number.isNaN(oldestFinalizedInPage) && oldestFinalizedInPage < dateFromMs) {
        console.log("[history-sync] corte por rango: última fecha de página quedó por debajo de date_from.");
        reasonForStop = "below_date_from_overlap";
        break;
      }
      page += 1;
      await sleep(DELAY_MS);
    }

    recordsProcessed = collected.length;
    console.log(`[history-sync] registros normalizados: ${collected.length}`);
    if (collected.length === 0) {
      registrosActualizadosEstimados = 0;
      registrosNuevosEstimados = 0;
    } else {
      const existedBefore = await countExistingHistoryIds(collected.map((r) => r.id));
      registrosActualizadosEstimados = existedBefore;
      registrosNuevosEstimados = Math.max(0, collected.length - existedBefore);
    }
    const upsertStats = await upsertHistoryRows(collected.map(stripHistoryRowForUpsert));
    recordsProcessed = upsertStats.processed;
    recordsReturnedByUpsert = upsertStats.countedByApi;
    if (recordsReturnedByUpsert === null) {
      console.log(
        "[history-sync] Supabase no devolvió conteo confiable de filas devueltas por upsert; métricas sync_monitor usan estimación previa al upsert.",
      );
    } else {
      console.log(
        `[history-sync] filas devueltas por upsert (nuevas o actualizadas, no separables): ${recordsReturnedByUpsert}`,
      );
    }

    cursorAfter = computeCursorDate(collected, nowIso) || nowIso;
    console.log(`[history-sync] modo ${mode}: max date_finalizado calculado=${cursorAfter} (no se escribe sync_state).`);

    console.log(
      JSON.stringify({
        status,
        mode,
        registros_procesados: recordsProcessed,
        filas_devueltas_upsert: recordsReturnedByUpsert,
        registros_nuevos_estimados: registrosNuevosEstimados,
        registros_actualizados_estimados: registrosActualizadosEstimados,
        pages_queried: pagesQueried,
        date_from: dateFromYmdManual,
        date_to: dateToYmdManual,
        date_to_iso: nowIso,
        cursor_after: cursorAfter,
      }),
    );
    console.log("[history-sync] ✅ Sync completado");
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    try {
      const reasonResolved =
        reasonForStop ?? (status === "error" ? "sync_exception" : "unknown_stop");
      const reasonWithMode =
        PAGES_BACKFILL_MODE
          ? `${reasonResolved};mode=pages_backfill;pages=${BACKFILL_PAGES};limit=${BACKFILL_LIMIT}`
          : reasonResolved;
      const monitorPayload = {
        status,
        records_procesados: recordsProcessed,
        records_inserted: recordsProcessed,
        registros_nuevos_estimados: registrosNuevosEstimados,
        registros_actualizados_estimados: registrosActualizadosEstimados,
        reason_for_stop: reasonWithMode,
        pages_queried: pagesQueried,
        last_id: "moobiz_services_history",
        error_message: errorMessage,
      };
      console.log("[history-sync] sync_monitor payload:", JSON.stringify(monitorPayload));
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/sync_monitor`,
        {
          method: "POST",
          headers: supabaseHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(monitorPayload),
        },
        "Insert sync_monitor history",
      );
    } catch (e) {
      console.error(
        "[history-sync] sync_monitor insert falló:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

sync().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[history-sync] ❌ Error:", msg);
  if (/401|403|auth|token/i.test(msg)) {
    process.exit(EXIT_CODES.TOKEN_INVALID_AFTER_RETRIES);
  }
  process.exit(EXIT_CODES.SYNC_FAILED);
});
