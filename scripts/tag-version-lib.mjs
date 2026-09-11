// Pure comparison of a git tag against version.ts's APP_VERSION.
//
// WHY: src/app/version.ts is the source of truth for the app version, and a
// release is cut by tagging. Nothing connects the two, so `v0.302.0` on a tree
// whose APP_VERSION is 0.301.0 publishes an installer that misreports itself —
// the same drift class `version-sync-check` catches among the six satellites,
// one level up.
//
// ★ NO SHEBANG. This module is imported by a vitest spec, and a `#!` line on an
// imported .mjs makes vitest throw naming the WRONG file. The CLI
// (check-tag-version.mjs) owns the shebang, the I/O and the exit codes.

// SOURCE_FILE is a plain exported string constant -- importing it here adds
// no I/O and no cycle (version-sync-lib.mjs does not import this module). It
// lets describeVerdict's messages name the file without the CLI having to
// stitch that in after the fact.
import { SOURCE_FILE } from "./version-sync-lib.mjs";

/** Tags are `v<version>`. Exported so the test compares against one source. */
export const TAG_PREFIX = "v";

/**
 * Classify a tag against the app version.
 *
 * Returns `{ verdict: "match" | "drift" | "unscannable", ... }`.
 *
 * ★★ THREE VERDICTS, NOT TWO, and the third is the load-bearing one. "drift"
 * means the two disagree and someone must fix a version. "unscannable" means
 * the comparison could not be made at all — an empty tag, i.e. this job ran on
 * a pipeline that is not a tag pipeline. A guard that cannot compare must never
 * report agreement, and must not send the reader to version.ts either.
 */
export function classifyTag(tag, appVersion) {
  if (typeof tag !== "string" || tag.trim() === "") {
    return {
      verdict: "unscannable",
      reason:
        "CI_COMMIT_TAG is empty — this job must run only on tag pipelines. Check its rules:, not version.ts.",
    };
  }
  if (typeof appVersion !== "string" || appVersion.trim() === "") {
    return {
      verdict: "unscannable",
      reason: "APP_VERSION came back empty — src/app/version.ts's shape moved.",
    };
  }

  const expected = `${TAG_PREFIX}${appVersion}`;

  if (!tag.startsWith(TAG_PREFIX)) {
    return {
      verdict: "drift",
      tag,
      appVersion,
      expected,
      detail: `tag does not start with "${TAG_PREFIX}"`,
    };
  }

  // ★ Compare the WHOLE remainder, never a prefix: "v0.301.01" and
  // "v0.301.0-rc1" both start with the version and are both wrong.
  if (tag.slice(TAG_PREFIX.length) !== appVersion) {
    return {
      verdict: "drift",
      tag,
      appVersion,
      expected,
      detail: "tag names a different version than src/app/version.ts",
    };
  }

  return { verdict: "match", tag, appVersion };
}

/**
 * Turn a classifyTag() result into what the CLI should print and how it
 * should exit: `{ code, stream, message }`, `stream` one of "stdout"/"stderr".
 *
 * ★★★ THE DEFAULT BRANCH IS THE WHOLE POINT OF THIS FUNCTION, not a fallback
 * bolted on afterward. A CLI whose success path is "the fall-through" reports
 * "ok" and exits 0 on a verdict it has never seen -- measured: a stubbed lib
 * returning `{verdict: "ambiguous"}` made the old inline CLI print "ok" and
 * exit 0. ANY result this function does not recognise as match/drift/
 * unscannable -- an unknown verdict string, or a null/undefined/non-object
 * result entirely (classifyTag threw, or a renamed export resolved to
 * `undefined` and was never called) -- resolves to exit 2, stderr, naming
 * what came back. A guard that cannot classify must never report agreement.
 *
 * `source` names where the CLI read the tag from ("argv" or "CI_COMMIT_TAG")
 * and is used only by the unscannable message, so the operator is told where
 * to look rather than always being pointed at CI_COMMIT_TAG.
 */
export function describeVerdict(result, source) {
  if (result === null || typeof result !== "object" || typeof result.verdict !== "string") {
    return {
      code: 2,
      stream: "stderr",
      message: `[tag:check] CANNOT SCAN: classifyTag returned an unrecognised result (${JSON.stringify(result)}).`,
    };
  }

  if (result.verdict === "match") {
    return {
      code: 0,
      stream: "stdout",
      // ★ NAME both values on success. A bare exit 0 cannot be told apart
      // from a gate that stopped reading the file.
      message: `[tag:check] ok — tag ${result.tag} matches ${SOURCE_FILE} version=${result.appVersion}`,
    };
  }

  if (result.verdict === "drift") {
    // ★★★ Drop the bump advice ONLY when the version UNDERNEATH the tag
    // already matches appVersion -- never merely because the tag lacks
    // TAG_PREFIX. `tag.startsWith(TAG_PREFIX)` was the wrong predicate:
    // "0.302.0" is ALSO un-prefixed, but it names a version that does not
    // exist yet, so "Re-tag as v0.301.0" would send an operator who forgot
    // to bump to re-tag an EXISTING release instead. The right question is
    // whether stripping (at most) the bad leading character recovers
    // appVersion -- i.e. whether the prefix really is the ONLY thing wrong.
    const onlyPrefixWrong = result.tag === result.appVersion || result.tag.slice(1) === result.appVersion;
    const advice = onlyPrefixWrong
      ? `Re-tag as ${result.expected} — ${SOURCE_FILE} already says ${result.appVersion}.`
      : `Either tag ${result.expected} instead, or bump ${SOURCE_FILE} (and propagate with \`npm run version:sync\`) before tagging.`;
    return {
      code: 1,
      stream: "stderr",
      message:
        `[tag:check] DRIFT: tag ${result.tag} but ${SOURCE_FILE} says ${result.appVersion} — ${result.detail}.\n` +
        `[tag:check] ${advice}`,
    };
  }

  if (result.verdict === "unscannable") {
    return {
      code: 2,
      stream: "stderr",
      message: `[tag:check] CANNOT SCAN (source: ${source}): ${result.reason}`,
    };
  }

  return {
    code: 2,
    stream: "stderr",
    message: `[tag:check] CANNOT SCAN: classifyTag returned an unrecognised verdict "${result.verdict}".`,
  };
}
