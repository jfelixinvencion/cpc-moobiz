import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDatosPendientesQueryParams,
  DATOS_PENDIENTES_COLUMNS,
  normalizeSortDir, normalizeSortKey,
  parseSortByToken,
  resolveDatosPendientesSort,
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
    sortBy: "n_servicios_30",
    sortDir: "desc",
  });

  const p = new URLSearchParams(query);
  assert.equal(p.get("page"), "3");
  assert.equal(p.get("pageSize"), "50");
  assert.equal(p.get("sucursal"), "Sede Centro");
  assert.equal(p.get("estado"), "Pendiente");
  assert.equal(p.get("search"), "juan");
  assert.equal(p.get("sortBy"), "n_servicios_30");
  assert.equal(p.get("sortDir"), "desc");
});

test("normalizadores de sort usan defaults seguros", () => {
  assert.equal(normalizeSortDir("ASC"), "asc");
  assert.equal(normalizeSortDir("random"), "desc");
  assert.equal(normalizeSortKey("nombre_conductor"), "nombre_conductor");
  assert.equal(normalizeSortKey("N Servicios <30"), "n_servicios_30");
  assert.equal(normalizeSortKey("foo"), "n_servicios_30");
});

test("parsea sortBy compuesto sin ejecutar tokens peligrosos", () => {
  const parsed = parseSortByToken("N Servicios <30.desc.nullslast");
  assert.equal(parsed.sortByRaw, "N Servicios <30");
  assert.equal(parsed.sortDirFromToken, "desc");
  assert.equal(parsed.nullsFromToken, "nullslast");
});

test("sort spec seguro: input peligroso cae a fallback permitido", () => {
  const spec = resolveDatosPendientesSort({
    rawSortBy: `foo.desc;drop table x;--`,
    rawSortDir: "asc",
  });
  assert.equal(spec.sortKey, "n_servicios_30");
  assert.equal(spec.orderColumn, "N Servicios <30");
  assert.equal(spec.sortDir, "desc");
  assert.equal(spec.usedFallback, true);
});

test("sort spec acepta claves compactas y amigables con nulls explícito", () => {
  const compact = resolveDatosPendientesSort({
    rawSortBy: "vencimiento_soat",
    rawSortDir: "desc",
    rawNulls: "nullsfirst",
  });
  assert.equal(compact.orderColumn, "Vencimiento de SOAT");
  assert.equal(compact.nulls, "nullsfirst");

  const friendly = resolveDatosPendientesSort({
    rawSortBy: "Nombre Conductor.asc.nullslast",
    rawSortDir: "desc",
  });
  assert.equal(friendly.sortKey, "nombre_conductor");
  assert.equal(friendly.sortDir, "asc");
  assert.equal(friendly.nulls, "nullslast");
});
