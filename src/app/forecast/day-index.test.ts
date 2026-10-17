import { describe, expect, test } from "vitest";
import { dayOnOrAfter, dayOnOrBefore, simulatedDates } from "./day-index";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";

describe("simulatedDates", () => {
  test("dates skip weekends and holidays", () => {
    const d = simulatedDates(TODAY, 10, new Set<string>());
    expect(d).toHaveLength(11);
    expect(d[0]).toBe(TODAY);
    expect(d[1]).toBe("2026-10-15");
    expect(d[3]).toBe("2026-10-19");
    const withHoliday = simulatedDates(TODAY, 10, new Set(["2026-10-15"]));
    expect(withHoliday[1]).toBe("2026-10-16");
    expect(withHoliday[2]).toBe("2026-10-19");
  });
});

describe("dayOnOrAfter / dayOnOrBefore", () => {
  const d = simulatedDates(TODAY, 10, new Set<string>());

  test("a Saturday lands on Monday going forward and Friday going back", () => {
    expect(dayOnOrAfter(d, "2026-10-17")).toBe(3);
    expect(dayOnOrBefore(d, "2026-10-17")).toBe(2);
  });

  test("a working day is its own index both ways", () => {
    expect(dayOnOrAfter(d, "2026-10-19")).toBe(3);
    expect(dayOnOrBefore(d, "2026-10-19")).toBe(3);
  });

  test("a past date is day 0", () => {
    expect(dayOnOrAfter(d, "2026-10-01")).toBe(0);
    expect(dayOnOrBefore(d, "2026-10-01")).toBe(0);
    expect(dayOnOrAfter(d, TODAY)).toBe(0);
    expect(dayOnOrBefore(d, TODAY)).toBe(0);
  });

  test("a date past the last simulated day is dates.length", () => {
    expect(d[10]).toBe("2026-10-28");
    expect(dayOnOrAfter(d, "2026-10-29")).toBe(d.length);
    expect(dayOnOrAfter(d, "2026-10-28")).toBe(10);
    expect(dayOnOrBefore(d, "2026-12-31")).toBe(10);
  });
});
