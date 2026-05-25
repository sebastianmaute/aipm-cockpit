import { describe, it, expect, beforeEach } from "vitest";
import { getSnoozedUntil, setSnoozedUntil, clearSnooze, SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";

describe("reminder-snooze store", () => {
  beforeEach(() => window.localStorage.clear());
  it("returns null when nothing is stored", () => {
    expect(getSnoozedUntil("due")).toBeNull();
  });
  it("round-trips a snoozedUntil epoch per kind", () => {
    setSnoozedUntil("due", 1_000_000);
    expect(getSnoozedUntil("due")).toBe(1_000_000);
    expect(getSnoozedUntil("birthday")).toBeNull();
  });
  it("clearSnooze removes the value", () => {
    setSnoozedUntil("birthday", 1_000_000);
    clearSnooze("birthday");
    expect(getSnoozedUntil("birthday")).toBeNull();
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
