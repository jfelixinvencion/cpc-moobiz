/**
 * Probe adicional de endpoints Moobiz (fleets, export, forms).
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: ".env.local" });
}
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");

const ID = "131137";
const VE = "21366";
const BASE = "https://app.moobiz.pe/api/admin";

function fvLen(obj) {
  const s = JSON.stringify(obj);
  const m = s.match(/"fv_items":"([^"]*)"/);
  return m ? m[1].length : 0;
}

const PATHS = [
  "/fleets",
  "/fleets?limit=10",
  "/fleet_fields",
  "/form_fields",
  "/forms",
  "/forms?type=driver",
  "/drivers/excel",
  "/drivers/xlsx",
  "/reports",
  "/reports/drivers",
  "/export",
  "/export/drivers",
  `/drivers/${ID}/vehicles`,
  `/vehicles/${VE}`,
  `/vehicles/${VE}?full=1`,
  `/drivers/${ID}/edit`,
  `/drivers/edit?id=${ID}`,
  `/users/${ID}/edit`,
  `/branches/5/drivers?id=${ID}`,
];

async function main() {
  const token = await ensureMoobizToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json, text/plain, */*",
    Origin: "https://app.moobiz.pe",
    Referer: `https://app.moobiz.pe/drivers/${ID}`,
  };

  for (const p of PATHS) {
    const url = `${BASE}${p}`;
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      const text = await res.text();
      let fv = 0;
      try {
        fv = fvLen(JSON.parse(text));
      } catch {
        /* not json */
      }
      console.log(
        `${res.status}\t${p}\tbytes=${text.length}\tfv=${fv}\t${text.slice(0, 100).replace(/\s+/g, " ")}`,
      );
    } catch (e) {
      console.log(`ERR\t${p}\t${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
