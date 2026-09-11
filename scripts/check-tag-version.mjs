#!/usr/bin/env node
// Fail a tag pipeline whose tag disagrees with src/app/version.ts.
//
// EXIT CODES, following version:check's convention in this repo:
//   0  the tag names exactly APP_VERSION
//   1  DRIFT — they disagree; fix the tag or version.ts
//   2  the gate could not do its job (no tag, version.ts's shape moved, or a
//      classification this script does not recognise)
//
// ★★ 1 and 2 demand opposite responses, which is why they are separate: a gate
// that scans nothing passes everything, so 2 must never be reported as 0 and
// must not be reported as 1 either.
//
// ★★★ EVERYTHING RUNS INSIDE ONE TOP-LEVEL TRY, including the two library
// imports. A STATIC `import` can't be caught: a renamed export in either lib
// throws at module-load time, before any of this file's own code runs, and
// prints a raw Node stack that reads as a crashed tool rather than "the gate
// could not scan". `await import()` rejects into the same catch as every
// other failure here, so a moved shape always exits 2 with a clean message.
import { readFileSync } from "node:fs";

// ★ argv wins over env, and the source travels with the value: an empty
// CI_COMMIT_TAG used to beat a real argv value under `??`, and the
// unscannable message always named CI_COMMIT_TAG even when the tag came from
// argv. Both are fixed by resolving them together, once.
const argvTag = process.argv[2];
const tag = argvTag || process.env.CI_COMMIT_TAG || "";
const source = argvTag ? "argv" : "CI_COMMIT_TAG";

try {
  const { SOURCE_FILE, readSourceFrom } = await import("./version-sync-lib.mjs");
  const { classifyTag, describeVerdict } = await import("./tag-version-lib.mjs");

  // readSourceFrom THROWS when the declaration shape moved, which lands in
  // the catch below exactly like every other structural failure.
  const appVersion = readSourceFrom(readFileSync(SOURCE_FILE, "utf8")).version;

  const result = classifyTag(tag, appVersion);
  const { code, stream, message } = describeVerdict(result, source);

  if (stream === "stdout") console.log(message);
  else console.error(message);

  process.exit(code);
} catch (err) {
  // ★★ No path above may exit 0 or 1 from here down — a structural failure
  // (a missing file, a moved declaration shape, a renamed export resolving
  // to `undefined` and throwing when called) is exit 2, the same code
  // describeVerdict uses for a verdict it cannot classify. Before this
  // rewrite, only the readFileSync/readSourceFrom read was guarded, so a
  // throw from anything after it — or from this file's own logic — fell
  // through to Node's default exit 1, which is the DRIFT code.
  console.error(`[tag:check] CANNOT SCAN: ${err.message}`);
  process.exit(2);
}
