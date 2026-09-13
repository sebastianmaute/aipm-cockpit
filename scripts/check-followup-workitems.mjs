import { readFileSync } from "node:fs";
import { parseEntries, isClosed } from "./followup-claims-lib.mjs";
import { workItemViolations, VIOLATION_HELP } from "./followup-workitem-lib.mjs";

const REGISTER = "docs/open-followups.md";

/** ★★★ TWO FAILURE MODES, TWO EXIT CODES — the split `check-followup-status.mjs`
 *  documents. Exit 1 is DRIFT: fix the Work item line. Exit 2 is the gate UNABLE
 *  TO DO ITS JOB: an unreadable register, or too few entries parsed. */
let src;
try {
  src = readFileSync(REGISTER, "utf8");
} catch (err) {
  console.error(`CANNOT SCAN: ${REGISTER} is unreadable (${err.code ?? err.message}).`);
  process.exit(2);
}

const entries = parseEntries(src);
const open = entries.filter((e) => !isClosed(e.title));
/** ★★★ 50, NOT 0 — the same floor as the two sibling gates over this file, for
 *  the same measured reason: a parser that drops all but one heading shape
 *  otherwise reports full coverage at exit 0. */
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

const violations = workItemViolations(entries);

console.log(`Work item contract — ${open.length} open entries scanned\n`);
for (const v of violations) {
  console.log(`  §${v.n}  ${v.title.slice(0, 70)}`);
  const detail = v.detail ? ` (${v.detail})` : "";
  console.log(`      ${v.code}${detail}: ${VIOLATION_HELP[v.code]}`);
}

if (violations.length === 0) {
  console.log(
    "All open entries carry exactly one conforming Work item line, and no closed entry carries one.",
  );
  process.exit(0);
}

console.log(
  `\n${violations.length} violation(s) of the Work item contract.\n` +
    "Do NOT satisfy this with `none — decision record` on an entry that has real\n" +
    "work to do; create the GitLab issue instead.",
);
process.exit(1);
