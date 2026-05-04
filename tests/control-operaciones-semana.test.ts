import test from "node:test";
import assert from "node:assert/strict";
import { getISOWeek, getISOWeekYear, startOfISOWeek, subDays } from "date-fns";

import { semanaLabelLiquidaciones } from "../src/lib/control-operaciones-semana";

test("semanaLabelLiquidaciones usa ISO semana de (hoy - 7 días)", () => {
  const ref = new Date(2026, 4, 4, 12, 0, 0);
  const d7 = subDays(ref, 7);
  const expectedY = getISOWeekYear(d7);
  const expectedW = getISOWeek(d7);
  const label = semanaLabelLiquidaciones(ref);
  assert.ok(label.startsWith(`${expectedY}_Sem${String(expectedW).padStart(2, "0")}_`));
  assert.match(label, /^\d{4}_Sem\d{2}_\d{2}\.\d{2}_\d{2}\.\d{2}$/);
  assert.ok(label.includes("_"));
  assert.equal(startOfISOWeek(d7).getDay(), 1);
});
