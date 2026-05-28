require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { ensureMoobizToken } = require("../helpers/refresh_moobiz_token");

function parseFvItems(s) {
  const parts = s.split("|:fv:|").filter(Boolean);
  return parts.map((p) => {
    const i = p.indexOf("|:fi:|");
    if (i < 0) return { label: p, value: "" };
    return { label: p.slice(0, i), value: p.slice(i + 6) };
  });
}

(async () => {
  const id = "131137";
  const token = await ensureMoobizToken();
  const h = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
  };
  const raw = (
    await (
      await fetch(`https://app.moobiz.pe/api/admin/drivers?query=${id}&limit=1`, { headers: h })
    ).json()
  ).items[0].fv_items;
  const form = JSON.parse(
    fs.readFileSync("cursor_moobiz_fv_recovery/driver_form_131137_probe.json", "utf8"),
  );
  const rawLabels = parseFvItems(raw).map((x) => x.label);
  const formLabels = [];
  for (const f of form.forms || []) {
    for (const x of f.fields || []) formLabels.push(x.label);
  }
  console.log("raw count", rawLabels.length, "form count", formLabels.length);
  console.log("raw first 8", rawLabels.slice(0, 8));
  console.log("form first 8", formLabels.slice(0, 8));
  const inRawNotForm = rawLabels.filter((l) => !formLabels.includes(l));
  const inFormNotRaw = formLabels.filter((l) => !rawLabels.includes(l));
  console.log("in raw not form", inRawNotForm);
  console.log("in form not raw (first 15)", inFormNotRaw.slice(0, 15));
})();
