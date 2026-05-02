import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const scriptPath = path.join(process.cwd(), "scripts", "check_env.js");

test("check_env exits 2 when required env is missing", () => {
  const res = spawnSync(process.execPath, [scriptPath, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], {
    env: { ...process.env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    encoding: "utf8",
  });

  assert.equal(res.status, 2);
  assert.match(`${res.stderr}${res.stdout}`, /Missing required env vars/i);
});

test("check_env exits 0 when required envs exist", () => {
  const res = spawnSync(process.execPath, [scriptPath, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], {
    env: {
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    encoding: "utf8",
  });

  assert.equal(res.status, 0);
  assert.match(`${res.stderr}${res.stdout}`, /\[check:env\] OK/i);
});
