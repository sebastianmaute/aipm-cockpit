import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { moveToolbarFocus } from "./toolbar-roving";

// An arbitrary row size. The engine is count-agnostic; the REAL row size is
// pinned against the DOM by TOOLBAR_CONTROL_COUNT in rich-text-toolbar.test.tsx.
const N = 15;

describe("moveToolbarFocus", () => {
  it("steps right and left", () => {
    expect(moveToolbarFocus(N, 0, "ArrowRight")).toBe(1);
    expect(moveToolbarFocus(N, 5, "ArrowLeft")).toBe(4);
  });

  it("wraps in both directions", () => {
    expect(moveToolbarFocus(N, N - 1, "ArrowRight")).toBe(0);
    expect(moveToolbarFocus(N, 0, "ArrowLeft")).toBe(N - 1);
  });

  it("jumps to the ends with Home and End", () => {
    expect(moveToolbarFocus(N, 7, "Home")).toBe(0);
    expect(moveToolbarFocus(N, 7, "End")).toBe(N - 1);
  });

  // ★ Up/Down are deliberately NOT handled: the row is horizontal, and
  // swallowing them would eat page scroll for no gain.
  it("leaves keys outside the model alone, so the caller does not preventDefault", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Tab", "a", "Escape"]) {
      expect(moveToolbarFocus(N, 3, key)).toBeNull();
    }
  });

  // ★ band-roving.ts's precedent: Alt+Left is browser Back. Swallowing a chord
  // from a toolbar control breaks navigation for keyboard users.
  it("ignores chords, leaving them to the browser or OS", () => {
    expect(moveToolbarFocus(N, 3, "ArrowLeft", { altKey: true })).toBeNull();
    expect(moveToolbarFocus(N, 3, "ArrowRight", { ctrlKey: true })).toBeNull();
    expect(moveToolbarFocus(N, 3, "Home", { metaKey: true })).toBeNull();
  });

  it("returns null for an empty row", () => {
    expect(moveToolbarFocus(0, 0, "ArrowRight")).toBeNull();
  });

  // ★ A stale index can outlive its row (a control added or removed between
  // render and keypress). Clamp rather than throw or return an out-of-range hit.
  it("clamps a stale index instead of returning an out-of-range one", () => {
    expect(moveToolbarFocus(N, 99, "ArrowRight")).toBe(0);
    expect(moveToolbarFocus(N, -4, "ArrowLeft")).toBe(N - 1);
  });

  it("always returns a valid index for a handled bare key", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: -20, max: 70 }),
        fc.constantFrom("ArrowLeft", "ArrowRight", "Home", "End"),
        (count, index, key) => {
          const next = moveToolbarFocus(count, index, key);
          expect(next).not.toBeNull();
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        },
      ),
    );
  });
});
