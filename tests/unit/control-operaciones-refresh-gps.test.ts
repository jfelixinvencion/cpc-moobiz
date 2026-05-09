import test from "node:test";
import assert from "node:assert/strict";

import {
  formatRefreshGpsToastSuccess,
  parseRefreshGpsRawJson,
  postRefreshGpsRaw,
  runRefreshGpsRawAndRefetch,
} from "../../src/lib/control-operaciones-refresh-gps.ts";

test("parseRefreshGpsRawJson acepta cuerpo ok con total/inserted", () => {
  const r = parseRefreshGpsRawJson({ ok: true, total: 10, inserted: 10, elapsed_ms: 5 }, true);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.total, 10);
    assert.equal(r.inserted, 10);
    assert.equal(r.elapsed_ms, 5);
  }
});

test("parseRefreshGpsRawJson devuelve error si ok false", () => {
  const r = parseRefreshGpsRawJson({ ok: false, error: "falló" }, false);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "falló");
});

test("formatRefreshGpsToastSuccess incluye inserted y total", () => {
  assert.match(formatRefreshGpsToastSuccess({ inserted: 3, total: 10 }), /inserted 3/);
  assert.match(formatRefreshGpsToastSuccess({ inserted: 3, total: 10 }), /total 10/);
});

test("postRefreshGpsRaw: mock fetch devuelve ok y números", async () => {
  const fetchImpl = async () =>
    ({
      ok: true,
      json: async () => ({ ok: true, total: 10, inserted: 10, elapsed_ms: 1 }),
    }) as Response;
  const r = await postRefreshGpsRaw(fetchImpl as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.total, 10);
    assert.equal(r.inserted, 10);
  }
});

test("runRefreshGpsRawAndRefetch invoca onSuccess tras éxito (refetch simulado)", async () => {
  let refetchCalls = 0;
  const fetchImpl = async () =>
    ({
      ok: true,
      json: async () => ({ ok: true, total: 10, inserted: 10 }),
    }) as Response;
  const r = await runRefreshGpsRawAndRefetch({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onSuccess: async () => {
      refetchCalls += 1;
    },
  });
  assert.equal(r.ok, true);
  assert.equal(refetchCalls, 1);
});

test("runRefreshGpsRawAndRefetch no llama onSuccess si falla", async () => {
  let refetchCalls = 0;
  const fetchImpl = async () =>
    ({
      ok: false,
      json: async () => ({ ok: false, error: "AUTH_REQUIRED" }),
    }) as Response;
  const r = await runRefreshGpsRawAndRefetch({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onSuccess: async () => {
      refetchCalls += 1;
    },
  });
  assert.equal(r.ok, false);
  assert.equal(refetchCalls, 0);
});
