/**
 * Sync global → public.moobiz_driver_forms.
 * - Listado sin filtro de sucursal (GET /api/admin/drivers?limit=3000).
 * - Si fv_items truncado (length === 1024): POST /drivers/form, reconstruir fv_items, upsert.
 * - Independiente de scripts/sync_moobiz_drivers.js.
 *
 * Uso:
 *   ONLY_IDS=128317,130927 node scripts/sync_moobiz_driver_forms.js --dry-run
 *   node scripts/sync_moobiz_driver_forms.js --dry-run --emit-sql
 *   DRY_RUN=false node scripts/sync_moobiz_driver_forms.js --batch-size=50
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ensureMoobizToken, redactToken } = require("../helpers/refresh_moobiz_token");
const { fetchWithRetry } = require("../helpers/moobiz_fetch_retry");

const DRIVERS_LIST_URL =
  (process.env.MOOBIZ_DRIVERS_URL && String(process.env.MOOBIZ_DRIVERS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/drivers";
const DRIVERS_FORM_URL = "https://app.moobiz.pe/api/admin/drivers/form";

const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || "./output_cursor_sync_forms");
const DIRS = {
  list: path.join(OUTPUT_DIR, "drivers_list"),
  forms: path.join(OUTPUT_DIR, "forms"),
  artifacts: path.join(OUTPUT_DIR, "artifacts"),
  logs: path.join(OUTPUT_DIR, "logs"),
};
const PROGRESS_FILE = path.join(OUTPUT_DIR, "progress.json");

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LIST_LIMIT = Number.parseInt(process.env.LIST_LIMIT || "3000", 10);
const DEFAULT_CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "8", 10);
const DEFAULT_RETRIES = Number.parseInt(process.env.RETRIES || "3", 10);
const DEFAULT_BACKOFF_MS = Number.parseInt(process.env.BACKOFF_MS_INITIAL || "500", 10);
const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || "999999", 10);

function parseArgs(argv) {
  const dryRunDefault = process.env.DRY_RUN !== "false";
  const opts = {
    dryRun: dryRunDefault,
    emitSql: process.env.EMIT_SQL === "true",
    since: null,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    onlyIds: process.env.ONLY_IDS
      ? process.env.ONLY_IDS.split(",").map((s) => s.trim()).filter(Boolean)
      : null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--no-dry-run") opts.dryRun = false;
    else if (a === "--emit-sql") opts.emitSql = true;
    else if (a.startsWith("--only-ids=")) opts.onlyIds = a.slice("--only-ids=".length).split(",").map((s) => s.trim());
    else if (a === "--since" && argv[i + 1]) opts.since = argv[++i];
    else if (a.startsWith("--since=")) opts.since = a.slice("--since=".length);
    else if (a === "--batch-size" && argv[i + 1]) opts.batchSize = Number(argv[++i]);
    else if (a.startsWith("--batch-size=")) opts.batchSize = Number(a.slice("--batch-size=".length));
    else if (a === "--concurrency" && argv[i + 1]) opts.concurrency = Number(argv[++i]);
    else if (a.startsWith("--concurrency=")) opts.concurrency = Number(a.slice("--concurrency=".length));
    else if (a === "--help" || a === "-h") {
      console.log(`sync_moobiz_driver_forms.js
  --dry-run (default)     No UPSERT en DB
  --no-dry-run              Aplicar UPSERT
  --emit-sql                Generar artifacts/update_sql.sql
  --only-ids=128317,130927  Subset de prueba
  --batch-size=N            Límite de ids a procesar
  Env: ONLY_IDS, DRY_RUN, EMIT_SQL, OUTPUT_DIR, CONCURRENCY, LIST_LIMIT`);
      process.exit(0);
    }
  }
  return opts;
}

function dbConnectionString() {
  return (
    String(process.env.DB_CONNECTION_STRING || "").trim() ||
    String(process.env.DATABASE_URL || "").trim()
  );
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

function escapeSql(s) {
  return String(s).replace(/'/g, "''");
}

/** Regla exacta de reconstrucción desde POST /drivers/form */
function rebuildFvItems(formBody) {
  let out = "";
  for (const form of formBody.forms || []) {
    for (const field of form.fields || []) {
      const label = String(field.label ?? "").trim();
      const value = field.value == null || field.value === undefined ? "" : String(field.value);
      out += `${label}|:fi:|${value}|:fv:|`;
    }
  }
  const item = formBody.item;
  if (item && typeof item === "object") {
    const covered = new Set();
    for (const form of formBody.forms || []) {
      for (const field of form.fields || []) {
        if (field.label) covered.add(String(field.label).trim());
      }
    }
    for (const [k, v] of Object.entries(item)) {
      if (v == null || typeof v === "object") continue;
      const s = String(v).trim();
      if (!s || k === "password" || k === "id") continue;
      if (/^id_|^date_|^token|^pic$/i.test(k)) continue;
      if (!covered.has(k)) out += `${k}|:fi:|${s}|:fv:|`;
    }
  }
  return out;
}

function branchFromForm(formBody) {
  const idBranch = formBody?.item?.id_branch ?? formBody?.item?.br_id ?? null;
  let branchName = null;
  if (idBranch != null && Array.isArray(formBody.branches)) {
    const hit = formBody.branches.find((b) => String(b.id) === String(idBranch));
    branchName = hit?.name ?? null;
  }
  return { id_branch: idBranch, branch_name: branchName };
}

function isTruncatedCandidate(listItem) {
  const fv = listItem?.fv_items;
  if (fv == null || fv === undefined) return true;
  if (typeof fv !== "string") return false;
  return fv.length === 1024;
}

function toTextNullable(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toBoolNullable(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return null;
}

function moobizHeaders(token, id) {
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

async function resolveToken() {
  const env = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (env) {
    console.log("[driver-forms-sync] MOOBIZ_TOKEN env:", redactToken(env));
    return env;
  }
  const t = await ensureMoobizToken();
  console.log("[driver-forms-sync] token:", redactToken(t));
  return t;
}

async function fetchDriverListGlobal(token) {
  const byId = new Map();
  const pages = [];
  let page = 1;

  for (;;) {
    const url = new URL(DRIVERS_LIST_URL);
    url.searchParams.set("limit", String(LIST_LIMIT));
    if (page > 1) {
      url.searchParams.set("page", String(page));
      url.searchParams.set("p", String(page));
    }
    const res = await fetchWithRetry(
      url.toString(),
      { method: "GET", headers: moobizHeaders(token), cache: "no-store" },
      { label: `list:p${page}`, retries: DEFAULT_RETRIES, backoffMs: [500, 1000, 2000] },
    );
    const text = await res.text();
    fs.writeFileSync(path.join(DIRS.list, `drivers_list_page_${page}.json`), text);
    if (!res.ok) throw new Error(`list HTTP ${res.status}`);
    const body = JSON.parse(text);
    if (!body.ok) throw new Error(`list ok=false: ${body.msg}`);
    const items = Array.isArray(body.items) ? body.items : [];
    pages.push({ page, count: items.length, total: body.total });
    for (const d of items) {
      const id = String(d.id);
      const fv = typeof d.fv_items === "string" ? d.fv_items : "";
      byId.set(id, {
        id,
        raw_fv_items: fv,
        raw_fv_len: fv.length,
        raw_fv_sha256: sha256Hex(fv),
        id_branch: d.id_branch ?? d.br_id,
        branch_name: d.br_name ?? d.branch_name,
        list_item: d,
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

async function fetchDriverForm(token, id, stats) {
  let attempt = 0;
  let delay = DEFAULT_BACKOFF_MS;
  while (true) {
    try {
      const res = await fetch(DRIVERS_FORM_URL, {
        method: "POST",
        headers: moobizHeaders(token, id),
        body: JSON.stringify({ id: String(id) }),
        cache: "no-store",
      });
      const text = await res.text();
      if (res.status === 429) stats.http429 += 1;
      if (res.status >= 500) stats.http5xx += 1;
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* */
      }
      if ((res.status === 429 || res.status >= 500) && attempt < DEFAULT_RETRIES) {
        await sleep(delay);
        attempt += 1;
        delay *= 2;
        continue;
      }
      return { res, parsed, text };
    } catch (err) {
      if (attempt >= DEFAULT_RETRIES) throw err;
      await sleep(delay);
      attempt += 1;
      delay *= 2;
    }
  }
}

function mapUpsertRow(id, listItem, formBody, rebuiltFv) {
  const item = (formBody && formBody.item) || listItem?.list_item || listItem || {};
  const rawData = { ...(listItem?.list_item || listItem || {}) };
  if (typeof rawData === "object" && rawData !== null) {
    if (rebuiltFv != null) {
      rawData.fv_items = rebuiltFv;
      rawData._fv_rebuilt = new Date().toISOString();
    }
  }
  return {
    id: String(id),
    id_branch: toTextNullable(item.id_branch ?? listItem?.id_branch),
    id_role: toTextNullable(item.id_role ?? listItem?.list_item?.id_role),
    id_company: toTextNullable(item.id_company ?? listItem?.list_item?.id_company),
    id_company_area: toTextNullable(item.id_company_area ?? listItem?.list_item?.id_company_area),
    show_data_fleets: toBoolNullable(item.show_data_fleets ?? listItem?.list_item?.show_data_fleets),
    raw_data: rawData,
    forms: formBody || null,
  };
}

async function tableExists(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'moobiz_driver_forms' LIMIT 1`,
  );
  return rows.length > 0;
}

async function upsertRow(pool, row) {
  await pool.query(
    `INSERT INTO public.moobiz_driver_forms (
       id, id_branch, id_role, id_company, id_company_area, show_data_fleets, raw_data, forms, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET
       id_branch = EXCLUDED.id_branch,
       id_role = EXCLUDED.id_role,
       id_company = EXCLUDED.id_company,
       id_company_area = EXCLUDED.id_company_area,
       show_data_fleets = EXCLUDED.show_data_fleets,
       raw_data = EXCLUDED.raw_data,
       forms = EXCLUDED.forms,
       updated_at = now()`,
    [
      row.id,
      row.id_branch,
      row.id_role,
      row.id_company,
      row.id_company_area,
      row.show_data_fleets,
      JSON.stringify(row.raw_data),
      row.forms ? JSON.stringify(row.forms) : null,
    ],
  );
}

async function runPool(ids, concurrency, worker) {
  let idx = 0;
  let n = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (idx < ids.length) {
        const i = idx++;
        await worker(ids[i]);
        n += 1;
        if (n % 100 === 0) console.log(`[driver-forms-sync] progreso ${n}/${ids.length}`);
      }
    }),
  );
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return { processed_ids: {}, errors: [], last_batch_time: null };
  }
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
}

function saveProgress(p) {
  p.last_batch_time = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

async function main() {
  const t0 = Date.now();
  const opts = parseArgs(process.argv);
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

  const conn = dbConnectionString();
  if (!conn && !opts.dryRun) {
    console.error("[driver-forms-sync] DB_CONNECTION_STRING requerido si --no-dry-run");
    process.exit(2);
  }

  let token = await resolveToken();
  console.log("[driver-forms-sync] OUTPUT_DIR:", OUTPUT_DIR, "opts:", { ...opts, onlyIds: opts.onlyIds?.length });

  let list;
  try {
    list = await fetchDriverListGlobal(token);
  } catch (e) {
    if (/not_logged/i.test(String(e.message))) {
      token = await ensureMoobizToken();
      list = await fetchDriverListGlobal(token);
    } else throw e;
  }

  const index = list.items;
  const byId = Object.fromEntries(index.map((x) => [x.id, x]));
  console.log(`[driver-forms-sync] listado global: ${index.length} conductores`);

  const spotIds = ["128317", "130927"];
  const spotChecks = {};

  let workIds;
  if (opts.onlyIds) {
    workIds = opts.onlyIds.filter((id) => byId[id] || true);
  } else {
    workIds = index
      .filter((x) => isTruncatedCandidate(x.list_item))
      .map((x) => x.id);
    workIds = workIds.slice(0, opts.batchSize);
  }

  for (const sid of spotIds) {
    if (!workIds.includes(sid)) workIds.unshift(sid);
  }
  workIds = [...new Set(workIds)];

  const stats = { http429: 0, http5xx: 0 };
  const recovered = [];
  const formErrors = [];
  const progress = loadProgress();
  let upserted = 0;
  let ok = 0;

  let pool = null;
  if (conn && !opts.dryRun) {
    pool = new Pool({ connectionString: conn });
    if (!(await tableExists(pool))) {
      console.error("[driver-forms-sync] Falta tabla moobiz_driver_forms — aplicar migration primero.");
      process.exit(3);
    }
  }

  await runPool(workIds, opts.concurrency, async (id) => {
    const meta = byId[id] || { id, list_item: {}, raw_fv_len: 0, raw_fv_items: "" };
    const listItem = meta.list_item || meta;
    const forceForm = opts.onlyIds?.includes(id) || isTruncatedCandidate(listItem);
    let formBody = null;
    let rebuiltFv = null;

    try {
      if (forceForm) {
        const { res, parsed, text } = await fetchDriverForm(token, id, stats);
        const toWrite = parsed && typeof parsed === "object" ? redactSecrets(parsed) : { _raw: text.slice(0, 2000) };
        fs.writeFileSync(path.join(DIRS.forms, `${id}.json`), JSON.stringify(toWrite, null, 2));
        if (!res.ok || !parsed?.ok) {
          throw new Error(`form HTTP ${res.status} ${parsed?.msg || ""}`);
        }
        formBody = parsed;
        rebuiltFv = rebuildFvItems(parsed);
        const origLen = meta.raw_fv_len ?? 0;
        const needsUpdate =
          origLen === 1024 || (rebuiltFv.length > origLen && (origLen === 1024 || origLen === 0));
        if (rebuiltFv.length > origLen || origLen === 1024) {
          /* sustituir antes del upsert */
        }
        recovered.push({
          id,
          original_raw_fv_len: origLen,
          original_raw_fv_sha256: meta.raw_fv_sha256 || sha256Hex(meta.raw_fv_items),
          rebuilt_fv_len: rebuiltFv.length,
          rebuilt_fv_sha256: sha256Hex(rebuiltFv),
          needs_update: needsUpdate,
          sample_original: (meta.raw_fv_items || "").slice(0, 200),
          sample_rebuilt: rebuiltFv.slice(0, 200),
        });
        if (spotIds.includes(id)) {
          const br = branchFromForm(parsed);
          spotChecks[id] = {
            in_list: !!byId[id],
            branch_list: meta.branch_name,
            id_branch_form: br.id_branch,
            branch_name_form: br.branch_name,
            original_raw_fv_len: origLen,
            rebuilt_fv_len: rebuiltFv.length,
            needs_update: needsUpdate,
          };
        }
      }

      const row = mapUpsertRow(id, meta, formBody, forceForm ? rebuiltFv : null);
      if (!opts.dryRun && pool) {
        await upsertRow(pool, row);
        upserted += 1;
      }
      progress.processed_ids[id] = opts.dryRun ? "dry_run_ok" : "upserted";
      ok += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      formErrors.push({ id, message: msg, at: new Date().toISOString() });
      progress.errors = progress.errors || [];
      progress.errors.push({ id, message: msg });
      progress.processed_ids[id] = "error";
      fs.appendFileSync(path.join(DIRS.logs, "errors.csv"), `${id},${JSON.stringify(msg)}\n`);
    }
  });

  saveProgress(progress);
  if (pool) await pool.end();

  fs.writeFileSync(path.join(OUTPUT_DIR, "fv_items_recovered.json"), JSON.stringify(recovered, null, 2));

  const totals = {
    total_drivers_listados: index.length,
    total_with_fv: index.filter((x) => x.raw_fv_len > 0).length,
    total_fv_len_eq_1024: index.filter((x) => x.raw_fv_len === 1024).length,
    total_work_ids: workIds.length,
    total_forms_retrieved: recovered.length,
    total_rebuilt: recovered.length,
    total_needs_update: recovered.filter((x) => x.needs_update).length,
    form_errors: formErrors.length,
    http429: stats.http429,
    http5xx: stats.http5xx,
    upserted: opts.dryRun ? 0 : upserted,
    elapsed_ms: Date.now() - t0,
  };

  if (opts.emitSql) {
    const lines = ["-- update_sql.sql — NO ejecutar sin revisión\n"];
    for (const r of recovered.filter((x) => x.needs_update)) {
      const row = recovered.find((x) => x.id === r.id);
      const fv = rebuildFvItems(
        JSON.parse(fs.readFileSync(path.join(DIRS.forms, `${r.id}.json`), "utf8")),
      );
      const esc = escapeSql(fv);
      lines.push(
        `UPDATE public.moobiz_driver_forms SET raw_data = jsonb_set(raw_data, '{fv_items}', to_jsonb('${esc}'::text), false) WHERE id = '${escapeSql(r.id)}' AND (raw_data->>'fv_items') IS DISTINCT FROM '${esc}';`,
      );
      lines.push("");
    }
    fs.writeFileSync(path.join(DIRS.artifacts, "update_sql.sql"), lines.join("\n"));
  }

  const report = [
    "# sync-driver-forms — report",
    "",
    `Fecha: ${new Date().toISOString()}`,
    `DRY_RUN: ${opts.dryRun}`,
    "",
    "## Métricas",
    "",
    ...Object.entries(totals).map(([k, v]) => `- **${k}**: ${v}`),
    "",
    "## Spot checks 128317 / 130927",
    "",
    "```json",
    JSON.stringify(spotChecks, null, 2),
    "```",
    "",
    spotChecks["128317"]?.branch_name_form === "LIMA" ? "- 128317 → LIMA: **OK**" : "- 128317: **REVISAR**",
    spotChecks["130927"]?.branch_name_form === "AREQUIPA" ? "- 130927 → AREQUIPA: **OK**" : "- 130927: **REVISAR**",
    "",
    "## Errores",
    "",
    formErrors.length ? `\`${formErrors.length}\` ver logs/errors.csv` : "Ninguno",
  ].join("\n");
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.md"), report);

  console.log("[driver-forms-sync] totals:", JSON.stringify(totals));
  console.log("[driver-forms-sync] spot:", JSON.stringify(spotChecks));
  if (formErrors.length) process.exit(1);
}

main().catch((e) => {
  console.error("[driver-forms-sync] fatal:", e.message);
  process.exit(1);
});
