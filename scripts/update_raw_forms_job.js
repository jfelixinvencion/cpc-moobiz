/**
 * Pobla public.moobiz_drivers.raw_forms con POST /api/admin/drivers/form.
 * Independiente de scripts/sync_moobiz_drivers.js (no modifica raw_data).
 *
 * Uso:
 *   node scripts/update_raw_forms_job.js --dry-run --batch-size=10
 *   node scripts/update_raw_forms_job.js --batch-size=50 --concurrency=8
 *   node scripts/update_raw_forms_job.js --full-run --batch-size=100
 *   node scripts/update_raw_forms_job.js --since=2026-05-01 --batch-size=20
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ensureMoobizToken, redactToken } = require("../helpers/refresh_moobiz_token");

const DRIVERS_FORM_URL = "https://app.moobiz.pe/api/admin/drivers/form";
const TMP_DIR = path.resolve(process.cwd(), "tmp_raw_forms_job");
const PROGRESS_FILE = path.join(TMP_DIR, "progress.json");
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 200;

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    fullRun: false,
    since: null,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--full-run") opts.fullRun = true;
    else if (a === "--since" && argv[i + 1]) opts.since = argv[++i];
    else if (a.startsWith("--since=")) opts.since = a.slice("--since=".length);
    else if (a === "--batch-size" && argv[i + 1]) opts.batchSize = Number(argv[++i]);
    else if (a.startsWith("--batch-size=")) opts.batchSize = Number(a.slice("--batch-size=".length));
    else if (a === "--concurrency" && argv[i + 1]) opts.concurrency = Number(argv[++i]);
    else if (a.startsWith("--concurrency=")) opts.concurrency = Number(a.slice("--concurrency=".length));
    else if (a === "--help" || a === "-h") {
      console.log(`update_raw_forms_job.js [options]
  --dry-run           Fetch Moobiz + write tmp; no DB UPDATE
  --full-run          Procesar todos los ids (no solo raw_forms IS NULL)
  --since=ISO_DATE    Solo filas con updated_at >= fecha
  --batch-size=N      Máximo de ids por ejecución (default ${DEFAULT_BATCH_SIZE})
  --concurrency=N     Paralelismo POST form (default ${DEFAULT_CONCURRENCY})`);
      process.exit(0);
    }
  }
  if (!Number.isFinite(opts.batchSize) || opts.batchSize < 1) opts.batchSize = DEFAULT_BATCH_SIZE;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = DEFAULT_CONCURRENCY;
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function redactSecrets(obj) {
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
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return { completed: {}, errors: [], startedAt: new Date().toISOString() };
  }
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
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

async function fetchDriverForm(token, id, retries = DEFAULT_RETRIES) {
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
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(delay);
        attempt += 1;
        delay *= 2;
        continue;
      }
      return { res, parsed, text };
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(delay);
      attempt += 1;
      delay *= 2;
    }
  }
}

async function selectIds(pool, opts, hasRawFormsColumn) {
  const params = [];
  const where = [];
  if (!opts.fullRun && hasRawFormsColumn) {
    where.push("raw_forms IS NULL");
  } else if (!opts.fullRun && !hasRawFormsColumn) {
    console.warn("[raw-forms] Columna raw_forms ausente: seleccionando por id sin filtrar NULL.");
  }
  if (opts.since) {
    params.push(opts.since);
    where.push(`updated_at >= $${params.length}::timestamptz`);
  }
  params.push(opts.batchSize);
  const sql = `
    SELECT id::text AS id
    FROM public.moobiz_drivers
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY id
    LIMIT $${params.length}
  `;
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => r.id);
}

async function columnExists(pool) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'moobiz_drivers'
       AND column_name = 'raw_forms'
     LIMIT 1`,
  );
  return rows.length > 0;
}

async function updateRawForms(pool, id, payload) {
  await pool.query(
    `UPDATE public.moobiz_drivers
     SET raw_forms = $1::jsonb
     WHERE id = $2`,
    [JSON.stringify(payload), String(id)],
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

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl && !opts.dryRun) {
    console.error("[raw-forms] DATABASE_URL requerido salvo en --dry-run.");
    process.exit(2);
  }

  const token = await ensureMoobizToken();
  console.log("[raw-forms] token:", redactToken(token));
  console.log("[raw-forms] opts:", {
    dryRun: opts.dryRun,
    fullRun: opts.fullRun,
    since: opts.since,
    batchSize: opts.batchSize,
    concurrency: opts.concurrency,
  });

  let pool = null;
  let ids = [];

  try {
    if (!databaseUrl) {
      if (!opts.dryRun) {
        console.error("[raw-forms] DATABASE_URL requerido.");
        process.exit(2);
      }
      console.warn("[raw-forms] --dry-run sin DATABASE_URL: usando ids de muestra.");
      ids = ["131137", "131136", "131135", "131134", "131133", "131132", "131131", "131130", "131129", "131128"].slice(
        0,
        opts.batchSize,
      );
    } else {
      pool = new Pool({ connectionString: databaseUrl });
      const hasCol = await columnExists(pool);
      if (!opts.dryRun && !hasCol) {
        console.error(
          "[raw-forms] Columna raw_forms no existe. Aplique migrations/20260527_add_raw_forms_column.sql primero.",
        );
        process.exit(3);
      }
      ids = await selectIds(pool, opts, hasCol);
    }

    if (ids.length === 0) {
      console.log("[raw-forms] No hay ids pendientes.");
      return;
    }

    console.log(`[raw-forms] ids a procesar: ${ids.length}`);

    const progress = loadProgress();
    let ok = 0;
    let err = 0;

    await runPool(ids, opts.concurrency, async (id) => {
      const tmpPath = path.join(TMP_DIR, `driver_form_${id}.json`);
      try {
        const { res, parsed, text } = await fetchDriverForm(token, id);
        const toStore =
          parsed && typeof parsed === "object" ? parsed : { _parse_error: true, _raw: text.slice(0, 5000) };
        fs.writeFileSync(tmpPath, JSON.stringify(redactSecrets(toStore), null, 2));

        if (!res.ok || !parsed?.ok) {
          throw new Error(`form HTTP ${res.status} ok=${parsed?.ok} msg=${parsed?.msg || ""}`);
        }

        if (!opts.dryRun && pool) {
          await updateRawForms(pool, id, parsed);
        }

        progress.completed[id] = opts.dryRun ? "dry_run_ok" : "updated";
        ok += 1;
      } catch (e) {
        err += 1;
        const msg = e instanceof Error ? e.message : String(e);
        progress.errors.push({ id, message: msg, at: new Date().toISOString() });
        progress.completed[id] = "error";
        console.warn(`[raw-forms] error id=${id}: ${msg}`);
      }
      if ((ok + err) % 10 === 0) saveProgress(progress);
    });

    saveProgress(progress);

    console.log("[raw-forms] done", { processed: ids.length, ok, err, dryRun: opts.dryRun, tmpDir: TMP_DIR });
    if (err > 0) process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

main().catch((e) => {
  console.error("[raw-forms] fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
