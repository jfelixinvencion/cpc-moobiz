#!/usr/bin/env node
// Carga .env.local SOLO si NO estamos en un entorno CI (ej. GitHub Actions)
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  // DOTENV_CONFIG_PATH permite Windows/PowerShell overrides si existe
  require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
}

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const target = String(process.argv[2] || "all").trim().toLowerCase();

const TARGETS = {
  drivers: ["scripts/sync_moobiz_drivers.js"],
  logs: ["scripts/sync_moobiz_logs_incremental.js"],
  services_history: ["scripts/sync_moobiz_history.js"],
  all: [
    "scripts/sync_moobiz_drivers.js",
    "scripts/sync_moobiz_logs_incremental.js",
    "scripts/sync_moobiz_history.js",
  ],
};

if (!TARGETS[target]) {
  console.error("[sync-wrapper] target inválido. Usa: drivers|logs|services_history|all");
  process.exit(1);
}

for (const script of TARGETS[target]) {
  const scriptPath = path.join(process.cwd(), script);
  console.log(`[sync-wrapper] Ejecutando ${script} ...`);
  const res = spawnSync("node", [scriptPath], { stdio: "inherit", env: process.env });
  if (res.status !== 0) {
    console.error(`[sync-wrapper] ${script} terminó con código ${res.status ?? 1}`);
    process.exit(res.status ?? 1);
  }
}

console.log("[sync-wrapper] OK");
