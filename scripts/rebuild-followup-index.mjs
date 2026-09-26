#!/usr/bin/env node
// Rebuild docs/open-followups.md's index table from its `## <n>.` headings.
//
//   node scripts/rebuild-followup-index.mjs              rewrite the table in place
//   node scripts/rebuild-followup-index.mjs --dry-run    list the rows that WOULD change
//   node scripts/rebuild-followup-index.mjs [--dry-run] <path>   another copy of the register
//
// The rules — which cell is harvested and which is derived — live on
// `rebuildIndex` in `followup-index-lib.mjs`, and are unit-tested there. This
// file only reads, prints and writes. It is NOT a gate and runs in no CI job;
// `followups:index:check` is the gate, and it compares §numbers only.
//
// ★★ Exit 2 when the table cannot be rebuilt (unreadable file, ambiguous
// markers, a row that is not four cells, a §number used twice). Nothing is
// written on that path.
import { readFileSync, writeFileSync } from "node:fs";
import { INDEX_ROW_RE, rebuildIndex } from "./followup-index-lib.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--")) ?? "docs/open-followups.md";

let src;
let out;
try {
  src = readFileSync(target, "utf8");
  out = rebuildIndex(src);
} catch (err) {
  console.error(`${err.message ?? err}`);
  console.error(`Nothing was written to ${target}.`);
  process.exit(2);
}

/** §n → the row line, for the rows of one version of the file. */
const rowsOf = (text) => {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = INDEX_ROW_RE.exec(line);
    if (m) rows.set(Number(m[1]), line);
  }
  return rows;
};
const before = rowsOf(src);
const after = rowsOf(out);
const changed = [...after.keys()].filter((n) => before.has(n) && before.get(n) !== after.get(n));
const added = [...after.keys()].filter((n) => !before.has(n));
const dropped = [...before.keys()].filter((n) => !after.has(n));

console.log(
  `${after.size} rows: ${changed.length} changed, ${added.length} added, ${dropped.length} dropped`,
);
if (changed.length > 0) console.log(`  changed: ${changed.map((n) => `§${n}`).join(" ")}`);
if (added.length > 0) console.log(`  added: ${added.map((n) => `§${n}`).join(" ")}`);
if (dropped.length > 0) console.log(`  dropped: ${dropped.map((n) => `§${n}`).join(" ")}`);

if (dryRun) {
  console.log(`--dry-run: ${target} was not written.`);
} else if (out !== src) {
  writeFileSync(target, out);
  console.log(`wrote ${target}`);
} else {
  console.log(`${target} already matches its headings; nothing written.`);
}
