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
/** ★★★ THE FLOOR IS 50, NOT 0, AND THE DIFFERENCE IS THE WHOLE GUARD. A
 *  zero-only test catches a scan that reads NOTHING and misses one that reads
 *  ALMOST nothing, which is the reachable failure: the parser recognises one
 *  heading shape and silently drops the rest, and the gate then reports
 *  "1 open entries scanned — all conforming" over a register with 174
 *  unexamined entries, at exit 0, in a BLOCKING job. MEASURED against a fixture
 *  whose other headings read `## 2) …`, not reasoned: exit 0, green, with
 *  full-coverage wording. `check-followup-claims.mjs` — same file, same
 *  imported parser — has always refused below 50; this matches its floor rather
 *  than inventing a second number. Found by a cold review of this branch. */
const MIN_OPEN_ENTRIES = 50;
if (open.length < MIN_OPEN_ENTRIES) {
  console.error(
    `CANNOT SCAN: parsed only ${open.length} open entries from ${REGISTER}` +
      ` (floor is ${MIN_OPEN_ENTRIES}).`,
  );
  console.error("Either the file lost its `## N.` headings, or the shared parser changed");
  console.error("and is silently dropping entries.");
  console.error("This is a vacuity guard: a scan that reads almost nothing would");
  console.error("otherwise pass almost everything.");
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
