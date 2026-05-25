import { describe, it, expect, beforeEach } from "vitest";
import { getSnoozedUntil, setSnoozedUntil, clearSnooze, SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";

describe("reminder-snooze store", () => {
  beforeEach(() => window.localStorage.clear());
  it("returns null when nothing is stored", () => {
    expect(getSnoozedUntil("due")).toBeNull();
  });
  it("round-trips a future snoozedUntil epoch per kind", () => {
    const until = Date.now() + SNOOZE_1H;
    setSnoozedUntil("due", until);
    expect(getSnoozedUntil("due")).toBe(until);
    expect(getSnoozedUntil("birthday")).toBeNull();
  });
  it("clearSnooze removes the value", () => {
    setSnoozedUntil("birthday", Date.now() + SNOOZE_1H);
    clearSnooze("birthday");
    expect(getSnoozedUntil("birthday")).toBeNull();
  });
  it("treats an already-elapsed snooze as not snoozed", () => {
    setSnoozedUntil("due", Date.now() - 1000);
    expect(getSnoozedUntil("due")).toBeNull();
  });
  it("returns null for invalid stored values", () => {
    window.localStorage.setItem("lop-app:reminder-snooze:due", "nope");
    expect(getSnoozedUntil("due")).toBeNull();
  });
  it("exposes hour + day durations", () => {
    expect(SNOOZE_1H).toBe(60 * 60 * 1000);
    expect(SNOOZE_1D).toBe(24 * 60 * 60 * 1000);
  });
});
