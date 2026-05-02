/**
 * Sync incremental de logs Moobiz → Supabase.
 * Token: public.sync_state (key moobiz_token); renovación automática en 401/403 vía login admin.
 */
// Carga .env.local SOLO si NO estamos en un entorno CI (ej. GitHub Actions)
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  // DOTENV_CONFIG_PATH permite Windows/PowerShell overrides si existe
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

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

const MOOBIZ_LOGS_URL =
  (process.env.MOOBIZ_LOGS_URL && String(process.env.MOOBIZ_LOGS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/logs";


const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const DELAY_MS = 300;
const SUPABASE_BATCH_SIZE = 200;

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

/**
 * Bearer actual en memoria (puede renovarse tras 401/403 en cualquier página).
 * @type {string | null}
 */
let moobizBearer = null;

async function ensureMoobizBearerInitial() {
  if (moobizBearer && moobizBearer.trim()) return moobizBearer;
  const fromEnv = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (fromEnv) {
    moobizBearer = fromEnv;
    console.log("[sync] Bearer desde MOOBIZ_TOKEN:", redactToken(fromEnv));
    return moobizBearer;
  }
  const fallback = await getMoobizTokenFallback();
  if (fallback) {
    moobizBearer = fallback;
    console.log("[sync] Bearer desde sync_state fallback:", redactToken(fallback));
    return moobizBearer;
  }
  const t = await ensureMoobizToken();
  moobizBearer = t;
  console.log("[sync] Bearer resuelto por ensureMoobizToken:", redactToken(t));
  return moobizBearer;
}

/**
 * GET página de logs con Authorization; en 401/403 login + upsert + un reintento.
 */
async function fetchMoobizLogsPageJson(page) {
  await ensureMoobizBearerInitial();

  const url = `${MOOBIZ_LOGS_URL}?limit=${PAGE_SIZE}&page=${page}`;
  const buildHeaders = () => ({
    Authorization: `Bearer ${moobizBearer}`,
    "User-Agent": CHROME_UA,
    Accept: "application/json",
  });

  const doFetch = () =>
    fetchWithRetry(
      url,
      { headers: buildHeaders(), cache: "no-store" },
      { label: "logs-sync:moobiz", retries: 3, backoffMs: [1000, 2000, 4000] },
    );

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    console.warn(`[sync] Logs HTTP ${res.status} (página ${page}) — renovando token con ensureMoobizToken()…`);
    let t = null;
    try {
      t = await ensureMoobizToken();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[sync] ensureMoobizToken falló (${msg}) — intentando token desde sync_state…`);
      t = await getMoobizTokenFromSyncStateOnly();
    }
    if (!t) {
      throw new Error(
        `Fetch Moobiz page ${page}: token invalid after retries (auth ${res.status}, sin token renovado).`,
      );
    }
    moobizBearer = t;
    console.log("[sync] Token renovado:", redactToken(t));
    res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      console.warn(
        `[sync] Logs HTTP ${res.status} (página ${page}) tras refresh — releyendo moobiz_token en sync_state…`,
      );
      const db = await getMoobizTokenFromSyncStateOnly();
      if (db && db !== moobizBearer) {
        moobizBearer = db;
        console.log("[sync] Token desde sync_state:", redactToken(db));
        res = await doFetch();
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Fetch Moobiz page ${page}: token invalid after retries (auth ${res.status} tras ensureMoobizToken y sync_state).`,
      );
    }
  }

  if (!res.ok) {
    throw new Error(`Fetch Moobiz page ${page} failed (${res.status}): ${await res.text()}`);
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

async function sync() {
  console.log("Iniciando sync en GitHub...");
  let status = "success";
  let recordsInserted = 0;
  let pagesQueried = 0;
  let lastIdAfter = 0n;
  let errorMessage = null;

  try {
    ensureEnv(["SUPABASE_SERVICE_ROLE_KEY"]);
    if (!SUPABASE_URL || !String(SUPABASE_URL).trim()) {
      console.error("[sync] Falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) en el entorno.");
      process.exit(EXIT_CODES.MISSING_CRITICAL_ENVS);
    }
    if (!SUPABASE_SERVICE_ROLE_KEY || !String(SUPABASE_SERVICE_ROLE_KEY).trim()) {
      console.error("[sync] Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.");
      process.exit(EXIT_CODES.MISSING_CRITICAL_ENVS);
    }

    moobizBearer = null;
    const initialToken = await ensureMoobizBearerInitial();
    if (!initialToken) {
      console.error("[sync] No MOOBIZ_TOKEN disponible por env/sync_state.");
      process.exit(EXIT_CODES.TOKEN_MISSING);
    }

    const lastIdData = await fetchJsonOrThrow(
      `${SUPABASE_URL}/rest/v1/sync_state?key=eq.last_id&select=value`,
      {
        headers: supabaseHeaders(),
      },
      "Read sync_state last_id",
    );
    const lastId = lastIdData.length ? BigInt(lastIdData[0].value) : 0n;
    lastIdAfter = lastId;
    console.log(`[sync] last_id inicial: ${lastId.toString()}`);

    let totalRead = 0;
    let lastPageQueried = 0;
    let reachedSyncPoint = false;
    const collected = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      lastPageQueried = page;
      const moobizData = await fetchMoobizLogsPageJson(page);

      const items = moobizData.items || [];
      totalRead += items.length;
      console.log(`[sync] pagina=${page} items=${items.length}`);

      if (items.length === 0) {
        reachedSyncPoint = true;
        break;
      }

      if (BigInt(items[0].id) <= lastId) {
        reachedSyncPoint = true;
        console.log(
          `[sync] fin temprano pagina ${page}: primer id ${items[0].id} <= lastId ${lastId.toString()}`,
        );
        break;
      }

      for (const it of items) {
        const id = BigInt(it.id);
        if (id > lastId) {
          collected.push(it);
        } else {
          reachedSyncPoint = true;
          break;
        }
      }

      if (reachedSyncPoint) {
        break;
      }

      if (page < MAX_PAGES) {
        await sleep(DELAY_MS);
      }
    }
    pagesQueried = lastPageQueried;

    const uniqueById = new Map();
    for (const item of collected) {
      const key = String(item.id);
      if (!uniqueById.has(key)) {
        uniqueById.set(key, item);
      }
    }
    const nuevos = Array.from(uniqueById.values());
    recordsInserted = nuevos.length;
    console.log(`[sync] nuevos deduplicados: ${nuevos.length}`);

    for (let i = 0; i < nuevos.length; i += SUPABASE_BATCH_SIZE) {
      const batch = nuevos.slice(i, i + SUPABASE_BATCH_SIZE);
      const toInsert = batch.map((it) => ({ original_id: String(it.id), raw: it }));
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/moobiz_logs`,
        {
          method: "POST",
          headers: supabaseHeaders({
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          }),
          body: JSON.stringify(toInsert),
        },
        `Upsert moobiz_logs batch ${Math.floor(i / SUPABASE_BATCH_SIZE) + 1}`,
      );
    }

    if (nuevos.length > 0) {
      const maxId = nuevos.reduce(
        (max, it) => (BigInt(it.id) > max ? BigInt(it.id) : max),
        lastId,
      );
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/sync_state`,
        {
          method: "POST",
          headers: supabaseHeaders({
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          }),
          body: JSON.stringify({ key: "last_id", value: maxId.toString() }),
        },
        "Upsert sync_state last_id",
      );
      lastIdAfter = maxId;
    }

    status = reachedSyncPoint ? "success" : "warning_backlog";

    console.log(`[sync] paginas consultadas: ${lastPageQueried}`);
    console.log(`[sync] total insertados: ${nuevos.length}`);
    console.log(`[sync] last_id final: ${lastIdAfter.toString()}`);
    console.log(
      JSON.stringify({
        status,
        records_fetched: totalRead,
        records_inserted: nuevos.length,
        pages_queried: pagesQueried,
        last_id_after: lastIdAfter.toString(),
      }),
    );
    console.log("✅ Sync completado con éxito");
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
            last_id: lastIdAfter.toString(),
            error_message: errorMessage,
          }),
        },
        "Insert sync_monitor",
      );
    } catch (e) {
      console.error("[sync] sync_monitor insert falló:", e instanceof Error ? e.message : String(e));
    }
  }
}

sync().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("❌ Error:", msg);
  if (/401|403|auth|token/i.test(msg)) {
    process.exit(EXIT_CODES.TOKEN_INVALID_AFTER_RETRIES);
  }
  process.exit(EXIT_CODES.SYNC_FAILED);
});
