import { describe, expect, it } from "vitest";
import {
  MAX_CALENDAR_SPAN_DAYS,
  monthWindow,
  weekWindow,
  customWindow,
  stepAnchor,
  resolveWindow,
} from "./calendar-window";

describe("monthWindow", () => {
  it("returns first..last day of the anchor's month", () => {
    expect(monthWindow("2026-06-15")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
  });
  it("handles 31-day months and December→year boundary", () => {
    expect(monthWindow("2026-07-04")).toEqual({ startDate: "2026-07-01", endDate: "2026-07-31" });
    expect(monthWindow("2026-12-25")).toEqual({ startDate: "2026-12-01", endDate: "2026-12-31" });
  });
  it("handles February in a leap year", () => {
    expect(monthWindow("2028-02-10")).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29" });
  });
});

describe("weekWindow", () => {
  it("returns Monday..Sunday of the anchor's week", () => {
    expect(weekWindow("2026-06-15")).toEqual({ startDate: "2026-06-15", endDate: "2026-06-21" });
    expect(weekWindow("2026-06-21")).toEqual({ startDate: "2026-06-15", endDate: "2026-06-21" });
  });
  it("handles a week spanning a month boundary", () => {
    expect(weekWindow("2026-07-01")).toEqual({ startDate: "2026-06-29", endDate: "2026-07-05" });
  });
});

describe("customWindow", () => {
  it("passes through an ordered range", () => {
    expect(customWindow("2026-06-01", "2026-06-10")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-10" });
  });
  it("swaps a reversed range", () => {
    expect(customWindow("2026-06-10", "2026-06-01")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-10" });
  });
  it("clamps a span longer than the max", () => {
    const w = customWindow("2026-01-01", "2030-01-01");
    expect(w.startDate).toBe("2026-01-01");
    const days = Math.round((Date.parse(w.endDate) - Date.parse(w.startDate)) / 86400000);
    expect(days).toBe(MAX_CALENDAR_SPAN_DAYS);
  });
});

describe("stepAnchor", () => {
  it("steps by one month", () => {
    expect(stepAnchor("2026-06-15", "month", 1)).toBe("2026-07-15");
    expect(stepAnchor("2026-01-15", "month", -1)).toBe("2025-12-15");
  });
  it("steps by one week", () => {
    expect(stepAnchor("2026-06-15", "week", 1)).toBe("2026-06-22");
    expect(stepAnchor("2026-06-15", "week", -1)).toBe("2026-06-08");
  });
});

describe("resolveWindow", () => {
  it("dispatches on mode", () => {
    expect(resolveWindow("month", "2026-06-15", "2026-06-03", "2026-06-09"))
      .toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(resolveWindow("week", "2026-06-15", "2026-06-03", "2026-06-09"))
      .toEqual({ startDate: "2026-06-15", endDate: "2026-06-21" });
    expect(resolveWindow("custom", "2026-06-15", "2026-06-03", "2026-06-09"))
      .toEqual({ startDate: "2026-06-03", endDate: "2026-06-09" });
  });
  it("falls back to a degenerate window on unparseable input", () => {
    expect(resolveWindow("month", "nope", "", "")).toEqual({ startDate: "nope", endDate: "nope" });
  });
});
