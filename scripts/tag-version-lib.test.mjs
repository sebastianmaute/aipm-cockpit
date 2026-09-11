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

  it("reports drift on a tag with no v prefix", () => {
    expect(classifyTag("0.301.0", "0.301.0").verdict).toBe("drift");
  });

  // ★★ A version that is a PREFIX of the tagged one must not pass. Substring
  // comparison is the obvious wrong implementation here.
  it("reports drift when the tag merely starts with the version", () => {
    expect(classifyTag("v0.301.01", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("v0.301.0-rc1", "0.301.0").verdict).toBe("drift");
  });

  // ★★★ UNSCANNABLE IS NOT DRIFT, and conflating them is the failure mode.
  // An empty CI_COMMIT_TAG means this job ran on a pipeline that is not a tag
  // pipeline — a rules bug. Reporting that as "drift" sends the reader to
  // version.ts, which is fine.
  it("reports unscannable, not drift, on an absent tag", () => {
    expect(classifyTag("", "0.301.0").verdict).toBe("unscannable");
    expect(classifyTag(undefined, "0.301.0").verdict).toBe("unscannable");
    expect(classifyTag("   ", "0.301.0").verdict).toBe("unscannable");
  });

  it("reports unscannable on an absent app version", () => {
    expect(classifyTag("v0.301.0", "").verdict).toBe("unscannable");
  });

  it("exports the prefix it compares against", () => {
    expect(TAG_PREFIX).toBe("v");
  });
});
