/**
 * Sync incremental de historial de servicios Moobiz -> Supabase.
 *
 * Estrategia:
 * - Inicial: hasta 2000 registros recientes.
 * - Incremental: cursor por date_finalized con overlap de 48h.
 * - Integridad: upsert por PK id en moobiz_services_history.
 */
const { randomUUID } = require("node:crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_EMAIL = process.env.MOOBIZ_EMAIL;
const MOOBIZ_PASSWORD = process.env.MOOBIZ_PASSWORD;

const MOOBIZ_SERVICES_URL =
  (process.env.MOOBIZ_SERVICES_URL && String(process.env.MOOBIZ_SERVICES_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/services";
const ADMIN_LOGIN_URL = "https://app.moobiz.pe/api/admin/login/login";
const MOOBIZ_TOKEN_KEY = "moobiz_token";
const HISTORY_CURSOR_KEY = "moobiz_services_history_last_finalized";

const PAGE_SIZE = 100;
const INITIAL_LIMIT = 2000;
const OVERLAP_HOURS = 48;
const SUPABASE_BATCH_SIZE = 200;
const DELAY_MS = 300;

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
const DATE_FROM_OVERRIDE = String(CLI_ARGS.date_from || "").trim();
const DATE_TO_OVERRIDE = String(CLI_ARGS.date_to || "").trim();

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
      Origin: "https://app.moobiz.pe",
      Referer: "https://app.moobiz.pe/",
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

function toIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.services)) return payload.services;
  return [];
}

async function fetchServicesPage({ page, dateFrom, dateTo }) {
  await ensureMoobizBearer();

  const p = new URLSearchParams();
  p.set("limit", String(PAGE_SIZE));
  p.set("page", String(page));
  if (dateFrom) p.set("date_from", dateFrom);
  if (dateTo) p.set("date_to", dateTo);

  const url = `${MOOBIZ_SERVICES_URL}?${p.toString()}`;
  const buildHeaders = () => ({
    Authorization: `Bearer ${moobizBearer}`,
    "X-Auth-Token": moobizBearer,
    Accept: "application/json",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/",
    "User-Agent": CHROME_UA,
  });
  const doFetch = () => fetch(url, { method: "GET", headers: buildHeaders(), cache: "no-store" });

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    console.warn(`[history-sync] Services HTTP ${res.status} (page ${page}) — renovando token…`);
    const fresh = await moobizAdminLogin();
    await writeSyncStateValue(MOOBIZ_TOKEN_KEY, fresh);
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
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
    const batch = rows.slice(i, i + SUPABASE_BATCH_SIZE);
    await fetchJsonOrThrow(
      `${SUPABASE_URL}/rest/v1/moobiz_services_history`,
      {
        method: "POST",
        headers: supabaseHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        }),
        body: JSON.stringify(batch),
      },
      `Upsert moobiz_services_history batch ${Math.floor(i / SUPABASE_BATCH_SIZE) + 1}`,
    );
  }
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
  let recordsInserted = 0;
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

    const cursorSaved = await readSyncStateValue(HISTORY_CURSOR_KEY);
    const nowIso = DATE_TO_OVERRIDE || new Date().toISOString();
    let dateFrom = "";
    let mode = "initial";

    if (DATE_FROM_OVERRIDE) {
      dateFrom = DATE_FROM_OVERRIDE;
      mode = "manual_range";
    } else if (cursorSaved) {
      const cursorDate = new Date(cursorSaved);
      if (!Number.isNaN(cursorDate.getTime())) {
        cursorDate.setHours(cursorDate.getHours() - OVERLAP_HOURS);
        dateFrom = cursorDate.toISOString();
        mode = "incremental";
      }
    }

    console.log(`[history-sync] modo=${mode} cursor=${cursorSaved || "none"} overlap_h=${OVERLAP_HOURS}`);
    if (dateFrom) {
      console.log(`[history-sync] rango: ${dateFrom} -> ${nowIso}`);
    } else {
      console.log(`[history-sync] carga inicial: máximo ${INITIAL_LIMIT} registros.`);
    }

    const collected = [];
    const seen = new Set();
    let page = 1;
    let continueLoop = true;

    while (continueLoop) {
      const items = await fetchServicesPage({
        page,
        dateFrom: dateFrom || undefined,
        dateTo: nowIso,
      });
      pagesQueried = page;
      console.log(`[history-sync] page=${page} items=${items.length}`);
      if (items.length === 0) break;

      for (const raw of items) {
        const normalized = normalizeServiceRow(raw);
        if (!normalized) continue;
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        collected.push(normalized);
        if (mode === "initial" && collected.length >= INITIAL_LIMIT) {
          continueLoop = false;
          break;
        }
      }

      if (items.length < PAGE_SIZE) break;
      if (mode === "initial" && collected.length >= INITIAL_LIMIT) break;
      page += 1;
      await sleep(DELAY_MS);
    }

    recordsInserted = collected.length;
    console.log(`[history-sync] registros normalizados: ${collected.length}`);
    await upsertHistoryRows(collected);

    cursorAfter = computeCursorDate(collected, cursorSaved || nowIso) || nowIso;
    await writeSyncStateValue(HISTORY_CURSOR_KEY, cursorAfter);

    console.log(
      JSON.stringify({
        status,
        mode,
        records_inserted: recordsInserted,
        pages_queried: pagesQueried,
        date_from: dateFrom || null,
        date_to: nowIso,
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
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/sync_monitor`,
        {
          method: "POST",
          headers: supabaseHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            status,
            records_inserted: recordsInserted,
            pages_queried: pagesQueried,
            last_id: "moobiz_services_history",
            error_message: errorMessage,
          }),
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
