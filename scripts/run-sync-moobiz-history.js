#!/usr/bin/env node
/**
 * Wrapper local para sync historial Moobiz (extracción por umbral).
 * Ejemplo:
 *   node -r dotenv/config scripts/run-sync-moobiz-history.js --stop-days=5 --run-mode=dry_run
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { spawn } = require("node:child_process");
const { join } = require("node:path");

function parseArgs(argv) {
  const out = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      out._.push(raw);
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq === -1) {
      out[raw.slice(2)] = "true";
      continue;
    }
    out[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const stopDays = args["stop-days"] || args.stop_days || "5";
const runMode = args["run-mode"] || args.run_mode || "dry_run";

const forward = [
  join(__dirname, "sync_moobiz_history.js"),
  `--stop-days=${stopDays}`,
  `--run-mode=${runMode}`,
];

if (args["print-sample"] === "true" || args.print_sample === "true") {
  forward.push("--print-sample");
}

const child = spawn(process.execPath, ["-r", "dotenv/config", ...forward], {
  stdio: "inherit",
  env: process.env,
  cwd: join(__dirname, ".."),
});

child.on("exit", (code) => process.exit(code ?? 1));
