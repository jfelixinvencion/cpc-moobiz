import assert from "node:assert/strict";
import test from "node:test";

import {
  SOLICITANTE_FILTER_ALL,
  SOLICITANTE_FILTER_EMPTY,
  buildSolicitanteFilterOptions,
  rowMatchesSolicitanteFilter,
} from "../../src/lib/control-operaciones-solicitante-tm-tt.ts";

const opMap = new Map<string, string>([
  ["1", "Ana"],
  ["2", "Bruno"],
]);

test("buildSolicitanteFilterOptions une TM y TT (etiquetas únicas)", () => {
  const opts = buildSolicitanteFilterOptions({
    controlById: {
      a: { solicitante_tm: "1", solicitante_tt: "2", observacion: null },
      b: { solicitante_tm: "1", solicitante_tt: null, observacion: null },
    },
    operatorLabelByValue: opMap,
  });
  const labels = opts.filter((o) => o.value !== SOLICITANTE_FILTER_ALL && o.value !== SOLICITANTE_FILTER_EMPTY);
  assert.deepEqual(
    labels.map((o) => o.label).sort((x, y) => x.localeCompare(y, "es")),
    ["Ana", "Bruno"],
  );
});

test("rowMatchesSolicitanteFilter: OR entre TM y TT por etiqueta", () => {
  const cell = { solicitante_tm: "1", solicitante_tt: null, observacion: null };
  assert.equal(
    rowMatchesSolicitanteFilter({
      solicitanteFilter: "Bruno",
      cell,
      operatorLabelByValue: opMap,
    }),
    false,
  );
  assert.equal(
    rowMatchesSolicitanteFilter({
      solicitanteFilter: "Ana",
      cell,
      operatorLabelByValue: opMap,
    }),
    true,
  );
  const cell2 = { solicitante_tm: null, solicitante_tt: "2", observacion: null };
  assert.equal(
    rowMatchesSolicitanteFilter({
      solicitanteFilter: "Bruno",
      cell: cell2,
      operatorLabelByValue: opMap,
    }),
    true,
  );
});

test("rowMatchesSolicitanteFilter: Vacíos solo si ambas columnas vacías", () => {
  assert.equal(
    rowMatchesSolicitanteFilter({
      solicitanteFilter: SOLICITANTE_FILTER_EMPTY,
      cell: { solicitante_tm: "1", solicitante_tt: null, observacion: null },
      operatorLabelByValue: opMap,
    }),
    false,
  );
  assert.equal(
    rowMatchesSolicitanteFilter({
      solicitanteFilter: SOLICITANTE_FILTER_EMPTY,
      cell: { solicitante_tm: null, solicitante_tt: null, observacion: "x" },
      operatorLabelByValue: opMap,
    }),
    true,
  );
});

test("rowMatchesSolicitanteFilter: Todos acepta cualquier fila", () => {
  assert.equal(
    rowMatchesSolicitanteFilter({
      solicitanteFilter: SOLICITANTE_FILTER_ALL,
      cell: undefined,
      operatorLabelByValue: opMap,
    }),
    true,
  );
});
