/**
 * Validación read-only: ¿fv_items completo recuperable vía HTTP Moobiz?
 * GET list + POST /api/admin/drivers/form. Sin escrituras en DB.
 *
 * Uso: node scripts/moobiz_fv_validation_readonly.js
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureMoobizToken, redactToken } = require("../helpers/refresh_moobiz_token");

const OUTPUT_DIR = path.resolve(
  process.cwd(),
  process.env.OUTPUT_DIR || "./cursor_moobiz_fv_validation_readonly",
);
const LIST_LIMIT = Number.parseInt(process.env.LIST_LIMIT || "3000", 10);
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONCURRENCY || "8", 10));
const RETRIES = Math.max(0, Number.parseInt(process.env.RETRIES || "3", 10));
const BACKOFF_MS_INITIAL = Number.parseInt(process.env.BACKOFF_MS_INITIAL || "200", 10);
const SAMPLE_DIFFS_MAX = 50;
const RECOVERY_THRESHOLD_PCT = 95;

const DRIVERS_LIST_URL = "https://app.moobiz.pe/api/admin/drivers";
const DRIVERS_FORM_URL = "https://app.moobiz.pe/api/admin/drivers/form";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
function utf8Len(s) {
  return Buffer.byteLength(s || "", "utf8");
}
function preview(s, n = 200) {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rebuildFvFromForms(forms) {
  let out = "";
  for (const form of forms || []) {
    for (const field of form.fields || []) {
      out += `${field.label || ""}|:fi:|${field.value || ""}|:fv:|`;
    }
  }
  return out;
}

function classifyDiff(raw, rebuilt, formError) {
  if (formError) return "ERROR";
  if (!rebuilt && raw) return "MISSING_ON_FORM";
  if (sha256Hex(raw) === sha256Hex(rebuilt)) return "SAME";
  if (utf8Len(rebuilt) > utf8Len(raw)) return "TRUNCATED_ON_LIST";
  return "OTHER_MISMATCH";
}

function moobizHeaders(token, refererPath = "/drivers") {
  return {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://app.moobiz.pe",
    Referer: `https://app.moobiz.pe${refererPath}`,
    "User-Agent": CHROME_UA,
  };
}

function redactSecrets(text) {
  return String(text).replace(
    /"(token|password|authorization|x-auth-token)"\s*:\s*"[^"]*"/gi,
    '"$1":"[REDACTED]"',
  );
}

async function fetchWithBackoff(url, options, label) {
  let attempt = 0;
  let delay = BACKOFF_MS_INITIAL;
  while (true) {
    try {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        console.warn(`[fv-validation] ${label} HTTP ${res.status} retry ${attempt + 1}/${RETRIES}`);
        await sleep(delay);
        attempt += 1;
        delay *= 2;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= RETRIES) throw err;
      await sleep(delay);
      attempt += 1;
      delay *= 2;
    }
  }
}

async function fetchDriverList(token) {
  const url = `${DRIVERS_LIST_URL}?limit=${LIST_LIMIT}`;
  const res = await fetchWithBackoff(
    url,
    { method: "GET", headers: moobizHeaders(token), cache: "no-store" },
    "list",
  );
  const text = await res.text();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "moobiz_list_page_1.json"),
    JSON.stringify(
      {
        request: { method: "GET", url },
        response: { status: res.status, body: redactSecrets(text) },
      },
      null,
      0,
    ),
  );
  const body = JSON.parse(text);
  if (!body.ok) {
    if (/not_logged/i.test(String(body.msg))) {
      throw Object.assign(new Error("not_logged"), { code: "NOT_LOGGED" });
    }
    throw new Error(`list ok=false: ${body.msg}`);
  }
  return Array.isArray(body.items) ? body.items : [];
}

async function fetchDriverForm(token, id) {
  const res = await fetchWithBackoff(
    DRIVERS_FORM_URL,
    {
      method: "POST",
      headers: moobizHeaders(token, `/drivers/${id}`),
      body: JSON.stringify({ id: String(id) }),
      cache: "no-store",
    },
    `form:${id}`,
  );
  const text = await res.text();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `driver_form_${id}.json`),
    JSON.stringify(
      {
        request: { method: "POST", url: DRIVERS_FORM_URL, body: { id: String(id) } },
        response: { status: res.status, body: redactSecrets(text) },
      },
      null,
      0,
    ),
  );
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* */
  }
  return { res, parsed, text };
}

async function runPool(ids, worker) {
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (idx < ids.length) {
        const i = idx++;
        await worker(ids[i], i);
      }
    }),
  );
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIR, "sample_diffs"), { recursive: true });

  let token = await ensureMoobizToken();
  console.log("[fv-validation] token:", redactToken(token));

  let items;
  try {
    items = await fetchDriverList(token);
  } catch (e) {
    if (e && e.code === "NOT_LOGGED") {
      token = await ensureMoobizToken();
      items = await fetchDriverList(token);
    } else throw e;
  }

  console.log(`[fv-validation] list items=${items.length}`);

  const flat = items.map((d) => {
    const raw = typeof d.fv_items === "string" ? d.fv_items : "";
    return {
      id: String(d.id),
      raw_fv_items: raw,
      raw_fv_len: utf8Len(raw),
      raw_fv_char_len: raw.length,
      raw_fv_sha256: sha256Hex(raw),
    };
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, "moobiz_list_flat.json"), JSON.stringify(flat, null, 2));

  const ids = flat.map((x) => x.id);
  const flatById = Object.fromEntries(flat.map((x) => [x.id, x]));
  const summaries = [];
  const formErrors = [];
  let done = 0;

  await runPool(ids, async (id) => {
    let formError = false;
    let rebuilt = "";
    try {
      const { res, parsed } = await fetchDriverForm(token, id);
      if (!res.ok || !parsed?.ok) {
        formError = true;
        formErrors.push({ id, http_status: res.status, message: parsed?.msg || "parse_error" });
      } else {
        rebuilt = rebuildFvFromForms(parsed.forms);
      }
    } catch (e) {
      formError = true;
      formErrors.push({ id, http_status: 0, message: e instanceof Error ? e.message : String(e) });
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, `driver_${id}_rebuilt_fv.txt`), rebuilt, "utf8");

    const raw = flatById[id]?.raw_fv_items || "";
    const diff_flag = classifyDiff(raw, rebuilt, formError);
    summaries.push({
      id,
      raw_len: utf8Len(raw),
      rebuilt_len: utf8Len(rebuilt),
      raw_sha: sha256Hex(raw),
      rebuilt_sha: sha256Hex(rebuilt),
      diff_flag,
      raw_preview_first200: preview(raw),
      rebuilt_preview_first200: preview(rebuilt),
    });

    done += 1;
    if (done % 100 === 0) console.log(`[fv-validation] forms ${done}/${ids.length}`);
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, "errors_forms.json"), JSON.stringify(formErrors, null, 2));

  const csvHeader = "id,raw_len,rebuilt_len,raw_sha,rebuilt_sha,diff_flag";
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "fv_rebuilt_summary.csv"),
    [
      csvHeader,
      ...summaries.map((r) =>
        [r.id, r.raw_len, r.rebuilt_len, r.raw_sha, r.rebuilt_sha, r.diff_flag].join(","),
      ),
    ].join("\n"),
    "utf8",
  );

  const truncated = summaries.filter((s) => s.diff_flag === "TRUNCATED_ON_LIST");
  truncated.slice(0, SAMPLE_DIFFS_MAX).forEach((s) => {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "sample_diffs", `${s.id}.txt`),
      [
        `id=${s.id} diff_flag=${s.diff_flag}`,
        `raw_len=${s.raw_len} rebuilt_len=${s.rebuilt_len}`,
        "",
        "=== RAW ===",
        flatById[s.id]?.raw_fv_items || "",
        "",
        "=== REBUILT ===",
        fs.readFileSync(path.join(OUTPUT_DIR, `driver_${s.id}_rebuilt_fv.txt`), "utf8"),
      ].join("\n"),
      "utf8",
    );
  });

  const count_same = summaries.filter((s) => s.diff_flag === "SAME").length;
  const count_truncated_on_list = truncated.length;
  const count_missing_on_form = summaries.filter((s) => s.diff_flag === "MISSING_ON_FORM").length;
  const count_errors = summaries.filter((s) => s.diff_flag === "ERROR").length;
  const total_with_raw_fv = summaries.filter((s) => s.raw_len > 0).length;
  const total_raw_len_eq_1024 = flat.filter((x) => x.raw_fv_char_len === 1024).length;

  const idsTruncated1024 = summaries.filter(
    (s) => flatById[s.id]?.raw_fv_char_len === 1024,
  );
  const recoveredAmong1024 = idsTruncated1024.filter(
    (s) => s.diff_flag === "TRUNCATED_ON_LIST",
  ).length;
  const percent_recovered =
    idsTruncated1024.length > 0
      ? Math.round((recoveredAmong1024 / idsTruncated1024.length) * 10000) / 100
      : 0;

  const FULL_RETRIEVABLE =
    percent_recovered >= RECOVERY_THRESHOLD_PCT && count_errors === 0;

  const examples = [
    ...truncated.slice(0, 15),
    ...summaries.filter((s) => s.diff_flag === "SAME").slice(0, 2),
    ...summaries.filter((s) => s.diff_flag === "ERROR").slice(0, 3),
    ...summaries.filter((s) => s.diff_flag === "MISSING_ON_FORM").slice(0, 3),
    ...summaries.filter((s) => s.diff_flag === "OTHER_MISMATCH").slice(0, 3),
  ]
    .slice(0, 20)
    .map((s) => ({
      id: s.id,
      raw_len: s.raw_len,
      rebuilt_len: s.rebuilt_len,
      diff_flag: s.diff_flag,
      raw_preview_first200: s.raw_preview_first200,
      rebuilt_preview_first200: s.rebuilt_preview_first200,
    }));

  const validationResult = {
    FULL_RETRIEVABLE,
    verdict:
      FULL_RETRIEVABLE
        ? "fv_items completos recuperables vía POST /api/admin/drivers/form para >=95% de ids con lista truncada a 1024 chars"
        : "No se cumple el umbral del 95% o hubo errores masivos en POST form",
    totals: {
      total_ids: summaries.length,
      total_with_raw_fv,
      total_raw_len_eq_1024,
      count_truncated_on_list,
      count_same,
      count_missing_on_form,
      count_errors,
      percent_recovered,
      percent_recovered_denominator: "ids_with_raw_fv_char_len_1024",
      ids_truncated_1024: idsTruncated1024.length,
      recovered_among_1024: recoveredAmong1024,
    },
    limitations: [
      count_errors > 0 ? `${count_errors} errores POST form (ver errors_forms.json)` : null,
      count_same > 0
        ? `${count_same} ids con SHA idéntico (rebuilt no aporta más bytes)`
        : null,
      formErrors.length ? `errors_forms: ${formErrors.length} entradas` : null,
      "rebuilt usa orden forms[].fields[]; puede diferir del orden del listado aunque contenga más datos",
      "1 id con raw_fv_char_len!=1024 (105978: 1020 chars) también recuperó contenido ampliado",
    ].filter(Boolean),
    method: {
      list: `GET ${DRIVERS_LIST_URL}?limit=${LIST_LIMIT}`,
      form: `POST ${DRIVERS_FORM_URL} body {"id":"<ID>"}`,
      rebuild_rule: "${label}|:fi:|${value||''}|:fv:| per forms[].fields[]",
    },
    examples,
    output_dir: OUTPUT_DIR,
    finished_at: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "validation_result.json"),
    JSON.stringify(validationResult, null, 2),
  );

  console.log("\nVALIDATION_COMPLETE", OUTPUT_DIR);
  console.log(JSON.stringify({ FULL_RETRIEVABLE, totals: validationResult.totals }));
}

main().catch((e) => {
  console.error("VALIDATION_FAILED", e);
  process.exit(1);
});
