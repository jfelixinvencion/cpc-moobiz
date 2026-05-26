/**
 * Diagnóstico: por qué extracción devuelve 0 filas / exhausted_pages.
 * SOLO LECTURA — no persiste en BD.
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { randomUUID } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const runId = randomUUID().slice(0, 8);
const tmpDir = join(process.cwd(), "tmp");
mkdirSync(tmpDir, { recursive: true });

const BASE =
  (process.env.MOOBIZ_API_BASE_URL && String(process.env.MOOBIZ_API_BASE_URL).trim()) ||
  "https://app.moobiz.pe";
const SERVICES_URL =
  (process.env.MOOBIZ_SERVICES_URL && String(process.env.MOOBIZ_SERVICES_URL).trim()) ||
  `${BASE}/api/admin/services`;
const LOGIN = `${BASE}/api/admin/login/login`;
const UA = "Mozilla/5.0 Chrome/124 Safari/537.36";

function headersToObject(res) {
  const out = {};
  res.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function probePaths(body) {
  const paths = {};
  if (Array.isArray(body)) paths["(root array)"] = body.length;
  if (body && typeof body === "object") {
    for (const key of ["items", "data", "services", "payload", "results", "records"]) {
      const v = body[key];
      if (Array.isArray(v)) paths[`body.${key}`] = v.length;
      else if (v && typeof v === "object") {
        paths[`body.${key} (type)`] = `object keys: ${Object.keys(v).slice(0, 12).join(",")}`;
        if (Array.isArray(v.items)) paths[`body.${key}.items`] = v.items.length;
      }
    }
  }
  return paths;
}

function extractLikeSync(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.services)) return payload.services;
  return [];
}

function extractLikeExtraction(payload) {
  return Array.isArray(payload)
    ? payload
    : payload?.items || payload?.data || payload?.services || [];
}

async function login() {
  const res = await fetch(LOGIN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify({
      username: process.env.MOOBIZ_EMAIL,
      password: process.env.MOOBIZ_PASSWORD,
      uuid: randomUUID(),
      language: "es",
      os: "Windows",
      os_version: "10",
      device_brand: "Chrome",
      device_model: "147",
      app_version_code: 193,
      time_zone_offset: -5,
      user_agent: UA,
      country_code: "US",
    }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, body, text: text.slice(0, 500) };
}

async function fetchPage(bearer, page, limit, withDates) {
  const p = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    order_col: "date_updated",
    order_dir: "desc",
  });
  if (withDates) {
    p.set("date_from", "2026-05-05");
    p.set("date_to", new Date().toISOString());
  }
  const url = `${SERVICES_URL}?${p}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-Auth-Token": bearer,
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
      "User-Agent": UA,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body = null;
  let parseError = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    parseError = e.message;
  }
  return {
    url,
    query: Object.fromEntries(p),
    status: res.status,
    headers: headersToObject(res),
    body_bytes: Buffer.byteLength(text, "utf8"),
    body_preview_first_200_bytes: text.slice(0, 200),
    body,
    parse_error: parseError,
    path_probe: body ? probePaths(body) : null,
    items_sync_extractor: body ? extractLikeSync(body).length : null,
    items_extraction_extractor: body ? extractLikeExtraction(body).length : null,
    body_top_keys: body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null,
    ok_field: body?.ok,
    msg_field: body?.msg,
    total_field: body?.total,
  };
}

async function main() {
  const report = {
    run_id: runId,
    services_url_base: SERVICES_URL,
    env: {
      has_MOOBIZ_TOKEN: Boolean(String(process.env.MOOBIZ_TOKEN || "").trim()),
      has_MOOBIZ_EMAIL: Boolean(String(process.env.MOOBIZ_EMAIL || "").trim()),
      MOOBIZ_API_BASE_URL: BASE,
    },
    auth: {},
    requests: [],
    diagnosis: [],
  };

  let bearer = String(process.env.MOOBIZ_TOKEN || "").trim();
  let authMethod = "MOOBIZ_TOKEN";

  if (!bearer) {
    authMethod = "login";
    const loginRes = await login();
    report.auth.login = {
      status: loginRes.status,
      ok: loginRes.body?.ok,
      has_token: Boolean(loginRes.body?.token),
      preview: loginRes.text,
    };
    if (loginRes.body?.token) bearer = loginRes.body.token.trim();
  } else {
    report.auth.token_source = "MOOBIZ_TOKEN env";
  }

  report.auth.method = authMethod;
  report.auth.token_redacted = bearer ? `${bearer.slice(0, 8)}...` : null;

  if (!bearer) {
    report.diagnosis.push("FATAL: sin token tras login/env");
    const outPath = join(tmpDir, `moobiz-raw-response-${runId}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const cases = [
    { label: "extraction_params_no_dates", page: 1, limit: 200, withDates: false },
    { label: "extraction_params_limit_10_no_dates", page: 1, limit: 10, withDates: false },
    { label: "legacy_with_date_from_to", page: 1, limit: 200, withDates: true },
  ];

  for (const c of cases) {
    const r = await fetchPage(bearer, c.page, c.limit, c.withDates);
    report.requests.push({ ...c, ...r });
    const dumpPath = join(tmpDir, `moobiz-raw-response-${runId}-${c.label}.json`);
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          label: c.label,
          status: r.status,
          headers: r.headers,
          url: r.url,
          query: r.query,
          body: r.body,
        },
        null,
        2,
      ),
      "utf8",
    );
    r.dump_path = dumpPath;
  }

  const main = report.requests[0];
  if (main.status === 401 || main.status === 403) {
    report.diagnosis.push(`Auth fallida: HTTP ${main.status} — renovar MOOBIZ_TOKEN o credenciales.`);
  } else if (main.status !== 200) {
    report.diagnosis.push(`HTTP ${main.status} en listado — revisar body en dump.`);
  } else if (main.items_extraction_extractor === 0 && main.items_sync_extractor > 0) {
    report.diagnosis.push(
      "BUG: extractItems (sync) encuentra filas pero extractor usa body?.data incorrectamente si data no es array.",
    );
  } else if (main.items_extraction_extractor === 0 && main.ok_field === false) {
    report.diagnosis.push(`API ok=false: ${main.msg_field || "sin msg"} — token o permisos.`);
  } else if (main.items_extraction_extractor === 0) {
    const legacy = report.requests.find((x) => x.label === "legacy_with_date_from_to");
    if (legacy && legacy.items_extraction_extractor > 0) {
      report.diagnosis.push(
        "Sin date_from/date_to la API devuelve 0 items; CON fechas devuelve datos — el endpoint puede requerir filtros de fecha.",
      );
    } else {
      report.diagnosis.push(
        "0 items en todos los casos — entorno vacío, token sin permiso admin/services, o path JSON distinto (ver path_probe y dump).",
      );
    }
  } else {
    report.diagnosis.push(`OK: ${main.items_extraction_extractor} items en page 1 (extraction extractor).`);
  }

  report.recommendation = report.diagnosis[report.diagnosis.length - 1];
  const outPath = join(tmpDir, `moobiz-extraction-diagnosis-${runId}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  report.output_path = outPath;

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
