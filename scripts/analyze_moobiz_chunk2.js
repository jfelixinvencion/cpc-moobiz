const fs = require("fs");
const d = fs.readFileSync("reports/fv_items_endpoint_probe/chunk2.js", "utf8");
console.log("fv_items occurrences:", (d.match(/fv_items/g) || []).length);
console.log("drivers/ path snippets:");
const re2 = /["'`][^"'`]{0,80}drivers[^"'`]{0,80}["'`]/g;
const snips = [...new Set([...d.matchAll(re2)].map((m) => m[0]))].slice(0, 40);
console.log(snips.join("\n"));
