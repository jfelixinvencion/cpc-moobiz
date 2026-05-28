/**
 * Diagnóstico fv_items: API Moobiz vs public.moobiz_drivers (solo lectura).
 * Uso: node scripts/diagnose_fv_items_truncation.js
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");
const { getMoobizTokenFallback } = require("./lib/env");

const IDS = ["131137", "131136", "131135", "131126", "131124"];
const DRIVERS_ONE = (id) => `https://app.moobiz.pe/api/admin/drivers/${encodeURIComponent(id)}`;
const DRIVERS_LIST = "https://app.moobiz.pe/api/admin/drivers?limit=3000";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT_DIR = path.join(process.cwd(), "reports", "fv_items_diagnosis");

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function extractFvItems(obj) {
  if (!obj || typeof obj !== "object") return { value: null, path: null };
  if (Object.prototype.hasOwnProperty.call(obj, "fv_items")) {
    const v = obj.fv_items;
    const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
    return { value: s, path: "root.fv_items" };
  }
  if (obj.item && typeof obj.item === "object" && "fv_items" in obj.item) {
    const v = obj.item.fv_items;
    const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
    return { value: s, path: "item.fv_items" };
  }
  if (Array.isArray(obj.items)) {
    for (const it of obj.items) {
      if (it && typeof it === "object" && "fv_items" in it) {
        const v = it.fv_items;
        const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
        return { value: s, path: "items[].fv_items" };
      }
    }
  }
  return { value: null, path: null };
}

function analyzeFv(text) {
  if (text === null || text === undefined) {
    return { bytes: 0, chars: 0, sha256: sha256(""), head400: "", tail400: "", truncationHints: [] };
  }
  const s = String(text);
  const buf = Buffer.from(s, "utf8");
  const hints = [];
  if (s.includes("\0")) hints.push("contains_null_byte");
  if (/\.\.\.(?!\.)/.test(s) || s.endsWith("...")) hints.push("contains_ellipsis");
  if (s.length === 1024) hints.push("exactly_1024_chars");
  if (buf.length === 1024) hints.push("exactly_1024_bytes");
  return {
    bytes: buf.length,
    chars: s.length,
    sha256: sha256(s),
    head400: s.slice(0, 400),
    tail400: s.slice(-400),
    truncationHints: hints,
  };
}

function headersPick(res) {
  const pick = ["content-type", "content-length", "content-encoding", "transfer-encoding"];
  const out = {};
  for (const k of pick) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

async function resolveToken() {
  try {
    const fresh = await ensureMoobizToken();
    if (fresh) return fresh;
  } catch (e) {
    console.warn("[diagnose] ensureMoobizToken failed:", e instanceof Error ? e.message : e);
  }
  const direct = String(process.env.MOOBIZ_TOKEN || process.env.MOOBIZ_DRIVERS_TOKEN || "").trim();
  if (direct) return direct;
  const fb = await getMoobizTokenFallback();
  if (fb) return fb;
  throw new Error("No MOOBIZ token");
}

async function fetchRaw(url, token) {
  const res = await fetch(url, {
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
  });
  const bodyText = await res.text();
  return { status: res.status, headers: headersPick(res), bodyText };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const token = await resolveToken();
  if (!token) throw new Error("No MOOBIZ token");

  const report = { ids: {}, listApi: null, db: {}, schema: null, triggers: null };

  // --- Bulk list (sync path) ---
  console.log("[diagnose] GET list", DRIVERS_LIST);
  const listRaw = await fetchRaw(DRIVERS_LIST, token);
  const listPath = path.join(OUT_DIR, "drivers_list_raw.txt");
  fs.writeFileSync(
    listPath,
    `HTTP/1.1 ${listRaw.status}\n${Object.entries(listRaw.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}\n\n${listRaw.bodyText}`,
    "utf8",
  );
  let listBody = null;
  try {
    listBody = JSON.parse(listRaw.bodyText);
  } catch {
    listBody = null;
  }
  const listItems = listBody?.items && Array.isArray(listBody.items) ? listBody.items : [];
  report.listApi = {
    status: listRaw.status,
    headers: listRaw.headers,
    bodyBytes: Buffer.byteLength(listRaw.bodyText, "utf8"),
    total: listBody?.total ?? null,
    itemsCount: listItems.length,
    rawFile: listPath,
  };

  for (const id of IDS) {
    console.log("[diagnose] GET one", id);
    const oneUrl = DRIVERS_ONE(id);
    const oneRaw = await fetchRaw(oneUrl, token);
    const rawFile = path.join(OUT_DIR, `response_${id}_raw.txt`);
    fs.writeFileSync(
      rawFile,
      `HTTP/1.1 ${oneRaw.status}\n${Object.entries(oneRaw.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}\n\n${oneRaw.bodyText}`,
      "utf8",
    );

    let oneBody = null;
    try {
      oneBody = oneRaw.bodyText ? JSON.parse(oneRaw.bodyText) : null;
    } catch {
      oneBody = null;
    }

    const fromOne = extractFvItems(oneBody);
    const listDriver = listItems.find((x) => String(x?.id) === id);
    const fromList = listDriver ? extractFvItems(listDriver) : { value: null, path: null };

    report.ids[id] = {
      oneEndpoint: {
        url: oneUrl,
        status: oneRaw.status,
        headers: oneRaw.headers,
        bodyBytes: Buffer.byteLength(oneRaw.bodyText, "utf8"),
        rawFile,
        fvPath: fromOne.path,
        fv: analyzeFv(fromOne.value),
        bodyPreview: oneRaw.bodyText.slice(0, 500),
      },
      listEndpoint: {
        foundInList: Boolean(listDriver),
        fvPath: fromList.path,
        fv: analyzeFv(fromList.value),
      },
    };
  }

  // --- DB ---
  const env = fs.readFileSync(".env.local", "utf8");
  const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!dbUrl) throw new Error("DATABASE_URL missing");

  const pool = new Pool({ connectionString: dbUrl, max: 1 });

  const schemaRes = await pool.query(`
    SELECT column_name, data_type, character_maximum_length, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'moobiz_drivers'
    ORDER BY ordinal_position
  `);
  report.schema = schemaRes.rows;

  const triggersRes = await pool.query(`
    SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'moobiz_drivers'
  `);
  report.triggers = triggersRes.rows;

  const idNums = IDS.map((x) => Number.parseInt(x, 10)).filter(Number.isFinite);
  const dbRows = await pool.query(
    `
    SELECT id,
           length(raw_data::text) AS raw_data_json_len,
           length(raw_data->>'fv_items') AS fv_len_text_op,
           octet_length(convert_to(raw_data->>'fv_items', 'UTF8')) AS fv_bytes,
           encode(digest(convert_to(COALESCE(raw_data->>'fv_items',''), 'UTF8'), 'sha256'), 'hex') AS fv_sha256,
           left(raw_data->>'fv_items', 400) AS fv_head_400,
           right(raw_data->>'fv_items', 400) AS fv_tail_400,
           substring(raw_data->>'fv_items' from 1 for 2000) AS fv_head_2000
    FROM public.moobiz_drivers
    WHERE id = ANY($1::text[])
    ORDER BY id DESC
    `,
    [IDS],
  );
  report.db.rows = dbRows.rows;

  for (const id of IDS) {
    const apiOne = report.ids[id]?.oneEndpoint?.fv;
    const apiList = report.ids[id]?.listEndpoint?.fv;
    const dbRow = dbRows.rows.find((r) => String(r.id) === id);
    report.ids[id].comparison = {
      apiOneChars: apiOne?.chars ?? null,
      apiListChars: apiList?.chars ?? null,
      dbFvChars: dbRow ? Number(dbRow.fv_len_text_op) : null,
      dbFvBytes: dbRow ? Number(dbRow.fv_bytes) : null,
      apiOneSha256: apiOne?.sha256 ?? null,
      apiListSha256: apiList?.sha256 ?? null,
      dbFvSha256: dbRow?.fv_sha256 ?? null,
      truncatedInApiList:
        apiList?.chars != null && apiOne?.chars != null && apiList.chars < apiOne.chars,
      truncatedInDbVsApiOne:
        dbRow && apiOne?.chars != null && Number(dbRow.fv_len_text_op) < apiOne.chars,
    };
  }

  await pool.end();

  const outJson = path.join(OUT_DIR, "fv_items_report.json");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

  const md = [];
  md.push("# Diagnóstico fv_items — API vs DB\n");
  md.push(`Generado: ${new Date().toISOString()}\n`);
  md.push("## Schema moobiz_drivers\n");
  md.push("```json\n" + JSON.stringify(report.schema, null, 2) + "\n```\n");
  md.push("## Triggers\n");
  md.push("```json\n" + JSON.stringify(report.triggers, null, 2) + "\n```\n");
  md.push("## List API (sync path)\n");
  md.push(JSON.stringify(report.listApi, null, 2) + "\n");
  for (const id of IDS) {
    const r = report.ids[id];
    md.push(`\n## ID ${id}\n`);
    md.push("### GET /api/admin/drivers/{id}\n");
    md.push(JSON.stringify(r.oneEndpoint, null, 2) + "\n");
    md.push("### En list bulk (items)\n");
    md.push(JSON.stringify(r.listEndpoint, null, 2) + "\n");
    md.push("### Comparación\n");
    md.push(JSON.stringify(r.comparison, null, 2) + "\n");
    const dbRow = report.db.rows.find((x) => String(x.id) === id);
    if (dbRow) {
      md.push("### DB row\n");
      md.push(JSON.stringify(dbRow, null, 2) + "\n");
    } else {
      md.push("### DB: id no encontrado\n");
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "fv_items_report.md"), md.join("\n"), "utf8");

  console.log("[diagnose] Report:", outJson);
  console.log(JSON.stringify(report.ids, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
