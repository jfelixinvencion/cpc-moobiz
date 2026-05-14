/**
 * Recuperación no destructiva de fv_items en public.moobiz_drivers (primer lote de 50).
 * Requiere: DATABASE_URL (Postgres directo), MOOBIZ_TOKEN en .env.local o env.
 *
 * Uso: node -r dotenv/config scripts/recover_moobiz_drivers_fv_items.js
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { Pool } = require("pg");
const crypto = require("crypto");
const { fetchWithRetry } = require("../helpers/moobiz_fetch_retry");

const DRIVERS_ONE_URL = (id) => `https://app.moobiz.pe/api/admin/drivers/${encodeURIComponent(id)}`;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BATCH_SIZE = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fvItemsValueLength(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "string") return v.length;
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

/** Encuentra fv_items de mayor longitud en cualquier nivel (string u objeto serializable). */
function findLongestFvItems(node, out = { len: 0, value: null }) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string") return out;
  if (Array.isArray(node)) {
    for (const x of node) findLongestFvItems(x, out);
    return out;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "fv_items") {
        const L = fvItemsValueLength(v);
        if (L > out.len) {
          out.len = L;
          out.value = typeof v === "string" ? v : JSON.stringify(v);
        }
      }
      findLongestFvItems(v, out);
    }
  }
  return out;
}

/** Sustituye todas las cadenas fv_items por `replacement` (recursivo). */
function replaceAllFvItemsStrings(node, replacement) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) replaceAllFvItemsStrings(x, replacement);
    return;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (k === "fv_items") {
        node[k] = replacement;
      } else {
        replaceAllFvItemsStrings(node[k], replacement);
      }
    }
  }
}

function buildUpdateSql(id, rawDataObj) {
  const jsonStr = JSON.stringify(rawDataObj);
  const tag = `fv_${crypto.randomBytes(12).toString("hex")}`;
  if (jsonStr.includes("$" + tag + "$")) {
    throw new Error("delimiter collision en JSON");
  }
  const escapedId = String(id).replace(/'/g, "''");
  return (
    "UPDATE public.moobiz_drivers SET raw_data = $" +
    tag +
    "$" +
    jsonStr +
    "$" +
    tag +
    "$::jsonb WHERE id::text = '" +
    escapedId +
    "';"
  );
}

async function fetchDriverById(token, id, attemptState) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/",
    "User-Agent": CHROME_UA,
  };
  const res = await fetchWithRetry(DRIVERS_ONE_URL(id), { method: "GET", headers, cache: "no-store" }, {
    label: `recover-fv:${id}`,
    retries: 3,
    backoffMs: [1000, 2000, 4000],
  });
  const text = await res.text();
  if (res.status === 429) {
    const wait = 2000 * (attemptState.retries429 + 1);
    attemptState.retries429 += 1;
    if (attemptState.retries429 <= 5) {
      await sleep(wait);
      return fetchDriverById(token, id, attemptState);
    }
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, text: text.slice(0, 2000), body };
}

const DRIVERS_LIST_BASE =
  (process.env.MOOBIZ_DRIVERS_URL && String(process.env.MOOBIZ_DRIVERS_URL).trim()) ||
  "https://app.moobiz.pe/api/admin/drivers";

/** Un solo GET listado admin (mismo criterio que sync:drivers) → Map id → ítem completo (suele incluir fv_items). */
async function fetchDriversBulkByIdMap(token) {
  const lim = Math.min(
    5000,
    Math.max(1, Number.parseInt(String(process.env.MOOBIZ_DRIVERS_PAGE_SIZE || "3000"), 10) || 3000),
  );
  const url = new URL(DRIVERS_LIST_BASE);
  url.searchParams.set("limit", String(lim));
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/",
    "User-Agent": CHROME_UA,
  };
  const res = await fetchWithRetry(
    url.toString(),
    { method: "GET", headers, cache: "no-store" },
    { label: "recover-fv:bulk-catalog", retries: 3, backoffMs: [1000, 2000, 4000] },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`bulk drivers HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = text ? JSON.parse(text) : {};
  if (body.ok !== true || !Array.isArray(body.items)) {
    throw new Error(`bulk drivers respuesta inválida (ok/items)`);
  }
  const byId = new Map();
  for (const it of body.items) {
    if (it && typeof it === "object" && it.id != null) {
      const sid = String(it.id).trim();
      if (sid) byId.set(sid, it);
    }
  }
  return { byId, limit: lim, itemCount: body.items.length };
}

async function main() {
  const report = {
    total_truncados_en_db: null,
    total_ids_chequeados: 0,
    total_necesitan_update: 0,
    primer_lote: { size: 0, rows: [] },
    verificacion_global: null,
    verificacion_lote: null,
    audit_sample: [],
    errores: [],
    notas: [],
  };

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const token = String(process.env.MOOBIZ_TOKEN || "").trim();

  if (!databaseUrl) {
    report.errores.push("Falta DATABASE_URL (conexión Postgres directa). Añádela a .env.local para ejecutar DDL/SQL.");
    const md = renderMd(report);
    console.log(md);
    process.exit(2);
  }
  if (!token) {
    report.errores.push("Falta MOOBIZ_TOKEN en el entorno.");
    const md = renderMd(report);
    console.log(md);
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 25_000,
  });

  const maxAuditEnv = Number.parseInt(String(process.env.RECOVER_MAX_AUDIT_IDS || "0"), 10);

  try {
    console.error("[recover-fv] Conectando y creando tablas de auditoría si faltan…");

    await pool.query(`
CREATE TABLE IF NOT EXISTS public.moobiz_drivers_audit (
  id text PRIMARY KEY,
  db_fv_len int,
  api_fv_len int,
  api_checked_at timestamptz,
  api_payload jsonb,
  needs_update boolean,
  update_sql text
);`);
    await pool.query(`
CREATE TABLE IF NOT EXISTS public.moobiz_drivers_updates_pending (
  id text PRIMARY KEY,
  update_sql text,
  created_at timestamptz DEFAULT now()
);`);
    await pool.query(`
CREATE TABLE IF NOT EXISTS public.moobiz_drivers_backup AS TABLE public.moobiz_drivers WITH NO DATA;`);
    await pool.query(`
CREATE TABLE IF NOT EXISTS public.moobiz_drivers_recovery_apply_log (
  log_id bigserial PRIMARY KEY,
  driver_id text NOT NULL,
  status text NOT NULL,
  detail text,
  ran_at timestamptz DEFAULT now()
);`);

    const { rows: truncatedRowsAll } = await pool.query(`
SELECT id::text AS id, length(coalesce(raw_data::jsonb ->> 'fv_items','')) AS db_fv_len
FROM public.moobiz_drivers
WHERE length(coalesce(raw_data::jsonb ->> 'fv_items','')) <= 1024
ORDER BY id;
    `);

    report.total_truncados_en_db = truncatedRowsAll.length;

    const truncatedRows =
      Number.isFinite(maxAuditEnv) && maxAuditEnv > 0
        ? truncatedRowsAll.slice(0, maxAuditEnv)
        : truncatedRowsAll;
    if (maxAuditEnv > 0 && truncatedRowsAll.length > maxAuditEnv) {
      report.notas.push(
        `RECOVER_MAX_AUDIT_IDS=${maxAuditEnv}: solo se auditaron ${truncatedRows.length} de ${truncatedRowsAll.length} ids truncados (modo acotado).`,
      );
    }

    report.total_ids_chequeados = truncatedRows.length;
    const ids = truncatedRows.map((r) => r.id);
    console.error(`[recover-fv] Ids a comparar con API: ${ids.length}`);

    let bulkById = new Map();
    if (ids.length > 0) {
      try {
        const bulk = await fetchDriversBulkByIdMap(token);
        bulkById = bulk.byId;
        report.notas.push(
          `Catálogo Moobiz (GET listado limit=${bulk.limit}): ${bulk.itemCount} ítems, ${bulk.byId.size} ids indexados para cruce fv_items.`,
        );
      } catch (e) {
        report.errores.push({
          fase: "bulk_catalog",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let idx = 0;
    for (const row of truncatedRows) {
      idx += 1;
      if (idx === 1 || idx % 25 === 0) console.error(`[recover-fv] Progreso API ${idx}/${truncatedRows.length}…`);
      const id = row.id;
      const dbFvLen = Number(row.db_fv_len) || 0;
      let apiFvLen = 0;
      let apiPayload = null;
      let needsUpdate = false;
      let updateSql = null;

      try {
        const attemptState = { retries429: 0 };
        const api = await fetchDriverById(token, id, attemptState);
        if (!api.ok || !api.body) {
          throw new Error(`HTTP ${api.status} — ${api.text?.slice(0, 500) || "sin cuerpo"}`);
        }
        let longest = findLongestFvItems(api.body, { len: 0, value: null });
        let fvSource = "detail_root";
        if (longest.len === 0 && api.body.item && typeof api.body.item === "object") {
          longest = findLongestFvItems(api.body.item, { len: 0, value: null });
          if (longest.len > 0) fvSource = "detail_item";
        }
        if (longest.len === 0 && bulkById.has(id)) {
          longest = findLongestFvItems(bulkById.get(id), { len: 0, value: null });
          if (longest.len > 0) fvSource = "bulk_list";
        }
        apiFvLen = longest.len;
        apiPayload =
          api.body && typeof api.body === "object"
            ? { ...api.body, _recover_fv_len: apiFvLen, _recover_fv_source: fvSource }
            : { _recover_fv_len: apiFvLen, _recover_fv_source: fvSource, raw: api.body };

        const { rows: cur } = await pool.query(
          `SELECT raw_data::jsonb AS raw_data, raw_data::jsonb->>'fv_items' AS fv_db FROM public.moobiz_drivers WHERE id::text = $1 LIMIT 1`,
          [id],
        );
        if (!cur.length) {
          throw new Error("Fila no encontrada en moobiz_drivers");
        }
        const raw = cur[0].raw_data;
        const dbFvStr = typeof cur[0].fv_db === "string" ? cur[0].fv_db : "";
        const merged = typeof raw === "string" ? JSON.parse(raw) : { ...raw };
        const apiStr = longest.value != null ? String(longest.value) : "";
        const shouldUpdate =
          apiStr.length > 0 &&
          (apiStr.length > dbFvLen || (apiStr.length === dbFvLen && apiStr !== dbFvStr));
        if (shouldUpdate) {
          replaceAllFvItemsStrings(merged, apiStr);
          needsUpdate = true;
          updateSql = buildUpdateSql(id, merged);
        }
      } catch (e) {
        report.errores.push({ id, fase: "api_o_auditoria", error: e instanceof Error ? e.message : String(e) });
        apiPayload = { _error: e instanceof Error ? e.message : String(e) };
      }

      await pool.query(
        `
INSERT INTO public.moobiz_drivers_audit (id, db_fv_len, api_fv_len, api_checked_at, api_payload, needs_update, update_sql)
VALUES ($1, $2, $3, now(), $4::jsonb, $5, $6)
ON CONFLICT (id) DO UPDATE SET
  db_fv_len = EXCLUDED.db_fv_len,
  api_fv_len = EXCLUDED.api_fv_len,
  api_checked_at = EXCLUDED.api_checked_at,
  api_payload = EXCLUDED.api_payload,
  needs_update = EXCLUDED.needs_update,
  update_sql = EXCLUDED.update_sql;
        `,
        [id, dbFvLen, apiFvLen, JSON.stringify(apiPayload ?? {}), needsUpdate, updateSql],
      );

      if (needsUpdate && updateSql) {
        await pool.query(
          `INSERT INTO public.moobiz_drivers_updates_pending (id, update_sql) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET update_sql = EXCLUDED.update_sql, created_at = now();`,
          [id, updateSql],
        );
      }
      await sleep(80);
    }

    const { rows: auditSample } = await pool.query(
      `SELECT id, db_fv_len, api_fv_len, needs_update,
              left(api_payload::text, 240) AS api_payload_head
       FROM public.moobiz_drivers_audit
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [ids],
    );
    report.audit_sample = auditSample;

    const { rows: needRows } = await pool.query(`
SELECT id, db_fv_len, api_fv_len, (api_fv_len - db_fv_len) AS diff
FROM public.moobiz_drivers_audit
WHERE needs_update = true AND update_sql IS NOT NULL AND api_fv_len > db_fv_len
ORDER BY (api_fv_len - db_fv_len) DESC NULLS LAST
LIMIT $1;
    `, [BATCH_SIZE]);

    report.total_necesitan_update = (
      await pool.query(
        `SELECT count(*)::int AS c FROM public.moobiz_drivers_audit WHERE needs_update = true AND update_sql IS NOT NULL AND api_fv_len > db_fv_len`,
      )
    ).rows[0].c;

    const { rows: allPending } = await pool.query(
      `SELECT id, left(update_sql, 120) AS update_sql_head, length(update_sql) AS sql_len, created_at FROM public.moobiz_drivers_updates_pending ORDER BY created_at DESC LIMIT 200`,
    );
    report.pending_preview = allPending;

    if (needRows.length === 0) {
      report.notas.push("No hay filas pendientes con api_fv_len > db_fv_len; no se aplica lote.");
      const v1 = await pool.query(`
SELECT max(length(raw_data::jsonb ->> 'fv_items'))::int AS max_largo,
       (count(*) FILTER (WHERE length(raw_data::jsonb ->> 'fv_items') = 1024))::int AS siguen_cortados
FROM public.moobiz_drivers;
      `);
      report.verificacion_global = v1.rows[0];
      const mdEarly = renderMd(report);
      console.log(mdEarly);
      try {
        const fs = require("fs");
        const path = require("path");
        const dir = path.join(process.cwd(), "reports");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "moobiz_drivers_fv_items_recovery.md"), mdEarly, "utf8");
      } catch {
        /* opcional */
      }
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const pr of needRows) {
        const id = pr.id;
        const { rows: pend } = await client.query(
          `SELECT update_sql FROM public.moobiz_drivers_updates_pending WHERE id = $1`,
          [id],
        );
        if (!pend.length || !pend[0].update_sql) {
          throw new Error(`Sin update_sql en pending para id=${id}`);
        }
        const sqlUpdate = pend[0].update_sql;
        await client.query(`INSERT INTO public.moobiz_drivers_backup SELECT * FROM public.moobiz_drivers WHERE id::text = $1`, [id]);
        await client.query(sqlUpdate);
        await client.query(
          `INSERT INTO public.moobiz_drivers_recovery_apply_log (driver_id, status, detail) VALUES ($1, $2, $3)`,
          [id, "success", `backup+update ok; diff api-db=${pr.api_fv_len - pr.db_fv_len}`],
        );
        report.primer_lote.rows.push({ id, status: "success", db_fv_len: pr.db_fv_len, api_fv_len: pr.api_fv_len });
      }
      await client.query("COMMIT");
      report.primer_lote.size = needRows.length;
    } catch (e) {
      await client.query("ROLLBACK");
      report.errores.push({ fase: "lote1_transaction", error: e instanceof Error ? e.message : String(e) });
      report.notas.push("ROLLBACK del primer lote: ningún cambio persistido en ese lote.");
      report.primer_lote.rows = [];
      report.primer_lote.size = 0;
    } finally {
      client.release();
    }

    const v1 = await pool.query(`
SELECT max(length(raw_data::jsonb ->> 'fv_items'))::int AS max_largo,
       (count(*) FILTER (WHERE length(raw_data::jsonb ->> 'fv_items') = 1024))::int AS siguen_cortados
FROM public.moobiz_drivers;
    `);
    report.verificacion_global = v1.rows[0];

    const idList = needRows.map((r) => `'${String(r.id).replace(/'/g, "''")}'`).join(",");
    if (idList.length > 0) {
      const v2 = await pool.query(`
SELECT id::text, length(raw_data::jsonb ->> 'fv_items') AS fv_len,
       left(raw_data::jsonb ->> 'fv_items', 200) AS head,
       right(raw_data::jsonb ->> 'fv_items', 200) AS tail
FROM public.moobiz_drivers
WHERE id::text IN (${idList});
      `);
      report.verificacion_lote = v2.rows;
    }
  } catch (e) {
    report.errores.push({ fase: "global", error: e instanceof Error ? e.message : String(e) });
  } finally {
    await pool.end();
  }

  const md = renderMd(report);
  console.log(md);
  try {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "moobiz_drivers_fv_items_recovery.md"), md, "utf8");
  } catch {
    /* opcional */
  }
}

function renderMd(r) {
  const lines = [];
  lines.push("# Informe recuperación `fv_items` (moobiz_drivers)");
  lines.push("");
  lines.push(`- **total_ids_truncados_en_db** (query length ≤ 1024): ${r.total_truncados_en_db ?? "n/d"}`);
  lines.push(`- **total_ids_chequeados** (API en esta corrida): ${r.total_ids_chequeados}`);
  lines.push(`- **total_necesitan_update** (audit: needs_update y api > db): ${r.total_necesitan_update}`);
  lines.push(`- **primer lote aplicado**: ${r.primer_lote.size} filas`);
  lines.push("");
  lines.push(
    "> **Diagnóstico:** si `api_fv_len` del listado Moobiz coincide con `db_fv_len` (p. ej. ambos 1024), la API también entrega `fv_items` truncado; este proceso no puede inventar el resto. Hace falta otra fuente (export Moobiz sin límite, otro endpoint, o corrección en origen).",
  );
  lines.push("");
  lines.push("## Estado por id (primer lote)");
  lines.push("");
  if (!r.primer_lote.rows.length) {
    lines.push("(ninguna fila aplicada o lote vacío / rollback)");
  } else {
    lines.push("| id | status |");
    lines.push("|---|---|");
    for (const x of r.primer_lote.rows) {
      lines.push(`| ${x.id} | ${x.status} |`);
    }
  }
  lines.push("");
  lines.push("## Muestra `moobiz_drivers_audit` (ids de esta corrida)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(r.audit_sample ?? [], null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Verificación global");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(r.verificacion_global ?? null, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Verificación filas del primer lote (head/tail)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(r.verificacion_lote ?? null, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Vista `moobiz_drivers_updates_pending` (preview id + inicio SQL)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(r.pending_preview ?? [], null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Errores / notas");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({ errores: r.errores, notas: r.notas }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("> No se ejecutaron lotes adicionales tras el primero (máx. 50).");
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
