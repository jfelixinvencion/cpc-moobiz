if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: ".env.local" });
}
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");

const ID = "131137";
const BASE = "https://app.moobiz.pe/api/admin";
const PATHS = [
  `/drivers/${ID}`,
  `/drivers/${ID}?full=1`,
  `/drivers/${ID}?expand=fv_items`,
  `/drivers/${ID}?with_fv_items=1`,
  `/drivers/details/${ID}`,
  `/drivers/full/${ID}`,
  `/driver/${ID}`,
  `/drivers/get?id=${ID}`,
  `/drivers?id=${ID}`,
  `/drivers/${ID}/fv_items`,
  `/form_values/driver/${ID}`,
];

async function main() {
  const token = await ensureMoobizToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/",
  };
  for (const p of PATHS) {
    const url = BASE + p.replace(/^\//, "/");
    try {
      const res = await fetch(url.startsWith("http") ? url : BASE + p, { headers });
      const text = await res.text();
      let fvLen = null;
      try {
        const j = JSON.parse(text);
        const find = (o) => {
          if (!o || typeof o !== "object") return null;
          if (typeof o.fv_items === "string") return o.fv_items.length;
          for (const v of Object.values(o)) {
            if (v && typeof v === "object") {
              const r = find(v);
              if (r != null) return r;
            }
          }
          return null;
        };
        fvLen = find(j);
      } catch {}
      console.log(res.status, p, "bytes", text.length, "fv_items_len", fvLen);
    } catch (e) {
      console.log("ERR", p, e.message);
    }
  }
}
main();
