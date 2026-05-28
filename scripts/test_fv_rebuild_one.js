require("dotenv").config({ path: ".env.local" });
const crypto = require("crypto");
const fs = require("fs");
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");

function rebuildFv(forms) {
  let out = "";
  for (const form of forms || []) {
    for (const field of form.fields || []) {
      out += `${field.label || ""}|:fi:|${field.value || ""}|:fv:|`;
    }
  }
  return out;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function utf8Len(s) {
  return Buffer.byteLength(s, "utf8");
}

(async () => {
  const id = process.argv[2] || "131137";
  const token = await ensureMoobizToken();
  const h = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://app.moobiz.pe",
    Referer: `https://app.moobiz.pe/drivers/${id}`,
  };
  const formRes = await fetch("https://app.moobiz.pe/api/admin/drivers/form", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ id }),
  });
  const formBody = await formRes.json();
  const rebuilt = rebuildFv(formBody.forms);
  const listRes = await fetch(
    `https://app.moobiz.pe/api/admin/drivers?query=${encodeURIComponent(id)}&limit=1`,
    { headers: h },
  );
  const raw = (await listRes.json()).items?.[0]?.fv_items || "";
  console.log({
    id,
    rawLen: utf8Len(raw),
    rebuiltLen: utf8Len(rebuilt),
    rawSha: sha256Hex(raw),
    rebuiltSha: sha256Hex(rebuilt),
    prefixMatch: rebuilt.startsWith(raw),
    rawTail: raw.slice(-80),
    rebuiltTail: rebuilt.slice(-80),
  });
})();
