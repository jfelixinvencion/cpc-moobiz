const fs = require("fs");
const path = require("path");
const https = require("https");

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

async function main() {
  const html = await fetch("https://app.moobiz.pe/drivers");
  const scripts = [...html.matchAll(/src="(\/static\/js\/[^"]+\.js)"/g)].map((m) => m[1]);
  const all = new Set();
  for (const src of scripts) {
    const js = await fetch(`https://app.moobiz.pe${src}`);
    const patterns = [
      ...js.matchAll(/api\/admin\/[a-zA-Z0-9_/.${}-]+/g),
      ...js.matchAll(/fv_items/g),
      ...js.matchAll(/form_values/g),
      ...js.matchAll(/fleet_values/g),
    ].map((m) => m[0]);
    for (const p of patterns) all.add(p);
    console.error("scanned", src, "size", js.length);
  }
  const filtered = [...all].filter((s) =>
    /driver|form|fv|field|fleet|user|export|excel|vehicle/i.test(s),
  );
  console.log(filtered.sort().join("\n"));
}

main().catch(console.error);
