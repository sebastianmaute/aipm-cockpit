#!/usr/bin/env node
// REPORT: backticked identifiers cited in SOURCE comments that resolve nowhere in
// the repo's code.
//
// ★★★ REPORTING ONLY — IT NEVER BLOCKS, and that is deliberate rather than
// provisional. It runs in no CI job and exits 0 even with findings, exactly like
// `followups:check`. Its universe excludes comment text, which the symbol GATE
// considered and rejected for itself because the trade produces false findings on
// literal/key names and "a gate that cries wolf gets switched off." That
// rejection is correct for a blocking gate and wrong for a report a human triages
// once. Promoting this to a gate would re-open the argument the gate already
// settled — do not.
//
// ★★ Exit codes follow this repo's two-code convention: **0** is "ran", whatever
// it found; **2** is "could not do its job" — the control failed, or nothing was
// examined. A check that scans nothing passes everything, so the vacuity guard is
// the load-bearing half.
//
// Usage:
//   node scripts/check-src-symbols.mjs                 # every comment in src/
//   node scripts/check-src-symbols.mjs --since main    # only lines this branch adds
//   node scripts/check-src-symbols.mjs --dir src --dir scripts
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import {
  citationsInDiff,
  citationsInFiles,
  collectCodeIdentifiers,
  CONTROL_ABSENT,
  CONTROL_PRESENT,
  listCodeFiles,
} from "./src-symbols-lib.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const since = flag("--since");
const dirs = argv.reduce((acc, a, i) => (a === "--dir" ? [...acc, argv[i + 1]] : acc), []);
const scanDirs = dirs.length > 0 ? dirs : ["src"];
const repoRoot = process.cwd();

// ---- universe: CODE identifiers across the whole repo ---------------------
// ★ Always the FULL set of code roots, never just the scanned dir — a comment in
//   `src/` legitimately names something defined in `scripts/` or `e2e/`, and
//   narrowing the universe to the scanned dir manufactures findings.
const universe = new Set();
let parsed = 0;
for (const dir of ["src", "scripts", "e2e"]) {
  parsed += collectCodeIdentifiers(path.join(repoRoot, dir), universe);
}

// ---- control, BEFORE the result ------------------------------------------
// ★★★ A report of "0 findings" is indistinguishable from a report whose corpus
//   was empty or whose universe swallowed every name. Both directions are
//   asserted so a defeated run says so instead of reading as clean.
const controlFailures = [];
for (const name of CONTROL_ABSENT) {
  if (universe.has(name)) controlFailures.push(`${name} should be ABSENT from code but resolved`);
}
for (const name of CONTROL_PRESENT) {
  if (!universe.has(name)) controlFailures.push(`${name} should be PRESENT in code but did not resolve`);
}

// ---- citations ------------------------------------------------------------
let citations;
let scopeLabel;
if (since) {
  const diff = execFileSync(
    "git",
    ["diff", `${since}...HEAD`, "--unified=0", "--", ...scanDirs],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  citations = citationsInDiff(diff);
  scopeLabel = `comment lines added since ${since} in ${scanDirs.join(", ")}`;
} else {
  const files = scanDirs.flatMap((d) => listCodeFiles(path.join(repoRoot, d)));
  citations = citationsInFiles(files);
  scopeLabel = `all comments in ${scanDirs.join(", ")} (${files.length} files)`;
}

const byName = new Map();
for (const c of citations) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}
const unresolved = [...byName.entries()].filter(([name]) => !universe.has(name));

// ---- report ---------------------------------------------------------------
// ★★ POPULATION BESIDE THE VERDICT, ALWAYS. "0 unresolved" is only meaningful
//   next to how many names were actually checked.
console.log(`src-symbol report — ${scopeLabel}`);
console.log(`  files parsed into the code universe: ${parsed}`);
console.log(`  code-only identifiers: ${universe.size}`);
console.log(`  distinct names cited in comments: ${byName.size}`);
console.log(`  UNRESOLVED: ${unresolved.length}`);

if (controlFailures.length > 0) {
  console.error("\nCONTROL FAILED — the result above is not meaningful:");
  for (const f of controlFailures) console.error(`  ${f}`);
  console.error(
    "\nMost likely cause: this report's own files stopped being self-excluded, so the\n" +
      "names it quotes entered the universe. See REPORT_SELF_FILES in src-symbols-lib.mjs.",
  );
  process.exit(2);
}
if (byName.size === 0) {
  console.error("\nVACUOUS: no citations were examined — the scope or the comment filter is wrong.");
  process.exit(2);
}

for (const [name, rows] of unresolved) {
  console.log(`\n  ${name}`);
  for (const row of rows.slice(0, 3)) {
    const where = row.line === null ? row.file : `${row.file}:${row.line}`;
    console.log(`    ${where}: ${row.text.slice(0, 160)}`);
  }
  if (rows.length > 3) console.log(`    … and ${rows.length - 3} more`);
}

if (unresolved.length > 0) {
  console.log(
    "\nEach finding is a QUESTION, not a defect: an upstream API name, a spec field, a\n" +
      "deliberately-hypothetical name in an explanation, and an invented one all look\n" +
      "identical here. Check the citation, then either correct the name or say near it\n" +
      "that the symbol is deliberately absent (the gate's ABSENCE_MARKERS suppress it).",
  );
}
// Reporting only: findings never change the exit code.
process.exit(0);
