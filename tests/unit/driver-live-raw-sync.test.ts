import test from "node:test";
import assert from "node:assert/strict";

import { runDriverLiveRawRefreshCore } from "../../src/lib/driver-live-raw-sync-core.ts";
import {
  extractItemsFromLiveVehiclesResponse,
  normalizeAvailabilityFromItem,
} from "../../src/lib/driver-live-vehicles-parse.ts";

type MonitorPayload = {
  status: string;
  records_procesados: number;
  records_inserted: number;
  reason_for_stop: string;
  pages_queried: number;
  error_message: string | null;
};

test("extractItemsFromLiveVehiclesResponse devuelve json.items cuando es array", () => {
  assert.deepEqual(extractItemsFromLiveVehiclesResponse({ items: [1, 2] }), [1, 2]);
  assert.deepEqual(extractItemsFromLiveVehiclesResponse({ items: "x" }), []);
  assert.deepEqual(extractItemsFromLiveVehiclesResponse(null), []);
});

test("normalizeAvailabilityFromItem alinea con live-driver-location", () => {
  assert.equal(normalizeAvailabilityFromItem({ availability: "Online" }), "online");
  assert.equal(normalizeAvailabilityFromItem({ availability: "Disponible" }), "online");
  assert.equal(normalizeAvailabilityFromItem({ status: "En servicio" }), "busy");
  assert.equal(normalizeAvailabilityFromItem({ status: "busy" }), "busy");
  assert.equal(normalizeAvailabilityFromItem({}), "offline");
});

test("runDriverLiveRawRefresh llama rpc con payload y escribe sync_monitor en éxito", async () => {
  const monitorCalls: MonitorPayload[] = [];
  let rpcName: string | null = null;
  let rpcItems: unknown = null;

  await runDriverLiveRawRefreshCore({
    getTokenForServicesSync: async () => ({ token: "test-token", fromEnvOverride: false }),
    moobizFetchWithToken: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          items: [{ id: "dr-1", availability: "Online", plate: "ABC-123" }],
        }),
        { status: 200 },
      ),
    createServiceSupabase: () =>
      ({
        rpc: async (name: string, args: { items: unknown }) => {
          rpcName = name;
          rpcItems = args.items;
          return { data: { total: 1, inserted: 1 }, error: null };
        },
      }) as unknown as ReturnType<typeof import("@supabase/supabase-js").createClient>,
    writeDriverLiveRawSyncMonitor: async (payload) => {
      monitorCalls.push(payload);
    },
  });

  assert.equal(rpcName, "refresh_driver_live_raw");
  assert.ok(Array.isArray(rpcItems));
  assert.equal((rpcItems as { driver_key: string }[]).length, 1);
  assert.equal((rpcItems as { driver_key: string }[])[0].driver_key, "dr-1");
  assert.equal((rpcItems as { availability: string }[])[0].availability, "online");

  const successMonitor = monitorCalls.find((c) => c.status === "success");
  assert.ok(successMonitor, "debe registrar sync_monitor success");
  assert.equal(successMonitor!.records_procesados, 1);
  assert.equal(successMonitor!.records_inserted, 1);
  assert.equal(successMonitor!.pages_queried, 1);
  assert.equal(successMonitor!.reason_for_stop, "full_replace_ok_1p");
});

test("runDriverLiveRawRefresh registra sync_monitor error si RPC falla", async () => {
  const monitorCalls: MonitorPayload[] = [];

  await assert.rejects(
    () =>
      runDriverLiveRawRefreshCore({
        getTokenForServicesSync: async () => ({ token: "t", fromEnvOverride: false }),
        moobizFetchWithToken: async () =>
          new Response(JSON.stringify({ ok: true, items: [{ id: "1" }] }), { status: 200 }),
        createServiceSupabase: () =>
          ({
            rpc: async () => ({
              data: null,
              error: { message: "rpc failed", details: "", hint: "", code: "P0001" },
            }),
          }) as unknown as ReturnType<typeof import("@supabase/supabase-js").createClient>,
        writeDriverLiveRawSyncMonitor: async (payload) => {
          monitorCalls.push(payload);
        },
      }),
    /Supabase RPC refresh_driver_live_raw/,
  );

  const errMon = monitorCalls.find((c) => c.status === "error");
  assert.ok(errMon);
  assert.ok(errMon!.error_message?.includes("rpc failed"));
  assert.equal(errMon!.reason_for_stop, "sync_exception");
});
