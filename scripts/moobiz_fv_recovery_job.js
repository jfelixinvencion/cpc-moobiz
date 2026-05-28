/**
 * Recuperación masiva fv_items: listado Moobiz + POST /api/admin/drivers/form.
 * Dry-run: genera artefactos; NO ejecuta SQL en DB.
 *
 * Uso:
 *   node scripts/moobiz_fv_recovery_job.js
 *   MAX_IDS=50 node scripts/moobiz_fv_recovery_job.js   # muestra reducida
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
  process.env.OUTPUT_DIR || "./cursor_moobiz_fv_recovery",
);
const LIST_LIMIT = Number.parseInt(process.env.LIST_LIMIT || "3000", 10);
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONCURRENCY || "8", 10));
const RETRIES = Math.max(0, Number.parseInt(process.env.RETRIES || "3", 10));
const BACKOFF_MS_INITIAL = Number.parseInt(process.env.BACKOFF_MS_INITIAL || "200", 10);
const MAX_IDS = process.env.MAX_IDS ? Number.parseInt(process.env.MAX_IDS, 10) : null;
const SAMPLE_DIFFS_MAX = Number.parseInt(process.env.SAMPLE_DIFFS_MAX || "50", 10);

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
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Regla exacta de reconstrucción (compatibilidad Moobiz). */
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
  const rawLen = utf8Len(raw);
  const rebuiltLen = utf8Len(rebuilt);
  if (formError) return "ERROR";
  if (!rebuilt && raw) return "MISSING_ON_FORM";
  const rawSha = sha256Hex(raw);
  const rebSha = sha256Hex(rebuilt);
  if (rawSha === rebSha) return "SAME";
  if (rebuiltLen > rawLen) return "TRUNCATED_ON_LIST";
  return "OTHER_MISMATCH";
}

async function resolveToken() {
  const env = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (env && process.env.USE_MOOBIIZ_TOKEN_ENV === "1") {
    console.log("[fv-recovery] MOOBIZ_TOKEN forzado desde env:", redactToken(env));
    return env;
  }
  const t = await ensureMoobizToken();
  console.log("[fv-recovery] token desde store sync_state (ensureMoobizToken):", redactToken(t));
  return t;
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

async function fetchWithBackoff(url, options, label) {
  let attempt = 0;
  let delay = BACKOFF_MS_INITIAL;
  while (true) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, options);
      const latencyMs = Date.now() - t0;
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        console.warn(`[${label}] HTTP ${res.status} retry ${attempt + 1}/${RETRIES} in ${delay}ms`);
        await sleep(delay);
        attempt += 1;
        delay *= 2;
        continue;
      }
      return { res, latencyMs };
    } catch (err) {
      if (attempt >= RETRIES) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${label}] network ${msg} retry ${attempt + 1}/${RETRIES} in ${delay}ms`);
      await sleep(delay);
      attempt += 1;
      delay *= 2;
    }
  }
}

function loadProgress() {
  const p = path.join(OUTPUT_DIR, "progress.json");
  if (!fs.existsSync(p)) {
    return { ids: {}, latenciesMs: [], startedAt: new Date().toISOString() };
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveProgress(progress) {
  fs.writeFileSync(path.join(OUTPUT_DIR, "progress.json"), JSON.stringify(progress, null, 2));
}

async function fetchDriverList(token) {
  const url = `${DRIVERS_LIST_URL}?limit=${LIST_LIMIT}`;
  const { res, latencyMs } = await fetchWithBackoff(
    url,
    { method: "GET", headers: moobizHeaders(token), cache: "no-store" },
    "list",
  );
  const text = await res.text();
  const pagePath = path.join(OUTPUT_DIR, "moobiz_list_page_1.json");
  fs.writeFileSync(
    pagePath,
    JSON.stringify(
      {
        request: { method: "GET", url },
        response: {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          latencyMs,
          body: text,
        },
      },
      null,
      0,
    ),
  );
  if (!res.ok) throw new Error(`List drivers failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  const body = JSON.parse(text);
  if (!body.ok) {
    const err = new Error(`List drivers ok=false: ${body.msg || ""}`);
    err.code = /not_logged/i.test(String(body.msg)) ? "NOT_LOGGED" : "API_ERROR";
    throw err;
  }
  const items = Array.isArray(body.items) ? body.items : [];
  return { items, total: body.total, latencyMs };
}

async function fetchDriverForm(token, id) {
  const body = JSON.stringify({ id: String(id) });
  const { res, latencyMs } = await fetchWithBackoff(
    DRIVERS_FORM_URL,
    {
      method: "POST",
      headers: moobizHeaders(token, `/drivers/${id}`),
      body,
      cache: "no-store",
    },
    `form:${id}`,
  );
  const text = await res.text();
  const outPath = path.join(OUTPUT_DIR, `driver_form_${id}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        request: { method: "POST", url: DRIVERS_FORM_URL, body: { id: String(id) } },
        response: { status: res.status, latencyMs, body: text },
      },
      null,
      0,
    ),
  );
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep null */
  }
  return { res, parsed, text, latencyMs };
}

async function runPool(ids, worker) {
  let idx = 0;
  const results = [];
  async function runOne() {
    while (idx < ids.length) {
      const i = idx++;
      const id = ids[i];
      results[i] = await worker(id);
    }
  }
  const n = Math.min(CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: n }, () => runOne()));
  return results;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, i))];
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIR, "sample_diffs"), { recursive: true });

  const token = await resolveToken();
  const progress = loadProgress();
  const formErrors = [];

  console.log("[fv-recovery] OUTPUT_DIR:", OUTPUT_DIR);
  console.log("[fv-recovery] LIST_LIMIT:", LIST_LIMIT, "CONCURRENCY:", CONCURRENCY);

  let listItems;
  const flatPath = path.join(OUTPUT_DIR, "moobiz_list_flat.json");
  if (fs.existsSync(flatPath) && process.env.SKIP_LIST_FETCH === "1") {
    listItems = JSON.parse(fs.readFileSync(flatPath, "utf8"));
    console.log("[fv-recovery] lista desde cache flat:", listItems.length);
  } else {
    let tokenForList = token;
    let listResult;
    try {
      listResult = await fetchDriverList(tokenForList);
    } catch (e) {
      if (e && e.code === "NOT_LOGGED") {
        console.warn("[fv-recovery] list not_logged — refrescando token…");
        tokenForList = await ensureMoobizToken();
        token = tokenForList;
        listResult = await fetchDriverList(tokenForList);
      } else throw e;
    }
    const { items, total, latencyMs } = listResult;
    console.log(`[fv-recovery] list OK items=${items.length} total=${total} latency=${latencyMs}ms`);
    listItems = items.map((d) => {
      const raw = typeof d.fv_items === "string" ? d.fv_items : "";
      return {
        id: String(d.id),
        raw_fv_items: raw,
        raw_fv_len: utf8Len(raw),
        raw_fv_char_len: raw.length,
        raw_fv_sha256: sha256Hex(raw),
      };
    });
    fs.writeFileSync(flatPath, JSON.stringify(listItems, null, 2));
  }

  let ids = listItems.map((x) => x.id);
  if (MAX_IDS && Number.isFinite(MAX_IDS) && MAX_IDS > 0) {
    ids = ids.slice(0, MAX_IDS);
    listItems = listItems.slice(0, MAX_IDS);
    console.log("[fv-recovery] MAX_IDS limitado a", ids.length);
  }

  const flatById = Object.fromEntries(listItems.map((x) => [x.id, x]));

  let done = 0;
  const pendingIds = ids.filter((id) => {
    const st = progress.ids[id];
    if (st === "success") return false;
    return true;
  });

  console.log(`[fv-recovery] forms pendientes: ${pendingIds.length} / ${ids.length}`);

  await runPool(pendingIds, async (id) => {
    const formPath = path.join(OUTPUT_DIR, `driver_form_${id}.json`);
    let parsed;
    let formError = null;
    let latencyMs = 0;

    try {
      if (fs.existsSync(formPath) && progress.ids[id] === "success") {
        const cached = JSON.parse(fs.readFileSync(formPath, "utf8"));
        parsed = JSON.parse(cached.response.body);
        latencyMs = cached.response.latencyMs || 0;
      } else {
        const result = await fetchDriverForm(token, id);
        latencyMs = result.latencyMs;
        if (!result.res.ok || !result.parsed?.ok) {
          formError = {
            id,
            http_status: result.res.status,
            message: result.parsed?.msg || result.text.slice(0, 300),
            attempts: RETRIES + 1,
          };
          formErrors.push(formError);
          progress.ids[id] = "error";
        } else {
          parsed = result.parsed;
          progress.ids[id] = "success";
        }
      }
    } catch (e) {
      formError = {
        id,
        http_status: 0,
        message: e instanceof Error ? e.message : String(e),
        attempts: RETRIES + 1,
      };
      formErrors.push(formError);
      progress.ids[id] = "error";
    }

    if (latencyMs > 0) progress.latenciesMs.push(latencyMs);

    done += 1;
    if (done % 50 === 0) {
      saveProgress(progress);
      console.log(`[fv-recovery] forms progreso ${done}/${pendingIds.length}`);
    }

    const raw = flatById[id]?.raw_fv_items || "";
    const rebuilt = parsed?.forms ? rebuildFvFromForms(parsed.forms) : "";
    const rebuiltPath = path.join(OUTPUT_DIR, `driver_${id}_rebuilt_fv.txt`);
    fs.writeFileSync(rebuiltPath, rebuilt, "utf8");

    const diff_flag = classifyDiff(raw, rebuilt, !!formError);
    return {
      id,
      raw_fv_len: utf8Len(raw),
      rebuilt_fv_len: utf8Len(rebuilt),
      raw_fv_sha256: sha256Hex(raw),
      rebuilt_fv_sha256: sha256Hex(rebuilt),
      diff_flag,
      rebuilt,
      raw,
    };
  });

  saveProgress(progress);
  fs.writeFileSync(path.join(OUTPUT_DIR, "errors_forms.json"), JSON.stringify(formErrors, null, 2));

  // Recompute summary from all ids (including cached successes)
  const summaries = [];
  for (const id of ids) {
    const flat = flatById[id];
    const raw = flat?.raw_fv_items || "";
    const rebuiltPath = path.join(OUTPUT_DIR, `driver_${id}_rebuilt_fv.txt`);
    let rebuilt = "";
    if (fs.existsSync(rebuiltPath)) rebuilt = fs.readFileSync(rebuiltPath, "utf8");
    const formErr = progress.ids[id] === "error";
    summaries.push({
      id,
      raw_fv_len: utf8Len(raw),
      rebuilt_fv_len: utf8Len(rebuilt),
      raw_fv_sha256: sha256Hex(raw),
      rebuilt_fv_sha256: sha256Hex(rebuilt),
      diff_flag: classifyDiff(raw, rebuilt, formErr),
      sample_preview_raw: preview(raw),
      sample_preview_rebuilt: preview(rebuilt),
    });
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "fv_rebuilt_summary.json"), JSON.stringify(summaries, null, 2));

  const csvHeader =
    "id,raw_len,rebuilt_len,raw_sha256,rebuilt_sha256,diff_flag,sample_preview_raw,sample_preview_rebuilt";
  const csvLines = [
    csvHeader,
    ...summaries.map((r) =>
      [
        r.id,
        r.raw_fv_len,
        r.rebuilt_fv_len,
        r.raw_fv_sha256,
        r.rebuilt_fv_sha256,
        r.diff_flag,
        csvEscape(r.sample_preview_raw),
        csvEscape(r.sample_preview_rebuilt),
      ].join(","),
    ),
  ];
  fs.writeFileSync(path.join(OUTPUT_DIR, "fv_rebuilt_summary.csv"), csvLines.join("\n"), "utf8");

  // sample_diffs
  const truncated = summaries.filter((s) => s.diff_flag === "TRUNCATED_ON_LIST");
  truncated.slice(0, SAMPLE_DIFFS_MAX).forEach((s) => {
    const content = [
      `id=${s.id}`,
      `diff_flag=${s.diff_flag}`,
      `raw_len=${s.raw_fv_len} rebuilt_len=${s.rebuilt_fv_len}`,
      "",
      "=== RAW (list API, truncated) ===",
      flatById[s.id]?.raw_fv_items || "",
      "",
      "=== REBUILT (from POST /drivers/form) ===",
      fs.readFileSync(path.join(OUTPUT_DIR, `driver_${s.id}_rebuilt_fv.txt`), "utf8"),
    ].join("\n");
    fs.writeFileSync(path.join(OUTPUT_DIR, "sample_diffs", `${s.id}.txt`), content, "utf8");
  });

  // SQL sugerido (NO ejecutar)
  const sqlLines = [
    "-- update_sql_suggested.sql",
    "-- DANGEROUS: NO EJECUTAR sin backup y autorización explícita.",
    "-- Sugerencia: BEGIN; backup tabla; aplicar en lote; COMMIT solo tras validación.",
    "",
  ];
  for (const s of truncated) {
    sqlLines.push(`-- id=${s.id} raw_len=${s.raw_fv_len} rebuilt_len=${s.rebuilt_fv_len}`);
    sqlLines.push(
      "-- UPDATE public.moobiz_drivers",
      "-- SET raw_data = jsonb_set(raw_data, '{fv_items}', to_jsonb($1::text), false)",
      `-- WHERE id = '${s.id}';`,
      "",
    );
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, "update_sql_suggested.sql"), sqlLines.join("\n"), "utf8");

  const applySh = `#!/usr/bin/env bash
# apply_updates_example_script.sh — DANGEROUS=OFF BY DEFAULT
# NO EJECUTAR sin revisar update_sql_suggested.sql y backup de public.moobiz_drivers.
set -euo pipefail
echo "DANGEROUS=OFF — descomentar y configurar DATABASE_URL para aplicar updates."
exit 1
# Ejemplo (psql):
# psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
# BEGIN;
# -- UPDATE ...
# COMMIT;
# SQL
`;
  fs.writeFileSync(path.join(OUTPUT_DIR, "apply_updates_example_script.sh"), applySh, "utf8");

  const total = summaries.length;
  const withRaw = summaries.filter((s) => s.raw_fv_len > 0).length;
  const rawEq1024 = summaries.filter((s) => {
    const flat = flatById[s.id];
    return flat && flat.raw_fv_char_len === 1024;
  }).length;
  const rebuiltGtRaw = summaries.filter((s) => s.rebuilt_fv_len > s.raw_fv_len).length;
  const shaMismatch = summaries.filter((s) => s.raw_fv_sha256 !== s.rebuilt_fv_sha256 && s.rebuilt_fv_len > 0).length;
  const truncatedCount = truncated.length;
  const sameCount = summaries.filter((s) => s.diff_flag === "SAME").length;
  const errorCount = summaries.filter((s) => s.diff_flag === "ERROR").length;
  const missingForm = summaries.filter((s) => s.diff_flag === "MISSING_ON_FORM").length;
  const latSorted = [...progress.latenciesMs].sort((a, b) => a - b);

  const truncatedWith1024 = summaries.filter(
    (s) => s.raw_fv_len > 0 && flatById[s.id]?.raw_fv_char_len === 1024,
  );
  const recoveredAmong1024 = truncatedWith1024.filter((s) => s.diff_flag === "TRUNCATED_ON_LIST").length;
  const percentRecovered =
    truncatedWith1024.length > 0
      ? Math.round((recoveredAmong1024 / truncatedWith1024.length) * 10000) / 100
      : 0;

  const report = [
    "=== Moobiz fv_items recovery job (dry-run) ===",
    `finished_at: ${new Date().toISOString()}`,
    `output_dir: ${OUTPUT_DIR}`,
    "",
    "Métricas:",
    `  total_ids_procesados: ${total}`,
    `  total_con_raw_fv_present: ${withRaw}`,
    `  total_raw_len_eq_1024 (chars): ${rawEq1024}`,
    `  total_rebuilt_len_gt_raw_len: ${rebuiltGtRaw}`,
    `  total_sha_mismatch (con rebuilt): ${shaMismatch}`,
    `  diff_flag SAME: ${sameCount}`,
    `  diff_flag TRUNCATED_ON_LIST: ${truncatedCount}`,
    `  diff_flag ERROR: ${errorCount}`,
    `  diff_flag MISSING_ON_FORM: ${missingForm}`,
    "",
    "Recuperación (criterio primario):",
    `  ids con raw char len 1024: ${truncatedWith1024.length}`,
    `  recuperados (TRUNCATED_ON_LIST): ${recoveredAmong1024}`,
    `  percent_recovered: ${percentRecovered}%`,
    "",
    "Latencia POST /drivers/form (ms):",
    `  p50: ${percentile(latSorted, 50)}`,
    `  p95: ${percentile(latSorted, 95)}`,
    `  p99: ${percentile(latSorted, 99)}`,
    `  samples: ${latSorted.length}`,
    "",
    "¿Recuperación masiva posible?",
    percentRecovered >= 95 ? "  SI (>=95% de ids con fv_items truncado a 1024 chars)" : "  PARCIAL / REVISAR",
    "",
    "Top ejemplos TRUNCATED_ON_LIST:",
    ...truncated.slice(0, 5).map(
      (s) =>
        `  id=${s.id} raw=${s.raw_fv_len}B rebuilt=${s.rebuilt_fv_len}B tail_raw="${preview(flatById[s.id]?.raw_fv_items || "", 60)}"`,
    ),
    "",
    "Integración sugerida en sync_moobiz_drivers:",
    "  1) Mantener GET list para metadatos masivos.",
    "  2) Tras listado, para cada id (o solo donde length(fv_items)=1024):",
    "     POST /api/admin/drivers/form {id} → rebuildFvFromForms(forms).",
    "  3) Sustituir raw_data.fv_items en el objeto antes del RPC moobiz_drivers_full_replace.",
    "  4) Concurrencia 4-8, retries/backoff, checkpoint por id.",
    "  5) Nota: orden/campos rebuilt pueden diferir del listado; usar rebuilt como fuente completa.",
    "",
    "Seguridad: rotar token Moobiz si se usó en entorno compartido.",
  ].join("\n");

  fs.writeFileSync(path.join(OUTPUT_DIR, "report_summary.txt"), report, "utf8");

  const resultJson = {
    status: errorCount === total ? "failed" : "complete",
    output_dir: OUTPUT_DIR,
    totals: {
      processed: total,
      truncated_count: truncatedCount,
      recovered_count: recoveredAmong1024,
      percent_recovered: percentRecovered,
    },
    errors_file: "errors_forms.json",
    report: "report_summary.txt",
  };

  console.log("\n" + report);
  console.log("\nJOB_COMPLETE", JSON.stringify(resultJson));

  if (errorCount === total) process.exit(1);
}

main().catch((e) => {
  console.error("JOB_FAILED", e);
  process.exit(1);
});
