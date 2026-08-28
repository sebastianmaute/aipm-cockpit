import { readFileSync } from "node:fs";
import { parseEntries, isClosed } from "./followup-claims-lib.mjs";
import { statusViolations, VIOLATION_HELP } from "./followup-status-lib.mjs";

const REGISTER = "docs/open-followups.md";

/** ★★★ TWO FAILURE MODES, TWO EXIT CODES, and they demand opposite responses.
 *  Exit 1 is DRIFT: an entry violates the contract, and the fix is to write the
 *  Status line. Exit 2 is the gate UNABLE TO DO ITS JOB: the register is
 *  unreadable, or the parser returned nothing. A scanner that reads nothing
 *  passes everything, so the vacuity guard is not optional. `version-sync-check`
 *  is the precedent; before it split these, a red pipeline could not be read
 *  without opening the log. */
let src;
try {
  src = readFileSync(REGISTER, "utf8");
} catch (err) {
  console.error(`CANNOT SCAN: ${REGISTER} is unreadable (${err.code ?? err.message}).`);
  process.exit(2);
}

const open = parseEntries(src).filter((e) => !isClosed(e.title));
if (open.length === 0) {
  console.error(
    `CANNOT SCAN: parsed zero open entries from ${REGISTER}.\n` +
      "Either the file lost its `## N.` headings or the shared parser changed.\n" +
      "This is a vacuity guard: a scan that reads nothing would otherwise pass everything.",
  );
  process.exit(2);
}

const bad = open.map((e) => ({ e, v: statusViolations(e) })).filter((x) => x.v.length > 0);

console.log(`Status-line contract — ${open.length} open entries scanned\n`);
for (const { e, v } of bad) {
  console.log(`  §${e.n}  ${e.title.slice(0, 70)}`);
  for (const k of v) console.log(`      ${k}: ${VIOLATION_HELP[k]}`);
}

if (bad.length === 0) {
  console.log("All open entries carry a conforming Status line.");
  process.exit(0);
}

console.log(
  `\n${bad.length} of ${open.length} open entries violate the contract.\n` +
    "Every OPEN entry needs a `**Status:**` line that carries an ISO date and\n" +
    "either cites a command in backticks or says `never machine-verified`.\n" +
    "Do NOT satisfy this by inventing a verification that was not run.",
);
process.exit(1);
