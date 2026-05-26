import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";

import {
  appendProductividadParams,
  isoInputToFechaParam,
  normalizeFechaParam,
  parseProductividadParams,
} from "../src/lib/productividad-logs-params.ts";
import {
  buildProductividadWhere,
  runProductividadByDate,
  runProductividadByDateHour,
  runProductividadCards,
  runProductividadFilterOptions,
  runProductividadUserChart,
} from "../src/lib/productividad-logs-query.ts";
import {
  formatPerHour,
  perHourFromCntBuckets,
  pivotAndSortUserChartRows,
  resolveSortTypes,
  visibleTypesToLogNameParam,
} from "../src/lib/productividad-user-chart-transform.ts";

function mockPool(rows: unknown[] = []): Pool {
  return {
    query: async () => ({ rows }),
  } as unknown as Pool;
}

test("parseProductividadParams: fechas DD/MM/YYYY e ISO", () => {
  const u = new URLSearchParams();
  u.set("fecha_from", "01/05/2026");
  u.set("fecha_to", "2026-05-15");
  u.append("global", "LIMA");
  u.set("limit", "50");
  const p = parseProductividadParams(u);
  assert.equal(p.fechaFrom, "01/05/2026");
  assert.equal(p.fechaTo, "15/05/2026");
  assert.deepEqual(p.global, ["LIMA"]);
  assert.equal(p.limit, 50);
});

test("isoInputToFechaParam convierte para API", () => {
  assert.equal(isoInputToFechaParam("2026-05-01"), "01/05/2026");
  assert.equal(normalizeFechaParam("15/05/2026"), "15/05/2026");
});

test("buildProductividadWhere omite filtro en cascada", () => {
  const p = parseProductividadParams(
    new URLSearchParams("estado=Activo&n_semana=22"),
  );
  const all = buildProductividadWhere(p);
  const omitEstado = buildProductividadWhere(p, "estado");
  assert.match(all.sql, /"Estado"/);
  assert.doesNotMatch(omitEstado.sql, /"Estado"/);
  assert.match(omitEstado.sql, /"N_Semana"/);
});

test("parseProductividadParams weekdays ISO 1..7", () => {
  const p = parseProductividadParams(
    new URLSearchParams("weekday=1&weekday=3&weekday=9&weekday=2"),
  );
  assert.deepEqual(p.weekdays, [1, 2, 3]);
});

test("buildProductividadWhere aplica weekday y type_log_name opcionales", () => {
  const p = parseProductividadParams(
    new URLSearchParams("weekday=1&type_log_name=Creó&type_log_name=Asignó"),
  );
  const { sql, params } = buildProductividadWhere(p);
  assert.match(sql, /to_char\(to_date\("Fecha"/);
  assert.match(sql, /'ID'\)::int = ANY/);
  assert.ok(params.some((x) => Array.isArray(x) && x.includes(1)));
  assert.ok(
    params.some(
      (x) => Array.isArray(x) && (x as string[]).includes("Creó"),
    ),
  );
});

test("buildProductividadWhere aplica filtros implícitos Operador + 5 tipos", () => {
  const p = parseProductividadParams(
    new URLSearchParams("type_user=Admin&type_log_name=Otro"),
  );
  const { sql } = buildProductividadWhere(p);
  assert.match(sql, /"Tp_user"::text = 'Operador'/);
  assert.match(sql, /"Actividad"::text = ANY\(ARRAY\[/);
  assert.match(sql, /'Creó'/);
  assert.match(sql, /'Quitó'/);
  assert.doesNotMatch(sql, /\$1::text\[\].*type_user/);
});

test("smoke: runProductividadUserChart con pool mock (0+ filas)", async () => {
  const pool = mockPool([]);
  const parsed = parseProductividadParams(new URLSearchParams());
  const { rows, totalUsers } = await runProductividadUserChart(pool, parsed);
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 0);
  assert.equal(totalUsers, 0);
});

test("smoke: runProductividadCards con pool mock", async () => {
  const pool = mockPool([
    {
      total_creo: 0,
      buckets_creo: 0,
      total_solicito: 0,
      buckets_solicito: 0,
      total_asigno: 0,
      buckets_asigno: 0,
      total_modifico: 0,
      buckets_modifico: 0,
      total_quito: 0,
      buckets_quito: 0,
    },
  ]);
  const parsed = parseProductividadParams(new URLSearchParams());
  const cards = await runProductividadCards(pool, parsed);
  assert.equal(cards.length, 5);
  assert.equal(cards[0].ratio, 0);
});

test("smoke: runProductividadByDate y ByDateHour", async () => {
  const pool = mockPool([{ fecha: "01/05/2026", cnt: 3, hora: "10" }]);
  const parsed = parseProductividadParams(new URLSearchParams());
  const byDate = await runProductividadByDate(pool, parsed);
  const byDh = await runProductividadByDateHour(pool, parsed);
  assert.equal(Array.isArray(byDate), true);
  assert.equal(Array.isArray(byDh), true);
});

test("smoke: runProductividadFilterOptions devuelve array", async () => {
  const pool = mockPool([{ v: "Finalizado" }]);
  const parsed = parseProductividadParams(new URLSearchParams());
  const { values, sql } = await runProductividadFilterOptions(pool, parsed, "estado");
  assert.deepEqual(values, ["Finalizado"]);
  assert.match(sql, /"Estado"/);
});

test("appendProductividadParams no envía type_log_name si skip", () => {
  const p = parseProductividadParams(new URLSearchParams("type_log_name=Creó"));
  const qs = new URLSearchParams();
  appendProductividadParams(qs, p, { skipTypeLogName: true });
  assert.equal(qs.getAll("type_log_name").length, 0);
});

test("perHourFromCntBuckets y formatPerHour con buckets=0", () => {
  assert.equal(perHourFromCntBuckets(10, 4), 2.5);
  assert.equal(perHourFromCntBuckets(10, 0), 0);
  assert.equal(formatPerHour(10, 0), "-");
  assert.equal(formatPerHour(10, 4), "2.50/h");
});

test("orden dinámico: solo Asignó vs suma Asignó+Modificó", () => {
  const allVisible = Object.fromEntries(
    ["Creó", "Solicitó", "Asignó", "Modificó", "Quitó"].map((t) => [t, true]),
  ) as Record<string, boolean>;
  const onlyAsigno = { ...allVisible, "Creó": false, "Solicitó": false, Modificó: false, Quitó: false };
  const asignoMod = { ...allVisible, "Creó": false, "Solicitó": false, Quitó: false };

  const raw = [
    { us_name: "A", type_log_name: "Asignó", cnt: 10, buckets: 2, total_per_user: 10 },
    { us_name: "B", type_log_name: "Asignó", cnt: 50, buckets: 5, total_per_user: 60 },
    { us_name: "B", type_log_name: "Modificó", cnt: 10, buckets: 1, total_per_user: 60 },
    { us_name: "A", type_log_name: "Creó", cnt: 100, buckets: 10, total_per_user: 110 },
  ];

  const byAsigno = pivotAndSortUserChartRows(raw, onlyAsigno as never);
  assert.equal(byAsigno[0].us_name, "B");

  const bySum = pivotAndSortUserChartRows(raw, asignoMod as never);
  assert.equal(bySum[0].us_name, "B");

  const byTotal = pivotAndSortUserChartRows(raw, allVisible as never);
  assert.equal(byTotal[0].us_name, "A");
});

test("visibleTypesToLogNameParam: todos null, subset array", () => {
  const all = Object.fromEntries(
    ["Creó", "Solicitó", "Asignó", "Modificó", "Quitó"].map((t) => [t, true]),
  ) as Record<string, boolean>;
  assert.equal(visibleTypesToLogNameParam(all as never), null);
  const one = { ...all, "Solicitó": false, "Asignó": false, Modificó: false, Quitó: false };
  assert.deepEqual(visibleTypesToLogNameParam(one as never), ["Creó"]);
});

test("resolveSortTypes: ninguno activo equivale a orden por total", () => {
  const none = Object.fromEntries(
    ["Creó", "Solicitó", "Asignó", "Modificó", "Quitó"].map((t) => [t, false]),
  ) as Record<string, boolean>;
  assert.equal(resolveSortTypes(none as never), null);
});

test("parseProductividadParams sort_types", () => {
  const u = new URLSearchParams();
  u.append("sort_types", "Asignó");
  u.append("sort_types", "Modificó");
  const p = parseProductividadParams(u);
  assert.deepEqual(p.sortTypes, ["Asignó", "Modificó"]);
});
