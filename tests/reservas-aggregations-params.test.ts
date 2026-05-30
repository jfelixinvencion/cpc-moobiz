import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReservasAggregationParams,
  parseReservasGranularity,
} from "../src/lib/aggregations-reservas.ts";

test("parseReservasGranularity defaults to day", () => {
  assert.equal(parseReservasGranularity(null), "day");
  assert.equal(parseReservasGranularity("week"), "week");
  assert.equal(parseReservasGranularity("invalid"), "day");
});

test("parseReservasAggregationParams reads filters", () => {
  const sp = new URLSearchParams();
  sp.set("start", "2026-05-01T00:00:00.000Z");
  sp.set("end", "2026-05-31T23:59:59.000Z");
  sp.set("granularity", "hour");
  sp.set("semana", "2026_Sem21_18.05_24.05");
  sp.append("estado", "Finalizado");
  sp.append("chart2_estado", "Cancelado");
  sp.append("weekday", "1");
  sp.append("weekday", "5");

  const p = parseReservasAggregationParams(sp);
  assert.equal(p.granularity, "hour");
  assert.equal(p.semana, "2026_Sem21_18.05_24.05");
  assert.deepEqual(p.estado, ["Finalizado"]);
  assert.deepEqual(p.chart2Estado, ["Cancelado"]);
  assert.deepEqual(p.weekdays, [1, 5]);
});
