import { describe, it, expect, beforeEach } from "vitest";
import { loadDismissed, dismissView } from "./view-hints-store";

const KEY = "aipm-cockpit:view-hints";

describe("view-hints-store", () => {
  beforeEach(() => localStorage.clear());

  it("returns no dismissals when storage is absent", () => {
    expect(loadDismissed()).toEqual({});
  });

  it("returns no dismissals when storage is malformed", () => {
    localStorage.setItem(KEY, "not json");
    expect(loadDismissed()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ nope: 1 }));
    expect(loadDismissed()).toEqual({});
  });

  it("persists a dismissal and round-trips it", () => {
    const next = dismissView("raid", false);
    expect(next.raid).toBe(true);
    expect(loadDismissed()).toEqual({ raid: true });
    dismissView("budget", false);
    expect(loadDismissed()).toEqual({ raid: true, budget: true });
  });

  it("does not persist in popout mode but still reports the new map", () => {
    const next = dismissView("raid", true);
    expect(next.raid).toBe(true);
    expect(loadDismissed()).toEqual({});
  });
});
