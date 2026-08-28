// Classifies the Status-line work remaining in the register, so no hardcoded
// list of entry numbers has to rot. No shebang (see scripts/probes/README.md).
import { readFileSync } from "node:fs";
import { parseEntries, isClosed } from "../followup-claims-lib.mjs";

const entries = parseEntries(readFileSync("docs/open-followups.md", "utf8")).filter(
  (e) => !isClosed(e.title),
);
if (entries.length === 0) {
  console.error("VACUITY: parsed zero open entries.");
  process.exit(2);
}
const FRESH = "2026-08-20";
const lastDate = (e) => {
  const d = [...e.body.join("\n").matchAll(/20\d\d-\d\d-\d\d/g)].map((m) => m[0]).sort();
  return d.length ? d[d.length - 1] : null;
};
const hasStatus = (e) => e.body.some((l) => /^\*\*Status:\*\*/.test(l));

const cheap = entries.filter((e) => !hasStatus(e) && lastDate(e) && lastDate(e) >= FRESH);
const probeNeeded = entries.filter((e) => {
  const d = lastDate(e);
  return !d || d < FRESH;
});
const done = entries.filter((e) => hasStatus(e) && lastDate(e) && lastDate(e) >= FRESH);

console.log(`open: ${entries.length}`);
console.log(`CHEAP  (no Status, fresh)      : ${cheap.length}  ${cheap.map((e) => e.n).join(",")}`);
console.log(
  `PROBE  (stale or undated)      : ${probeNeeded.length}  ${probeNeeded.map((e) => e.n).join(",")}`,
);
console.log(`DONE   (has Status, fresh)     : ${done.length}`);
process.exit(0);
