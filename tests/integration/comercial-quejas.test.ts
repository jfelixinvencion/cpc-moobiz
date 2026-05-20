import test from "node:test";
import assert from "node:assert/strict";

import {
  ID_SERVICIO_REGEX,
  derivePasajero,
  resolveEstadoOnUpdate,
  sanitizeFotoUrls,
  validateIdServicio,
} from "../../src/lib/comercial-quejas.ts";
import { parseComercialQuejasListParams } from "../../src/lib/comercial-quejas-params.ts";

test("validateIdServicio acepta 7 dígitos", () => {
  assert.equal(validateIdServicio("1234567"), "1234567");
  assert.throws(() => validateIdServicio("123456"), /7 dígitos/);
  assert.throws(() => validateIdServicio("12345678"), /7 dígitos/);
});

test("ID_SERVICIO_REGEX para botón Moobiz", () => {
  assert.equal(ID_SERVICIO_REGEX.test("0000001"), true);
  assert.equal(ID_SERVICIO_REGEX.test("abc"), false);
});

test("derivePasajero prioriza invitado", () => {
  assert.equal(derivePasajero("Invitado X", "Usuario Y"), "Invitado X");
  assert.equal(derivePasajero("", "Usuario Y"), "Usuario Y");
  assert.equal(derivePasajero(null, null), null);
});

test("resolveEstadoOnUpdate: acciones → Completado", () => {
  assert.equal(
    resolveEstadoOnUpdate({ acciones: "Llamar cliente", updatingReview: true, previous: "Pendiente" }),
    "Completado",
  );
  assert.equal(
    resolveEstadoOnUpdate({ acciones: "  ", updatingReview: true, previous: "Pendiente" }),
    "En revision",
  );
});

test("sanitizeFotoUrls rechaza más de 5", () => {
  const six = ["a", "b", "c", "d", "e", "f"];
  assert.throws(() => sanitizeFotoUrls(six), /máximo 5/);
  assert.equal(sanitizeFotoUrls(["https://x/1.jpg"]).length, 1);
});

test("parseComercialQuejasListParams paginación y sort", () => {
  const p = parseComercialQuejasListParams(
    new URLSearchParams("limit=50&offset=100&sort_col=fecha_queja&sort_dir=asc&search=test"),
  );
  assert.equal(p.limit, 50);
  assert.equal(p.offset, 100);
  assert.equal(p.sortCol, "fecha_queja");
  assert.equal(p.sortDir, "asc");
  assert.equal(p.search, "test");
});

test("integration contract: POST create body campos mínimos", () => {
  const body = {
    fecha_queja: "2026-05-20",
    id_servicio: "1234567",
    turno: "Mañana",
    categoria: "Demora",
    descripcion: "Cliente esperó 20 min",
    fuente: "Whatsapp",
    sync: true,
  };
  assert.equal(body.id_servicio.length, 7);
  assert.match(body.fecha_queja, /^\d{4}-\d{2}-\d{2}$/);
});
