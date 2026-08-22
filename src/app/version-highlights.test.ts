import { describe, it, expect } from "vitest";
import { APP_HIGHLIGHT_KEYS, APP_VERSION, APP_MILESTONE } from "./version";

// ★★ The Version popover renders APP_HIGHLIGHT_KEYS in ARRAY ORDER
// (`version-info.tsx` maps it with no sort and no reverse), and the list is
// chronological, so the current release's note belongs LAST. A release that
// inserts its key mid-array puts its own headline behind every prior entry.
// That shipped once — 0.254.0's key landed at index 212 of 272 — and nothing
// reported it, because until this file NOTHING asserted the ordering at all.
describe("APP_HIGHLIGHT_KEYS", () => {
  it("ends with the current release's highlight, so the newest note renders last", () => {
    expect(APP_HIGHLIGHT_KEYS.at(-1)).toBe("versionHighlightIconSet");
  });

  it("has no duplicate keys", () => {
    expect(new Set(APP_HIGHLIGHT_KEYS).size).toBe(APP_HIGHLIGHT_KEYS.length);
  });

  // ★ Deliberately loose: this is a reminder to bump the key above when the
  // version moves, not a pin on the version string itself.
  it("names a released version and milestone", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_MILESTONE.length).toBeGreaterThan(0);
  });
});
