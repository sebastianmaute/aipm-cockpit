import { describe, expect, it } from "vitest";
import { classifyTag, TAG_PREFIX } from "./tag-version-lib.mjs";

describe("classifyTag", () => {
  it("accepts a tag that names exactly the app version", () => {
    expect(classifyTag("v0.301.0", "0.301.0")).toEqual({
      verdict: "match",
      tag: "v0.301.0",
      appVersion: "0.301.0",
    });
  });

  // ★ The defect this whole guard exists to catch: tagging v0.302.0 on a tree
  // whose APP_VERSION is 0.301.0 publishes an installer that misreports its
  // own version.
  it("reports drift when the tag names a different version", () => {
    const r = classifyTag("v0.302.0", "0.301.0");
    expect(r.verdict).toBe("drift");
    expect(r.expected).toBe("v0.301.0");
  });

  // ★★★ MUTATION-PROVEN: deleting the `!tag.startsWith(TAG_PREFIX)` branch below
  // leaves this test green on ITS OWN, because "0.301.0" is missing the prefix
  // CHARACTER entirely — its stripped-remainder length already differs from
  // appVersion's ("0.301.0".slice(1) === ".301.0"), so the remainder-equality
  // check alone already rejects it. A wrong-but-same-length prefix character (a
  // capital "V", or any other single character) strips to the SAME remainder
  // and is caught ONLY by the startsWith check — and CI's tag-pipeline rules
  // fire on ANY tag, not merely v-prefixed ones, so this branch is the only
  // thing standing between `V0.301.0` and a publish.
  it("reports drift on a tag with no v prefix", () => {
    expect(classifyTag("0.301.0", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("V0.301.0", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("x0.301.0", "0.301.0").verdict).toBe("drift");
    // `expected` is built from TAG_PREFIX, not copied off the tag under test —
    // pin it here too, or a mutant that returns the wrong tag in `expected`
    // survives this test undetected.
    expect(classifyTag("0.301.0", "0.301.0").expected).toBe("v0.301.0");
  });

  // ★★ A version that is a PREFIX of the tagged one must not pass. Substring
  // comparison is the obvious wrong implementation here.
  it("reports drift when the tag merely starts with the version", () => {
    expect(classifyTag("v0.301.01", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("v0.301.0-rc1", "0.301.0").verdict).toBe("drift");
  });

  // ★★★ UNSCANNABLE IS NOT DRIFT, and conflating them is the failure mode.
  // An empty CI_COMMIT_TAG means this job ran on a pipeline that is not a tag
  // pipeline — a rules bug. Reporting that as "drift" would send the reader to
  // version.ts — a file with nothing wrong in it.
  it("reports unscannable, not drift, on an absent tag", () => {
    expect(classifyTag("", "0.301.0").verdict).toBe("unscannable");
    expect(classifyTag(undefined, "0.301.0").verdict).toBe("unscannable");
    expect(classifyTag("   ", "0.301.0").verdict).toBe("unscannable");
    // Pin the reason text too, or swapping the tag-empty message for the
    // appVersion-empty one survives: it must point at CI's rules, not at
    // version.ts.
    expect(classifyTag("", "0.301.0").reason).toMatch(/rules/);
  });

  it("reports unscannable on an absent app version", () => {
    expect(classifyTag("v0.301.0", "").verdict).toBe("unscannable");
    // ★★ Dropping the `typeof appVersion !== "string"` half of this guard
    // survives every other test here and then THROWS on `undefined` (calling
    // .trim() on it) — a CLI wrapping this would report that as exit 1, the
    // DRIFT code, not "unscannable".
    expect(classifyTag("v0.301.0", undefined).verdict).toBe("unscannable");
  });

  it("exports the prefix it compares against", () => {
    expect(TAG_PREFIX).toBe("v");
  });
});
