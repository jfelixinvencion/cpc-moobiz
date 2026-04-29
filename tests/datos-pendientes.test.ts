import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDatosPendientesQueryParams,
  DATOS_PENDIENTES_COLUMNS,
  normalizeSortDir,
  normalizeSortKey,
} from "../src/lib/datos-pendientes.ts";

test("render contract: columnas de Datos Pendientes en orden exacto", () => {
  const labels = DATOS_PENDIENTES_COLUMNS.map((c) => c.label);
  assert.deepEqual(labels, [
    "ID Conductor",
    "Nombre Conductor",
    "N Servicios <30",
    "Sucursal",
    "En que distrito vive",
    "Turno",
    "Vencimiento de Brevete",
    "Vencimiento de Revisión Técnica",
    "Vencimiento de SOAT",
    "Tipo de Contribuyente",
    "Marcar si Moobiz realiza su contabilidad",
    "Número Ruc Factura",
    "Usuario Sunat",
    "Clave Sol Sunat",
    "Estado",
  ]);
});

test("integration contract: query params aplican filtro + paginación + sort server-side", () => {
  const query = buildDatosPendientesQueryParams({
    page: 3,
    pageSize: 50,
    sucursalFilter: "Sede Centro",
    estadoFilter: "Pendiente",
    searchText: "juan",
    sortBy: "n_servicios_lt_30",
    sortDir: "desc",
  });

  const p = new URLSearchParams(query);
  assert.equal(p.get("page"), "3");
  assert.equal(p.get("pageSize"), "50");
  assert.equal(p.get("sucursal"), "Sede Centro");
  assert.equal(p.get("estado"), "Pendiente");
  assert.equal(p.get("search"), "juan");
  assert.equal(p.get("sortBy"), "n_servicios_lt_30");
  assert.equal(p.get("sortDir"), "desc");
});

test("normalizadores de sort usan defaults seguros", () => {
  assert.equal(normalizeSortDir("ASC"), "asc");
  assert.equal(normalizeSortDir("random"), "desc");
  assert.equal(normalizeSortKey("nombre_conductor"), "nombre_conductor");
  assert.equal(normalizeSortKey("foo"), "n_servicios_lt_30");
});
