#!/usr/bin/env node
// Fail a tag pipeline whose tag disagrees with src/app/version.ts.
//
// EXIT CODES, following version:check's convention in this repo:
//   0  the tag names exactly APP_VERSION
//   1  DRIFT — they disagree; fix the tag or version.ts
//   2  the gate could not do its job (no tag, or version.ts's shape moved)
//
// ★★ 1 and 2 demand opposite responses, which is why they are separate: a gate
// that scans nothing passes everything, so 2 must never be reported as 0 and
// must not be reported as 1 either.
import { readFileSync } from "node:fs";
import { SOURCE_FILE, readSourceFrom } from "./version-sync-lib.mjs";
import { classifyTag } from "./tag-version-lib.mjs";

const tag = process.env.CI_COMMIT_TAG ?? process.argv[2] ?? "";

let appVersion;
try {
  // readSourceFrom THROWS when the declaration shape moved, which is exactly
  // the unscannable case rather than a drift.
  appVersion = readSourceFrom(readFileSync(SOURCE_FILE, "utf8")).version;
} catch (err) {
  console.error(`[tag:check] cannot read ${SOURCE_FILE}: ${err.message}`);
  process.exit(2);
}

const result = classifyTag(tag, appVersion);

if (result.verdict === "unscannable") {
  console.error(`[tag:check] CANNOT SCAN: ${result.reason}`);
  process.exit(2);
}

if (result.verdict === "drift") {
  console.error(
    `[tag:check] DRIFT: tag ${result.tag} but ${SOURCE_FILE} says ${result.appVersion} — ${result.detail}.`,
  );
  console.error(
    `[tag:check] Either tag ${result.expected} instead, or bump ${SOURCE_FILE} (and propagate with \`npm run version:sync\`) before tagging.`,
  );
  process.exit(1);
}

// ★ NAME both values on success. A bare exit 0 cannot be told apart from a
// gate that stopped reading the file.
console.log(`[tag:check] ok — tag ${result.tag} matches ${SOURCE_FILE} version=${result.appVersion}`);
