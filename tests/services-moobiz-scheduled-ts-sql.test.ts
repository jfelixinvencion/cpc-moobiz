import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { scheduledTsFromFpRawExpr } from "../src/lib/services-moobiz-scheduled-ts-sql.ts";

const SAMPLES = ["2026-04-24 14:50:00", "24/04/2026 14:50", "24/04/2026 2:30 PM", "24/04/2026"];

test("scheduledTsFromFpRawExpr incluye ramas regex esperadas", () => {
  const sql = scheduledTsFromFpRawExpr("v");
  assert.match(sql, /::timestamptz/);
  assert.match(sql, /DD\/MM\/YYYY HH24:MI/);
  assert.match(sql, /DD\/MM\/YYYY HH12:MI AM/);
  assert.ok(sql.includes("to_timestamp"), "usa to_timestamp para d/m/y");
});

test("scheduled_ts: literales de ejemplo no lanzan error en Postgres", async (t) => {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    t.skip("DATABASE_URL no definida");
    return;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const expr = scheduledTsFromFpRawExpr("v");
    for (const v of SAMPLES) {
      const sql = `SELECT (${expr}) AS scheduled_ts FROM (SELECT $1::text AS v) s`;
      const { rows } = await pool.query<{ scheduled_ts: unknown }>(sql, [v]);
      assert.ok(rows[0], `sin fila para ${JSON.stringify(v)}`);
      assert.notEqual(rows[0].scheduled_ts, null, `scheduled_ts null para ${v}`);
    }
  } finally {
    await pool.end();
  }
});
