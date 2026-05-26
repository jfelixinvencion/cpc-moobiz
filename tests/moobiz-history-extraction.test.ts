import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  splitPageRowsByThreshold,
  dedupeRawItemsKeepLatest,
  parseItem,
} = require("../helpers/moobiz-history-extraction.js");
const { parseMoobizDateAsUTC } = require("../helpers/moobiz-dates.js");

const THRESHOLD_MS = Date.parse("2026-05-21T12:00:00.000Z");

function raw(id: string, dateUpdated: string) {
  return { id, date_updated: dateUpdated };
}

test("parseItem: America/Lima → normalized UTC", () => {
  const row = parseItem(raw("1", "2026-05-25 12:00:00"), "America/Lima");
  assert.equal(row.normalized_utc_iso, parseMoobizDateAsUTC("2026-05-25 12:00:00", "America/Lima"));
  assert.ok(row.ts_ms && row.ts_ms > THRESHOLD_MS);
});

test("splitPageRowsByThreshold: trunca cuando last <= threshold", () => {
  const parsed = [
    parseItem(raw("a", "2026-05-25 10:00:00"), "America/Lima"),
    parseItem(raw("b", "2026-05-20 08:00:00"), "America/Lima"),
  ];
  const { valid, discarded, shouldStop } = splitPageRowsByThreshold(parsed, THRESHOLD_MS);
  assert.equal(valid.length, 1);
  assert.equal(discarded, 1);
  assert.equal(shouldStop, true);
});

test("splitPageRowsByThreshold: todos válidos si last > threshold", () => {
  const parsed = [
    parseItem(raw("a", "2026-05-25 10:00:00"), "America/Lima"),
    parseItem(raw("b", "2026-05-22 10:00:00"), "America/Lima"),
  ];
  const { valid, shouldStop } = splitPageRowsByThreshold(parsed, THRESHOLD_MS);
  assert.equal(valid.length, 2);
  assert.equal(shouldStop, false);
});

test("dedupeRawItemsKeepLatest: conserva el timestamp más reciente por id", () => {
  const older = parseItem(raw("99", "2026-05-22 08:00:00"), "America/Lima");
  const newer = parseItem(raw("99", "2026-05-25 18:00:00"), "America/Lima");
  const out = dedupeRawItemsKeepLatest([older, newer, older]);
  assert.equal(out.length, 1);
  assert.equal(out[0].normalized_utc_iso, newer.normalized_utc_iso);
});
