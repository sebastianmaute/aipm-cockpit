import { describe, expect, it } from "vitest";
import type { ForecastFacts } from "./budget-forecast";
import { simulatedDates } from "./forecast/day-index";
import {
  onTeamResourceIds,
  resolveAddedPeople,
  shiftFor,
  teamHoursPerDay,
  type ScenarioDirectory,
  type ScheduleContext,
} from "./forecast-added-people";
import type { AddPeopleChange } from "./forecast-scenarios";
import { currencyToBase } from "./fx";
import { buildResourceWorkload } from "./resource-workload-rows";
import type { Absence, BudgetBucket, FxRates, Resource, Role, Shift, Task } from "./types";
import { workingDaysBefore } from "./working-days";

const TODAY = "2026-10-14"; // a Wednesday
const NONE: ReadonlySet<string> = new Set();
const HORIZON = 30;
const DATES = simulatedDates(TODAY, HORIZON, NONE); // 1 = Thu 10-15, 2 = Fri 10-16, 3 = Mon 10-19
const WINDOW = workingDaysBefore(TODAY, 12, NONE);

function resource(id: number, over: Partial<Resource> = {}): Resource {
  return { id, firstName: `P${id}`, lastName: "X", roleId: null, utilizationMode: "percent", utilization: {}, ...over };
}
function role(id: number, over: Partial<Role> = {}): Role {
  return { id, disciplineId: 1, gradeId: 1, internalRate: 50, externalRate: 90, ...over };
}
function shift(id: number, hoursPerWeekday: Shift["hoursPerWeekday"], over: Partial<Shift> = {}): Shift {
  return { id, assignee: "", hoursPerWeekday, ...over };
}
function task(id: number, over: Partial<Task> = {}): Task {
  return { id, taskName: `t${id}`, assignee: "", assigneeEmail: "", status: "To Do", ...over } as Task;
}
function directory(over: Partial<ScenarioDirectory> = {}): ScenarioDirectory {
  return {
    resources: [], roles: [], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
    ...over,
  };
}
function ctx(over: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    today: TODAY, holidaySet: NONE, dates: DATES, tasks: [], milestones: [], directory: directory(),
    windowDates: WINDOW, hoursFacts: null, onTeam: new Set(), teamHours: 8,
    ...over,
  };
}
function facts(dated: { date: string; value: number }[]): ForecastFacts {
  return {
    bac: 0, ac: 0, ev: null, pv: 0, bucketsMissingPercent: [],
    dated: dated.map((d) => ({ date: d.date, bookedFrom: d.date, value: d.value, spread: false })),
    planEnd: "2027-01-01", today: TODAY, holidaySet: NONE, hasFixedPrice: false,
  };
}
function person(resourceId: number, hoursPerWeek: number, over: Partial<AddPeopleChange> = {}): AddPeopleChange {
  return { kind: "addPeople", who: { resourceId, hoursPerWeek }, from: TODAY, until: "", rampWeeks: 0, ...over };
}
function placeholder(
  hoursPerWeek: number,
  over: Partial<AddPeopleChange> = {},
  money: { rate: number; currency: "EUR" | "USD" | "GBP" } = { rate: 100, currency: "EUR" },
): AddPeopleChange {
  return { kind: "addPeople", who: { label: "Dev", count: 1, hoursPerWeek, ...money }, from: TODAY, until: "", rampWeeks: 0, ...over };
}

describe("teamHoursPerDay", () => {
  it("team hours are booked hours over every window day, zero days included", () => {
    // 12 window days, 20 h on six of them (the first among them) = 120 h -> 10 h per day.
    const booked = [0, 2, 4, 6, 8, 10].map((i) => ({ date: WINDOW[i], value: 20 }));
    const outside = { date: "2026-09-01", value: 500 }; // before the window: not a window day
    expect(teamHoursPerDay(facts([...booked, outside]), WINDOW)).toBe(10);
  });

  it("team hours are null below the spend floor, all zero, or under 1 h", () => {
    expect(teamHoursPerDay(null, WINDOW)).toBeNull();
    // First booking on window day 3: 9 samples, under MIN_SPEND_WORKING_DAYS (10).
    expect(teamHoursPerDay(facts([{ date: WINDOW[3], value: 100 }]), WINDOW)).toBeNull();
    expect(teamHoursPerDay(facts(WINDOW.map((date) => ({ date, value: 0 }))), WINDOW)).toBeNull();
    // 1 h over 12 days.
    expect(teamHoursPerDay(facts([{ date: WINDOW[0], value: 0.5 }, { date: WINDOW[11], value: 0.5 }]), WINDOW)).toBeNull();
    // Exactly 1 h per day is sized.
    expect(teamHoursPerDay(facts([{ date: WINDOW[0], value: 12 }]), WINDOW)).toBe(1);
  });
});

describe("onTeamResourceIds", () => {
  it("a budget allocation or a task completed inside the window puts a person on the team; one completed before the window does not", () => {
    const bucket = {
      id: 1, allocations: [{ roleId: 1, resourceIds: [1], budgetHours: {}, actualHours: {} }],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [2], budgetHours: {}, actualHours: {} }],
    } as unknown as BudgetBucket;
    const dir = directory({ resources: [1, 2, 3, 4, 5, 6].map((id) => resource(id)), budgets: [bucket] });
    const tasks = [
      task(1, { status: "Done", completedDate: WINDOW[5], resourceId: 3 }),
      task(2, { status: "Done", completedDate: WINDOW[6], assignee: "  p4 x " }),
      task(3, { status: "Done", completedDate: "2026-09-01", resourceId: 5 }),
      task(4, { status: "In Progress", resourceId: 6 }),
    ];
    expect([...onTeamResourceIds(tasks, dir, WINDOW)].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("resolveAddedPeople", () => {
  it("arrays are dates.length long (horizon + 1) and index 0 stays unused", () => {
    const { share, cost } = resolveAddedPeople(placeholder(40), ctx());
    expect(share.length).toBe(HORIZON + 1);
    expect(cost.length).toBe(HORIZON + 1);
    expect(share[0]).toBe(0);
    expect(cost[0]).toBe(0);
  });

  it("a Shift's weekday hours are rescaled to hoursPerWeek and its weekend hours ignored", () => {
    const dir = directory({
      resources: [resource(1, { roleId: 1 })], roles: [role(1)], shifts: [shift(1, [4, 8, 8, 8, 8, 8, 4], { resourceId: 1 })],
    });
    const { status, share, cost } = resolveAddedPeople(person(1, 20), ctx({ directory: dir }));
    expect(status).toEqual({ kind: "sized", name: "P1 X", weeklyHours: 20, ratePerHour: 50, rateNote: "ok", shareAtFullSpeed: 0.5 });
    for (let d = 1; d <= HORIZON; d += 1) {
      expect(share[d]).toBeCloseTo(4 / 8, 12);
      expect(cost[d]).toBeCloseTo(4 * 50, 12);
    }
  });

  it("a Shift matched by name follows its weekday proportions; one with no weekday hours splits evenly", () => {
    const byName = directory({ resources: [resource(1)], shifts: [shift(1, [0, 10, 0, 0, 0, 10, 0], { assignee: " p1 X" })] });
    const named = resolveAddedPeople(person(1, 20), ctx({ directory: byName }));
    expect([named.share[1], named.share[2], named.share[3]]).toEqual([0, 10 / 8, 10 / 8]); // Thu, Fri, Mon
    const weekendOnly = directory({ resources: [resource(1)], shifts: [shift(1, [8, 0, 0, 0, 0, 0, 8], { resourceId: 1 })] });
    expect(resolveAddedPeople(person(1, 20), ctx({ directory: weekendOnly })).share[1]).toBe(4 / 8);
    // No Shift at all: DEFAULT_WEEK_HOURS, an even Mon-Fri split.
    expect(resolveAddedPeople(person(1, 20), ctx({ directory: directory({ resources: [resource(1)] }) })).share[1]).toBe(4 / 8);
  });

  it("an absence removes that day's hours from delivery and cost", () => {
    const absence = { id: 1, assignee: "", startDate: "2026-10-16", endDate: "2026-10-16", type: "vacation", resourceId: 1 } as Absence;
    const dir = directory({ resources: [resource(1, { roleId: 1 })], roles: [role(1)], absences: [absence] });
    const { share, cost } = resolveAddedPeople(person(1, 40), ctx({ directory: dir }));
    expect([share[1], share[2], share[3]]).toEqual([1, 0, 1]);
    expect([cost[1], cost[2], cost[3]]).toEqual([400, 0, 400]);
  });

  it("ramp counts from the stored from, so a past start keeps its progress", () => {
    const from = workingDaysBefore(TODAY, 10, NONE)[0]; // 2026-09-30: today is w = 11
    expect(from).toBe("2026-09-30");
    const { share, cost } = resolveAddedPeople(placeholder(40, { from, rampWeeks: 4 }), ctx());
    expect(share[1]).toBeCloseTo(12 / 20, 12);
    expect(share[2]).toBeCloseTo(13 / 20, 12);
    expect(share[9]).toBe(1); // w = 20
    expect(share[HORIZON]).toBe(1);
    expect(cost[1]).toBe(8 * 100); // ramp-up does not reduce cost
    // A future start: its first working day counts 1.
    const later = resolveAddedPeople(placeholder(40, { from: DATES[3], rampWeeks: 4 }), ctx());
    expect([later.share[2], later.share[3], later.share[4]]).toEqual([0, 1 / 20, 2 / 20]);
    expect([later.cost[2], later.cost[3]]).toEqual([0, 800]);
  });

  it("rampWeeks 0 is full speed at once", () => {
    const { share } = resolveAddedPeople(placeholder(40, { rampWeeks: 0 }), ctx());
    expect(share[1]).toBe(1);
  });

  it("a placeholder converts its rate to the baseline at read time", () => {
    const fxRates: FxRates = { base: "EUR", date: "2026-10-13", fetchedAt: "2026-10-13T16:00:00Z", rates: { USD: 1.25 } };
    const dir = directory({ fxRates });
    const usd = resolveAddedPeople(placeholder(40, {}, { rate: 100, currency: "USD" }), ctx({ directory: dir }));
    const expected = currencyToBase(100, { currency: "USD" }, fxRates, "EUR");
    expect(expected).toBe(80);
    expect(usd.status).toMatchObject({ kind: "sized", name: "Dev", ratePerHour: expected, rateNote: "ok" });
    expect(usd.cost[1]).toBe(8 * 80);
    const gbp = resolveAddedPeople(placeholder(40, {}, { rate: 100, currency: "GBP" }), ctx({ directory: dir }));
    expect(gbp.status).toMatchObject({ kind: "sized", ratePerHour: 100, rateNote: "at-par" });
  });

  it("a placeholder's count multiplies its hours", () => {
    const change: AddPeopleChange = {
      kind: "addPeople", who: { label: "Devs", count: 3, rate: 10, currency: "EUR", hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 0,
    };
    const { status, share, cost } = resolveAddedPeople(change, ctx());
    expect(status).toMatchObject({ kind: "sized", weeklyHours: 60, shareAtFullSpeed: 12 / 8 });
    expect(share[1]).toBe(12 / 8);
    expect(cost[1]).toBe(120);
  });

  it("an external directory person adds delivery and no cost", () => {
    const dir = directory({ resources: [resource(1, { roleId: 1, isExternal: true })], roles: [role(1)] });
    const { status, share, cost } = resolveAddedPeople(person(1, 40), ctx({ directory: dir }));
    expect(status).toMatchObject({ kind: "sized", ratePerHour: 0, rateNote: "external" });
    expect(share[1]).toBe(1);
    expect(cost.every((c) => c === 0)).toBe(true);
  });

  it("no role means rate 0 with no-rate", () => {
    const noRole = resolveAddedPeople(person(1, 40), ctx({ directory: directory({ resources: [resource(1)] }) }));
    expect(noRole.status).toMatchObject({ kind: "sized", ratePerHour: 0, rateNote: "no-rate" });
    expect(noRole.share[1]).toBe(1);
    const zero = directory({ resources: [resource(1, { roleId: 1 })], roles: [role(1, { internalRate: 0 })] });
    expect(resolveAddedPeople(person(1, 40), ctx({ directory: zero })).status).toMatchObject({ ratePerHour: 0, rateNote: "no-rate" });
    // A day-basis role is read through materializeRoleRates: 400 a day over 8 h = 50 an hour.
    const day = directory({ resources: [resource(1, { roleId: 1 })], roles: [role(1, { rateBasis: "day", internalRateDay: 400, internalRate: 7 })] });
    expect(resolveAddedPeople(person(1, 40), ctx({ directory: day })).status).toMatchObject({ ratePerHour: 50, rateNote: "ok" });
  });

  it("a gone person is inert", () => {
    const { status, share, cost } = resolveAddedPeople(person(99, 40), ctx({ teamHours: null }));
    expect(status).toEqual({ kind: "inert", reason: "person-gone" });
    expect(share.every((s) => s === 0) && cost.every((c) => c === 0)).toBe(true);
    expect(share.length).toBe(HORIZON + 1);
  });

  it("a person who completed a task inside the window goes inert", () => {
    const dir = directory({ resources: [resource(1)] });
    const tasks = [task(1, { status: "Done", completedDate: WINDOW[11], resourceId: 1 })];
    const onTeam = onTeamResourceIds(tasks, dir, WINDOW);
    const { status, share } = resolveAddedPeople(person(1, 40, { until: "2026-10-01" }), ctx({ directory: dir, tasks, onTeam }));
    expect(status).toEqual({ kind: "inert", reason: "on-team" }); // on-team is checked before ended
    expect(share.every((s) => s === 0)).toBe(true);
  });

  it("an until before today is inert with ended, checked before booked hours", () => {
    const { status } = resolveAddedPeople(placeholder(40, { from: "2026-09-01", until: "2026-10-13" }), ctx({ teamHours: null }));
    expect(status).toEqual({ kind: "inert", reason: "ended" });
  });

  it("without team hours the row is inert with needs-booked-hours", () => {
    const { status, cost } = resolveAddedPeople(placeholder(40), ctx({ teamHours: null }));
    expect(status).toEqual({ kind: "inert", reason: "needs-booked-hours" });
    expect(cost.every((c) => c === 0)).toBe(true);
  });
});

describe("shiftFor", () => {
  const WEEK: Shift["hoursPerWeekday"] = [0, 8, 8, 8, 8, 8, 0];
  // The join under test is buildResourceWorkload's: each case is checked against its `row.shift` too.
  function workloadShift(dir: ScenarioDirectory, id: number): Shift | null | undefined {
    return buildResourceWorkload(dir.resources, [], [], dir.shifts, [], TODAY).managed.find((m) => m.resource.id === id)?.shift;
  }
  function expectJoin(dir: ScenarioDirectory, id: number, expected: Shift | undefined) {
    expect(shiftFor(dir.resources.find((r) => r.id === id)!, dir)).toBe(expected);
    expect(workloadShift(dir, id) ?? undefined).toBe(expected);
  }

  it("the last matching Shift wins, and a name match may follow an id match", () => {
    const byId1 = shift(1, WEEK, { resourceId: 1 });
    const byId2 = shift(2, WEEK, { resourceId: 1 });
    expectJoin(directory({ resources: [resource(1)], shifts: [byId1, byId2] }), 1, byId2);
    const byName = shift(3, WEEK, { assignee: "P1 x " });
    expectJoin(directory({ resources: [resource(1)], shifts: [byId1, byName] }), 1, byName);
    expectJoin(directory({ resources: [resource(1)], shifts: [byName, byId1] }), 1, byId1);
  });

  it("a name joins the first resource carrying it; a Shift on another known resource never joins by name", () => {
    const twin = resource(2, { firstName: "P1" }); // display name "P1 X", as resource 1
    const named = shift(1, WEEK, { assignee: "p1 x" });
    const dir = directory({ resources: [resource(1), twin], shifts: [named] });
    expectJoin(dir, 1, named);
    expectJoin(dir, 2, undefined);
    const other = shift(2, WEEK, { resourceId: 2, assignee: "P1 X" });
    expectJoin(directory({ resources: [resource(1), twin], shifts: [other] }), 1, undefined);
  });

  it("an empty display name never matches, not even a Shift with an empty assignee", () => {
    const blank = resource(1, { firstName: "", lastName: "" });
    const dir = directory({ resources: [blank], shifts: [shift(1, WEEK, { assignee: "" }), shift(2, WEEK, { assignee: "  " })] });
    expectJoin(dir, 1, undefined);
  });
});
