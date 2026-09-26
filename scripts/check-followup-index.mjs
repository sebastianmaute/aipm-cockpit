#!/usr/bin/env node
// Gate: every `## <n>.` entry in docs/open-followups.md must carry a row in the
// index table, and every index row must point at an entry that exists. Nothing
// compared the two sets before this file; on the day it was written the register
// carried 413 headings against 405 rows.
//
// Since §319/§382 it also fails when the table is not exactly what
// `rebuild-followup-index.mjs` would write (`rebuildDrift`), so a missed
// rebuild goes red here, in the fast `static` job, not only in `unit`.
import { readFileSync } from "node:fs";
import { diffHeadingsAgainstIndex, REBUILD_COMMAND, rebuildDrift } from "./followup-index-lib.mjs";

const REGISTER = "docs/open-followups.md";

/** ★★★ TWO FAILURE MODES, TWO EXIT CODES, and they demand opposite responses.
 *  Exit 1 is DRIFT: the register's two halves disagree, and the fix is to write
 *  the missing rows (or delete the orphaned ones). Exit 2 is the gate UNABLE TO
 *  DO ITS JOB: the file is unreadable, the markers are missing or duplicated, or
 *  one of the two sets came back empty. A scan that reads nothing passes
 *  everything, so those are not ordinary reds. `version-sync-check` and
 *  `followups-status-check` already split their codes this way; before they did,
 *  a red pipeline could not be read without opening the log. */
let src;
try {
  src = readFileSync(REGISTER, "utf8");
} catch (err) {
  console.error(`CANNOT SCAN: ${REGISTER} is unreadable (${err.code ?? err.message}).`);
  process.exit(2);
}

let result;
try {
  result = diffHeadingsAgainstIndex(src);
} catch (err) {
  console.error(`${err.message}`);
  console.error(`The register's shape is not what this gate can parse — fix ${REGISTER},`);
  console.error("or the parser, before reading any result from it.");
  process.exit(2);
}

const { missingRows, orphanRows, duplicateHeadings, duplicateRows, headingCount, rowCount } =
  result;

/** ★★★ THE FLOOR IS 50, NOT 0, AND THE DIFFERENCE IS THE WHOLE GUARD. The lib
 *  refuses at zero — that is the guard a unit test can reach — but a zero-only
 *  floor catches a scan that reads NOTHING and misses one that reads ALMOST
 *  nothing, which is the reachable failure: a parser that recognises one shape
 *  and silently drops the rest would report "3 headings scanned — in sync" over
 *  a register with 410 unexamined entries, at exit 0, in a BLOCKING job.
 *  `check-followup-claims.mjs` and `check-followup-status.mjs` have always
 *  refused below 50; this matches their floor rather than inventing a third
 *  number. */
const MIN_ENTRIES = 50;
if (headingCount < MIN_ENTRIES || rowCount < MIN_ENTRIES) {
  console.error(
    `CANNOT SCAN: parsed ${headingCount} headings and ${rowCount} index rows` +
      ` from ${REGISTER} (floor is ${MIN_ENTRIES} on each axis).`,
  );
  console.error("Either the register lost content, or the parser is silently dropping it.");
  process.exit(2);
}

// Printed on EVERY path, including the green one: a caller reading only the
// summary can still prove both sets were non-empty and which two were compared.
console.log(`Follow-up index — ${headingCount} headings compared against ${rowCount} index rows\n`);

/** ★★ A DUPLICATE IS DRIFT (exit 1), NOT AN UNSCANNABLE FILE (exit 2). The
 *  parser understood the register perfectly; the register is what is wrong, and
 *  the fix is an ordinary edit. It is reported ahead of the two set differences
 *  because a duplicate makes BOTH of those empty while the counts disagree —
 *  so the summary line above is the only other tell, and nothing reads it. */
if (duplicateHeadings.length > 0 || duplicateRows.length > 0) {
  if (duplicateHeadings.length > 0) {
    console.log(`  §numbers used by more than one heading: ${duplicateHeadings.join(" ")}`);
  }
  if (duplicateRows.length > 0) {
    console.log(`  §numbers carrying more than one index row: ${duplicateRows.join(" ")}`);
  }
  console.log(
    "\nA follow-up number is a permanent handle other docs cite, so two entries\n" +
      "sharing one makes every cross-reference to it ambiguous. Give the newer\n" +
      "entry the next free number; delete the duplicated row rather than the row\n" +
      "whose anchor other docs already link to.",
  );
  process.exit(1);
}

if (missingRows.length === 0 && orphanRows.length === 0) {
  console.log("Every entry has an index row, and every index row has an entry.");
  checkRebuildIsNoOp();
}

if (missingRows.length > 0) {
  console.log(`  headings with no index row (${missingRows.length}): ${missingRows.join(" ")}`);
}
if (orphanRows.length > 0) {
  console.log(`  index rows with no heading (${orphanRows.length}): ${orphanRows.join(" ")}`);
}

console.log(
  "\nWrite the missing rows into the index table between the markers, and delete\n" +
    `any row whose entry no longer exists — \`${REBUILD_COMMAND}\` does both. It keeps\n` +
    "Origin and Size, and keeps State while the row's open/closed status agrees with\n" +
    "the heading's; it regenerates State on a status flip and Item on a retitle.\n" +
    "Do NOT satisfy this by renumbering an entry — a follow-up number is a permanent\n" +
    "handle that other docs cite.",
);
process.exit(1);

/** ★★ The SAME drift check `rebuild-followup-index.mjs --check` and the unit
 *  test run (`rebuildDrift`), reached only once both sets already agree, so a
 *  missing row is reported by the clearer message above. Exit 1 = drift; a
 *  table the rebuild cannot parse (a row that is not four cells) is exit 2,
 *  like every other could-not-scan path in this file. */
function checkRebuildIsNoOp() {
  let drift;
  try {
    drift = rebuildDrift(src);
  } catch (err) {
    console.error(`CANNOT SCAN: ${err.message}`);
    console.error("The index table cannot be rebuilt; fix the row it names first.");
    process.exit(2);
  }
  console.log(drift.drifted ? `\n${drift.message}` : drift.message);
  process.exit(drift.drifted ? 1 : 0);
}
