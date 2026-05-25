import { describe, it, expect } from "vitest";
import { getUpcomingBirthdays } from "./birthdays";
import type { Resource } from "./types";

const r = (id: number, firstName: string, lastName: string, birthday?: string): Resource =>
  ({ id, firstName, lastName, birthday, roleId: null, utilizationMode: "percent", utilization: {} });

const NO_HOLIDAYS: ReadonlySet<string> = new Set();
const NO_ABSENCES: never[] = [];

describe("getUpcomingBirthdays", () => {
  it("includes a birthday today with daysUntil 0", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-15")], "2026-06-15", 7, NO_HOLIDAYS, NO_ABSENCES);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(0);
  });
  it("includes a birthday within the lead window", () => {
    // event=2026-06-20, leadDays=7, trigger=isoAddDays(06-20,-7)=06-13(Sat)->shift->06-12(Fri); today=06-15>=06-12 => included
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-20")], "2026-06-15", 7, NO_HOLIDAYS, NO_ABSENCES)[0].daysUntil).toBe(5);
  });
  it("excludes a birthday beyond the lead window", () => {
    // event=2026-06-25, trigger=isoAddDays(06-25,-7)=06-18(Thu); today=06-15 < 06-18 => excluded
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-25")], "2026-06-15", 7, NO_HOLIDAYS, NO_ABSENCES)).toHaveLength(0);
  });
  it("excludes a birthday that already passed this year", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-10")], "2026-06-15", 7, NO_HOLIDAYS, NO_ABSENCES)).toHaveLength(0);
  });
  it("handles year-wrap (Dec -> Jan)", () => {
    // event=2027-01-02, leadDays=7, trigger=isoAddDays(2027-01-02,-7)=2026-12-26(Sat)->shift->2026-12-25(Fri)->shift(holiday?)->no holiday, so 12-25(Fri); today=12-30>=12-25 => included
    const out = getUpcomingBirthdays([r(1, "A", "B", "01-02")], "2026-12-30", 7, NO_HOLIDAYS, NO_ABSENCES);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(3);
  });
  it("skips missing or invalid birthdays", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B"), r(2, "C", "D", "13-40")], "2026-06-15", 7, NO_HOLIDAYS, NO_ABSENCES)).toHaveLength(0);
  });
  it("sorts by daysUntil ascending", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-20"), r(2, "C", "D", "06-16")], "2026-06-15", 7, NO_HOLIDAYS, NO_ABSENCES);
    expect(out.map((b) => b.resource.id)).toEqual([2, 1]);
  });
  it("returns [] for an unparseable today", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-15")], "nope", 7, NO_HOLIDAYS, NO_ABSENCES)).toHaveLength(0);
  });
  it("trigger shifts past weekend: birthday on Monday, leadDays=2 → trigger is Friday", () => {
    // event=2026-06-15(Mon), isoAddDays(-2)=2026-06-13(Sat)->shift->2026-06-12(Fri)
    // today=2026-06-12 >= 2026-06-12 and <= 2026-06-15 => included
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-15")], "2026-06-12", 2, NO_HOLIDAYS, NO_ABSENCES);
    expect(out).toHaveLength(1);
    // today=2026-06-11 < 2026-06-12 => excluded
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-15")], "2026-06-11", 2, NO_HOLIDAYS, NO_ABSENCES)).toHaveLength(0);
  });
});
