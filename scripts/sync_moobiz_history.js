/**
 * Sync de historial Moobiz -> Supabase (public.moobiz_services_history).
 *
 * Modo normal: 2 páginas (1000 c/u), date_from=hoy−7 y date_to=hoy (YYYY-MM-DD), API con
 * order_col=date_updated&order_dir=desc; dedupe por id; métricas nuevos/actualizados vía
 * fetchExistingIdsChunked; sync_state moobiz_services_history_last_run (informativo).
 * Todas las llamadas a admin/services incluyen orden por date_updated descendente.
 * pages_backfill, manual e --id sin cambios de rol.
 */
const { randomUUID } = require("node:crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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
const MOOBIZ_TOKEN_KEY = "moobiz_token";
/** Solo modo normal: marca de última corrida (no se usa como filtro). */
const LAST_RUN_KEY = "moobiz_services_history_last_run";
const NORMAL_PAGES_FIXED = 2;
const NORMAL_LIMIT_FIXED = 1000;
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
    if (eq === -1) continue;
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
const MANUAL_RANGE_MODE = Boolean(DATE_FROM_OVERRIDE || DATE_TO_OVERRIDE);
const PAGE_SIZE = Number.parseInt(CLI_ARGS.page_size || "", 10) || PAGE_SIZE_DEFAULT;
const MAX_RECORDS = Number.parseInt(CLI_ARGS.max_records || "", 10) || MAX_RECORDS_DEFAULT;
const MAX_PAGES = Number.parseInt(CLI_ARGS.max_pages || "", 10) || MAX_PAGES_DEFAULT;
const DELAY_MS = Number.parseInt(CLI_ARGS.delay_ms || "", 10) || DELAY_MS_DEFAULT;
const BACKFILL_PAGES = Number.parseInt(CLI_ARGS.pages || "", 10) || 20;
const BACKFILL_LIMIT = Number.parseInt(CLI_ARGS.limit || "", 10) || 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactToken(token) {
  const t = String(token ?? "").trim();
  if (t.length < 10) return `[len=${t.length}]`;
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
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
  const fromDb = await readSyncStateValue(MOOBIZ_TOKEN_KEY);
  if (fromDb) {
    moobizBearer = fromDb;
    console.log("[history-sync] Bearer desde sync_state:", redactToken(moobizBearer));
    return moobizBearer;
  }

  const fresh = await moobizAdminLogin();
  await writeSyncStateValue(MOOBIZ_TOKEN_KEY, fresh);
  moobizBearer = fresh;
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
  p.set("order_col", "date_updated");
  p.set("order_dir", "desc");

  const url = `${MOOBIZ_SERVICES_URL}?${p.toString()}`;
  console.log(`[history-sync] GET (sin token, order_col=date_updated order_dir=desc): ${url}`);

  const buildHeaders = () => ({
    Authorization: `Bearer ${moobizBearer}`,
    "X-Auth-Token": moobizBearer,
    Accept: "application/json",
    Origin: MOOBIZ_WEB_ORIGIN,
    Referer: `${MOOBIZ_WEB_ORIGIN}/`,
    "User-Agent": CHROME_UA,
  });
  const doFetch = () => fetch(url, { method: "GET", headers: buildHeaders(), cache: "no-store" });

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    console.warn(`[history-sync] Services HTTP ${res.status} (page ${page}) — renovando token…`);
    const fresh = await moobizAdminLogin();
    if (!skipSyncStateToken) {
      await writeSyncStateValue(MOOBIZ_TOKEN_KEY, fresh);
    }
    moobizBearer = fresh;
    res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Fetch services page ${page}: auth falló otra vez (${res.status}) tras renovar token.`,
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
    if (!SUPABASE_URL || !String(SUPABASE_URL).trim()) {
      throw new Error("Falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL).");
    }
    if (!SUPABASE_SERVICE_ROLE_KEY || !String(SUPABASE_SERVICE_ROLE_KEY).trim()) {
      throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY.");
    }

    moobizBearer = null;

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
      const dateToYmd = formatYyyyMmDdFromDate(new Date());
      const dateFromYmd = ymdDaysAgoLocal(7);

      console.log(
        `[history-sync] modo=${mode} run_started_at=${runStartedAt} date_from=${dateFromYmd} date_to=${dateToYmd} pages=${NORMAL_PAGES_FIXED} limit=${NORMAL_LIMIT_FIXED} delay_ms=${NORMAL_DELAY_MS_FIXED} base=${MOOBIZ_API_BASE_URL}`,
      );

      const byId = new Map();

      for (let page = 1; page <= NORMAL_PAGES_FIXED; page += 1) {
        const items = await fetchServicesPage({
          page,
          dateFrom: dateFromYmd,
          dateTo: dateToYmd,
          limit: NORMAL_LIMIT_FIXED,
          skipSyncStateToken: false,
        });
        pagesQueried = page;

        for (const raw of items) {
          const normalized = normalizeServiceRow(raw);
          if (!normalized) continue;
          byId.set(normalized.id, normalized);
        }

        console.log(
          `[history-sync] Página ${page}/${NORMAL_PAGES_FIXED}: API_items=${items.length} ids_unicos_acum=${byId.size}`,
        );

        if (page < NORMAL_PAGES_FIXED) await sleep(NORMAL_DELAY_MS_FIXED);
      }

      const collected = [...byId.values()];
      console.log(`[history-sync] filas unicas tras dedupe: ${collected.length}`);

      const idsToProcess = collected.map((r) => r.id);
      const total = idsToProcess.length;
      const existingIdsSet = await fetchExistingIdsChunked(idsToProcess);
      const actualizados = idsToProcess.filter((id) => existingIdsSet.has(id)).length;
      const nuevos = total - actualizados;
      registrosNuevosEstimados = nuevos;
      registrosActualizadosEstimados = actualizados;
      console.log(
        `[history-sync] métricas (pre-upsert, ids vs DB): total=${total} nuevos=${nuevos} actualizados=${actualizados}`,
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

      pagesQueried = NORMAL_PAGES_FIXED;
      reasonForStop = `ok_2pages_sync;nuevos=${nuevos};actualizados=${actualizados};run_started_at=${runStartedAt}`;
      cursorAfter = runStartedAt;

      console.log(
        JSON.stringify({
          status,
          mode,
          run_started_at: runStartedAt,
          registros_procesados: total,
          registros_nuevos_estimados: nuevos,
          registros_actualizados_estimados: actualizados,
          filas_devueltas_upsert: recordsReturnedByUpsert,
          pages_queried: NORMAL_PAGES_FIXED,
          date_from: dateFromYmd,
          date_to: dateToYmd,
          last_run_saved_key: LAST_RUN_KEY,
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
  console.error("[history-sync] ❌ Error:", err);
  process.exit(1);
});
