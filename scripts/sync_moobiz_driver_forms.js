/**
 * Sync POST /api/admin/drivers/form → public.moobiz_driver_forms (upsert).
 * Independiente de scripts/sync_moobiz_drivers.js — no modifica moobiz_drivers.
 *
 * Uso:
 *   node scripts/sync_moobiz_driver_forms.js --dry-run --batch-size=10 --concurrency=4
 *   node scripts/sync_moobiz_driver_forms.js --batch-size=50 --concurrency=8
 *   node scripts/sync_moobiz_driver_forms.js --since=2026-05-01T00:00:00Z --batch-size=100
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ensureMoobizToken, redactToken } = require("../helpers/refresh_moobiz_token");
const { fetchWithRetry } = require("../helpers/moobiz_fetch_retry");

const DRIVERS_LIST_URL =
  (process.env.MOOBIZ_DRIVERS_URL && String(process.env.MOOBIZ_DRIVERS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/drivers";
const DRIVERS_FORM_URL = "https://app.moobiz.pe/api/admin/drivers/form";
const TMP_DIR = path.resolve(process.cwd(), "tmp_sync_driver_forms");
const PROGRESS_FILE = path.join(TMP_DIR, "progress.json");

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 200;
const LIST_LIMIT = Number.parseInt(process.env.MOOBIZ_DRIVERS_PAGE_SIZE || "3000", 10);

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    since: null,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    maxWorkers: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--since" && argv[i + 1]) opts.since = argv[++i];
    else if (a.startsWith("--since=")) opts.since = a.slice("--since=".length);
    else if (a === "--batch-size" && argv[i + 1]) opts.batchSize = Number(argv[++i]);
    else if (a.startsWith("--batch-size=")) opts.batchSize = Number(a.slice("--batch-size=".length));
    else if (a === "--concurrency" && argv[i + 1]) opts.concurrency = Number(argv[++i]);
    else if (a.startsWith("--concurrency=")) opts.concurrency = Number(a.slice("--concurrency=".length));
    else if (a === "--max-workers" && argv[i + 1]) opts.maxWorkers = Number(argv[++i]);
    else if (a.startsWith("--max-workers=")) opts.maxWorkers = Number(a.slice("--max-workers=".length));
    else if (a === "--help" || a === "-h") {
      console.log(`sync_moobiz_driver_forms.js [options]
  --dry-run              Guardar JSON en tmp; sin UPSERT
  --since=ISO_TIMESTAMP  Solo ids con updated_at >= en moobiz_drivers
  --batch-size=N         Máx. ids por ejecución (default ${DEFAULT_BATCH_SIZE})
  --concurrency=N        Paralelismo POST form (default ${DEFAULT_CONCURRENCY})
  --max-workers=N        Alias de --concurrency`);
      process.exit(0);
    }
  }
  if (opts.maxWorkers != null && Number.isFinite(opts.maxWorkers)) {
    opts.concurrency = opts.maxWorkers;
  }
  if (!Number.isFinite(opts.batchSize) || opts.batchSize < 1) opts.batchSize = DEFAULT_BATCH_SIZE;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = DEFAULT_CONCURRENCY;
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

function redactSecrets(obj) {
  try {
    const clone = JSON.parse(JSON.stringify(obj));
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        if (/token|password|authorization/i.test(k) && typeof v === "string") {
          node[k] = "[REDACTED]";
        } else walk(v);
      }
    };
    walk(clone);
    return clone;
  } catch {
    return obj;
  }
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return { processed_ids: {}, errors: [], last_batch_time: null, startedAt: new Date().toISOString() };
  }
  const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  if (!raw.processed_ids) raw.processed_ids = raw.completed || {};
  return raw;
}

function saveProgress(progress) {
  progress.last_batch_time = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
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

function mapUpsertRow(id, formBody, listItem) {
  const item = (formBody && formBody.item) || listItem || {};
  const rawSnapshot = item && typeof item === "object" ? item : listItem || {};
  return {
    id: String(id),
    id_branch: toTextNullable(item.id_branch ?? listItem?.id_branch),
    id_role: toTextNullable(item.id_role ?? listItem?.id_role),
    id_company: toTextNullable(item.id_company ?? listItem?.id_company),
    id_company_area: toTextNullable(item.id_company_area ?? listItem?.id_company_area),
    show_data_fleets: toBoolNullable(item.show_data_fleets ?? listItem?.show_data_fleets),
    raw_data: rawSnapshot,
    forms: formBody,
  };
}

function moobizHeaders(token, id) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://app.moobiz.pe",
    Referer: `https://app.moobiz.pe/drivers/${id}`,
    "User-Agent": CHROME_UA,
  };
}

async function resolveToken() {
  const envToken = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (envToken) {
    console.log("[driver-forms-sync] MOOBIZ_TOKEN desde env:", redactToken(envToken));
    return envToken;
  }
  const t = await ensureMoobizToken();
  console.log("[driver-forms-sync] token ensureMoobizToken:", redactToken(t));
  return t;
}

async function fetchDriverList(token) {
  const url = new URL(DRIVERS_LIST_URL);
  url.searchParams.set("limit", String(LIST_LIMIT));
  const res = await fetchWithRetry(
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
      cache: "no-store",
    },
    { label: "driver-forms:list", retries: DEFAULT_RETRIES, backoffMs: [200, 400, 800] },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`list HTTP ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (!body.ok) throw new Error(`list ok=false: ${body.msg || ""}`);
  return Array.isArray(body.items) ? body.items : [];
}

async function fetchDriverForm(token, id) {
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

async function selectCandidateIds(pool, opts, allListIds) {
  if (!opts.since) {
    return allListIds.slice(0, opts.batchSize);
  }
  const { rows } = await pool.query(
    `SELECT id::text AS id
     FROM public.moobiz_drivers
     WHERE updated_at >= $1::timestamptz
     ORDER BY updated_at ASC
     LIMIT $2`,
    [opts.since, opts.batchSize],
  );
  const allowed = new Set(allListIds.map(String));
  return rows.map((r) => r.id).filter((id) => allowed.has(id));
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
      JSON.stringify(row.forms),
    ],
  );
}

async function runPool(ids, concurrency, worker) {
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (idx < ids.length) {
        const i = idx++;
        await worker(ids[i], i);
      }
    }),
  );
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const conn = dbConnectionString();
  if (!conn && !opts.dryRun) {
    console.error("[driver-forms-sync] DB_CONNECTION_STRING o DATABASE_URL requerido.");
    process.exit(2);
  }

  let token = await resolveToken();
  console.log("[driver-forms-sync] opts:", opts);

  let listItems;
  try {
    listItems = await fetchDriverList(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not_logged/i.test(msg)) {
      console.warn("[driver-forms-sync] token inválido — refrescando vía ensureMoobizToken…");
      token = await ensureMoobizToken();
      console.log("[driver-forms-sync] token refreshed:", redactToken(token));
      listItems = await fetchDriverList(token);
    } else {
      throw e;
    }
  }
  const listById = Object.fromEntries(listItems.map((d) => [String(d.id), d]));
  console.log(`[driver-forms-sync] list API: ${listItems.length} conductores`);

  let ids = listItems.map((d) => String(d.id));
  let pool = null;

  if (conn) {
    pool = new Pool({ connectionString: conn });
    if (!opts.dryRun) {
      const exists = await tableExists(pool);
      if (!exists) {
        console.error(
          "[driver-forms-sync] Tabla moobiz_driver_forms no existe. Aplique migrations/20260528_create_moobiz_driver_forms_table.sql",
        );
        process.exit(3);
      }
    }
    if (opts.since) {
      ids = await selectCandidateIds(pool, opts, ids);
    } else {
      ids = ids.slice(0, opts.batchSize);
    }
  } else {
    ids = ids.slice(0, opts.batchSize);
  }

  const progress = loadProgress();
  ids = ids.filter((id) => !progress.processed_ids[id] || progress.processed_ids[id] === "error");

  if (ids.length === 0) {
    console.log("[driver-forms-sync] Sin ids pendientes en este lote.");
    if (pool) await pool.end();
    return;
  }

  console.log(`[driver-forms-sync] procesando ${ids.length} ids`);

  let ok = 0;
  let err = 0;

  await runPool(ids, opts.concurrency, async (id) => {
    const tmpPath = path.join(TMP_DIR, `driver_form_${id}.json`);
    try {
      const { res, parsed, text } = await fetchDriverForm(token, id);
      const body = parsed && typeof parsed === "object" ? parsed : { _parse_error: true, _raw: text.slice(0, 5000) };
      fs.writeFileSync(tmpPath, JSON.stringify(redactSecrets(body), null, 2));

      if (!res.ok || !parsed?.ok) {
        throw new Error(`form HTTP ${res.status} msg=${parsed?.msg || ""}`);
      }

      const row = mapUpsertRow(id, parsed, listById[id]);
      if (!opts.dryRun && pool) {
        await upsertRow(pool, row);
      }

      progress.processed_ids[id] = opts.dryRun ? "dry_run_ok" : "upserted";
      ok += 1;
    } catch (e) {
      err += 1;
      const msg = e instanceof Error ? e.message : String(e);
      progress.errors.push({ id, message: msg, at: new Date().toISOString() });
      progress.processed_ids[id] = "error";
      console.warn(`[driver-forms-sync] id=${id} error: ${msg}`);
    }
    if ((ok + err) % 10 === 0) saveProgress(progress);
  });

  saveProgress(progress);
  if (pool) await pool.end();

  const summary = {
    processed: ids.length,
    success: ok,
    errors: err,
    dryRun: opts.dryRun,
    tmpDir: TMP_DIR,
  };
  console.log("[driver-forms-sync] done", JSON.stringify(summary));
  if (err > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[driver-forms-sync] fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
