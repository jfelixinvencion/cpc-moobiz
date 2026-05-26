import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseMoobizDateAsUTC,
  parseMoobizDateToMillis,
  isIsoLikeDateString,
  getMoobizDefaultTimezone,
} = require("../helpers/moobiz-dates.js");

test("parseMoobizDateAsUTC: Lima local sin Z → UTC Z", () => {
  const out = parseMoobizDateAsUTC("2026-05-25 12:46:41", "America/Lima");
  assert.equal(out, "2026-05-25T17:46:41.000Z");
});

test("parseMoobizDateAsUTC: ISO con Z se conserva en UTC", () => {
  const out = parseMoobizDateAsUTC("2026-05-22T19:25:37.000Z");
  assert.equal(out, "2026-05-22T19:25:37.000Z");
});

test("parseMoobizDateAsUTC: ISO con offset", () => {
  const out = parseMoobizDateAsUTC("2026-05-25T12:46:41-05:00");
  assert.equal(out, "2026-05-25T17:46:41.000Z");
});

test("isIsoLikeDateString detecta T y Z", () => {
  assert.equal(isIsoLikeDateString("2026-05-25 12:46:41"), false);
  assert.equal(isIsoLikeDateString("2026-05-25T12:46:41.000Z"), true);
});

test("parseMoobizDateToMillis convierte Lima local a millis UTC", () => {
  const limaAsUtc = parseMoobizDateToMillis("2026-05-25 12:46:41");
  assert.equal(limaAsUtc, Date.parse("2026-05-25T17:46:41.000Z"));
});

test("getMoobizDefaultTimezone respeta DEFAULT_TIMEZONE", () => {
  const prev = process.env.DEFAULT_TIMEZONE;
  process.env.DEFAULT_TIMEZONE = "America/Lima";
  try {
    assert.equal(getMoobizDefaultTimezone(), "America/Lima");
  } finally {
    if (prev === undefined) delete process.env.DEFAULT_TIMEZONE;
    else process.env.DEFAULT_TIMEZONE = prev;
  }
});
