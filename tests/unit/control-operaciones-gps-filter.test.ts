import test from "node:test";
import assert from "node:assert/strict";

import {
  buildControlOperacionesFetchUrl,
  gpsTableLabelFromAvailability,
  rowMatchesGpsMultiFilter,
  GPS_TABLE_LABEL_DESCONECTADO,
  GPS_TABLE_LABEL_EN_LINEA,
  GPS_TABLE_LABEL_OCUPADO,
  GPS_TABLE_LABEL_RECIENTE,
} from "../../src/lib/control-operaciones-gps-filter.ts";

test("gpsTableLabelFromAvailability: online/busy/offline/null/undefined", () => {
  assert.equal(gpsTableLabelFromAvailability("online"), GPS_TABLE_LABEL_EN_LINEA);
  assert.equal(gpsTableLabelFromAvailability("busy"), GPS_TABLE_LABEL_OCUPADO);
  assert.equal(gpsTableLabelFromAvailability("offline"), GPS_TABLE_LABEL_RECIENTE);
  assert.equal(gpsTableLabelFromAvailability(null), GPS_TABLE_LABEL_DESCONECTADO);
  assert.equal(gpsTableLabelFromAvailability(undefined), GPS_TABLE_LABEL_DESCONECTADO);
});

test("rowMatchesGpsMultiFilter: sin selección acepta cualquier fila", () => {
  assert.equal(rowMatchesGpsMultiFilter([], GPS_TABLE_LABEL_EN_LINEA), true);
  assert.equal(rowMatchesGpsMultiFilter([], GPS_TABLE_LABEL_DESCONECTADO), true);
  assert.equal(rowMatchesGpsMultiFilter([], GPS_TABLE_LABEL_RECIENTE), true);
});

test("rowMatchesGpsMultiFilter: OR sobre varias etiquetas", () => {
  const sel = [GPS_TABLE_LABEL_EN_LINEA, GPS_TABLE_LABEL_OCUPADO];
  assert.equal(rowMatchesGpsMultiFilter(sel, GPS_TABLE_LABEL_EN_LINEA), true);
  assert.equal(rowMatchesGpsMultiFilter(sel, GPS_TABLE_LABEL_OCUPADO), true);
  assert.equal(rowMatchesGpsMultiFilter(sel, GPS_TABLE_LABEL_DESCONECTADO), false);
  assert.equal(rowMatchesGpsMultiFilter(sel, GPS_TABLE_LABEL_RECIENTE), false);
});

test("rowMatchesGpsMultiFilter: Reciente vs Desconectado", () => {
  assert.equal(rowMatchesGpsMultiFilter([GPS_TABLE_LABEL_RECIENTE], GPS_TABLE_LABEL_RECIENTE), true);
  assert.equal(rowMatchesGpsMultiFilter([GPS_TABLE_LABEL_RECIENTE], GPS_TABLE_LABEL_DESCONECTADO), false);
  assert.equal(rowMatchesGpsMultiFilter([GPS_TABLE_LABEL_DESCONECTADO], GPS_TABLE_LABEL_DESCONECTADO), true);
  assert.equal(rowMatchesGpsMultiFilter([GPS_TABLE_LABEL_DESCONECTADO], GPS_TABLE_LABEL_RECIENTE), false);
});

test("buildControlOperacionesFetchUrl: vacío no añade gps", () => {
  assert.equal(buildControlOperacionesFetchUrl([]), "/api/control-operaciones");
});

test("buildControlOperacionesFetchUrl: múltiples gps en query (para refetch con filtro activo)", () => {
  const url = buildControlOperacionesFetchUrl(["En linea", "Ocupado"]);
  const u = new URL(url, "https://example.test");
  assert.equal(u.pathname, "/api/control-operaciones");
  assert.deepEqual(u.searchParams.getAll("gps"), ["En linea", "Ocupado"]);
});

test("buildControlOperacionesFetchUrl incluye Reciente y Desconectado", () => {
  const url = buildControlOperacionesFetchUrl(["Reciente", "Desconectado"]);
  const u = new URL(url, "https://example.test");
  assert.deepEqual(u.searchParams.getAll("gps"), ["Reciente", "Desconectado"]);
});

test("simulación: al armar URL de refetch tras elegir filtro multi, se conservan los valores en español", () => {
  const selected = [GPS_TABLE_LABEL_EN_LINEA, GPS_TABLE_LABEL_OCUPADO];
  const url = buildControlOperacionesFetchUrl(selected);
  assert.match(url, /gps=En(\+|%20)linea/);
  assert.match(url, /gps=Ocupado/);
});
