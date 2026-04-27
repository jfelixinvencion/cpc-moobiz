/**
 * Diagnóstico rápido de paginación GET /api/admin/drivers (solo lectura).
 * No escribe en Supabase ni ejecuta RPC; opcionalmente lee sync_state para el token.
 *
 * Salida: reports/moobiz_drivers_page_probe.json, reports/moobiz_drivers_page_probe.md
 *
 * Token (mismo orden que sync): MOOBIZ_DRIVERS_TOKEN → GET sync_state.moobiz_token → login (sin persistir).
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
const LIMIT = 1000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function readSyncStateValue(key) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return "";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sync_state?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: supabaseHeaders() },
  );
  if (!res.ok) return "";
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const v = rows[0].value;
  return typeof v === "string" ? v.trim() : "";
}

async function moobizAdminLoginNoPersist() {
  const username = typeof MOOBIZ_EMAIL === "string" ? MOOBIZ_EMAIL.trim() : "";
  const password = typeof MOOBIZ_PASSWORD === "string" ? MOOBIZ_PASSWORD.trim() : "";
  if (!username || !password) {
    throw new Error("Sin token en env ni sync_state: define MOOBIZ_DRIVERS_TOKEN o MOOBIZ_EMAIL/MOOBIZ_PASSWORD.");
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
  if (!res.ok) throw new Error(`MOOBIZ_LOGIN: HTTP ${res.status} — ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text);
  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error("MOOBIZ_LOGIN: sin token en respuesta");
  }
  return parsed.token.trim();
}

async function resolveToken() {
  const only = typeof MOOBIZ_DRIVERS_TOKEN === "string" ? MOOBIZ_DRIVERS_TOKEN.trim() : "";
  if (only) return { token: only, source: "MOOBIZ_DRIVERS_TOKEN" };
  const fromDb = await readSyncStateValue(MOOBIZ_TOKEN_KEY);
  if (fromDb) return { token: fromDb, source: "sync_state.moobiz_token (GET)" };
  const fresh = await moobizAdminLoginNoPersist();
  return { token: fresh, source: "MOOBIZ_EMAIL login (no persistido)" };
}

function pickResponseHeaders(res) {
  const out = {};
  const wantExact = [
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "ratelimit-limit",
    "ratelimit-remaining",
    "ratelimit-reset",
    "cf-ray",
    "x-request-id",
  ];
  for (const n of wantExact) {
    const v = res.headers.get(n);
    if (v != null && String(v).length) out[n] = v;
  }
  if (typeof res.headers.getSetCookie === "function") {
    const cookies = res.headers.getSetCookie();
    if (cookies && cookies.length) out["set-cookie"] = cookies;
  } else {
    const sc = res.headers.get("set-cookie");
    if (sc) out["set-cookie"] = sc;
  }
  for (const [k, v] of res.headers.entries()) {
    const lk = k.toLowerCase();
    if (
      (lk.includes("rate") && lk.includes("limit")) ||
      lk === "x-served-by" ||
      lk === "server-timing"
    ) {
      if (out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

function extractItems(body) {
  const raw = body && body.items;
  return Array.isArray(raw) ? raw : [];
}

function idsFromItems(items) {
  const ids = [];
  for (const it of items) {
    if (it && typeof it === "object" && it.id != null) {
      const s = String(it.id).trim();
      if (s) ids.push(s);
    }
  }
  return ids;
}

/**
 * @param {Record<string, string>} queryParams
 */
async function probeOne(token, label, queryParams) {
  const url = new URL(DRIVERS_BASE_URL);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, String(v));
  }
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Auth-Token": token,
        Accept: "application/json",
        Origin: "https://app.moobiz.pe",
        Referer: "https://app.moobiz.pe/",
        "User-Agent": CHROME_UA,
      },
    });
  } catch (e) {
    return {
      label,
      request_url: url.toString(),
      query: queryParams,
      error: e instanceof Error ? e.message : String(e),
      elapsed_ms: Date.now() - t0,
    };
  }

  const text = await res.text();
  const headers = pickResponseHeaders(res);
  let body = null;
  let parseError = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const items = body ? extractItems(body) : [];
  const ids = idsFromItems(items);
  const sample10 = ids.slice(0, 10);
  const firstId = ids.length ? ids[0] : null;
  const lastId = ids.length ? ids[ids.length - 1] : null;
  const idListSignature =
    ids.length > 0 ? `${ids.length}:${ids[0]}:${ids[ids.length - 1]}:${ids.slice(0, 5).join(",")}` : "empty";

  return {
    label,
    request_url: url.toString(),
    query: queryParams,
    http_status: res.status,
    headers,
    elapsed_ms: Date.now() - t0,
    parse_error: parseError,
    api_ok: body && body.ok === true,
    api_msg: typeof body?.msg === "string" ? body.msg : null,
    api_total: body && body.total != null ? body.total : null,
    items_count: items.length,
    ids_extracted: ids.length,
    first_id: firstId,
    last_id: lastId,
    sample_10_ids: sample10,
    id_list_signature: idListSignature,
    body_preview_error: !parseError && res.ok && body && body.ok !== true ? JSON.stringify(body).slice(0, 280) : null,
    raw_body_snippet: parseError || !res.ok ? text.slice(0, 400) : null,
  };
}

function pagesRepeatSignature(results) {
  const main = results.filter((r) => ["page_1", "page_2", "page_3"].includes(r.label) && !r.error);
  if (main.length < 2) return { verdict: "insufficient_data", details: main.map((m) => m.label) };
  const sigs = main.map((m) => m.id_list_signature || "");
  const uniqueSigs = new Set(sigs);
  const sameAll = uniqueSigs.size === 1 && sigs[0] !== "empty";
  return {
    verdict: sameAll ? "likely_same_window_repeated" : "windows_differ_or_incomplete",
    signatures: main.map((m) => ({ label: m.label, signature: m.id_list_signature })),
    unique_signature_count: uniqueSigs.size,
  };
}

function whichParamWorks(results) {
  const p2 = results.find((r) => r.label === "p_2");
  const pagina2 = results.find((r) => r.label === "pagina_2");
  const off = results.find((r) => r.label === "offset_1000_no_page");
  const page1 = results.find((r) => r.label === "page_1");
  const page2 = results.find((r) => r.label === "page_2");

  const ok = (r) => r && !r.error && r.http_status === 200 && r.api_ok && (r.items_count || 0) > 0;

  const pageAdvances =
    ok(page1) &&
    ok(page2) &&
    page1.id_list_signature !== page2.id_list_signature &&
    page1.first_id !== page2.first_id;

  const notes = [];
  if (pageAdvances) notes.push("`limit`+`page` (1 vs 2) devuelven ventanas distintas (first_id / firma distinta).");
  if (ok(p2) && ok(page2) && p2.id_list_signature === page2.id_list_signature) notes.push("`p` coincide con `page` para la 2ª ventana.");
  if (ok(pagina2) && ok(page2) && pagina2.id_list_signature === page2.id_list_signature) notes.push("`pagina` coincide con `page` para la 2ª ventana.");
  if (ok(off) && ok(page2) && off.id_list_signature === page2.id_list_signature) notes.push("`offset` sin `page` coincide con `page=2`.");

  let recommended = "page";
  if (!pageAdvances) {
    if (ok(p2) && ok(page1) && p2.id_list_signature !== page1.id_list_signature) recommended = "p";
    else if (ok(pagina2) && ok(page1) && pagina2.id_list_signature !== page1.id_list_signature) recommended = "pagina";
    else if (ok(off) && ok(page1) && off.id_list_signature !== page1.id_list_signature) recommended = "offset";
    else recommended = "unknown_needs_manual_review";
  }

  return {
    page_1_2_advances: pageAdvances,
    recommended_query_param: recommended,
    notes,
  };
}

function buildMarkdown(meta, results, analysis) {
  const lines = [];
  lines.push("# Probe paginación: Moobiz `/api/admin/drivers`");
  lines.push("");
  lines.push(`- Generado: ${meta.generated_at}`);
  lines.push(`- Base URL: \`${meta.drivers_base_url}\``);
  lines.push(`- Token origen: **${meta.token_source}**`);
  lines.push(`- Límite fijo del probe: **${LIMIT}**`);
  lines.push("");
  lines.push("## Resumen");
  lines.push("");
  lines.push(`- **Parámetro recomendado (heurística):** \`${analysis.which.recommended_query_param}\``);
  lines.push(`- **page=1 vs page=2 avanza:** ${analysis.which.page_1_2_advances ? "sí (ventanas distintas)" : "no o incompleto"}`);
  lines.push(`- **Repetición page 1–3 (misma firma de ids):** ${analysis.repeat.verdict}`);
  if (analysis.which.notes && analysis.which.notes.length) {
    lines.push("");
    for (const n of analysis.which.notes) lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push("### Recomendación inmediata para el sync");
  lines.push("");
  lines.push(analysis.recommendation);
  lines.push("");
  lines.push("## Detalle por petición");
  lines.push("");
  lines.push("| label | status | items | first_id | last_id | api_ok |");
  lines.push("|-------|--------|-------|----------|---------|--------|");
  for (const r of results) {
    const st = r.error ? `ERR` : String(r.http_status ?? "");
    const ic = r.items_count ?? "—";
    const fi = r.first_id != null ? String(r.first_id).slice(0, 12) + "…" : "—";
    const la = r.last_id != null ? String(r.last_id).slice(0, 12) + "…" : "—";
    const ok = r.api_ok === true ? "true" : r.api_ok === false ? "false" : "—";
    lines.push(`| ${r.label} | ${st} | ${ic} | ${fi} | ${la} | ${ok} |`);
  }
  lines.push("");
  lines.push("## Headers relevantes (por petición)");
  for (const r of results) {
    lines.push(`### ${r.label}`);
    if (r.error) {
      lines.push(`- error: ${r.error}`);
      continue;
    }
    const h = r.headers && Object.keys(r.headers).length ? r.headers : {};
    lines.push("```json");
    lines.push(JSON.stringify(h, null, 2));
    lines.push("```");
    lines.push("");
    lines.push(`- sample_10_ids: \`${JSON.stringify(r.sample_10_ids || [])}\``);
    lines.push("");
  }
  return lines.join("\n");
}

function buildRecommendation(which, repeat) {
  if (which.page_1_2_advances && repeat.verdict !== "likely_same_window_repeated") {
    return "Mantener el sync con **`limit` + `page`** (`page=1..N`). Las tres peticiones de control muestran ventanas distintas entre páginas consecutivas.";
  }
  if (repeat.verdict === "likely_same_window_repeated") {
    return "Las respuestas de **page=1,2,3** parecen la **misma ventana** (misma firma de ids). El servidor **no está paginando** con `page` como se espera: revisar otro parámetro en la tabla de variantes (`p`, `pagina`, `offset`) o documentación Moobiz; no fiarse solo de `page` hasta corregir.";
  }
  if (which.recommended_query_param === "p") {
    return "Considerar cambiar el sync a **`p`** en lugar de **`page`** si `p=2` diverge de `page=2` y coincide con el total esperado.";
  }
  if (which.recommended_query_param === "pagina") {
    return "Considerar usar **`pagina`** en el sync si es el único parámetro que avanza la ventana.";
  }
  if (which.recommended_query_param === "offset") {
    return "Si **`offset`** es el que avanza y `page` no, alinear el código del sync a **offset** (y verificar que Moobiz no ignore el offset en tu despliegue).";
  }
  return "Resultado **ambiguo**: revisar `moobiz_drivers_page_probe.json`, comparar `id_list_signature` y `sample_10_ids` entre etiquetas.";
}

(async () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  let tokenSource = "";
  let token = "";
  try {
    const r = await resolveToken();
    token = r.token;
    tokenSource = r.source;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const payload = {
      meta: { generated_at: generatedAt, drivers_base_url: DRIVERS_BASE_URL, token_source: null, error: err },
      results: [],
    };
    fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_page_probe.json"), JSON.stringify(payload, null, 2), "utf8");
    fs.writeFileSync(
      path.join(REPORTS_DIR, "moobiz_drivers_page_probe.md"),
      `# Probe paginación\n\n**Error:** ${err}\n`,
      "utf8",
    );
    console.error("[probe]", err);
    process.exit(2);
    return;
  }

  const scenarios = [
    { label: "page_1", query: { limit: LIMIT, page: 1 } },
    { label: "page_2", query: { limit: LIMIT, page: 2 } },
    { label: "page_3", query: { limit: LIMIT, page: 3 } },
    { label: "page_0", query: { limit: LIMIT, page: 0 } },
    { label: "p_2", query: { limit: LIMIT, p: 2 } },
    { label: "pagina_2", query: { limit: LIMIT, pagina: 2 } },
    { label: "offset_1000_no_page", query: { limit: LIMIT, offset: 1000 } },
  ];

  const results = [];
  for (const s of scenarios) {
    const row = await probeOne(token, s.label, s.query);
    results.push(row);
    if (!row.error) {
      console.log(
        `[probe] ${s.label} status=${row.http_status} items=${row.items_count} first=${row.first_id} last=${row.last_id}`,
      );
    } else {
      console.error(`[probe] ${s.label} error=${row.error}`);
    }
  }

  const repeat = pagesRepeatSignature(results);
  const which = whichParamWorks(results);
  const recommendation = buildRecommendation(which, repeat);

  const payload = {
    meta: {
      generated_at: generatedAt,
      drivers_base_url: DRIVERS_BASE_URL,
      token_source: tokenSource,
      limit: LIMIT,
    },
    analysis: {
      pages_1_2_3_repeat: repeat,
      which_param_works: which,
      recommendation,
    },
    results,
  };

  fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_page_probe.json"), JSON.stringify(payload, null, 2), "utf8");
  const md = buildMarkdown(
    { generated_at: generatedAt, drivers_base_url: DRIVERS_BASE_URL, token_source: tokenSource },
    results,
    { repeat, which, recommendation },
  );
  fs.writeFileSync(path.join(REPORTS_DIR, "moobiz_drivers_page_probe.md"), md, "utf8");
  console.log("[probe] Escrito:", path.join(REPORTS_DIR, "moobiz_drivers_page_probe.json"));
  console.log("[probe] Escrito:", path.join(REPORTS_DIR, "moobiz_drivers_page_probe.md"));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
