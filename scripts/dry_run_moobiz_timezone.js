/**
 * Dry-run: 1 GET Moobiz services (limit=10), conversión Lima→UTC. Sin DB, sin upsert, sin persistir token.
 *
 * Uso:
 *   node -r dotenv/config scripts/dry_run_moobiz_timezone.js
 *   DOTENV_CONFIG_PATH=.env.local node -r dotenv/config scripts/dry_run_moobiz_timezone.js
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { randomUUID } = require("node:crypto");
const {
  getMoobizDefaultTimezone,
  resolveMoobizDateParseDetails,
  moobizYmdDaysAgo,
  moobizDateToNowUtcIso,
} = require("../helpers/moobiz-dates");

const BASE = (
  process.env.MOOBIZ_API_BASE_URL && String(process.env.MOOBIZ_API_BASE_URL).trim()
) || "https://app.moobiz.pe";
const SERVICES_URL =
  (process.env.MOOBIZ_SERVICES_URL && String(process.env.MOOBIZ_SERVICES_URL).trim()) ||
  `${BASE.replace(/\/+$/, "")}/api/admin/services`;
const LOGIN_URL = `${BASE.replace(/\/+$/, "")}/api/admin/login/login`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let bearer = null;

async function login() {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
      "User-Agent": UA,
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
  const j = await res.json();
  if (j?.ok !== true || !j?.token) throw new Error(`login_failed:${j?.msg || res.status}`);
  return j.token.trim();
}

async function ensureBearer() {
  const envTok = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (envTok) {
    bearer = envTok;
    return "token";
  }
  bearer = await login();
  return "login";
}

function pickRawDateUpdated(item) {
  const raw = item?.raw_data && typeof item.raw_data === "object" ? item.raw_data : item;
  return raw?.date_updated ?? raw?.updated_at ?? item?.date_updated ?? null;
}

function pickTemporalExtra(item) {
  const raw = item?.raw_data && typeof item.raw_data === "object" ? item.raw_data : item;
  const out = {};
  for (const k of ["date_created", "date_scheduled", "updated_at"]) {
    if (raw?.[k] != null && raw[k] !== "") out[k] = raw[k];
  }
  return out;
}

async function fetchSample() {
  const dateFrom = moobizYmdDaysAgo(20);
  const dateTo = moobizDateToNowUtcIso();
  const qs = new URLSearchParams({
    page: "1",
    limit: "10",
    date_from: dateFrom,
    date_to: dateTo,
    order_col: "date_updated",
    order_dir: "desc",
  });
  const url = `${SERVICES_URL}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-Auth-Token": bearer,
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
      "User-Agent": UA,
      "Cache-Control": "no-cache",
    },
    cache: "no-store",
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  const items = Array.isArray(body) ? body : body?.items || body?.data || [];
  return {
    status: res.status,
    headers: {
      Date: res.headers.get("date"),
      "Cache-Control": res.headers.get("cache-control"),
      ETag: res.headers.get("etag"),
    },
    api_total: body?.total ?? null,
    date_from: dateFrom,
    date_to: dateTo,
    items,
  };
}

function isTodayInLimaUtc(isoUtc) {
  if (!isoUtc) return false;
  const zone = getMoobizDefaultTimezone();
  const { DateTime } = require("luxon");
  const itemDay = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(zone).toFormat("yyyy-MM-dd");
  const today = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
  return itemDay === today;
}

async function main() {
  const startedAt = new Date().toISOString();
  const authMethod = await ensureBearer();
  let fetchResult = await fetchSample();
  let authUsed = authMethod;
  if (fetchResult.status === 200 && fetchResult.items.length === 0 && authMethod === "token") {
    bearer = await login();
    authUsed = "login";
    fetchResult = await fetchSample();
  }
  bearer = null;

  const zone = getMoobizDefaultTimezone();
  const rows = fetchResult.items.slice(0, 10).map((item) => {
    const rawDu = pickRawDateUpdated(item);
    const parsed = resolveMoobizDateParseDetails(rawDu, zone);
    return {
      id: String(item?.id ?? item?.service_id ?? ""),
      raw_date_updated: parsed.raw_date_updated,
      parsed_lima_iso: parsed.parsed_lima_iso,
      normalized_utc_iso: parsed.normalized_utc_iso,
      temporal_extra: pickTemporalExtra(item),
      is_today_in_moobiz_tz: isTodayInLimaUtc(parsed.normalized_utc_iso),
    };
  });

  const nowUtc = moobizDateToNowUtcIso();
  const latest = rows.reduce(
    (acc, r) => {
      if (!r.normalized_utc_iso) return acc;
      const ms = Date.parse(r.normalized_utc_iso);
      if (Number.isNaN(ms)) return acc;
      if (!acc.ms || ms > acc.ms) return { ms, iso: r.normalized_utc_iso, id: r.id };
      return acc;
    },
    { ms: null, iso: null, id: null },
  );
  const gapMs = latest.ms != null ? Date.parse(nowUtc) - latest.ms : null;
  const anyToday = rows.some((r) => r.is_today_in_moobiz_tz);

  console.log("[timezone-fix] parse check");
  if (typeof console.table === "function") {
    console.table(
      rows.map((r) => ({
        id: r.id,
        raw: r.raw_date_updated,
        parsed_lima_iso: r.parsed_lima_iso,
        normalized_utc_iso: r.normalized_utc_iso,
      })),
    );
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }

  console.log(
    `[timezone-fix] dry-run result: items=${rows.length}, now_utc=${nowUtc}, latest_normalized_utc=${latest.iso ?? "null"}, gap_with_now_ms=${gapMs ?? "null"}, any_today_in_${zone}=${anyToday}`,
  );

  const output = {
    confirmations: {
      no_db_write: "NO se escribió en la DB",
      no_token_on_disk: "NO se guardaron tokens en disco",
      no_sync_script: "NO se ejecutó sync_moobiz_history.js en modo escritura",
    },
    auth: { method: authUsed, timestamp: startedAt, token_used: "<REDACTED_TOKEN>" },
    timezone: zone,
    http: {
      status: fetchResult.status,
      headers: fetchResult.headers,
      api_total: fetchResult.api_total,
      date_from: fetchResult.date_from,
      date_to: fetchResult.date_to,
    },
    dry_run: {
      items: rows,
      now_utc: nowUtc,
      latest_normalized_utc: latest.iso,
      latest_id: latest.id,
      gap_with_now_ms: gapMs,
      any_record_today_in_moobiz_tz: anyToday,
      check_passed: anyToday && rows.length > 0,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: e.message }));
  process.exit(1);
});
