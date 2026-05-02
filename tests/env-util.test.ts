import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getMoobizTokenFallback, getMoobizTokenFromSyncStateOnly } = require("../scripts/lib/env.js");

test("getMoobizTokenFallback returns MOOBIZ_TOKEN from env", async () => {
  const prevToken = process.env.MOOBIZ_TOKEN;
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.MOOBIZ_TOKEN = "env-token-value";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const token = await getMoobizTokenFallback();
    assert.equal(token, "env-token-value");
  } finally {
    if (prevToken === undefined) delete process.env.MOOBIZ_TOKEN;
    else process.env.MOOBIZ_TOKEN = prevToken;
    if (prevSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevSupabaseUrl;
    if (prevServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRole;
  }
});

test("getMoobizTokenFallback returns null without env token or supabase auth", async () => {
  const prevToken = process.env.MOOBIZ_TOKEN;
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MOOBIZ_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const token = await getMoobizTokenFallback();
    assert.equal(token, null);
  } finally {
    if (prevToken === undefined) delete process.env.MOOBIZ_TOKEN;
    else process.env.MOOBIZ_TOKEN = prevToken;
    if (prevSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevSupabaseUrl;
    if (prevServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRole;
  }
});

test("getMoobizTokenFromSyncStateOnly ignores MOOBIZ_TOKEN when Supabase creds are missing", async () => {
  const prevToken = process.env.MOOBIZ_TOKEN;
  const prevSupabaseUrl = process.env.SUPABASE_URL;
  const prevPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.MOOBIZ_TOKEN = "env-only-token";
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const token = await getMoobizTokenFromSyncStateOnly();
    assert.equal(token, null);
  } finally {
    if (prevToken === undefined) delete process.env.MOOBIZ_TOKEN;
    else process.env.MOOBIZ_TOKEN = prevToken;
    if (prevSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevSupabaseUrl;
    if (prevPublicUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevPublicUrl;
    if (prevServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRole;
  }
});
