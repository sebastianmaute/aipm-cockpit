#!/usr/bin/env node
// scripts/check-version-sync.mjs — fail when a version restatement has drifted
// from src/app/version.ts.
//
// Pass --update to propagate version.ts's values to every satellite.
//
// ★ It PRINTS EVERY READING before its verdict, so a green result is
// falsifiable rather than asserted. A gate whose output is one word cannot be
// distinguished from a gate that scanned nothing.
//
// ★★ It THROWS if a shape it depends on has moved, rather than reporting IN
// SYNC on a regex that stopped matching. That is deliberate: a probe that
// silently passes because it stopped looking is the failure mode this exists
// to prevent.

import fs from "node:fs";
import path from "node:path";

import {
  SATELLITES,
  SOURCE_FILE,
  applyValue,
  diffSatellite,
  readSourceFrom,
  readValue,
} from "./version-sync-lib.mjs";

const CODEMAP_DIR = "docs/CODEMAPS";

/** Expand the codemap glob; every other descriptor names one real file. */
function filesFor(satellite) {
  if (satellite.file !== `${CODEMAP_DIR}/*.md`) return [satellite.file];
  const found = fs
    .readdirSync(CODEMAP_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.posix.join(CODEMAP_DIR, f));
  // A gate that scans nothing passes everything.
  if (found.length === 0) {
    console.error(`no ${CODEMAP_DIR}/*.md found — refusing to report a pass.`);
    process.exit(2);
  }
  return found;
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`${SOURCE_FILE} not found — run from the repo root.`);
    process.exit(2);
  }
  const { version, milestone } = readSourceFrom(fs.readFileSync(SOURCE_FILE, "utf8"));
  const update = process.argv.includes("--update");

  console.log(`${SOURCE_FILE}: ${version} "${milestone}"`);

  const problems = [];
  let written = 0;

  for (const satellite of SATELLITES) {
    for (const file of filesFor(satellite)) {
      const text = fs.readFileSync(file, "utf8");
      if (update) {
        const out = applyValue(satellite, text, version, milestone);
        if (out !== text) {
          fs.writeFileSync(file, out);
          written++;
          console.log(`  updated ${file}`);
        } else {
          console.log(`  unchanged ${file}`);
        }
        continue;
      }
      const readings = readValue(satellite, text);
      const shown = Object.entries(readings)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`  ${file}: ${shown}`);
      problems.push(...diffSatellite(satellite, readings, version, milestone));
    }
  }

  if (update) {
    console.log(`version-sync: ${written} file(s) updated to ${version} "${milestone}"`);
    return;
  }

  if (problems.length) {
    console.error(`\nversion drift against ${SOURCE_FILE} (${version} "${milestone}"):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\nPropagate with: node scripts/check-version-sync.mjs --update`);
    process.exit(1);
  }
  console.log(`version-sync ok — every restatement matches ${version} "${milestone}"`);
}

main();
