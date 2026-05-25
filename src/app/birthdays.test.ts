import { describe, it, expect } from "vitest";
import { getUpcomingBirthdays } from "./birthdays";
import type { Resource } from "./types";

const r = (id: number, firstName: string, lastName: string, birthday?: string): Resource =>
  ({ id, firstName, lastName, birthday, roleId: null, utilizationMode: "percent", utilization: {} });

describe("getUpcomingBirthdays", () => {
  it("includes a birthday today with daysUntil 0", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-15")], "2026-06-15", 7);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(0);
  });
  it("includes a birthday within the lead window", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-20")], "2026-06-15", 7)[0].daysUntil).toBe(5);
  });
  it("excludes a birthday beyond the lead window", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-25")], "2026-06-15", 7)).toHaveLength(0);
  });
  it("excludes a birthday that already passed this year", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-10")], "2026-06-15", 7)).toHaveLength(0);
  });
  it("handles year-wrap (Dec -> Jan)", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "01-02")], "2026-12-30", 7);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(3);
  });
  it("skips missing or invalid birthdays", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B"), r(2, "C", "D", "13-40")], "2026-06-15", 7)).toHaveLength(0);
  });
  it("sorts by daysUntil ascending", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-20"), r(2, "C", "D", "06-16")], "2026-06-15", 7);
    expect(out.map((b) => b.resource.id)).toEqual([2, 1]);
  });
  it("returns [] for an unparseable today", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-15")], "nope", 7)).toHaveLength(0);
  });
});
