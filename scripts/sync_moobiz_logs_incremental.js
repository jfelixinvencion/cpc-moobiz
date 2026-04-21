/**
 * Sync incremental de logs Moobiz → Supabase.
 * Token: public.sync_state (key moobiz_token); renovación automática en 401/403 vía login admin.
 */
const { randomUUID } = require("node:crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_EMAIL = process.env.MOOBIZ_EMAIL;
const MOOBIZ_PASSWORD = process.env.MOOBIZ_PASSWORD;

const MOOBIZ_LOGS_URL =
  (process.env.MOOBIZ_LOGS_URL && String(process.env.MOOBIZ_LOGS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/logs";

const ADMIN_LOGIN_URL = "https://app.moobiz.pe/api/admin/login/login";
const MOOBIZ_TOKEN_KEY = "moobiz_token";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const DELAY_MS = 300;
const SUPABASE_BATCH_SIZE = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Nunca loguear el token completo en Actions. */
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

async function readMoobizTokenFromSyncState() {
  const rows = await fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/sync_state?key=eq.${encodeURIComponent(MOOBIZ_TOKEN_KEY)}&select=value`,
    { headers: supabaseHeaders() },
    "Read sync_state moobiz_token",
  );
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const v = rows[0].value;
  return typeof v === "string" ? v.trim() : "";
}

async function writeMoobizTokenToSyncState(token) {
  const trimmed = String(token).trim();
  if (!trimmed) throw new Error("writeMoobizTokenToSyncState: token vacío");
  await fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/sync_state`,
    {
      method: "POST",
      headers: supabaseHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      }),
      body: JSON.stringify({ key: MOOBIZ_TOKEN_KEY, value: trimmed }),
    },
    "Upsert sync_state moobiz_token",
  );
}

async function moobizAdminLogin() {
  const username = typeof MOOBIZ_EMAIL === "string" ? MOOBIZ_EMAIL.trim() : "";
  const password = typeof MOOBIZ_PASSWORD === "string" ? MOOBIZ_PASSWORD.trim() : "";
  if (!username || !password) {
    throw new Error(
      "Faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD (necesarios para renovar token cuando expire o no exista en sync_state).",
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

  console.log("[sync] POST admin/login/login (usuario redactado)…");

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
  console.log("[sync] Login admin OK, token", redactToken(token));
  return token;
}

/**
 * Bearer actual en memoria (puede renovarse tras 401/403 en cualquier página).
 * @type {string | null}
 */
let moobizBearer = null;

async function ensureMoobizBearerInitial() {
  if (moobizBearer && moobizBearer.trim()) return moobizBearer;

  const fromDb = await readMoobizTokenFromSyncState();
  if (fromDb) {
    moobizBearer = fromDb;
    console.log("[sync] Bearer desde sync_state:", redactToken(moobizBearer));
    return moobizBearer;
  }

  console.log("[sync] No hay moobiz_token en DB; login inicial…");
  const t = await moobizAdminLogin();
  await writeMoobizTokenToSyncState(t);
  moobizBearer = t;
  console.log("[sync] Token persistido:", redactToken(t));
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

  const doFetch = () => fetch(url, { headers: buildHeaders(), cache: "no-store" });

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    console.warn(`[sync] Logs HTTP ${res.status} (página ${page}) — renovando token…`);
    const t = await moobizAdminLogin();
    await writeMoobizTokenToSyncState(t);
    moobizBearer = t;
    console.log("[sync] Token renovado:", redactToken(t));
    res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Fetch Moobiz page ${page}: auth falló otra vez (${res.status}) tras renovar token.`,
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
    if (!SUPABASE_URL || !String(SUPABASE_URL).trim()) {
      throw new Error("Falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) en el entorno.");
    }
    if (!SUPABASE_SERVICE_ROLE_KEY || !String(SUPABASE_SERVICE_ROLE_KEY).trim()) {
      throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    }

    moobizBearer = null;

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
  console.error("❌ Error:", err);
  process.exit(1);
});
