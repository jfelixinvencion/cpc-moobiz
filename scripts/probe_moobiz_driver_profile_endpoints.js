/**
 * Busca endpoints Moobiz con fv_items > 1024 (simula exploración Network).
 * Uso: node scripts/probe_moobiz_driver_profile_endpoints.js
 */
if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
  require("dotenv").config({ path: ".env.local" });
}
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");

const ID = process.env.PROBE_DRIVER_ID || "131137";
const BASE = "https://app.moobiz.pe/api/admin";
const OUT = path.join(process.cwd(), "reports", "fv_items_endpoint_probe");

function fvLen(body) {
  let max = { len: 0, path: null };
  const walk = (node, p) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.fv_items === "string") {
      const L = node.fv_items.length;
      if (L > max.len) max = { len: L, path: `${p}.fv_items` };
    }
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.toLowerCase().includes("fv") && typeof v === "string" && v.includes(":fi:|")) {
        const L = v.length;
        if (L > max.len) max = { len: L, path: `${p}.${k}` };
      }
      walk(v, `${p}.${k}`);
    }
  };
  walk(body, "root");
  return max;
}

const PATHS = [];
const add = (p, method = "GET") => PATHS.push({ method, url: p.startsWith("http") ? p : `${BASE}${p}` });

// Perfil / detalle
add(`/drivers/${ID}`);
add(`/drivers/${ID}?full=1`);
add(`/drivers/${ID}?with_fv=1`);
add(`/drivers/${ID}?include_fv_items=1`);
add(`/drivers/${ID}?fields=all`);
add(`/drivers/get/${ID}`);
add(`/drivers/get?id=${ID}`);
add(`/drivers?id=${ID}`);
add(`/drivers?id=${ID}&limit=1`);

// Form / custom fields (patrones típicos admin)
for (const seg of [
  "form-values",
  "form_values",
  "formvalues",
  "custom-fields",
  "custom_fields",
  "extended-info",
  "extended_info",
  "fv-items",
  "fv_items",
  "fleet-values",
  "fleet_values",
  "fields",
  "profile",
  "details",
  "full",
  "data",
  "extra",
]) {
  add(`/drivers/${ID}/${seg}`);
  add(`/driver/${ID}/${seg}`);
  add(`/drivers/${seg}?id=${ID}`);
  add(`/drivers/${seg}?id_driver=${ID}`);
  add(`/drivers/${seg}?driver_id=${ID}`);
}

// Users module (drivers son users type 3)
add(`/users/${ID}`);
add(`/users/${ID}?full=1`);
add(`/users/get/${ID}`);
for (const seg of ["form-values", "form_values", "fv_items", "custom-fields", "fields"]) {
  add(`/users/${ID}/${seg}`);
  add(`/users/${seg}?id=${ID}`);
}

// Forms genéricos
for (const seg of [
  `/forms/driver-values?id=${ID}`,
  `/forms/driver?id=${ID}`,
  `/forms/values?type=driver&id=${ID}`,
  `/forms/values?id_user=${ID}`,
  `/form_values/driver/${ID}`,
  `/form_values?id_driver=${ID}`,
  `/form_values?id_user=${ID}`,
  `/fleet/form_values?id_driver=${ID}`,
  `/fleets/driver/${ID}/form_values`,
  `/fleets/drivers/${ID}/form_values`,
]) {
  add(seg);
}

// Export
for (const seg of [
  `/drivers/export?id=${ID}`,
  `/drivers/${ID}/export`,
  `/drivers/export?ids=${ID}`,
  `/export/drivers?id=${ID}`,
  `/reports/drivers?id=${ID}`,
  `/drivers/download?id=${ID}`,
]) {
  add(seg);
}

// Vehicles linked
add(`/vehicles?query=${ID}`);
add(`/vehicles?id_driver=${ID}`);
add(`/vehicles/driver/${ID}`);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const token = await ensureMoobizToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json, text/plain, */*",
    Origin: "https://app.moobiz.pe",
    Referer: `https://app.moobiz.pe/drivers?query=${ID}`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  const results = [];
  let best = { len: 0, url: null };

  for (const { method, url } of PATHS) {
    try {
      const res = await fetch(url, { method, headers, cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();
      let parsed = null;
      let fv = { len: 0, path: null };
      if (ct.includes("json") && text) {
        try {
          parsed = JSON.parse(text);
          fv = fvLen(parsed);
        } catch {
          /* ignore */
        }
      }
      const row = {
        url,
        status: res.status,
        contentType: ct,
        bodyBytes: Buffer.byteLength(text, "utf8"),
        fvLen: fv.len,
        fvPath: fv.path,
        ok: parsed?.ok,
        msg: parsed?.msg,
        preview: text.slice(0, 120).replace(/\s+/g, " "),
      };
      results.push(row);
      if (fv.len > best.len) best = { len: fv.len, url, fvPath: fv.path, status: res.status };
      if (fv.len > 1024) {
        const safe = url.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
        fs.writeFileSync(path.join(OUT, `hit_${safe}.json`), text, "utf8");
        console.log("*** HIT fv>", 1024, url, fv.len);
      }
    } catch (e) {
      results.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Fetch Moobiz SPA JS for route hints
  let jsHints = [];
  try {
    const html = await (await fetch("https://app.moobiz.pe/drivers", { headers: { "User-Agent": headers["User-Agent"] } })).text();
    const scripts = [...html.matchAll(/src="(\/[^"]+\.js)"/g)].map((m) => m[1]).slice(0, 8);
    for (const src of scripts) {
      const jsUrl = `https://app.moobiz.pe${src}`;
      const js = await (await fetch(jsUrl)).text();
      const matches = [...js.matchAll(/api\/admin\/[a-zA-Z0-9_\-\/\$\{\}]+/g)]
        .map((m) => m[0])
        .filter((s) => /driver|form|fv|field|fleet|user/i.test(s));
      jsHints.push({ jsUrl, matches: [...new Set(matches)].slice(0, 40) });
    }
  } catch (e) {
    jsHints = [{ error: String(e) }];
  }

  const summary = { id: ID, probed: results.length, best, jsHints, results: results.filter((r) => r.fvLen > 0 || r.status === 200) };
  fs.writeFileSync(path.join(OUT, "probe_summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log("\n=== Best fv_items length ===");
  console.log(JSON.stringify(best, null, 2));
  console.log("\n=== Endpoints with fv_items > 0 ===");
  console.table(results.filter((r) => (r.fvLen || 0) > 0).map(({ url, status, fvLen, bodyBytes }) => ({ url, status, fvLen, bodyBytes })));

  // Save curl template (token redacted)
  const curlBest = best.url
    ? `# Reemplaza TOKEN\n curl -i -X GET '${best.url}' \\\n  -H 'Authorization: Bearer TOKEN' \\\n  -H 'X-Auth-Token: TOKEN' \\\n  -H 'Accept: application/json' \\\n  -H 'Origin: https://app.moobiz.pe' \\\n  -H 'Referer: https://app.moobiz.pe/drivers?query=${ID}' \\\n  --compressed`
    : "";
  fs.writeFileSync(path.join(OUT, "curl_best.sh"), curlBest, "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
