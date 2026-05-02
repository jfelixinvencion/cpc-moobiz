import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCount,
  normalizeDriverPendienteRow,
  normalizeDriverPendienteRows,
  normalizeDriverPendienteRowsFromVistaLabels,
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

test("mapea filas de vista con etiquetas legibles a campos del frontend", () => {
  const rows = normalizeDriverPendienteRowsFromVistaLabels([
    {
      "ID Conductor": 99,
      "Nombre Conductor": "María López",
      GLOBAL: "LIMA",
      "N Servicios <30": "3",
      Sucursal: "Centro",
      "En que distrito vive": "Lima",
      Turno: "Mañana",
      "Vencimiento de Brevete": "2026-01-01",
      "Vencimiento de Revisión Técnica": "2026-02-01",
      "Vencimiento de SOAT": "2026-03-01",
      "Tipo de Contribuyente": "RUC",
      "Marcar si Moobiz realiza su contabilidad": "Sí",
      "Número Ruc Factura": "20123456789",
      "Usuario Sunat": "user",
      "Clave Sol Sunat": "***",
      Estado: "Pendiente",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id_conductor, "99");
  assert.equal(rows[0].nombre_conductor, "María López");
  assert.equal(rows[0].global, "LIMA");
  assert.equal(rows[0].n_servicios_lt_30, 3);
  assert.equal(rows[0].sucursal, "Centro");
  assert.equal(rows[0].distrito_vive, "Lima");
  assert.equal(rows[0].marca_contabilidad_moobiz, "Sí");
  assert.equal(rows[0].estado, "Pendiente");
});

test("contrato filtro GLOBAL: todas las filas normalizadas comparten el mismo valor GLOBAL", () => {
  const rows = normalizeDriverPendienteRowsFromVistaLabels([
    {
      "ID Conductor": 1,
      "Nombre Conductor": "A",
      GLOBAL: "LIMA",
      "N Servicios <30": 0,
      Sucursal: "X",
      "En que distrito vive": "",
      Turno: "",
      "Vencimiento de Brevete": "",
      "Vencimiento de Revisión Técnica": "",
      "Vencimiento de SOAT": "",
      "Tipo de Contribuyente": "",
      "Marcar si Moobiz realiza su contabilidad": "",
      "Número Ruc Factura": "",
      "Usuario Sunat": "",
      "Clave Sol Sunat": "",
      Estado: "Pendiente",
    },
    {
      "ID Conductor": 2,
      "Nombre Conductor": "B",
      GLOBAL: "LIMA",
      "N Servicios <30": 1,
      Sucursal: "Y",
      "En que distrito vive": "",
      Turno: "",
      "Vencimiento de Brevete": "",
      "Vencimiento de Revisión Técnica": "",
      "Vencimiento de SOAT": "",
      "Tipo de Contribuyente": "",
      "Marcar si Moobiz realiza su contabilidad": "",
      "Número Ruc Factura": "",
      "Usuario Sunat": "",
      "Clave Sol Sunat": "",
      Estado: "Pendiente",
    },
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.global === "LIMA"));
});
