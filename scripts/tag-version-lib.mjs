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
