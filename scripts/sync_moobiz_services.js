/**
 * Sync servicios Moobiz (dispatcher) → Supabase: reemplazo total en `moobiz_services`.
 *
 * Descarga: hasta 2 GET con `limit=1000` y `offset` 0 / 1000 si `total > 1000`.
 *
 * Token: `MOOBIZ_SERVICES_TOKEN` o `MOOBIZ_TOKEN` o `sync_state.moobiz_token` + login admin.
 */
// Carga .env.local SOLO si NO estamos en un entorno CI (ej. GitHub Actions)
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { createClient } = require("@supabase/supabase-js");
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
const MOOBIZ_SERVICES_TOKEN = process.env.MOOBIZ_SERVICES_TOKEN;

const DISPATCHER_BASE_URL =
  (process.env.MOOBIZ_SERVICES_URL && String(process.env.MOOBIZ_SERVICES_URL).trim()) ||
  (process.env.MOOBIZ_DISPATCHER_URL && String(process.env.MOOBIZ_DISPATCHER_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/dispatcher";

const PAGE_LIMIT = 1000;
const INSERT_BATCH = 1000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

let moobizBearer = null;

async function ensureMoobizBearer() {
  const generic = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (generic) {
    console.log("[services-sync] Bearer desde MOOBIZ_TOKEN:", redactToken(generic));
    return generic;
  }

  const only = typeof MOOBIZ_SERVICES_TOKEN === "string" ? MOOBIZ_SERVICES_TOKEN.trim() : "";
  if (only) {
    console.log("[services-sync] Bearer desde MOOBIZ_SERVICES_TOKEN:", redactToken(only));
    return only;
  }

  if (moobizBearer && moobizBearer.trim()) return moobizBearer;
  const fallback = await getMoobizTokenFallback();
  if (fallback) {
    moobizBearer = fallback;
    console.log("[services-sync] Bearer desde sync_state fallback:", redactToken(moobizBearer));
    return moobizBearer;
  }
  const fresh = await ensureMoobizToken();
  moobizBearer = fresh;
  console.log("[services-sync] Bearer resuelto por ensureMoobizToken:", redactToken(moobizBearer));
  return moobizBearer;
}

function extractItems(body) {
  const raw = body && body.items;
  return Array.isArray(raw) ? raw : [];
}

function extractTotal(body) {
  const t = body && body.total;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string" && t.trim()) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTextId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function mapServiceRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = toTextId(raw.id);
  if (!id) return null;
  return {
    id,
    state: String(raw.state ?? ""),
    raw,
  };
}

const AUTH_401_AFTER_REFRESH_MSG = "Error 401 tras intento de renovación";

function moobizBodyLooksLikeAuthFailure(body) {
  if (!body || typeof body !== "object") return false;
  if (body.ok === true) return false;
  const msg = `${typeof body.msg === "string" ? body.msg : ""} ${typeof body.error === "string" ? body.error : ""}`;
  return /not_logged|not\s*authorized|unauthori|token\s*invalid|sesi[oó]n/i.test(msg);
}

function responseLooksLikeAuthFailure(res, text) {
  if (res.status === 401 || res.status === 403) return true;
  if (!res.ok || res.status !== 200) return false;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) return false;
  try {
    const body = text ? JSON.parse(text) : {};
    return moobizBodyLooksLikeAuthFailure(body);
  } catch {
    return false;
  }
}

async function fetchDispatcherSinglePage(token, offset) {
  const url = new URL(DISPATCHER_BASE_URL);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("offset", String(offset));

  const dispatcherHeaders = (t) => ({
    Authorization: `Bearer ${t}`,
    "X-Auth-Token": t,
    Accept: "application/json",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/",
    "User-Agent": CHROME_UA,
  });

  let bearer = token;
  for (let recovery = 0; ; recovery += 1) {
    const res = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: dispatcherHeaders(bearer),
        cache: "no-store",
      },
      { label: "services-sync:moobiz", retries: 3, backoffMs: [1000, 2000, 4000] },
    );
    const text = await res.text();

    if (responseLooksLikeAuthFailure(res, text)) {
      if (recovery >= 2) {
        throw new Error(`${AUTH_401_AFTER_REFRESH_MSG} (token invalid after retries)`);
      }
      console.warn(
        `[services-sync] Sesión/token inválido (HTTP ${res.status} o ok!=true auth) — recuperación ${recovery + 1}/2…`,
      );
      if (recovery === 0) {
        let next = null;
        try {
          next = await ensureMoobizToken();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[services-sync] ensureMoobizToken falló (${msg}) — intentando token desde sync_state…`);
          next = await getMoobizTokenFromSyncStateOnly();
        }
        if (!next) {
          throw new Error(`${AUTH_401_AFTER_REFRESH_MSG} (token invalid after retries)`);
        }
        moobizBearer = next;
        bearer = next;
        continue;
      }
      const next = await getMoobizTokenFromSyncStateOnly();
      if (!next || next === bearer) {
        throw new Error(`${AUTH_401_AFTER_REFRESH_MSG} (token invalid after retries)`);
      }
      moobizBearer = next;
      bearer = next;
      continue;
    }

    if (!res.ok) {
      throw new Error(`MOOBIZ_DISPATCHER_FETCH: HTTP ${res.status} — ${text.slice(0, 400)}`);
    }
    let body;
    try {
      body = text ? JSON.parse(text) : {};
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
    if (recovery > 0) {
      console.log("[services-sync] GET dispatcher OK tras recuperar token");
    }
    return body;
  }
}

async function downloadDispatcherServicesDeduped(token) {
  const byId = new Map();
  let rawMappedRows = 0;
  let pages = 0;

  const body1 = await fetchDispatcherSinglePage(token, 0);
  pages = 1;
  const totalReported = extractTotal(body1);
  const items1 = extractItems(body1);

  console.log(`[services-sync] GET offset=0: limit=${PAGE_LIMIT}, ítems=${items1.length}`);

  for (const item of items1) {
    const row = mapServiceRow(item);
    if (row) {
      rawMappedRows += 1;
      byId.set(String(row.id), row);
    }
  }

  if (typeof totalReported === "number" && totalReported > PAGE_LIMIT) {
    const body2 = await fetchDispatcherSinglePage(token, PAGE_LIMIT);
    pages = 2;
    const items2 = extractItems(body2);
    console.log(`[services-sync] GET offset=${PAGE_LIMIT}: ítems=${items2.length}`);
    for (const item of items2) {
      const row = mapServiceRow(item);
      if (row) {
        rawMappedRows += 1;
        byId.set(String(row.id), row);
      }
    }
  }

  const rows = [...byId.values()];
  const dupesRemoved = rawMappedRows - rows.length;
  if (dupesRemoved > 0) {
    console.log(
      `[services-sync] Dedupe final: ${rawMappedRows} filas mapeadas → ${rows.length} únicos (eliminados ${dupesRemoved} duplicados por id).`,
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
  };
}

async function replaceAllServices(supabase, rows) {
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

async function countServicesInDb(supabase) {
  const { count, error } = await supabase.from("moobiz_services").select("*", { count: "exact", head: true });
  if (error) throw new Error(`COUNT moobiz_services: ${error.message}`);
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

async function insertSyncMonitor(payload) {
  await fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/sync_monitor`,
    {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    },
    "Insert sync_monitor services",
  );
}

async function sync() {
  ensureEnv(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    process.exit(EXIT_CODES.MISSING_CRITICAL_ENVS);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = await ensureMoobizBearer();
  if (!token) {
    console.error("[services-sync] No MOOBIZ_TOKEN disponible por env/sync_state.");
    process.exit(EXIT_CODES.TOKEN_MISSING);
  }
  let pagesQueried = 0;

  console.log(`[services-sync] Dispatcher limit=${PAGE_LIMIT} por página, modo=reemplazo_total`);
  await insertSyncMonitor({
    action: "services_fetch",
    status: "running",
    records_procesados: 0,
    records_inserted: 0,
    registros_nuevos_estimados: null,
    registros_actualizados_estimados: null,
    reason_for_stop: "fetch_start",
    pages_queried: 0,
    last_id: "moobiz_services",
    error_message: null,
  });

  try {
    const dl = await downloadDispatcherServicesDeduped(token);
    pagesQueried = dl.pages;

    if (dl.uniqueCount === 0) {
      throw new Error("MOOBIZ_SERVICES_SYNC: 0 servicios descargados; la tabla no se modifica.");
    }

    console.log(
      `[services-sync] Resumen descarga: únicos=${dl.uniqueCount}, rawMapped=${dl.rawMappedRows}, total API(campo)=${dl.totalReported ?? "?"}, peticiones=${dl.pages}, reachedCap=${dl.reachedFetchCap}`,
    );

    const { deleted, inserted } = await replaceAllServices(supabase, dl.rows);
    const finalDbCount = await countServicesInDb(supabase);

    const validationErrors = [];
    if (dl.totalReported !== null && dl.totalReported !== dl.uniqueCount) {
      validationErrors.push(
        `La API declaró total=${dl.totalReported} pero se consolidaron ${dl.uniqueCount} servicios únicos (Δ ${dl.totalReported - dl.uniqueCount}).`,
      );
    }
    if (dl.rawMappedRows > dl.uniqueCount) {
      validationErrors.push(
        `Ítems mapeados: ${dl.rawMappedRows}; únicos tras dedupe: ${dl.uniqueCount} (ids repetidos en la API).`,
      );
    }
    if (finalDbCount !== dl.uniqueCount) {
      validationErrors.push(`Conteo en Supabase (${finalDbCount}) ≠ descargados únicos (${dl.uniqueCount}).`);
    }
    if (inserted !== dl.uniqueCount) {
      validationErrors.push(`Se insertaron ${inserted} filas; se esperaban ${dl.uniqueCount}.`);
    }
    if (dl.reachedFetchCap) {
      validationErrors.push(
        `La API declara total=${dl.totalReported} superior a ${PAGE_LIMIT * dl.pages} filas descargables con la paginación actual.`,
      );
    }

    const validationOk = validationErrors.length === 0;

    await insertSyncMonitor({
      action: "services_fetch",
      status: validationOk ? "success" : "error",
      records_procesados: dl.uniqueCount,
      records_inserted: inserted,
      registros_nuevos_estimados: null,
      registros_actualizados_estimados: null,
      reason_for_stop: validationOk ? "full_replace_ok_dispatcher" : "full_replace_validation_failed_dispatcher",
      pages_queried: pagesQueried,
      last_id: "moobiz_services",
      error_message: validationOk ? null : validationErrors.join(" "),
    });
    await insertSyncMonitor({
      action: "services_fetch",
      status: "success",
      records_procesados: dl.uniqueCount,
      records_inserted: inserted,
      registros_nuevos_estimados: null,
      registros_actualizados_estimados: null,
      reason_for_stop: "fetch_end",
      pages_queried: pagesQueried,
      last_id: "moobiz_services",
      error_message: null,
    });

    console.log(
      JSON.stringify({
        ok: validationOk,
        uniqueAfterDedupe: dl.uniqueCount,
        finalDbCount,
        apiTotalDeclared: dl.totalReported,
        inserted,
        deleted,
        pages: pagesQueried,
        reachedFetchCap: dl.reachedFetchCap,
        validationErrors,
      }),
    );

    if (!validationOk) {
      process.exitCode = 2;
      console.warn("[services-sync] Validación con advertencias o error; revisa el JSON anterior.");
    } else {
      console.log("[services-sync] OK");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const auth401AfterRefresh =
      msg === AUTH_401_AFTER_REFRESH_MSG || msg.includes(AUTH_401_AFTER_REFRESH_MSG);
    try {
      await insertSyncMonitor({
        action: "services_fetch",
        status: "error",
        records_procesados: 0,
        records_inserted: 0,
        registros_nuevos_estimados: null,
        registros_actualizados_estimados: null,
        reason_for_stop: auth401AfterRefresh ? "moobiz_auth_401_after_refresh" : "sync_exception",
        pages_queried: pagesQueried,
        last_id: "moobiz_services",
        error_message: auth401AfterRefresh ? AUTH_401_AFTER_REFRESH_MSG : msg,
      });
    } catch (e) {
      console.error("[services-sync] sync_monitor insert falló:", e instanceof Error ? e.message : String(e));
    }
    throw err;
  }
}

sync().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[services-sync] Error:", msg);
  if (/401|403|auth|token/i.test(msg)) {
    process.exit(EXIT_CODES.TOKEN_INVALID_AFTER_RETRIES);
  }
  process.exit(EXIT_CODES.SYNC_FAILED);
});
