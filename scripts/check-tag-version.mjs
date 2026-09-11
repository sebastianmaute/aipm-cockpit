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
//
// ★★ A blank/whitespace-only argv (`node check-tag-version.mjs "   "`) is
// treated as ABSENT, not as a real tag -- without this, that call reported
// "(source: argv): CI_COMMIT_TAG is empty", which both blames the wrong
// variable and ignores a real CI_COMMIT_TAG sitting right there in env.
const argvTag = process.argv[2];
const hasArgvTag = typeof argvTag === "string" && argvTag.trim() !== "";
const tag = hasArgvTag ? argvTag : process.env.CI_COMMIT_TAG || "";
const source = hasArgvTag ? "argv" : "CI_COMMIT_TAG";

try {
  const { SOURCE_FILE, readSourceFrom } = await import("./version-sync-lib.mjs");
  const { classifyTag, describeVerdict } = await import("./tag-version-lib.mjs");

  // readSourceFrom THROWS when the declaration shape moved, which lands in
  // the catch below exactly like every other structural failure. ★ It also
  // requires APP_MILESTONE, so a MILESTONE-only shape change blocks this tag
  // gate too (exit 2) even though this guard never reads the milestone
  // itself -- deliberate: readSourceFrom is the ONE parser for version.ts's
  // shape, and keeping a single parser means a moved shape can never pass
  // here while version-sync-check already fails it on its own gate.
  const appVersion = readSourceFrom(readFileSync(SOURCE_FILE, "utf8")).version;

  const result = classifyTag(tag, appVersion);
  const { code, stream, message } = describeVerdict(result, source);

  if (stream === "stdout") console.log(message);
  else console.error(message);

  // ★★★ (D) DO NOT TRUST describeVerdict's `code` BLINDLY, even though it is
  // this file's own sibling module. Clamp to the only two codes that may ever
  // leave this branch un-widened (0 and 1), and even 0 is accepted ONLY when
  // the result's own verdict says "match" -- a describeVerdict bug (or a
  // future verdict wired through with code 0 by mistake) still exits 2
  // rather than silently passing a tag pipeline.
  const verdictIsMatch = result && typeof result === "object" && result.verdict === "match";
  const exitCode = code === 0 ? (verdictIsMatch ? 0 : 2) : code === 1 ? 1 : 2;
  process.exit(exitCode);
} catch (err) {
  // ★★ No path above may exit 0 or 1 from here down — a structural failure
  // (a missing file, a moved declaration shape, a renamed export resolving
  // to `undefined` and throwing when called) is exit 2, the same code
  // describeVerdict uses for a verdict it cannot classify. Before this
  // rewrite, only the readFileSync/readSourceFrom read was guarded, so a
  // throw from anything after it — or from this file's own logic — fell
  // through to Node's default exit 1, which is the DRIFT code.
  //
  // ★ (A) `err` is not guaranteed to be an Error -- `throw undefined` or
  // `throw null` from a lib crashes a bare `err.message` read and exits 1
  // (Node's default for an uncaught throw), which is the DRIFT code, not
  // "the gate could not scan". Never read `.message` off `err` directly.
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[tag:check] CANNOT SCAN: ${msg}`);
  process.exit(2);
}
