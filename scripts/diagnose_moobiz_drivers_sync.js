/**
 * Diagnóstico: compara IDs API vs public.moobiz_drivers y registra paginación (solo lectura).
 * Salida: reports/moobiz_drivers_*
 *
 * Env (mismo criterio que sync_moobiz_drivers.js):
 * - MOOBIZ_DRIVERS_TOKEN (preferido) o token en sync_state + login opcional
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * - MOOBIZ_DRIVERS_URL, MOOBIZ_DRIVERS_PAGE_SIZE
 */
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch {
  /* optional */
}

const REPORTS_DIR = path.join(__dirname, "..", "reports");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_EMAIL = process.env.MOOBIZ_EMAIL;
const MOOBIZ_PASSWORD = process.env.MOOBIZ_PASSWORD;
const MOOBIZ_DRIVERS_TOKEN = process.env.MOOBIZ_DRIVERS_TOKEN;

const DRIVERS_BASE_URL =
  (process.env.MOOBIZ_DRIVERS_URL && String(process.env.MOOBIZ_DRIVERS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/drivers";

const ADMIN_LOGIN_URL = "https://app.moobiz.pe/api/admin/login/login";
const MOOBIZ_TOKEN_KEY = "moobiz_token";

const PAGE_SIZE_RAW = Number.parseInt(String(process.env.MOOBIZ_DRIVERS_PAGE_SIZE ?? "3000"), 10);
const PAGE_SIZE =
  Number.isFinite(PAGE_SIZE_RAW) && PAGE_SIZE_RAW >= 1 && PAGE_SIZE_RAW <= 5000 ? PAGE_SIZE_RAW : 3000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = Number.parseInt(process.env.MOOBIZ_DRIVERS_DIAG_FETCH_TIMEOUT_MS || "", 10) || 60000;

async function fetchWithTimeout(url, options, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`${label}: timeout ${FETCH_TIMEOUT_MS}ms — ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function fetchJsonOrThrow(url, options, label) {
  const res = await fetchWithTimeout(url, options, label);
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

async function moobizAdminLoginNoPersist() {
  const username = typeof MOOBIZ_EMAIL === "string" ? MOOBIZ_EMAIL.trim() : "";
  const password = typeof MOOBIZ_PASSWORD === "string" ? MOOBIZ_PASSWORD.trim() : "";
  if (!username || !password) {
    throw new Error("Faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD para login Moobiz (diagnóstico sin escribir sync_state).");
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
  const res = await fetchWithTimeout(
    ADMIN_LOGIN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://app.moobiz.pe",
        Referer: "https://app.moobiz.pe/",
        "User-Agent": CHROME_UA,
      },
      body: JSON.stringify(body),
    },
    "Moobiz login",
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`MOOBIZ_LOGIN_FAILED: HTTP ${res.status} — ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text);
  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error("MOOBIZ_LOGIN_FAILED: sin token");
  }
  return parsed.token.trim();
}

async function resolveToken() {
  const only = typeof MOOBIZ_DRIVERS_TOKEN === "string" ? MOOBIZ_DRIVERS_TOKEN.trim() : "";
  if (only) return { token: only, source: "MOOBIZ_DRIVERS_TOKEN" };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Sin MOOBIZ_DRIVERS_TOKEN y sin Supabase para leer sync_state. Define MOOBIZ_DRIVERS_TOKEN o credenciales Supabase + MOOBIZ_EMAIL/PASSWORD.",
    );
  }
  const fromDb = await readSyncStateValue(MOOBIZ_TOKEN_KEY);
  if (fromDb) return { token: fromDb, source: "sync_state.moobiz_token" };
  const fresh = await moobizAdminLoginNoPersist();
  return { token: fresh, source: "MOOBIZ_EMAIL login (no persistido en diagnóstico)" };
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

function mapDriverRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = toTextId(raw.id);
  if (!id) return null;
  return { id };
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function fetchDriversPageLogged(token, { limit }, pageLog, globalSeenIds) {
  const url = new URL(DRIVERS_BASE_URL);
  url.searchParams.set("limit", String(limit));

  const t0 = Date.now();
  let httpStatus = 0;
  let body = null;
  let errText = "";
  try {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Auth-Token": token,
          Accept: "application/json",
          Origin: "https://app.moobiz.pe",
          Referer: "https://app.moobiz.pe/",
          "User-Agent": CHROME_UA,
        },
      },
      "Moobiz drivers",
    );
    httpStatus = res.status;
    const text = await res.text();
    if (!res.ok) {
      errText = text.slice(0, 500);
      pageLog.push({
        request_url: url.toString(),
        http_status: httpStatus,
        time_ms: Date.now() - t0,
        error: errText,
      });
      throw new Error(`HTTP ${httpStatus}: ${errText}`);
    }
    body = text ? JSON.parse(text) : {};
    if (body.ok !== true) {
      errText = JSON.stringify(body).slice(0, 400);
      pageLog.push({
        request_url: url.toString(),
        http_status: httpStatus,
        time_ms: Date.now() - t0,
        error: errText,
      });
      throw new Error(`ok!=true: ${errText}`);
    }
  } catch (e) {
    if (!pageLog.length || !pageLog[pageLog.length - 1].request_url) {
      pageLog.push({
        request_url: url.toString(),
        http_status: httpStatus,
        time_ms: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }

  const timeMs = Date.now() - t0;
  const items = extractItems(body);
  const idsThisPage = [];
  let skippedNoId = 0;
  const dupSamples = [];
  let anyDup = false;
  for (const item of items) {
    const mapped = mapDriverRow(item);
    if (!mapped) {
      skippedNoId += 1;
      continue;
    }
    const id = mapped.id;
    if (globalSeenIds.has(id)) {
      anyDup = true;
      if (dupSamples.length < 5) dupSamples.push(id);
    }
    globalSeenIds.add(id);
    idsThisPage.push(id);
  }

  const firstId = idsThisPage.length ? idsThisPage[0] : "";
  const lastId = idsThisPage.length ? idsThisPage[idsThisPage.length - 1] : "";

  pageLog.push({
    request_url: url.toString(),
    pagination_type: "single_limit",
    page_number: null,
    offset_value: null,
    requested_limit: limit,
    items_returned: items.length,
    ids_extracted: idsThisPage.length,
    items_skipped_no_id: skippedNoId,
    first_id: firstId,
    last_id: lastId,
    time_ms: timeMs,
    http_status: httpStatus,
    any_duplicates_with_previous_page: anyDup,
    duplicate_ids_sample: dupSamples,
    api_total_field: extractTotal(body),
  });

  return body;
}

/**
 * Replica la descarga del sync: un solo GET con `limit` (sin offset/page/p).
 */
async function collectApiIdsAndPageLog(token) {
  const limit = PAGE_SIZE;
  let totalReported = null;
  const listaApiIds = [];
  const pageRows = [];
  const globalSeen = new Set();
  const acc = [];

  const body = await fetchDriversPageLogged(token, { limit }, pageRows, globalSeen);
  totalReported = extractTotal(body);
  const items = extractItems(body);
  const lastPageItemCount = items.length;

  console.error(`[diagnose] GET único: limit=${limit}, ítems en respuesta=${items.length}`);

  const mapped = items.map(mapDriverRow).filter(Boolean);
  console.error(`[diagnose] ids mapeables=${mapped.length}`);

  for (const m of mapped) listaApiIds.push(m.id);
  acc.push(...mapped);

  const reachedFetchCap =
    lastPageItemCount >= limit && totalReported !== null && totalReported > lastPageItemCount;

  return {
    listaApiIds,
    totalReported,
    pagesUsed: 1,
    mode: "single_limit",
    pageRows,
    accLen: acc.length,
    reachedFetchCap,
  };
}

async function fetchDbCountsAndIds() {
  const headRes = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/moobiz_drivers?select=id&limit=1`,
    {
      headers: supabaseHeaders({ Prefer: "count=exact", Accept: "application/json" }),
    },
    "Supabase count moobiz_drivers",
  );
  if (!headRes.ok) {
    throw new Error(`DB count: ${headRes.status} ${await headRes.text()}`);
  }
  const cr = headRes.headers.get("content-range") || "";
  let totalDb = null;
  const m = /\d+-\d+\/(\d+)/.exec(cr);
  if (m) totalDb = Number.parseInt(m[1], 10);

  const dbIds = [];
  const chunk = 1000;
  let off = 0;
  while (true) {
    const res = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/moobiz_drivers?select=id&order=id.asc&limit=${chunk}&offset=${off}`,
      { headers: supabaseHeaders({ Accept: "application/json" }) },
      `Supabase list ids offset=${off}`,
    );
    if (!res.ok) throw new Error(`DB fetch ids: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) break;
    for (const r of rows) {
      if (r && r.id != null) dbIds.push(String(r.id));
    }
    if (rows.length < chunk) break;
    off += chunk;
  }

  const totalDbDistinct = new Set(dbIds).size;
  const totalDbRows = totalDb != null && Number.isFinite(totalDb) ? totalDb : dbIds.length;

  return { totalDb: totalDbRows, totalDbDistinct, dbIds };
}

function setDiff(aArr, bSet) {
  const out = [];
  for (const x of aArr) {
    if (!bSet.has(x)) out.push(x);
  }
  return out;
}

function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

main();

(async () => {
  const meta = {
    generated_at: new Date().toISOString(),
    drivers_base_url: DRIVERS_BASE_URL,
    page_size: PAGE_SIZE,
    max_pages: 1,
    api_unreachable: false,
    supabase_unreachable: false,
    token_source: null,
    errors: [],
  };

  let token = "";
  try {
    const r = await resolveToken();
    token = r.token;
    meta.token_source = r.source;
  } catch (e) {
    meta.api_unreachable = true;
    meta.errors.push(e instanceof Error ? e.message : String(e));
    fs.writeFileSync(
      path.join(REPORTS_DIR, "moobiz_drivers_sync_report.md"),
      buildMarkdown({
        meta,
        total_api: null,
        total_api_ids: null,
        total_db: null,
        total_db_distinct: null,
        missing: [],
        extra: [],
        pageSummary: null,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(REPORTS_DIR, "moobiz_drivers_missing_ids.json"),
      JSON.stringify({ error: meta.errors[0], ids: [] }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(REPORTS_DIR, "moobiz_drivers_extra_ids.json"),
      JSON.stringify({ error: meta.errors[0], ids: [] }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_pages.json"), JSON.stringify({ pages: [] }, null, 2), "utf8");
    console.error("[diagnose]", meta.errors[0]);
    process.exit(2);
  }

  let api = null;
  try {
    api = await collectApiIdsAndPageLog(token);
  } catch (e) {
    meta.api_unreachable = true;
    meta.errors.push(e instanceof Error ? e.message : String(e));
  }

  let db = null;
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    db = await fetchDbCountsAndIds();
  } catch (e) {
    meta.supabase_unreachable = true;
    meta.errors.push(e instanceof Error ? e.message : String(e));
  }

  const listaApiIds = api ? api.listaApiIds : [];
  const totalApi = api && api.totalReported != null ? api.totalReported : null;
  const totalApiIds = listaApiIds.length;
  const uniqueApi = [...new Set(listaApiIds)];

  const dbIds = db ? db.dbIds : [];
  const dbSet = new Set(dbIds);
  const apiSet = new Set(uniqueApi);

  const missingInDb = uniqueApi.filter((id) => !dbSet.has(id));
  const extraInDb = dbIds.filter((id) => !apiSet.has(id));

  const missingSlice = missingInDb.slice(0, 500);
  fs.writeFileSync(
    path.join(REPORTS_DIR, "moobiz_drivers_missing_ids.json"),
    JSON.stringify(
      {
        meta: {
          total_missing: missingInDb.length,
          stored_count: missingSlice.length,
          truncated: missingInDb.length > 500,
        },
        ids: missingSlice,
      },
      null,
      2,
    ),
    "utf8",
  );

  fs.writeFileSync(
    path.join(REPORTS_DIR, "moobiz_drivers_extra_ids.json"),
    JSON.stringify({ total_extra: extraInDb.length, ids: extraInDb }, null, 2),
    "utf8",
  );

  const pageLog = api ? api.pageRows : [];
  fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_pages.json"), JSON.stringify({ pages: pageLog }, null, 2), "utf8");

  const csvLines = [
    [
      "pagination_type",
      "page_number",
      "offset_value",
      "requested_limit",
      "items_returned",
      "ids_extracted",
      "items_skipped_no_id",
      "first_id",
      "last_id",
      "time_ms",
      "http_status",
      "any_duplicates_with_previous_page",
      "duplicate_ids_sample",
      "api_total_field",
      "request_url",
    ].join(","),
  ];
  for (const row of pageLog) {
    csvLines.push(
      [
        csvEscape(row.pagination_type),
        csvEscape(row.page_number),
        csvEscape(row.offset_value),
        csvEscape(row.requested_limit),
        csvEscape(row.items_returned),
        csvEscape(row.ids_extracted),
        csvEscape(row.items_skipped_no_id),
        csvEscape(row.first_id),
        csvEscape(row.last_id),
        csvEscape(row.time_ms),
        csvEscape(row.http_status),
        csvEscape(row.any_duplicates_with_previous_page),
        csvEscape((row.duplicate_ids_sample || []).join("|")),
        csvEscape(row.api_total_field),
        csvEscape(row.request_url),
      ].join(","),
    );
  }
  fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_pages.csv"), csvLines.join("\n"), "utf8");

  const md = buildMarkdown({
    meta,
    total_api: totalApi,
    total_api_ids: totalApiIds,
    total_api_ids_unique: uniqueApi.length,
    duplicate_ids_in_stream: totalApiIds - uniqueApi.length,
    total_db: db ? db.totalDb : null,
    total_db_distinct: db ? db.totalDbDistinct : null,
    missing: missingInDb,
    extra: extraInDb,
    pageSummary: summarizePages(pageLog),
    apiCollect: api,
  });

  fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_sync_report.md"), md, "utf8");
  console.log("[diagnose] Reporte en", REPORTS_DIR);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function summarizePages(pageLog) {
  const dups = pageLog.filter((p) => p.any_duplicates_with_previous_page);
  const empty = pageLog.filter((p) => (p.items_returned ?? 0) === 0);
  const errors = pageLog.filter((p) => p.error);
  const fivexx = pageLog.filter((p) => p.http_status >= 500);
  const skipped = pageLog.reduce((s, p) => s + (p.items_skipped_no_id || 0), 0);
  return {
    total_requests: pageLog.length,
    pages_with_duplicates_vs_previous: dups.length,
    empty_item_pages: empty.length,
    errors_in_log: errors.length,
    http_5xx: fivexx.length,
    total_items_skipped_no_id: skipped,
    sample_duplicate_pages: dups.slice(0, 5),
  };
}

function buildMarkdown({
  meta,
  total_api,
  total_api_ids,
  total_api_ids_unique,
  duplicate_ids_in_stream,
  total_db,
  total_db_distinct,
  missing,
  extra,
  pageSummary,
  apiCollect,
}) {
  const lines = [];
  lines.push("# Informe diagnóstico: moobiz_drivers vs API Moobiz");
  lines.push("");
  lines.push(`- Generado: ${meta.generated_at}`);
  lines.push(`- URL base conductores: \`${meta.drivers_base_url}\``);
  lines.push(`- \`limit\` (PAGE_SIZE): ${meta.page_size}`);
  lines.push(`- Peticiones API (sync actual): **${meta.max_pages}** (GET único con \`limit\`)`);
  lines.push(`- Origen del token: ${meta.token_source ?? "(desconocido)"}`);
  lines.push("");

  if (meta.errors.length) {
    lines.push("## Errores / advertencias");
    for (const e of meta.errors) lines.push(`- ${e}`);
    lines.push("");
  }

  lines.push("## Totales API");
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| total_api (campo \`total\` del JSON, primera respuesta válida) | ${total_api ?? "N/D"} |`);
  lines.push(`| total_api_ids (IDs extraídos de ítems, con posibles repetidos) | ${total_api_ids ?? "N/D"} |`);
  lines.push(`| total_api_ids_unique | ${total_api_ids_unique ?? "N/D"} |`);
  lines.push(`| duplicate_ids_in_stream (lista bruta − únicos) | ${duplicate_ids_in_stream ?? "N/D"} |`);
  if (apiCollect) {
    lines.push(`| Modo de paginación | **single_limit** (solo \`limit\`, sin \`offset\`/\`page\`/\`p\`) |`);
    lines.push(`| Peticiones realizadas | ${apiCollect.pagesUsed} |`);
    lines.push(`| Filas mapeadas acumuladas (\`acc.length\`) | ${apiCollect.accLen} |`);
    lines.push(`| Tope de peticiones alcanzado con página llena (\`reachedFetchCap\`) | ${apiCollect.reachedFetchCap ? "sí" : "no"} |`);
  }
  lines.push("");

  lines.push("## Totales base de datos");
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| total_db (COUNT vía Content-Range o recorrido) | ${total_db ?? "N/D"} |`);
  lines.push(`| total_db_distinct | ${total_db_distinct ?? "N/D"} |`);
  lines.push("");

  const totalMissing = missing ? missing.length : 0;
  lines.push("## Diferencia API → DB");
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| total_missing (IDs en API únicos y no en DB) | ${totalMissing} |`);
  lines.push(`| total_extra (IDs en DB y no en API en esta corrida) | ${extra ? extra.length : "N/D"} |`);
  lines.push("");
  lines.push("### Primeros 20 missing IDs");
  if (!missing || missing.length === 0) lines.push("_Ninguno (o no se pudo calcular)._");
  else lines.push("```\n" + missing.slice(0, 20).join("\n") + "\n```");
  lines.push("");

  lines.push("## Resumen de paginación (requests)");
  if (pageSummary) {
    lines.push(`- Peticiones registradas: **${pageSummary.total_requests}**`);
    lines.push(`- Páginas con duplicados respecto a páginas anteriores: **${pageSummary.pages_with_duplicates_vs_previous}**`);
    lines.push(`- Respuestas con 0 ítems: **${pageSummary.empty_item_pages}**`);
    lines.push(`- Entradas con error en log: **${pageSummary.errors_in_log}**`);
    lines.push(`- HTTP 5xx: **${pageSummary.http_5xx}**`);
    lines.push(`- Ítems sin \`id\` válido (omitidos del listado API, mismo criterio que sync): **${pageSummary.total_items_skipped_no_id}**`);
  } else {
    lines.push("_No hay datos de paginación._");
  }
  lines.push("");
  lines.push("Detalle completo: `reports/moobiz_drivers_pages.csv` y `reports/moobiz_drivers_pages.json`.");
  lines.push("");

  lines.push("## Causa probable (lectura de evidencia)");
  lines.push("");
  if (meta.api_unreachable) {
    lines.push("- **API no consultada** o falló antes de completar: revisar token (`MOOBIZ_DRIVERS_TOKEN`) o Supabase para `sync_state` + `MOOBIZ_EMAIL`/`MOOBIZ_PASSWORD`.");
  } else if (total_api != null && total_api_ids_unique != null && total_api_ids_unique < total_api) {
    lines.push(
      `- **La API reporta \`total=${total_api}\` pero solo se obtuvieron ${total_api_ids_unique} IDs únicos**: \`limit\` demasiado bajo (sube \`MOOBIZ_DRIVERS_PAGE_SIZE\`), corte por error de red, o revisar JSON de la petición.`,
    );
  } else if (pageSummary && pageSummary.total_items_skipped_no_id > 0) {
    lines.push(
      `- **${pageSummary.total_items_skipped_no_id} ítems sin \`id\` usable**: el sync los descarta igual que este informe; si el \`total\` de la API los cuenta, explicaría parte del hueco.`,
    );
  } else if (totalMissing > 0 && total_api_ids_unique === total_api && total_db != null && totalMissing === total_api - total_db) {
    lines.push(
      "- **Los IDs faltantes están en la API pero no en DB**: si el fetch en este informe coincide con `total_api`, el problema estaría en **upsert/post-Supabase** (ejecución anterior incompleta, error parcial no registrado, o datos borrados). Si aquí el fetch ya trae menos que `total_api`, el problema es **paginación**.",
    );
  } else {
    lines.push("- Revisar `moobiz_drivers_pages.csv`: última página incompleta, duplicados, o `acc.length` vs `total`.");
  }
  lines.push("");

  lines.push("## Recomendación rápida");
  if (totalMissing > 0 && total_api_ids_unique >= (total_api ?? 0)) {
    lines.push("- **Re-fetch de missing**: volver a ejecutar sync tras corregir paginación, o upsert solo los IDs listados en `moobiz_drivers_missing_ids.json` (tras análisis).");
  } else {
    lines.push("- **Full re-sync** tras subir `MOOBIZ_DRIVERS_PAGE_SIZE` si `reachedFetchCap` indica truncado.");
  }
  lines.push("");

  lines.push("## Pasos siguientes sugeridos");
  lines.push("1. Abrir `moobiz_drivers_pages.csv` y verificar últimas filas: `items_returned`, `ids_extracted`, `any_duplicates_with_previous_page`.");
  lines.push("2. Comparar `total_api` con `total_api_ids_unique` y con `accLen` en el JSON de páginas.");
  lines.push("3. Si el fetch actual trae 1811 IDs y la tabla 1796, auditar logs del último `sync_monitor` / errores de Supabase en el momento del upsert.");
  lines.push("4. Si el fetch actual trae 1796 IDs, ajustar paginación (no aplicado en este informe).");
  lines.push("");
  return lines.join("\n");
}
