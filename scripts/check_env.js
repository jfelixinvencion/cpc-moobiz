#!/usr/bin/env node
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const required = process.argv.slice(2).filter(Boolean);
if (required.length === 0) {
  console.error("[check:env] Usage: node scripts/check_env.js VAR1 VAR2 ...");
  process.exit(1);
}

const missing = required.filter((key) => !String(process.env[key] || "").trim());
if (missing.length) {
  console.error("[check:env] Missing required env vars:", missing.join(", "));
  process.exit(2);
}

console.log("[check:env] OK");
