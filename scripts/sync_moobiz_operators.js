/**
 * Sync operadores Moobiz → Supabase: reemplazo total (dedupe + RPC TRUNCATE+INSERT).
 *
 * Descarga: **un solo GET** con `limit` alto (por defecto **3000**).
 *
 * Token: `MOOBIZ_OPERATORS_TOKEN` o `MOOBIZ_TOKEN` o `sync_state.moobiz_token` + login admin.
 */
// Carga .env.local SOLO si NO estamos en un entorno CI (ej. GitHub Actions)
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
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
const MOOBIZ_OPERATORS_TOKEN = process.env.MOOBIZ_OPERATORS_TOKEN;

const OPERATORS_BASE_URL =
  (process.env.MOOBIZ_OPERATORS_URL && String(process.env.MOOBIZ_OPERATORS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/operators";

const PAGE_SIZE_RAW = Number.parseInt(String(process.env.MOOBIZ_OPERATORS_PAGE_SIZE ?? "3000"), 10);
const PAGE_SIZE =
  Number.isFinite(PAGE_SIZE_RAW) && PAGE_SIZE_RAW >= 1 && PAGE_SIZE_RAW <= 5000 ? PAGE_SIZE_RAW : 3000;

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
    console.log("[Operators sync] Bearer desde MOOBIZ_TOKEN:", redactToken(generic));
    return generic;
  }

  const only = typeof MOOBIZ_OPERATORS_TOKEN === "string" ? MOOBIZ_OPERATORS_TOKEN.trim() : "";
  if (only) {
    console.log("[Operators sync] Bearer desde MOOBIZ_OPERATORS_TOKEN:", redactToken(only));
    return only;
  }

  if (moobizBearer && moobizBearer.trim()) return moobizBearer;
  const fallback = await getMoobizTokenFallback();
  if (fallback) {
    moobizBearer = fallback;
    console.log("[Operators sync] Bearer desde sync_state fallback:", redactToken(moobizBearer));
    return moobizBearer;
  }
  const fresh = await ensureMoobizToken();
  moobizBearer = fresh;
  console.log("[Operators sync] Bearer resuelto por ensureMoobizToken:", redactToken(moobizBearer));
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

function toTextNullable(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function mapOperatorRow(raw) {
  if (!raw || typeof raw !== "object") return null;
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

async function fetchOperatorsSingleLimit(token, limit) {
  const url = new URL(OPERATORS_BASE_URL);
  url.searchParams.set("limit", String(limit));

  const operatorHeaders = (t) => ({
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
        headers: operatorHeaders(bearer),
        cache: "no-store",
      },
      { label: "operators-sync:moobiz", retries: 3, backoffMs: [1000, 2000, 4000] },
    );
    const text = await res.text();

    if (responseLooksLikeAuthFailure(res, text)) {
      if (recovery >= 2) {
        throw new Error(`${AUTH_401_AFTER_REFRESH_MSG} (token invalid after retries)`);
      }
      console.warn(
        `[Operators sync] Sesión/token inválido (HTTP ${res.status} o ok!=true auth) — recuperación ${recovery + 1}/2…`,
      );
      if (recovery === 0) {
        let next = null;
        try {
          next = await ensureMoobizToken();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[Operators sync] ensureMoobizToken falló (${msg}) — intentando token desde sync_state…`);
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
      throw new Error(`MOOBIZ_OPERATORS_FETCH: HTTP ${res.status} — ${text.slice(0, 400)}`);
    }
    let body;
    try {
      body = text ? JSON.parse(text) : {};
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
    if (recovery > 0) {
      console.log("[Operators sync] GET operadores OK tras recuperar token");
    }
    return body;
  }
}

async function downloadAllOperatorsDeduped(token) {
  const limit = PAGE_SIZE;
  const byId = new Map();
  let rawMappedRows = 0;

  const body = await fetchOperatorsSingleLimit(token, limit);
  const totalReported = extractTotal(body);
  const items = extractItems(body);
  const lastPageItemCount = items.length;

  console.log(`[Operators sync] GET único: limit=${limit}, ítems en respuesta=${items.length}`);

  const mapped = items.map(mapOperatorRow).filter(Boolean);
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
    lastPageItemCount >= limit && totalReported !== null && totalReported > lastPageItemCount;

  return {
    rows,
    uniqueCount: rows.length,
    rawMappedRows,
    totalReported,
    pages: 1,
    reachedFetchCap,
  };
}

async function rpcFullReplace(rows) {
  return fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/rpc/moobiz_operators_full_replace`,
    {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ p_rows: rows }),
    },
    "RPC moobiz_operators_full_replace",
  );
}

async function countOperatorsInDb() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/moobiz_operators?select=id`, {
    headers: supabaseHeaders({ Prefer: "count=exact", Accept: "application/json" }),
  });
  if (!res.ok) {
    throw new Error(`COUNT moobiz_operators: ${res.status} ${await res.text()}`);
  }
  const cr = res.headers.get("content-range") || "";
  const m = /\d+-\d+\/(\d+)/.exec(cr);
  if (m) return Number.parseInt(m[1], 10);
  return 0;
}

async function insertSyncMonitor(payload) {
  await fetchJsonOrThrow(
    `${SUPABASE_URL}/rest/v1/sync_monitor`,
    {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    },
    "Insert sync_monitor operators",
  );
}

async function sync() {
  ensureEnv(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    process.exit(EXIT_CODES.MISSING_CRITICAL_ENVS);
  }

  const token = await ensureMoobizBearer();
  if (!token) {
    console.error("[Operators sync] No MOOBIZ_TOKEN disponible por env/sync_state.");
    process.exit(EXIT_CODES.TOKEN_MISSING);
  }
  let pagesQueried = 0;

  console.log(
    `[Operators sync] GET único limit=${PAGE_SIZE} (MOOBIZ_OPERATORS_PAGE_SIZE), modo=reemplazo_total`,
  );
  await insertSyncMonitor({
    action: "operators_fetch",
    status: "running",
    records_procesados: 0,
    records_inserted: 0,
    registros_nuevos_estimados: null,
    registros_actualizados_estimados: null,
    reason_for_stop: "fetch_start",
    pages_queried: 0,
    last_id: "moobiz_operators",
    error_message: null,
  });

  try {
    const dl = await downloadAllOperatorsDeduped(token);
    pagesQueried = dl.pages;

    if (dl.uniqueCount === 0) {
      throw new Error("MOOBIZ_OPERATORS_SYNC: 0 operadores descargados; la tabla no se modifica.");
    }

    console.log(
      `[Operators sync] Resumen descarga: únicos=${dl.uniqueCount}, rawMapped=${dl.rawMappedRows}, total API(campo)=${dl.totalReported ?? "?"}, peticiones=${dl.pages}, reachedCap=${dl.reachedFetchCap}`,
    );

    const rpcResult = await rpcFullReplace(dl.rows);
    const inserted = typeof rpcResult === "number" ? rpcResult : dl.uniqueCount;
    const finalDbCount = await countOperatorsInDb();

    const validationErrors = [];
    if (dl.totalReported !== null && dl.totalReported !== dl.uniqueCount) {
      validationErrors.push(
        `La API declaró total=${dl.totalReported} pero se descargaron ${dl.uniqueCount} operadores únicos (Δ ${dl.totalReported - dl.uniqueCount}).`,
      );
    }
    if (dl.rawMappedRows > dl.uniqueCount) {
      validationErrors.push(
        `Ítems mapeados: ${dl.rawMappedRows}; únicos tras dedupe: ${dl.uniqueCount} (ids repetidos en la API).`,
      );
    }
    if (finalDbCount !== dl.uniqueCount) {
      validationErrors.push(
        `Conteo en Supabase (${finalDbCount}) ≠ descargados únicos (${dl.uniqueCount}).`,
      );
    }
    if (inserted !== dl.uniqueCount) {
      validationErrors.push(`RPC insertó ${inserted} filas; se esperaban ${dl.uniqueCount}.`);
    }
    if (dl.reachedFetchCap) {
      validationErrors.push(
        `El GET único devolvió ${PAGE_SIZE} ítems pero la API declara total=${dl.totalReported}; sube MOOBIZ_OPERATORS_PAGE_SIZE.`,
      );
    }

    const validationOk = validationErrors.length === 0;

    await insertSyncMonitor({
      action: "operators_fetch",
      status: validationOk ? "success" : "error",
      records_procesados: dl.uniqueCount,
      records_inserted: inserted,
      registros_nuevos_estimados: null,
      registros_actualizados_estimados: null,
      reason_for_stop: validationOk ? "full_replace_ok_single_limit" : "full_replace_validation_failed_single_limit",
      pages_queried: pagesQueried,
      last_id: "moobiz_operators",
      error_message: validationOk ? null : validationErrors.join(" "),
    });
    await insertSyncMonitor({
      action: "operators_fetch",
      status: "success",
      records_procesados: dl.uniqueCount,
      records_inserted: inserted,
      registros_nuevos_estimados: null,
      registros_actualizados_estimados: null,
      reason_for_stop: "fetch_end",
      pages_queried: pagesQueried,
      last_id: "moobiz_operators",
      error_message: null,
    });

    console.log(
      JSON.stringify({
        ok: validationOk,
        uniqueAfterDedupe: dl.uniqueCount,
        finalDbCount,
        apiTotalDeclared: dl.totalReported,
        inserted,
        reachedFetchCap: dl.reachedFetchCap,
        validationErrors,
      }),
    );

    if (!validationOk) {
      process.exitCode = 2;
      console.warn("[Operators sync] Validación con advertencias o error; revisa el JSON anterior.");
    } else {
      console.log("[Operators sync] OK");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const auth401AfterRefresh =
      msg === AUTH_401_AFTER_REFRESH_MSG || msg.includes(AUTH_401_AFTER_REFRESH_MSG);
    try {
      await insertSyncMonitor({
        action: "operators_fetch",
        status: "error",
        records_procesados: 0,
        records_inserted: 0,
        registros_nuevos_estimados: null,
        registros_actualizados_estimados: null,
        reason_for_stop: auth401AfterRefresh ? "moobiz_auth_401_after_refresh" : "sync_exception",
        pages_queried: pagesQueried,
        last_id: "moobiz_operators",
        error_message: auth401AfterRefresh ? AUTH_401_AFTER_REFRESH_MSG : msg,
      });
    } catch (e) {
      console.error("[Operators sync] sync_monitor insert falló:", e instanceof Error ? e.message : String(e));
    }
    throw err;
  }
}

sync().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[Operators sync] Error:", msg);
  if (/401|403|auth|token/i.test(msg)) {
    process.exit(EXIT_CODES.TOKEN_INVALID_AFTER_RETRIES);
  }
  process.exit(EXIT_CODES.SYNC_FAILED);
});
