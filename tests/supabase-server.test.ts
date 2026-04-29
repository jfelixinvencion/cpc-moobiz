import test from "node:test";
import assert from "node:assert/strict";

import { getSupabaseServerClient } from "../src/lib/supabase-server.ts";

test("getSupabaseServerClient retorna client server-side sin exponer la key", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";

  try {
    const result = getSupabaseServerClient();
    assert.equal(result.usingServiceRole, true);
    assert.equal(typeof result.client.from, "function");
    assert.deepEqual(Object.keys(result).sort(), ["client", "usingServiceRole"]);
  } finally {
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
  }
});
