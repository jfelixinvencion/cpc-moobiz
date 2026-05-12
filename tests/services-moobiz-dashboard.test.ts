import test from "node:test";
import assert from "node:assert/strict";

import {
  parseServicesMoobizParams,
  ymToMmmYy,
} from "../src/lib/services-moobiz-dashboard-params.ts";

test("parseServicesMoobizParams: defaults y arrays", () => {
  const u = new URLSearchParams();
  u.set("granularity", "monthly");
  u.append("estados", " A ");
  u.append("sucursal", "LIMA");
  u.append("conductor_category", "AFILIADO");
  u.append("months", "2026-05");
  const p = parseServicesMoobizParams(u);
  assert.equal(p.granularity, "monthly");
  assert.deepEqual(p.estados, ["A"]);
  assert.deepEqual(p.sucursales, ["LIMA"]);
  assert.deepEqual(p.conductorCategories, ["AFILIADO"]);
  assert.deepEqual(p.months, ["2026-05"]);
});

test("ymToMmmYy produce etiqueta mmm-yy en minúsculas", () => {
  const s = ymToMmmYy("2026-05");
  assert.match(s, /^may-26$/i);
});
