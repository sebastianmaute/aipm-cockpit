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
    expect(APP_HIGHLIGHT_KEYS.at(-1)).toBe("versionHighlightDocumentImageExport");
  });

  it("has no duplicate keys", () => {
    expect(new Set(APP_HIGHLIGHT_KEYS).size).toBe(APP_HIGHLIGHT_KEYS.length);
  });

  // ★★★ WHAT THIS FILE DOES NOT COVER, because it reads like it does: it is NOT
  // a release-bump guard. `at(-1)` is pinned to a LITERAL key, so bumping
  // `APP_VERSION` without adding a highlight at all leaves every test here
  // green. It guards ORDERING — that a key which exists is last — and nothing
  // about whether the release remembered to add one.
  // ★ The assertion below is deliberately loose for the same reason.
  it("names a released version and milestone", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_MILESTONE.length).toBeGreaterThan(0);
  });
});
