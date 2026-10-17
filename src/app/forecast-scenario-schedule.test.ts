import { describe, expect, it } from "vitest";
import { simulatedDates } from "./forecast/day-index";
import type { ScenarioDirectory, ScheduleContext } from "./forecast-added-people";
import { buildScenarioSchedule } from "./forecast-scenario-schedule";
import type { AddPeopleChange, AvailabilityChange, ScopeChange } from "./forecast-scenarios";
import type { Milestone, Resource } from "./types";

const TODAY = "2026-10-14"; // a Wednesday
const NONE: ReadonlySet<string> = new Set();
const HORIZON = 30;
const DATES = simulatedDates(TODAY, HORIZON, NONE); // 1 = Thu 10-15, 2 = Fri 10-16, 3 = Mon 10-19

function directory(over: Partial<ScenarioDirectory> = {}): ScenarioDirectory {
  return {
    resources: [], roles: [], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
    ...over,
  };
}
function ctx(over: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    today: TODAY, holidaySet: NONE, dates: DATES, tasks: [], milestones: [], directory: directory(),
    windowDates: [], hoursFacts: null, onTeam: new Set(), teamHours: 8,
    ...over,
  };
}
function avail(percent: number, from = TODAY, until = ""): AvailabilityChange {
  return { kind: "availability", percent, from, until };
}
function placeholder(hoursPerWeek: number, rate = 100): AddPeopleChange {
  return { kind: "addPeople", who: { label: "Dev", count: 1, rate, currency: "EUR", hoursPerWeek }, from: TODAY, until: "", rampWeeks: 0 };
}
function scope(tasks: number, on: string, milestoneId?: number): ScopeChange {
  return milestoneId === undefined ? { kind: "scope", tasks, on } : { kind: "scope", tasks, on, milestoneId };
}
function milestone(id: number, over: Partial<Milestone> = {}): Milestone {
  return { id, title: `m${id}`, date: "2026-12-01", ...over } as Milestone;
}

describe("buildScenarioSchedule", () => {
  it("every per-day array is horizon + 1 long, as the engine and the cost pass require", () => {
    const s = buildScenarioSchedule([avail(80), placeholder(20)], ctx());
    expect(s.changes.capacityByDay.length).toBe(HORIZON + 1);
    expect(s.spendScale.length).toBe(HORIZON + 1);
    expect(s.addedCost.length).toBe(HORIZON + 1);
    const empty = buildScenarioSchedule([], ctx());
    expect([...empty.changes.capacityByDay.slice(1)].every((v) => v === 1)).toBe(true);
    expect([...empty.spendScale.slice(1)].every((v) => v === 1)).toBe(true);
    expect([...empty.addedCost].every((v) => v === 0)).toBe(true);
    expect(empty.changes.arrivals).toEqual([]);
  });

  it("overlapping availability multiplies, then clamps", () => {
    const a = buildScenarioSchedule([avail(130), avail(40)], ctx());
    expect(a.changes.capacityByDay[1]).toBeCloseTo(0.52, 12);
    expect(a.spendScale[1]).toBeCloseTo(0.52, 12);
    const b = buildScenarioSchedule([avail(300), avail(300)], ctx());
    expect(b.changes.capacityByDay[1]).toBe(3);
    expect(b.spendScale[1]).toBe(3);
    const c = buildScenarioSchedule([avail(10), avail(10)], ctx());
    expect(c.changes.capacityByDay[1]).toBe(0.1);
  });

  it("added shares are added after the clamp and not clamped", () => {
    // Placeholder 20 h/week = 4 h a day over a team of 8 h a day = share 0.5.
    const s = buildScenarioSchedule([avail(80), placeholder(20)], ctx());
    expect(s.changes.capacityByDay[1]).toBeCloseTo(1.3, 12);
    expect(s.spendScale[1]).toBeCloseTo(0.8, 12);
    expect(s.addedCost[1]).toBe(4 * 100);
    // At the clamp's ceiling the share still adds on top: 3 + 0.5, not 3.
    const top = buildScenarioSchedule([avail(300), avail(300), placeholder(20)], ctx());
    expect(top.changes.capacityByDay[1]).toBeCloseTo(3.5, 12);
    expect(top.spendScale[1]).toBe(3);
  });

  it("a past from counts from day 1; an until before today is ended", () => {
    const past = buildScenarioSchedule([avail(50, "2026-09-01")], ctx());
    expect(past.changes.capacityByDay[1]).toBe(0.5);
    expect(past.changes.capacityByDay[HORIZON]).toBe(0.5);
    expect(past.rows).toEqual([{ kind: "availability", ended: false }]);
    const ended = buildScenarioSchedule([avail(50, "2026-09-01", "2026-10-13")], ctx());
    expect(ended.rows).toEqual([{ kind: "availability", ended: true }]);
    expect([...ended.changes.capacityByDay.slice(1)].every((v) => v === 1)).toBe(true);
  });

  it("a Saturday change applies from Monday", () => {
    const s = buildScenarioSchedule([avail(50, "2026-10-17", "2026-10-24")], ctx()); // Sat .. Sat
    const cap = s.changes.capacityByDay;
    expect([cap[1], cap[2], cap[3]]).toEqual([1, 1, 0.5]); // Thu, Fri, Mon
    expect(DATES[7]).toBe("2026-10-23");
    expect([cap[7], cap[8]]).toEqual([0.5, 1]); // last day is Fri 10-23
  });

  it("a from past the last simulated day applies on no day", () => {
    const s = buildScenarioSchedule([avail(50, "2027-06-01")], ctx());
    expect([...s.changes.capacityByDay.slice(1)].every((v) => v === 1)).toBe(true);
    expect(s.rows).toEqual([{ kind: "availability", ended: false }]);
  });

  it("a gone milestone counts as unattributed and is flagged", () => {
    const milestones = [milestone(1), milestone(2, { achievedDate: "2026-10-01" }), milestone(3, { date: "" })];
    const changes = [
      scope(5, "2026-10-20", 1), scope(3, "2026-10-20", 2), scope(2, "2026-10-20", 3), scope(4, "2026-10-20", 99),
      scope(-1, "2026-09-01"), scope(6, "2027-06-01"),
    ];
    const s = buildScenarioSchedule(changes, ctx({ milestones }));
    expect(s.changes.arrivals).toEqual([
      { day: 4, tasks: 5, milestoneId: 1 },
      { day: 4, tasks: 3, milestoneId: null },
      { day: 4, tasks: 2, milestoneId: null },
      { day: 4, tasks: 4, milestoneId: null },
      { day: 0, tasks: -1, milestoneId: null },
      { day: HORIZON, tasks: 6, milestoneId: null },
    ]);
    expect(s.rows).toEqual([
      { kind: "scope", milestoneGone: false },
      { kind: "scope", milestoneGone: true },
      { kind: "scope", milestoneGone: true },
      { kind: "scope", milestoneGone: true },
      { kind: "scope", milestoneGone: false },
      { kind: "scope", milestoneGone: false },
    ]);
  });

  it("addedShareAtFullSpeed sums the sized rows", () => {
    const r: Resource = { id: 1, firstName: "Ann", lastName: "Lee", roleId: null, utilizationMode: "percent", utilization: {} };
    const gone: AddPeopleChange = { kind: "addPeople", who: { resourceId: 99, hoursPerWeek: 40 }, from: TODAY, until: "", rampWeeks: 4 };
    const ann: AddPeopleChange = { ...gone, who: { resourceId: 1, hoursPerWeek: 40 } };
    const s = buildScenarioSchedule([ann, gone], ctx({ teamHours: 31, directory: directory({ resources: [r] }) }));
    expect(s.teamHoursPerDay).toBe(31);
    expect(s.addedShareAtFullSpeed).toBeCloseTo(8 / 31, 12);
    expect(s.rows[0]).toMatchObject({ kind: "addPeople", status: { kind: "sized", name: "Ann Lee", rateNote: "no-rate" } });
    expect(s.rows[1]).toEqual({ kind: "addPeople", status: { kind: "inert", reason: "person-gone" } });
  });
});
