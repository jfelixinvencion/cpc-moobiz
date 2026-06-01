/**
 * Verifica la política de mover empresa entre bolsas (lógica de upsert en memoria).
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { ClientBucketRow } from "../src/lib/client-buckets-types.ts";

function applyUpsertInMemory(
  buckets: ClientBucketRow[],
  row: ClientBucketRow,
): ClientBucketRow[] {
  return [...buckets.filter((b) => b.co_id !== row.co_id), row];
}

test("assigning same co_id to level 2 replaces level 1 (single bolsa)", () => {
  const initial: ClientBucketRow[] = [
    {
      co_id: "7",
      co_name: "Acme",
      bucket_level: 1,
      created_by: "u",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  const moved = applyUpsertInMemory(initial, {
    co_id: "7",
    co_name: "Acme",
    bucket_level: 2,
    created_by: "u",
    created_at: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.bucket_level, 2);
});
