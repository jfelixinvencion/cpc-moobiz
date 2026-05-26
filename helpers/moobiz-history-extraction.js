/**
 * Extracción Moobiz historial: paginación desc + corte cliente por stop_threshold.
 * Sin date_from/date_to en queries. Persistencia vía callback onBatch (sync script).
 */
const { randomUUID } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DateTime } = require("luxon");
const {
  resolveMoobizDateParseDetails,
  getMoobizDefaultTimezone,
} = require("./moobiz-dates");

const DEFAULTS = {
  stop_days: 5,
  limit: 200,
  pause_ms: 500,
  timeout_ms: 15000,
  retries: 3,
  max_pages_safety: 50,
  abort_if_too_many_rows: 10000,
  batch_pages: 10,
  run_mode: "dry_run",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickRawDateUpdated(it) {
  const raw = it?.raw_data && typeof it.raw_data === "object" ? it.raw_data : it;
  return raw?.date_updated ?? raw?.updated_at ?? it?.date_updated ?? null;
}

function pickId(it) {
  return String(it?.id ?? it?.service_id ?? "").trim();
}

function parseItem(it, zone) {
  const rawStr = pickRawDateUpdated(it);
  const d = resolveMoobizDateParseDetails(rawStr, zone);
  const ts_ms = d.normalized_utc_iso ? Date.parse(d.normalized_utc_iso) : null;
  return {
    id: pickId(it),
    raw_date_updated: d.raw_date_updated,
    parsed_lima_iso: d.parsed_lima_iso,
    normalized_utc_iso: d.normalized_utc_iso,
    ts_ms: Number.isNaN(ts_ms) ? null : ts_ms,
    _raw: it,
  };
}

/** @param {ReturnType<parseItem>[]} parsedRows */
function splitPageRowsByThreshold(parsedRows, stopThresholdMs) {
  const valid = [];
  let discarded = 0;
  for (const row of parsedRows) {
    if (row.ts_ms != null && row.ts_ms > stopThresholdMs) {
      valid.push(row);
    } else {
      discarded += 1;
    }
  }
  const last = parsedRows[parsedRows.length - 1];
  const shouldStop =
    last != null && last.ts_ms != null && last.ts_ms <= stopThresholdMs;
  return { valid, discarded, shouldStop };
}

/** Dedupe raw API items by id; keep latest by timestamp_ms. */
function dedupeRawItemsKeepLatest(parsedRows) {
  const map = new Map();
  for (const row of parsedRows) {
    const id = row.id;
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, row);
      continue;
    }
    const prevMs = prev.ts_ms ?? 0;
    const curMs = row.ts_ms ?? 0;
    if (curMs >= prevMs) map.set(id, row);
  }
  return [...map.values()];
}

function headerSnippet(res) {
  const keys = [
    "cache-control",
    "date",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "ratelimit-limit",
    "ratelimit-remaining",
    "ratelimit-reset",
    "retry-after",
  ];
  const out = {};
  for (const k of keys) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/** Mismo criterio que scripts/sync_moobiz_history.js extractItems */
function extractItemsFromBody(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.services)) return body.services;
  return [];
}

function writeDebugRawResponse(cfg, page, payload) {
  if (process.env.MOOBIZ_EXTRACTION_DEBUG !== "1" || !cfg.tmpDir || !cfg.run_id) return;
  try {
    mkdirSync(cfg.tmpDir, { recursive: true });
    const p = join(cfg.tmpDir, `moobiz-raw-response-${cfg.run_id}-page-${page}.json`);
    writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

function publicItem(row) {
  return {
    id: row.id,
    raw_date_updated: row.raw_date_updated,
    parsed_lima_iso: row.parsed_lima_iso,
    normalized_utc_iso: row.normalized_utc_iso,
    ts_ms: row.ts_ms,
  };
}

function boundaryItem(row) {
  return row ? publicItem(row) : null;
}

/**
 * @param {object} cfg
 * @param {() => Promise<string>} cfg.ensureBearer
 * @param {string} cfg.servicesUrl
 * @param {string} cfg.webOrigin
 * @param {string} cfg.userAgent
 * @param {(rawItems: object[]) => Promise<{ processed?: number }>} [cfg.onBatch]
 */
async function fetchServicesPageExtraction(cfg, page) {
  const {
    ensureBearer,
    servicesUrl,
    webOrigin,
    userAgent,
    limit,
    timeout_ms,
    retries,
    pause_ms,
  } = cfg;

  let bearer = await ensureBearer();
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    order_col: "date_updated",
    order_dir: "desc",
  });
  const url = `${servicesUrl}?${qs}`;

  let attempt = 0;
  while (true) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Auth-Token": bearer,
          Accept: "application/json",
          Origin: webOrigin,
          Referer: `${webOrigin}/`,
          "User-Agent": userAgent,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeout_ms),
      });
      const text = await res.text();
      const elapsed_ms = Date.now() - t0;

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        attempt += 1;
        const ra = res.headers.get("retry-after");
        await sleep(ra ? Math.max(Number(ra) * 1000, pause_ms) : 1000 * 2 ** attempt);
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        return {
          http_status: res.status,
          error: `persistent_${res.status}_after_${attempt}_retries`,
          elapsed_ms,
          retries: attempt,
          headers: headerSnippet(res),
        };
      }

      if (!res.ok) {
        return {
          http_status: res.status,
          error: `http_${res.status}`,
          elapsed_ms,
          retries: attempt,
          headers: headerSnippet(res),
          body_snippet: text.slice(0, 300),
        };
      }

      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return { http_status: res.status, error: "invalid_json", elapsed_ms, retries: attempt };
      }

      writeDebugRawResponse(cfg, page, {
        status: res.status,
        headers: headerSnippet(res),
        url,
        body,
        body_preview_first_200_bytes: text.slice(0, 200),
      });

      if (body && typeof body === "object" && !Array.isArray(body) && body.ok === false) {
        const msg = String(body.msg || "");
        const authInvalid = /not_logged|unauthorized|auth/i.test(msg);
        if (authInvalid && typeof cfg.refreshBearer === "function" && !cfg._authRefreshUsed) {
          cfg._authRefreshUsed = true;
          console.warn(
            `[moobiz-extraction] API ok=false msg=${msg} — renovando token y reintentando página ${page}`,
          );
          const refreshed = await cfg.refreshBearer();
          if (refreshed && String(refreshed).trim()) {
            bearer = String(refreshed).trim();
          } else {
            bearer = await ensureBearer();
          }
          continue;
        }
        return {
          http_status: res.status,
          error: `api_ok_false:${msg || "unknown"}`,
          api_msg: msg,
          api_ok_false: true,
          elapsed_ms,
          retries: attempt,
          headers: headerSnippet(res),
          body_snippet: text.slice(0, 300),
        };
      }

      const items = extractItemsFromBody(body);
      return {
        http_status: res.status,
        elapsed_ms,
        api_total: body?.total ?? null,
        items_count: items.length,
        body_bytes: Buffer.byteLength(text, "utf8"),
        rows: items,
        retries: attempt,
        headers: headerSnippet(res),
        api_ok: body?.ok,
        api_msg: body?.msg,
      };
    } catch (e) {
      if (attempt >= retries) {
        return { error: e.message, retries: attempt, http_status: null, fatal: true };
      }
      attempt += 1;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function flushBatch(cfg, state, batchParsed, opts = {}) {
  if (batchParsed.length === 0) return { processed: 0 };
  const deduped = dedupeRawItemsKeepLatest(batchParsed);
  const rawItems = deduped.map((r) => r._raw);

  state.collectedParsed.push(...deduped);

  if (cfg.run_mode === "dry_run") {
    state.rows_persisted += rawItems.length;
    state.dry_run_batches += 1;
    return { processed: rawItems.length, dry_run: true };
  }

  if (typeof cfg.onBatch === "function") {
    const result = await cfg.onBatch(rawItems, opts);
    const n = result?.processed ?? rawItems.length;
    state.rows_persisted += n;
    return result;
  }

  return { processed: 0 };
}

function writeCheckpoint(cfg, state) {
  if (!cfg.tmpDir) return;
  try {
    mkdirSync(cfg.tmpDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const partialPath = join(
    cfg.tmpDir,
    `moobiz-stop-threshold-${cfg.stop_days}d-${state.run_id}.partial.json`,
  );
  writeFileSync(
    partialPath,
    JSON.stringify(
      {
        checkpoint_at: new Date().toISOString(),
        metadata: state.metadata,
        global: {
          total_rows_fetched: state.total_rows_fetched,
          collected_items_count: state.collectedParsed.length,
          stop_reason: state.stop_reason,
          pages_requested: state.pages_requested,
        },
        per_page_count: state.per_page.length,
      },
      null,
      2,
    ),
    "utf8",
  );
  state.partial_path = partialPath;
}

function buildCoverage(collected) {
  const withTs = collected.filter((r) => r.ts_ms != null);
  if (!withTs.length) return null;
  let newest = withTs[0];
  let oldest = withTs[0];
  for (const r of withTs) {
    if (r.ts_ms > newest.ts_ms) newest = r;
    if (r.ts_ms < oldest.ts_ms) oldest = r;
  }
  const zone = getMoobizDefaultTimezone();
  return {
    newest_normalized_utc_iso: newest.normalized_utc_iso,
    newest_lima_iso: DateTime.fromISO(newest.normalized_utc_iso, { zone: "utc" })
      .setZone(zone)
      .toISO(),
    oldest_normalized_utc_iso: oldest.normalized_utc_iso,
    oldest_lima_iso: DateTime.fromISO(oldest.normalized_utc_iso, { zone: "utc" })
      .setZone(zone)
      .toISO(),
  };
}

/**
 * Extracción paginada con corte por umbral (frozen_now − stop_days).
 * @param {object} options
 */
async function syncMoobizHistoryExtraction(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const zone = getMoobizDefaultTimezone();
  const run_id = cfg.run_id || randomUUID();
  const runStartMs = Date.now();

  const frozen = DateTime.utc();
  const frozen_now_utc = frozen.toISO();
  const stop_threshold_utc = frozen.minus({ days: cfg.stop_days }).toISO();
  const stop_threshold_ms = Date.parse(stop_threshold_utc);

  const state = {
    run_id,
    metadata: {
      frozen_now_utc,
      stop_threshold_utc,
      stopped_at_frozen_now: true,
      stop_days: cfg.stop_days,
      limit: cfg.limit,
    },
    per_page: [],
    errors: [],
    collectedParsed: [],
    batchBuffer: [],
    total_rows_fetched: 0,
    discarded_by_threshold: 0,
    pages_requested: 0,
    pages_successful: 0,
    rows_persisted: 0,
    dry_run_batches: 0,
    stop_reason: null,
    partial_path: null,
    output_path: cfg.output_path || null,
  };

  const flushPendingBatch = async (opts) => {
    const out = await flushBatch(cfg, state, state.batchBuffer, opts);
    state.batchBuffer = [];
    return out;
  };

  for (let page = 1; page <= cfg.max_pages_safety; page += 1) {
    if (page > 1) await sleep(cfg.pause_ms);
    state.pages_requested += 1;

    const res = await fetchServicesPageExtraction(cfg, page);

    const entry = {
      page_number: page,
      http_status: res.http_status ?? null,
      elapsed_ms: res.elapsed_ms ?? null,
      items_count: res.items_count ?? 0,
      body_bytes: res.body_bytes ?? null,
      retries: res.retries ?? 0,
      headers: res.headers ?? null,
      error: res.error ?? null,
      truncated: false,
      last_page_truncated_by_threshold: false,
    };

    if (res.error || res.http_status !== 200) {
      state.errors.push({ page_number: page, ...res });
      state.per_page.push(entry);
      state.stop_reason = res.fatal ? "error" : "error";
      break;
    }

    state.pages_successful += 1;
    const rawRows = res.rows || [];
    state.total_rows_fetched += rawRows.length;

    if (state.total_rows_fetched > cfg.abort_if_too_many_rows) {
      state.stop_reason = "too_much_data";
      state.per_page.push(entry);
      break;
    }

    const parsed = rawRows.map((it) => parseItem(it, zone));
    const { valid, discarded, shouldStop } = splitPageRowsByThreshold(
      parsed,
      stop_threshold_ms,
    );

    entry.valid_in_page = valid.length;
    entry.discarded_in_page = discarded;
    entry.first_item = boundaryItem(parsed[0]);
    entry.last_item = boundaryItem(parsed[parsed.length - 1]);
    entry.first_item_ts_ms = parsed[0]?.ts_ms ?? null;
    entry.last_item_ts_ms = parsed[parsed.length - 1]?.ts_ms ?? null;
    entry.first_10_items = parsed.slice(0, 10).map(publicItem);
    entry.last_10_items = parsed.slice(-10).map(publicItem);

    if (page === 1 && valid.length === 0 && parsed.length > 0) {
      state.discarded_by_threshold += discarded;
      state.stop_reason = "no_new_data_since_threshold";
      state.per_page.push(entry);
      break;
    }

    state.batchBuffer.push(...valid);
    state.discarded_by_threshold += discarded;

    if (shouldStop) {
      entry.truncated = true;
      entry.last_page_truncated_by_threshold = true;
      state.stop_reason = "threshold_reached";
      state.per_page.push(entry);
      break;
    }

    state.per_page.push(entry);

    if (rawRows.length < cfg.limit) {
      state.stop_reason = "exhausted_pages";
      break;
    }

    if (page % cfg.batch_pages === 0) {
      await flushPendingBatch({ reason: "batch_checkpoint" });
      writeCheckpoint(cfg, state);
    }

    if (page >= cfg.max_pages_safety) {
      state.stop_reason = "max_pages_safety";
      break;
    }
  }

  if (!state.stop_reason && state.pages_requested >= cfg.max_pages_safety) {
    state.stop_reason = "max_pages_safety";
  }

  const partialPersist =
    state.stop_reason === "max_pages_safety" ||
    state.stop_reason === "too_much_data" ||
    state.stop_reason === "threshold_reached" ||
    state.stop_reason === "exhausted_pages" ||
    state.stop_reason === "no_new_data_since_threshold";

  const graveError = state.stop_reason === "error";

  if (partialPersist && !graveError && state.batchBuffer.length > 0) {
    await flushPendingBatch({ reason: "final_flush", partial_success: true });
  } else if (!graveError && state.batchBuffer.length > 0 && state.stop_reason) {
    await flushPendingBatch({ reason: "final_flush" });
  }

  if (state.pages_successful > 0 && state.pages_successful % cfg.batch_pages !== 0) {
    writeCheckpoint(cfg, state);
  }

  const total_elapsed_ms = Date.now() - runStartMs;
  const latencies = state.per_page.map((p) => p.elapsed_ms).filter((n) => typeof n === "number");
  const sortedLat = [...latencies].sort((a, b) => a - b);
  const avg_latency_ms_per_page = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  const idCounts = new Map();
  for (const r of state.collectedParsed) {
    idCounts.set(r.id, (idCounts.get(r.id) || 0) + 1);
  }
  const duplicate_count_collected = state.collectedParsed.length - idCounts.size;

  const report = {
    metadata: {
      ...state.metadata,
      pages_requested: state.pages_requested,
      pages_successful: state.pages_successful,
      total_elapsed_ms,
      run_mode: cfg.run_mode,
      run_id,
    },
    confirmations: {
      no_db_write: cfg.run_mode === "dry_run",
      no_token_on_disk: true,
      no_sync_script: cfg.run_mode === "dry_run",
    },
    per_page: state.per_page,
    global: {
      total_rows_fetched: state.total_rows_fetched,
      collected_items_count: state.collectedParsed.length,
      discarded_by_threshold_count: state.discarded_by_threshold,
      unique_ids_collected_count: idCounts.size,
      duplicate_count_collected,
      coverage_span_of_collected: buildCoverage(state.collectedParsed),
      stop_reason: state.stop_reason,
      rows_persisted: state.rows_persisted,
      duplicate_rate:
        state.collectedParsed.length > 0
          ? Number((duplicate_count_collected / state.collectedParsed.length).toFixed(4))
          : 0,
    },
    performance: {
      avg_latency_ms_per_page,
      p95_latency_ms: percentile(sortedLat, 95),
      top_10_slowest_pages: [...state.per_page]
        .filter((p) => typeof p.elapsed_ms === "number")
        .sort((a, b) => b.elapsed_ms - a.elapsed_ms)
        .slice(0, 10)
        .map((p) => ({ page: p.page_number, elapsed_ms: p.elapsed_ms })),
      pages_processed: state.pages_successful,
      runtime_ms: total_elapsed_ms,
      last_processed_ts: buildCoverage(state.collectedParsed)?.newest_normalized_utc_iso ?? null,
    },
    errors: state.errors,
    recommendations: [
      "Mantener corte en cliente (ts > stop_threshold) y dedupe Map(byId) por lote.",
      "No usar date_from/date_to del API para ventanas; limit=200 probado en simulaciones.",
      "Monitorear duplicate_rate y stop_reason; alertar si too_much_data o max_pages_safety.",
    ],
    partial_path: state.partial_path,
    output_path: cfg.output_path,
    audit: {
      run_id,
      started_at: new Date(runStartMs).toISOString(),
      frozen_now_utc,
      stop_threshold_utc,
      pages_requested: state.pages_requested,
      pages_successful: state.pages_successful,
      rows_fetched: state.total_rows_fetched,
      rows_persisted: state.rows_persisted,
      duplicates: duplicate_count_collected,
      stop_reason: state.stop_reason,
      output_path: cfg.output_path,
      partial_path: state.partial_path,
    },
  };

  if (cfg.output_path) {
    try {
      mkdirSync(cfg.tmpDir || "./tmp", { recursive: true });
      writeFileSync(cfg.output_path, JSON.stringify(report, null, 2), "utf8");
    } catch (e) {
      report.output_write_error = e.message;
    }
  }

  if (cfg.auditPath) {
    try {
      writeFileSync(cfg.auditPath, JSON.stringify(report.audit, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }

  return report;
}

module.exports = {
  syncMoobizHistoryExtraction,
  splitPageRowsByThreshold,
  dedupeRawItemsKeepLatest,
  parseItem,
  extractItemsFromBody,
  DEFAULTS,
};
