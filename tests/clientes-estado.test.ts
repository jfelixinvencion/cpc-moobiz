/**
 * COPIA INDEPENDIENTE: tests para Clientes (copiados de lógica Seguimiento en clientes-estado).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalClientesEstado,
  colorForClientesEstado,
  sortEstadosForLegend,
} from "../src/lib/clientes-estado.ts";

test("canonicalClientesEstado matches case-sensitive SQL names", () => {
  assert.equal(canonicalClientesEstado("Aceptado"), "Aceptado");
  assert.equal(canonicalClientesEstado("En camino"), "En camino");
  assert.equal(canonicalClientesEstado("aceptado"), null);
});

test("colorForClientesEstado returns palette or fallback", () => {
  assert.equal(colorForClientesEstado("Aceptado"), "#333333");
  assert.equal(colorForClientesEstado("unknown"), "#64748b");
});

test("sortEstadosForLegend uses UI order", () => {
  const sorted = sortEstadosForLegend(["Llegado", "Aceptado", "En camino"]);
  assert.deepEqual(sorted, ["Aceptado", "En camino", "Llegado"]);
});
