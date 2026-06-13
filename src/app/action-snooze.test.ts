import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snoozeAction, getSnoozedActionIds, clearActionSnooze, ACTION_SNOOZE_KEY } from "./action-snooze";

describe("action-snooze", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it("snoozes an action and reports it as dismissed until expiry", () => {
    snoozeAction("raid:1:severity", 1000, 10_000);
    expect(getSnoozedActionIds(10_500).has("raid:1:severity")).toBe(true);
    expect(getSnoozedActionIds(11_001).has("raid:1:severity")).toBe(false); // expired
  });
  it("prunes expired entries from the persisted store on read", () => {
    snoozeAction("a", 100, 0);
    getSnoozedActionIds(1000); // a expired -> pruned
    const raw = window.localStorage.getItem(ACTION_SNOOZE_KEY);
    expect(raw === null || JSON.parse(raw).a === undefined).toBe(true);
  });
  it("clearActionSnooze removes an entry", () => {
    snoozeAction("b", 10_000, 0);
    clearActionSnooze("b");
    expect(getSnoozedActionIds(1).has("b")).toBe(false);
  });
  it("does not throw when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
    expect(() => snoozeAction("c", 1000, 0)).not.toThrow();
    expect(getSnoozedActionIds(0)).toEqual(new Set());
  });
});
