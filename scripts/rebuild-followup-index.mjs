#!/usr/bin/env node
// Rebuild docs/open-followups.md's index table from its `## <n>.` headings.
//
//   node scripts/rebuild-followup-index.mjs              rewrite the table in place
//   node scripts/rebuild-followup-index.mjs --dry-run    list the rows that WOULD change; write nothing
//   node scripts/rebuild-followup-index.mjs --check      exit 1 if a rebuild would change anything
//   node scripts/rebuild-followup-index.mjs [flag] <path>   another copy of the register
//
// The rules — which cell is harvested and which is derived — live on
// `rebuildIndex` in `followup-index-lib.mjs`, and are unit-tested there. This
// file only reads, prints and writes. `followups:index:check` (BLOCKING, in the
// `static` job) runs the same drift check as `--check`.
//
// ★★ Exit codes: 0 = done / clean; 1 = `--check` found drift; 2 = bad arguments
// or the table cannot be rebuilt (unreadable file, ambiguous markers, a row
// that is not four cells, a §number used twice) or the file cannot be written.
// Nothing is written on a 1 or 2.
// ★ An unknown flag is exit 2, never ignored: a typo such as `--dryrun` used to
// fall through to a real WRITE.
import { readFileSync, writeFileSync } from "node:fs";
import { rebuildDrift } from "./followup-index-lib.mjs";

const USAGE = "usage: node scripts/rebuild-followup-index.mjs [--dry-run | --check] [path]";
const FLAGS = new Set(["--dry-run", "--check"]);

const args = process.argv.slice(2);
const unknown = args.filter((a) => a.startsWith("-") && !FLAGS.has(a));
const positional = args.filter((a) => !a.startsWith("-"));
const dryRun = args.includes("--dry-run");
const check = args.includes("--check");
if (unknown.length > 0 || positional.length > 1 || (dryRun && check)) {
  if (unknown.length > 0) console.error(`unknown option(s): ${unknown.join(" ")}`);
  if (positional.length > 1) console.error(`more than one path: ${positional.join(" ")}`);
  if (dryRun && check) console.error("--dry-run and --check are exclusive");
  console.error(USAGE);
  process.exit(2);
}
const target = positional[0] ?? "docs/open-followups.md";

let src;
let drift;
try {
  src = readFileSync(target, "utf8");
  drift = rebuildDrift(src);
} catch (err) {
  console.error(`${err.message ?? err}`);
  console.error(`Nothing was written to ${target}.`);
  process.exit(2);
}

const { out, drifted, changed, added, dropped, message } = drift;

if (check) {
  console.log(message);
  process.exit(drifted ? 1 : 0);
}

console.log(`${changed.length} changed, ${added.length} added, ${dropped.length} dropped`);
if (changed.length > 0) console.log(`  changed: ${changed.map((n) => `§${n}`).join(" ")}`);
if (added.length > 0) console.log(`  added: ${added.map((n) => `§${n}`).join(" ")}`);
if (dropped.length > 0) console.log(`  dropped: ${dropped.map((n) => `§${n}`).join(" ")}`);

if (dryRun) {
  console.log(`--dry-run: ${target} was not written.`);
} else if (drifted) {
  // ★ A failed write is exit 2 (could not do the job), never an uncaught throw:
  // node's uncaught exit code is 1, which this file reserves for drift.
  try {
    writeFileSync(target, out);
  } catch (err) {
    console.error(`could not write ${target}: ${err.code ?? err.message}`);
    process.exit(2);
  }
  console.log(`wrote ${target}`);
} else {
  console.log(`${target} already matches its headings; nothing written.`);
}
