if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: ".env.local" });
}
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");
const ID = "131137";
const qs = [
  `limit=3000`,
  `limit=1&id=${ID}`,
  `id=${ID}`,
  `id=${ID}&full=1`,
  `id=${ID}&detail=1`,
  `id=${ID}&include_fv_items=1`,
  `limit=3000&full=1`,
  `limit=3000&detail=1`,
  `limit=3000&expand=all`,
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
  for (const q of qs) {
    const url = `https://app.moobiz.pe/api/admin/drivers?${q}`;
    const res = await fetch(url, { headers });
    const text = await res.text();
    let fvLen = null;
    let itemCount = null;
    try {
      const j = JSON.parse(text);
      const items = j.items || (j.item ? [j.item] : []);
      itemCount = items.length;
      const d = items.find((x) => String(x?.id) === ID) || items[0];
      if (d && typeof d.fv_items === "string") fvLen = d.fv_items.length;
    } catch {}
    console.log(res.status, q, "body", text.length, "items", itemCount, "fv_len", fvLen);
  }
}
main();
