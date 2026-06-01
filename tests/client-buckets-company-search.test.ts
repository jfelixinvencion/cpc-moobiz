import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCompanySearchSuccess,
  initialCompanySearchUiState,
  pickCompanyOnEnter,
  shouldRunCompanySearch,
} from "../src/lib/client-buckets-company-search.ts";

test("shouldRunCompanySearch requires at least 2 characters", () => {
  assert.equal(shouldRunCompanySearch("F"), false);
  assert.equal(shouldRunCompanySearch("Fe"), true);
});

test("applyCompanySearchSuccess ignores stale request id", () => {
  const prev = { ...initialCompanySearchUiState(), isSearching: true };
  const next = applyCompanySearchSuccess(
    prev,
    1,
    2,
    [{ co_id: "1", co_name: "Fenix" }],
  );
  assert.equal(next.isSearching, true);
  assert.equal(next.options.length, 0);
});

test("applyCompanySearchSuccess applies when request id matches", () => {
  const prev = { ...initialCompanySearchUiState(), isSearching: true };
  const next = applyCompanySearchSuccess(
    prev,
    3,
    3,
    [{ co_id: "7", co_name: "Fenix Corp" }],
  );
  assert.equal(next.isSearching, false);
  assert.equal(next.options.length, 1);
  assert.equal(next.options[0]!.co_name, "Fenix Corp");
});

test("pickCompanyOnEnter prefers exact name match", () => {
  const options = [
    { co_id: "1", co_name: "Fenix Transport" },
    { co_id: "2", co_name: "Otra" },
  ];
  const pick = pickCompanyOnEnter(options, "Fenix Transport");
  assert.equal(pick?.co_id, "1");
});

test("stale response does not overwrite newer results (race simulation)", () => {
  let latest = 0;
  let ui = initialCompanySearchUiState();

  const reqSlow = ++latest;
  ui = { ...ui, isSearching: true };

  const reqFast = ++latest;
  ui = applyCompanySearchSuccess(ui, reqFast, latest, [
    { co_id: "9", co_name: "Fenix Final" },
  ]);

  ui = applyCompanySearchSuccess(ui, reqSlow, latest, [
    { co_id: "1", co_name: "Stale" },
  ]);

  assert.equal(ui.options[0]!.co_name, "Fenix Final");
});
