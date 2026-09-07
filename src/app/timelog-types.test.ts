import { describe, expect, it } from "vitest";
import { dailyKey, parseDailyKey } from "./timelog-types";

describe("parseDailyKey", () => {
  it("round-trips a key built by dailyKey", () => {
    expect(parseDailyKey(dailyKey(7, "2026-09-01"))).toEqual({ userId: 7, date: "2026-09-01" });
  });

  // ★★ The oversized key is the shape open-followups §367 is named for: before
  // this check it parsed successfully and was a single roll cell larger than
  // MAX_DAILY_ROLL_CHARS on its own.
  it("rejects a date half that is not ISO-shaped", () => {
    expect(parseDailyKey("7|tomorrow")).toBeNull();
    expect(parseDailyKey("7|2026-9-1")).toBeNull();
    expect(parseDailyKey("7|2026-09-01T00:00:00Z")).toBeNull();
    expect(parseDailyKey(`7|${"x".repeat(600000)}`)).toBeNull();
  });

  // ★★★ THE NEGATIVE CONTROL, AND IT IS THE ONE THAT MUST NOT BE DELETED. This
  // is a SHAPE rule, never an existence rule: the check exists to make `<`/`>`
  // comparisons on the date lexicographically meaningful downstream, not to
  // certify that a date exists. Without this assertion, "tighten it to a real
  // calendar date" reads as a safe improvement — and it is not, because
  // `timelog-policy.ts` compares violation bounds against a roll window with
  // plain string comparison and never asks whether either end is a real day.
  it("admits an ISO-SHAPED date that is not a real day", () => {
    expect(parseDailyKey("7|9999-99-99")).toEqual({ userId: 7, date: "9999-99-99" });
  });

  it("still rejects a missing separator, an empty userId and a non-integer userId", () => {
    expect(parseDailyKey("no-pipe")).toBeNull();
    expect(parseDailyKey("|2026-09-01")).toBeNull();
    expect(parseDailyKey("7.5|2026-09-01")).toBeNull();
  });
});
