import { beforeAll, describe, it, expect } from "vitest";
import { loadI18n, t } from "./i18n";
import { APP_HIGHLIGHT_KEYS, APP_VERSION, APP_MILESTONE } from "./version";

// The Version panel's highlights are a fixed elevator pitch of what is unique to
// the app, NOT a per-release history (CHANGELOG.md owns that). They used to grow
// by one key per release and had reached 275 entries, so the panel read as a
// changelog. Pinning the exact list makes a release that appends a key fail here.
describe("APP_HIGHLIGHT_KEYS", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("is the fixed five-point pitch, in display order", () => {
    expect([...APP_HIGHLIGHT_KEYS]).toEqual([
      "versionHighlightCopilot",
      "versionHighlightLimits",
      "versionHighlightStack",
      "versionHighlightLocalFirst",
      "versionHighlightScales",
    ]);
  });

  it("has no duplicate keys", () => {
    expect(new Set(APP_HIGHLIGHT_KEYS).size).toBe(APP_HIGHLIGHT_KEYS.length);
  });

  it("has a real English string and a German one that differs from it for every key", () => {
    for (const k of APP_HIGHLIGHT_KEYS) {
      const en = t("en-US", k);
      const de = t("de", k);
      expect(en, k).not.toBe(k);
      expect(en.length, k).toBeGreaterThan(20);
      expect(de, k).not.toBe(en);
    }
  });

  it("names a released version and milestone", () => {
    // A prerelease suffix (1.14.0-rc.1) is a released version too.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(APP_MILESTONE.length).toBeGreaterThan(0);
  });
});
