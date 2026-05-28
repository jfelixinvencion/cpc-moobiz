/**
 * Validación global fv_items: listado drivers + POST form + reconstrucción.
 * DRY_RUN por defecto; no escribe en DB.
 *
 * Uso:
 *   node scripts/cursor_fv_recovery_global.js
 *   node scripts/cursor_fv_recovery_global.js --only-ids=128317,130927
 *   node scripts/cursor_fv_recovery_global.js --emit-sql
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureMoobizToken, redactToken } = require("../helpers/refresh_moobiz_token");

const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || "./output_cursor_fv_recovery");
const LIST_URL = "https://app.moobiz.pe/api/admin/drivers";
const FORM_URL = "https://app.moobiz.pe/api/admin/drivers/form";
const LIST_LIMIT = Number.parseInt(process.env.LIST_LIMIT || "3000", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "10", 10);
const RETRIES = Number.parseInt(process.env.RETRIES || "3", 10);
const BACKOFF_MS_INITIAL = Number.parseInt(process.env.BACKOFF_MS_INITIAL || "500", 10);
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DIRS = {
  list: path.join(OUTPUT_DIR, "drivers_list"),
  forms: path.join(OUTPUT_DIR, "forms"),
  logs: path.join(OUTPUT_DIR, "logs"),
  artifacts: path.join(OUTPUT_DIR, "artifacts"),
};

function parseArgs() {
  const opts = {
    dryRun: process.env.DRY_RUN !== "false",
    emitSql: false,
    onlyIds: null,
    formsOnlyTruncated: true,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--emit-sql") opts.emitSql = true;
    else if (a === "--no-dry-run") opts.dryRun = false;
    else if (a.startsWith("--only-ids=")) opts.onlyIds = a.slice("--only-ids=".length).split(",").map((s) => s.trim());
    else if (a === "--all-forms") opts.formsOnlyTruncated = false;
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s || "", "utf8").digest("hex");
}

function redactSecrets(obj) {
  try {
    const c = JSON.parse(JSON.stringify(obj));
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      for (const [k, v] of Object.entries(n)) {
        if (/token|password|authorization/i.test(k) && typeof v === "string") n[k] = "<REDACTED>";
        else walk(v);
      }
    };
    walk(c);
    return c;
  } catch {
    return obj;
  }
}

function headers(token, id) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://app.moobiz.pe",
    Referer: id ? `https://app.moobiz.pe/drivers/${id}` : "https://app.moobiz.pe/drivers",
    "User-Agent": CHROME_UA,
  };
}

async function fetchWithRetry(fn, label) {
  let attempt = 0;
  let delay = BACKOFF_MS_INITIAL;
  while (true) {
    try {
      const res = await fn();
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        fs.appendFileSync(
          path.join(DIRS.logs, "rate_limits.log"),
          `${new Date().toISOString()} ${label} HTTP ${res.status} retry ${attempt + 1}\n`,
        );
        await sleep(delay);
        attempt += 1;
        delay *= 2;
        continue;
      }
      return res;
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      await sleep(delay);
      attempt += 1;
      delay *= 2;
    }
  }
}

async function resolveToken() {
  const env = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (env) {
    console.log("[fv-global] MOOBIZ_TOKEN env:", redactToken(env));
    return env;
  }
  const t = await ensureMoobizToken();
  console.log("[fv-global] token:", redactToken(t));
  return t;
}

async function fetchDriverListPage(token, page = 1) {
  const url = new URL(LIST_URL);
  url.searchParams.set("limit", String(LIST_LIMIT));
  if (page > 1) {
    url.searchParams.set("page", String(page));
    url.searchParams.set("p", String(page));
  }
  const res = await fetchWithRetry(
    () => fetch(url.toString(), { method: "GET", headers: headers(token), cache: "no-store" }),
    `list:p${page}`,
  );
  const text = await res.text();
  return { res, text, url: url.toString(), page };
}

async function downloadAllDrivers(token) {
  const pages = [];
  let page = 1;
  const byId = new Map();

  for (;;) {
    const { res, text, url } = await fetchDriverListPage(token, page);
    const outPath = path.join(DIRS.list, `drivers_list_page_${page}.json`);
    fs.writeFileSync(outPath, text);
    if (!res.ok) throw new Error(`list HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    if (!body.ok) {
      if (/not_logged/i.test(String(body.msg)) && page === 1) throw Object.assign(new Error("not_logged"), { code: "NOT_LOGGED" });
      throw new Error(`list ok=false: ${body.msg}`);
    }
    const items = Array.isArray(body.items) ? body.items : [];
    pages.push({ page, url, count: items.length, total: body.total });
    for (const d of items) {
      const id = String(d.id);
      const rawFv = typeof d.fv_items === "string" ? d.fv_items : "";
      byId.set(id, {
        id,
        raw_fv_items: rawFv,
        raw_fv_len: rawFv.length,
        raw_fv_char_len: rawFv.length,
        raw_fv_sha256: sha256Hex(rawFv),
        id_branch: d.id_branch ?? d.br_id ?? null,
        branch_name: d.br_name ?? d.branch_name ?? null,
        name: [d.name, d.surname].filter(Boolean).join(" ").trim(),
      });
    }
    const total = Number(body.total) || 0;
    if (items.length < LIST_LIMIT || byId.size >= total || page >= 5) break;
    page += 1;
  }

  const consolidated = { pages, items: [...byId.values()], total_unique: byId.size };
  fs.writeFileSync(path.join(DIRS.list, "drivers_list.json"), JSON.stringify(consolidated, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, "drivers_index.json"), JSON.stringify(consolidated.items, null, 2));
  return consolidated;
}

function rebuildFvFromFormBody(body) {
  let out = "";
  for (const form of body.forms || []) {
    for (const field of form.fields || []) {
      const label = String(field.label ?? "").trim();
      const value = field.value == null ? "" : String(field.value);
      out += `${label}|:fi:|${value}|:fv:|`;
    }
  }
  const item = body.item;
  if (item && typeof item === "object") {
    for (const [k, v] of Object.entries(item)) {
      if (v == null || typeof v === "object") continue;
      const s = String(v).trim();
      if (!s || k === "id" || k === "password") continue;
      if (/^id_|^date_|^token|^pic$/i.test(k)) continue;
      out += `${k}|:fi:|${s}|:fv:|`;
    }
  }
  return out;
}

function branchFromForm(body) {
  const idBranch = body?.item?.id_branch ?? body?.item?.br_id ?? null;
  let branchName = null;
  if (idBranch != null && Array.isArray(body.branches)) {
    const hit = body.branches.find((b) => String(b.id) === String(idBranch));
    branchName = hit?.name ?? null;
  }
  return { id_branch: idBranch, branch_name: branchName };
}

function escapeSqlDollar(s) {
  return String(s).replace(/'/g, "''");
}

async function fetchForm(token, id) {
  const res = await fetchWithRetry(
    () =>
      fetch(FORM_URL, {
        method: "POST",
        headers: headers(token, id),
        body: JSON.stringify({ id: String(id) }),
        cache: "no-store",
      }),
    `form:${id}`,
  );
  const text = await res.text();
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
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (idx < ids.length) {
        const i = idx++;
        await worker(ids[i]);
        done += 1;
        if (done % 100 === 0) console.log(`[fv-global] forms ${done}/${ids.length}`);
      }
    }),
  );
}

async function main() {
  const opts = parseArgs();
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

  let token = await resolveToken();
  console.log("[fv-global] OUTPUT_DIR:", OUTPUT_DIR, "DRY_RUN:", opts.dryRun);

  let list;
  try {
    list = await downloadAllDrivers(token);
  } catch (e) {
    if (e && e.code === "NOT_LOGGED") {
      token = await ensureMoobizToken();
      list = await downloadAllDrivers(token);
    } else throw e;
  }

  const index = list.items;
  const byId = Object.fromEntries(index.map((x) => [x.id, x]));
  console.log(`[fv-global] drivers listados: ${index.length}`);

  const checkIds = ["128317", "130927"];
  const spotChecks = {};
  for (const cid of checkIds) {
    const row = byId[cid];
    spotChecks[cid] = row
      ? {
          in_list: true,
          id_branch: row.id_branch,
          branch_name: row.branch_name,
          raw_fv_len: row.raw_fv_len,
        }
      : { in_list: false, flag: `MISSING_IN_LIST_${cid}` };
  }

  let formTargets;
  if (opts.onlyIds) {
    formTargets = opts.onlyIds;
  } else if (opts.formsOnlyTruncated) {
    formTargets = index.filter((x) => x.raw_fv_len === 1024).map((x) => x.id);
  } else {
    formTargets = index.map((x) => x.id);
  }
  for (const cid of checkIds) {
    if (!formTargets.includes(cid)) formTargets.unshift(cid);
  }
  formTargets = [...new Set(formTargets)];

  console.log(`[fv-global] POST form targets: ${formTargets.length}`);

  const formErrors = [];
  const recovered = [];
  const stats = { http429: 0, http5xx: 0 };

  await runPool(formTargets, async (id) => {
    const formPath = path.join(DIRS.forms, `${id}.json`);
    try {
      const { res, parsed, text } = await fetchForm(token, id);
      if (res.status === 429) stats.http429 += 1;
      if (res.status >= 500) stats.http5xx += 1;
      const toWrite = parsed && typeof parsed === "object" ? redactSecrets(parsed) : { _raw: text.slice(0, 2000) };
      fs.writeFileSync(formPath, JSON.stringify(toWrite, null, 2));
      if (!res.ok || !parsed?.ok) {
        formErrors.push({ id, status: res.status, msg: parsed?.msg || "" });
        fs.writeFileSync(path.join(DIRS.logs, `errors_${id}.log`), `status=${res.status}\n${text.slice(0, 500)}`);
        return;
      }
      const rebuilt = rebuildFvFromFormBody(parsed);
      const orig = byId[id] || {};
      const branch = branchFromForm(parsed);
      const needs_update =
        (orig.raw_fv_len === 1024 || orig.raw_fv_sha256 !== sha256Hex(rebuilt)) &&
        rebuilt.length > (orig.raw_fv_len || 0);
      recovered.push({
        id,
        original_raw_fv_len: orig.raw_fv_len ?? 0,
        original_raw_fv_sha256: orig.raw_fv_sha256 ?? "",
        rebuilt_fv_len: rebuilt.length,
        rebuilt_fv_sha256: sha256Hex(rebuilt),
        needs_update,
        id_branch_form: branch.id_branch,
        branch_name_form: branch.branch_name,
        sample_original: (orig.raw_fv_items || "").slice(0, 200),
        sample_rebuilt: rebuilt.slice(0, 200),
        rebuilt_fv: rebuilt,
      });
      if (checkIds.includes(id)) {
        spotChecks[id] = {
          ...spotChecks[id],
          form_fetched: true,
          id_branch_form: branch.id_branch,
          branch_name_form: branch.branch_name,
          rebuilt_fv_len: rebuilt.length,
          needs_update,
        };
      }
    } catch (e) {
      formErrors.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  });

  const recoveredPublic = recovered.map(({ rebuilt_fv, ...rest }) => rest);
  fs.writeFileSync(path.join(OUTPUT_DIR, "fv_items_recovered.json"), JSON.stringify(recoveredPublic, null, 2));

  const mapById = Object.fromEntries(recovered.map((r) => [r.id, r]));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "fv_items_recovered_map.json"),
    JSON.stringify(
      Object.fromEntries(recovered.map((r) => [r.id, { rebuilt_fv: r.rebuilt_fv, needs_update: r.needs_update }])),
      null,
      0,
    ),
  );

  const totals = {
    total_drivers_listados: index.length,
    total_with_fv: index.filter((x) => x.raw_fv_len > 0).length,
    total_fv_len_eq_1024: index.filter((x) => x.raw_fv_len === 1024).length,
    total_forms_targets: formTargets.length,
    total_forms_retrieved: recovered.length,
    total_rebuilt: recovered.length,
    total_needs_update: recovered.filter((x) => x.needs_update).length,
    form_errors: formErrors.length,
    http429: stats.http429,
    http5xx: stats.http5xx,
  };

  if (opts.emitSql || !opts.dryRun) {
    const sqlLines = [
      "-- update_sql.sql — revisar antes de ejecutar. DRY_RUN recomendado.",
      "-- Token y credenciales: NO incluidos.",
      "",
    ];
    for (const r of recovered.filter((x) => x.needs_update)) {
      const esc = escapeSqlDollar(r.rebuilt_fv);
      sqlLines.push(`-- id=${r.id} orig_len=${r.original_raw_fv_len} rebuilt_len=${r.rebuilt_fv_len}`);
      sqlLines.push(
        `UPDATE public.moobiz_drivers SET raw_data = jsonb_set(raw_data, '{fv_items}', to_jsonb('${esc}'::text), false) WHERE id = '${escapeSqlDollar(r.id)}' AND (raw_data->>'fv_items') IS DISTINCT FROM '${esc}';`,
      );
      sqlLines.push(
        `-- UPDATE public.moobiz_driver_forms SET raw_data = jsonb_set(COALESCE(raw_data,'{}'::jsonb), '{fv_items}', to_jsonb('${esc}'::text), false) WHERE id = '${escapeSqlDollar(r.id)}';`,
      );
      sqlLines.push("");
    }
    fs.writeFileSync(path.join(DIRS.artifacts, "update_sql.sql"), sqlLines.join("\n"));
  }

  for (const cid of checkIds) {
    if (!spotChecks[cid]?.form_fetched && !fs.existsSync(path.join(DIRS.forms, `${cid}.json`))) {
      const { res, parsed } = await fetchForm(token, cid);
      if (parsed?.ok) {
        fs.writeFileSync(path.join(DIRS.forms, `${cid}.json`), JSON.stringify(redactSecrets(parsed), null, 2));
        const branch = branchFromForm(parsed);
        spotChecks[cid] = {
          in_list: !!byId[cid],
          form_fetched: true,
          id_branch_form: branch.id_branch,
          branch_name_form: branch.branch_name,
          rebuilt_fv_len: rebuildFvFromFormBody(parsed).length,
        };
      }
    }
  }

  const report = buildReport(totals, spotChecks, checkIds, formErrors.slice(0, 20), recoveredPublic.slice(0, 20));
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.md"), report);

  console.log("\n[fV-global] totals:", JSON.stringify(totals));
  console.log("[fv-global] spot checks:", JSON.stringify(spotChecks, null, 2));
  console.log("[fv-global] done. See", path.join(OUTPUT_DIR, "report.md"));
}

function buildReport(totals, spotChecks, checkIds, formErrorsSample, recoveredSample) {
  const lines = [
    "# Informe — recuperación global fv_items",
    "",
    `Fecha: ${new Date().toISOString()}`,
    "",
    "## Métricas",
    "",
    "| Métrica | Valor |",
    "|---------|-------|",
    ...Object.entries(totals).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Validación IDs requeridos",
    "",
  ];
  for (const cid of checkIds) {
    const s = spotChecks[cid] || {};
    lines.push(`### id ${cid}`);
    lines.push("");
    lines.push(`- En listado: ${s.in_list !== false ? "sí" : "NO"}`);
    if (s.branch_name || s.branch_name_form) {
      lines.push(`- Sucursal (list): ${s.branch_name ?? "—"} (id_branch=${s.id_branch ?? "?"})`);
      lines.push(`- Sucursal (form): ${s.branch_name_form ?? "—"} (id_branch=${s.id_branch_form ?? "?"})`);
    }
    const expected = cid === "128317" ? "LIMA" : "AREQUIPA";
    const got = s.branch_name_form || s.branch_name || "";
    lines.push(`- Esperado: **${expected}** → obtenido: **${got}** → ${got.toUpperCase().includes(expected) ? "OK" : "REVISAR"}`);
    lines.push(`- raw_fv_len (list): ${s.raw_fv_len ?? "n/a"}`);
    lines.push(`- rebuilt_fv_len: ${s.rebuilt_fv_len ?? "n/a"}`);
    lines.push(`- needs_update: ${s.needs_update ?? "n/a"}`);
    lines.push(`- forms/${cid}.json: ${fs.existsSync(path.join(DIRS.forms, `${cid}.json`)) ? "sí" : "no"}`);
    lines.push("");
  }
  lines.push("## jq equivalente (branch name desde form)");
  lines.push("```");
  lines.push('jq -r \'.item.id_branch as $id | .branches[] | select(.id==$id) | .name\' forms/128317.json');
  lines.push("```");
  if (fs.existsSync(path.join(DIRS.forms, "128317.json"))) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(DIRS.forms, "128317.json"), "utf8"));
      const br = branchFromForm(b);
      lines.push(`Captura 128317: id_branch=${br.id_branch} name=${br.branch_name}`);
    } catch {
      /* */
    }
  }
  if (fs.existsSync(path.join(DIRS.forms, "130927.json"))) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(DIRS.forms, "130927.json"), "utf8"));
      const br = branchFromForm(b);
      lines.push(`Captura 130927: id_branch=${br.id_branch} name=${br.branch_name}`);
    } catch {
      /* */
    }
  }
  lines.push("");
  lines.push("## Muestra needs_update (top 20)");
  lines.push("```json");
  lines.push(JSON.stringify(recoveredSample.filter((r) => r.needs_update), null, 2));
  lines.push("```");
  if (formErrorsSample.length) {
    lines.push("");
    lines.push("## Errores form (muestra)");
    lines.push("```json");
    lines.push(JSON.stringify(formErrorsSample, null, 2));
    lines.push("```");
  }
  lines.push("");
  lines.push("## Notas");
  lines.push("- MOOBIZ_TOKEN redactado en logs; no incluido en artefactos.");
  lines.push("- DRY_RUN: no se aplicó SQL en base de datos.");
  lines.push("- Regla rebuild: forms[].fields[] + campos escalares de item.");
  return lines.join("\n");
}

main().catch((e) => {
  console.error("[fv-global] fatal:", e);
  process.exit(1);
});
