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
  assert.equal(canonicalClientesEstado("Pendiente"), "Pendiente");
  assert.equal(canonicalClientesEstado("En camino"), "En camino");
  assert.equal(canonicalClientesEstado("aceptado"), null);
});

test("colorForClientesEstado returns palette or fallback", () => {
  assert.equal(colorForClientesEstado("Pendiente"), "#b8b8b8");
  assert.equal(colorForClientesEstado("Aceptado"), "#333333");
  assert.equal(colorForClientesEstado("Validar"), "#7c3aed");
  assert.notEqual(colorForClientesEstado("Otro estado"), colorForClientesEstado("Llegado"));
});

test("sortEstadosForLegend uses primary order then extras", () => {
  const sorted = sortEstadosForLegend([
    "Llegado",
    "Validar",
    "Pendiente",
    "Aceptado",
    "En camino",
  ]);
  assert.deepEqual(sorted, [
    "Pendiente",
    "Aceptado",
    "En camino",
    "Llegado",
    "Validar",
  ]);
});
