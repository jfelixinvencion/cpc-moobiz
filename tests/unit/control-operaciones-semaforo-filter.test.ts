import test from "node:test";
import assert from "node:assert/strict";

import {
  rowMatchesSemaforoMultiFilter,
  rowSemaforoBucket,
  SEMAFORO_MULTI_SIN,
} from "../../src/lib/control-operaciones-semaforo-filter.ts";

test("Sin semáforo: NULL, vacío y —", () => {
  for (const raw of [undefined, null, "", "  ", "—", "–", "-"]) {
    assert.equal(rowSemaforoBucket(raw), SEMAFORO_MULTI_SIN);
    assert.equal(rowMatchesSemaforoMultiFilter({ semaforo: raw }, [SEMAFORO_MULTI_SIN]), true);
  }
});

test("Sin semáforo + Verde combina buckets", () => {
  assert.equal(
    rowMatchesSemaforoMultiFilter({ semaforo: null }, [SEMAFORO_MULTI_SIN, "verde"]),
    true,
  );
  assert.equal(
    rowMatchesSemaforoMultiFilter({ semaforo: "Verde" }, [SEMAFORO_MULTI_SIN, "verde"]),
    true,
  );
  assert.equal(
    rowMatchesSemaforoMultiFilter({ semaforo: "Rojo" }, [SEMAFORO_MULTI_SIN, "verde"]),
    false,
  );
});
