import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCount,
  normalizeDriverPendienteRow,
  normalizeDriverPendienteRows,
} from "../src/lib/moobiz-drivers-pendientes-normalize.ts";

test("normaliza una fila válida de drivers pendientes", () => {
  const row = normalizeDriverPendienteRow({
    id_conductor: 123,
    nombre_conductor: "Juan Perez",
    n_servicios_lt_30: "7",
    estado: "Pendiente",
  });
  assert.equal(row.id_conductor, "123");
  assert.equal(row.nombre_conductor, "Juan Perez");
  assert.equal(row.n_servicios_lt_30, 7);
  assert.equal(row.estado, "Pendiente");
});

test("normaliza data array unknown a DriverPendienteRow[]", () => {
  const rows = normalizeDriverPendienteRows([{ nombre_conductor: "Ana", n_servicios_lt_30: 1 }]);
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nombre_conductor, "Ana");
});

test("si supabase devuelve GenericStringError[] no rompe y mapea seguro", () => {
  const rows = normalizeDriverPendienteRows([{ message: "something bad", details: "x" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nombre_conductor, null);
  assert.equal(rows[0].n_servicios_lt_30, 0);
});

test("si data no es array retorna [] y count se normaliza a number seguro", () => {
  assert.deepEqual(normalizeDriverPendienteRows({ foo: "bar" }), []);
  assert.equal(normalizeCount(10), 10);
  assert.equal(normalizeCount("20"), 20);
  assert.equal(normalizeCount("invalid"), 0);
});
