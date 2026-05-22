import assert from "node:assert/strict";
import test from "node:test";

import {
  SOLICITANTE_API_TODOS,
  SOLICITANTE_API_VACIOS,
  apiSolicitanteValuesToSelectOptions,
  ilikeContainsPatterns,
  normalizeSolicitanteFilterParams,
} from "../../src/lib/control-operaciones-solicitante-filter-query.ts";
import {
  SOLICITANTE_FILTER_ALL,
  SOLICITANTE_FILTER_EMPTY,
} from "../../src/lib/control-operaciones-solicitante-tm-tt.ts";

test("ilikeContainsPatterns escapa comodines y envuelve con %", () => {
  assert.deepEqual(ilikeContainsPatterns(["CARLOS"]), ["%CARLOS%"]);
  assert.deepEqual(ilikeContainsPatterns(["a%b_c"]), ["%a\\%b\\_c%"]);
});

test("normalizeSolicitanteFilterParams ignora Todos", () => {
  assert.deepEqual(
    normalizeSolicitanteFilterParams([SOLICITANTE_FILTER_ALL, "  Ana  "]),
    ["Ana"],
  );
});

test("apiSolicitanteValuesToSelectOptions mapea Todos y VACÍOS", () => {
  const opts = apiSolicitanteValuesToSelectOptions([
    SOLICITANTE_API_TODOS,
    SOLICITANTE_API_VACIOS,
    "CARLOS CAYO",
  ]);
  assert.equal(opts[0]?.value, SOLICITANTE_FILTER_ALL);
  assert.equal(opts[1]?.value, SOLICITANTE_FILTER_EMPTY);
  assert.equal(opts[1]?.label, SOLICITANTE_API_VACIOS);
  assert.ok(opts.some((o) => o.label === "CARLOS CAYO"));
});
