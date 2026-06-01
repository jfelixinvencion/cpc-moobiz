import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSummaryFromServices,
  empresaDisplayName,
  empresaRowKey,
  moobizActivesCompanyUrl,
  UNKNOWN_COMPANY_ID,
} from "../src/lib/clientes-operaciones-map.ts";
import type { ClientesOperacionesServiceRow } from "../src/lib/clientes-operaciones-types.ts";

test("empresaRowKey prefers co_id and falls back to name", () => {
  assert.equal(empresaRowKey("42", "Acme"), "42");
  assert.equal(empresaRowKey("", "Acme"), `${UNKNOWN_COMPANY_ID}:Acme`);
});

test("moobizActivesCompanyUrl builds id_company link", () => {
  assert.equal(
    moobizActivesCompanyUrl("99"),
    "https://app.moobiz.pe/actives?id_company=99",
  );
  assert.equal(moobizActivesCompanyUrl(""), null);
  assert.equal(moobizActivesCompanyUrl(UNKNOWN_COMPANY_ID), null);
});

test("empresaDisplayName uses co_name or fallback", () => {
  assert.equal(empresaDisplayName("Foo S.A.", "1"), "Foo S.A.");
  assert.equal(empresaDisplayName("", "7"), "Empresa 7");
});

test("buildSummaryFromServices aggregates by empresa, hour and estado", () => {
  const rows: ClientesOperacionesServiceRow[] = [
    {
      id: 1,
      co_id: "10",
      co_name: "Beta",
      estado: "Pendiente",
      fecha: "2026-05-30T14:15:00.000Z",
      fecha_registro: "",
      dr_id: null,
      producto: "Taxi",
    },
    {
      id: 2,
      co_id: "10",
      co_name: "Beta",
      estado: "Pendiente",
      fecha: "2026-05-30T14:45:00.000Z",
      fecha_registro: "",
      dr_id: "drv-1",
      producto: "Taxi",
    },
    {
      id: 3,
      co_id: "10",
      co_name: "Beta",
      estado: "Aceptado",
      fecha: "2026-05-30T14:30:00.000Z",
      fecha_registro: "",
      dr_id: null,
      producto: "Taxi",
    },
  ];
  const summary = buildSummaryFromServices(rows);
  const pendiente = summary.find((s) => s.estado === "Pendiente");
  assert.ok(pendiente);
  assert.equal(pendiente!.servicios_count, 2);
  assert.equal(pendiente!.co_name, "Beta");
});
