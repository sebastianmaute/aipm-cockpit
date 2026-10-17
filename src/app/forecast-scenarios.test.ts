import { describe, expect, it } from "vitest";
import {
  addScenario,
  isScenarioNameTaken,
  removeScenario,
  replaceScenario,
  sanitizeForecastScenarios,
  validateScenarioChange,
  validateScenarioDraft,
  whatIfToScenarioChanges,
  type ForecastScenario,
  type ScenarioChange,
  type ValidationContext,
} from "./forecast-scenarios";
import type { Milestone, Resource } from "./types";

const avail = { kind: "availability", percent: 80, from: "2026-10-01", until: "2026-11-01" };
const scen = (id: number, name: string, changes: unknown[] = [avail]) => ({ id, name, changes });

describe("sanitizeForecastScenarios", () => {
  it("drops junk, keeps a valid scenario and its rows", () => {
    const out = sanitizeForecastScenarios([null, 5, scen(0, "zero"), scen(1, "  "), scen(2, "Ok", [avail, "x", { kind: "nope" }])]);
    expect(out).toEqual([{ id: 2, name: "Ok", changes: [avail] }]);
    expect(sanitizeForecastScenarios("x")).toEqual([]);
  });

  it("clamps out-of-range numbers", () => {
    const rows = [
      { ...avail, percent: 5 },
      { kind: "addPeople", from: "2026-10-01", until: "", rampWeeks: 30, who: { resourceId: 3, hoursPerWeek: 80 } },
      { kind: "addPeople", from: "2026-10-01", until: "", rampWeeks: 2, who: { label: "Dev", count: 0, rate: 2e5, currency: "EUR", hoursPerWeek: 20 } },
    ];
    const [s] = sanitizeForecastScenarios([scen(1, "A", rows)]);
    expect(s.changes[0]).toMatchObject({ percent: 10 });
    expect(s.changes[1]).toMatchObject({ rampWeeks: 26, who: { hoursPerWeek: 60 } });
    expect(s.changes[2]).toMatchObject({ who: { count: 1, rate: 1e5 } });
  });

  it("absent rampWeeks is 4", () => {
    const row = { kind: "addPeople", from: "2026-10-01", until: "", who: { resourceId: 3, hoursPerWeek: 10 } };
    expect(sanitizeForecastScenarios([scen(1, "A", [row])])[0].changes[0]).toMatchObject({ rampWeeks: 4 });
  });

  it("drops a row with until before from, tasks 0, a bad date, an unsupported currency, or a who with both shapes", () => {
    const rows = [
      { ...avail, until: "2026-09-01" },
      { kind: "scope", tasks: 0, on: "2026-10-01" },
      { ...avail, from: "2026-13-45" },
      { kind: "addPeople", from: "2026-10-01", until: "", who: { label: "D", count: 1, rate: 1, currency: "JPY", hoursPerWeek: 5 } },
      { kind: "addPeople", from: "2026-10-01", until: "", who: { resourceId: 1, label: "D", count: 1, rate: 1, currency: "EUR", hoursPerWeek: 5 } },
    ];
    expect(sanitizeForecastScenarios([scen(1, "A", rows)])[0].changes).toEqual([]);
  });

  it("drops unknown keys", () => {
    const [s] = sanitizeForecastScenarios([{ ...scen(1, "A", [{ ...avail, junk: 1 }]), extra: true }]);
    expect(s).toEqual({ id: 1, name: "A", changes: [avail] });
  });

  it("keeps the first of a repeated id", () => {
    expect(sanitizeForecastScenarios([scen(1, "A"), scen(1, "B")]).map((s) => s.name)).toEqual(["A"]);
  });

  it("keeps a fifth scenario and duplicate names", () => {
    const out = sanitizeForecastScenarios([1, 2, 3, 4, 5].map((i) => scen(i, "Same")));
    expect(out).toHaveLength(5);
  });

  it("keeps an unknown resource id and milestone id", () => {
    const rows = [
      { kind: "scope", tasks: 3, on: "2026-10-01", milestoneId: 999 },
      { kind: "addPeople", from: "2026-10-01", until: "", rampWeeks: 1, who: { resourceId: 999, hoursPerWeek: 5 } },
    ];
    expect(sanitizeForecastScenarios([scen(1, "A", rows)])[0].changes).toHaveLength(2);
  });

  it("at most 20 changes survive and names are cut to 60", () => {
    const [s] = sanitizeForecastScenarios([scen(1, "x".repeat(80), Array.from({ length: 30 }, () => avail))]);
    expect(s.changes).toHaveLength(20);
    expect(s.name).toHaveLength(60);
  });
});

const ms = (id: number, date: string, achievedDate = ""): Milestone => ({ id, date, achievedDate }) as unknown as Milestone;
const res = (id: number, active?: boolean): Resource => ({ id, active }) as unknown as Resource;
const ctx: ValidationContext = {
  milestones: [ms(1, "2026-12-01"), ms(2, "2026-12-01", "2026-11-01"), ms(3, "")],
  resources: [res(1), res(2, false), res(3)],
  onTeam: new Set([3]),
};
const people = (who: unknown, over: object = {}) =>
  ({ kind: "addPeople", from: "2026-10-01", until: "", rampWeeks: 4, who, ...over }) as ScenarioChange;
const lab = { label: "Dev", count: 1, rate: 10, currency: "EUR", hoursPerWeek: 10 };

describe("validateScenarioChange", () => {
  const cases: [string, ScenarioChange, string | null][] = [
    ["ok", avail as ScenarioChange, null],
    ["date", { ...avail, from: "bad" } as ScenarioChange, "date"],
    ["until-before-from", { ...avail, until: "2026-09-01" } as ScenarioChange, "until-before-from"],
    ["percent", { ...avail, percent: 5 } as ScenarioChange, "percent"],
    ["hours", people({ ...lab, hoursPerWeek: 0 }), "hours"],
    ["count", people({ ...lab, count: 0 }), "count"],
    ["ramp", people(lab, { rampWeeks: 27 }), "ramp"],
    ["rate", people({ ...lab, rate: -1 }), "rate"],
    ["currency", people({ ...lab, currency: "JPY" }), "currency"],
    ["label", people({ ...lab, label: " " }), "label"],
    ["tasks", { kind: "scope", tasks: 0, on: "2026-10-01" }, "tasks"],
    ["milestone-unknown", { kind: "scope", tasks: 1, on: "2026-10-01", milestoneId: 9 }, "milestone-unknown"],
    ["milestone-finished achieved", { kind: "scope", tasks: 1, on: "2026-10-01", milestoneId: 2 }, "milestone-finished"],
    ["milestone-finished no date", { kind: "scope", tasks: 1, on: "2026-10-01", milestoneId: 3 }, "milestone-finished"],
    ["milestone ok", { kind: "scope", tasks: 1, on: "2026-10-01", milestoneId: 1 }, null],
    ["resource-unknown", people({ resourceId: 9, hoursPerWeek: 5 }), "resource-unknown"],
    ["resource-archived", people({ resourceId: 2, hoursPerWeek: 5 }), "resource-archived"],
    ["on-team", people({ resourceId: 3, hoursPerWeek: 5 }), "on-team"],
    ["resource ok", people({ resourceId: 1, hoursPerWeek: 5 }), null],
  ];
  it.each(cases)("%s", (_n, c, want) => {
    expect(validateScenarioChange(c, ctx)).toBe(want);
  });
});

describe("validateScenarioDraft and list ops", () => {
  const list: ForecastScenario[] = [1, 2, 3, 4].map((i) => ({ id: i, name: `S${i}`, changes: [] }));

  it("name-taken is case-insensitive and ignores the scenario being edited", () => {
    expect(validateScenarioDraft({ name: " s1 ", changes: [] }, list, 2)).toBe("name-taken");
    expect(validateScenarioDraft({ name: "s1", changes: [] }, list, 1)).toBeNull();
    expect(isScenarioNameTaken(list, "S2", 2)).toBe(false);
  });

  it("empty, long, too many changes", () => {
    expect(validateScenarioDraft({ name: " ", changes: [] }, [], null)).toBe("name-empty");
    expect(validateScenarioDraft({ name: "x".repeat(61), changes: [] }, [], null)).toBe("name-long");
    const many = Array.from({ length: 21 }, () => avail as ScenarioChange);
    expect(validateScenarioDraft({ name: "n", changes: many }, [], null)).toBe("too-many-changes");
  });

  it("cap only when creating", () => {
    expect(validateScenarioDraft({ name: "new", changes: [] }, list, null)).toBe("cap");
    expect(validateScenarioDraft({ name: "new", changes: [] }, list, 1)).toBeNull();
  });

  it("list ops return new arrays and leave the input untouched", () => {
    const before = JSON.stringify(list);
    const s = { id: 9, name: "N", changes: [] };
    expect(addScenario(list, s)).toHaveLength(5);
    expect(replaceScenario(list, { ...s, id: 2 })[1].name).toBe("N");
    expect(removeScenario(list, 3).map((x) => x.id)).toEqual([1, 2, 4]);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("whatIfToScenarioChanges", () => {
  it("scope percent rounds half-up", () => {
    const r = whatIfToScenarioChanges({ scopeTasks: 0, scopePercent: 10, capacityPercent: 100 }, 55, "2026-10-14");
    expect(r.changes).toEqual([{ kind: "scope", tasks: 6, on: "2026-10-14" }]);
    expect(r.percentTasks).toBe(6);
  });
  it("capacity alone gives one availability row", () => {
    const r = whatIfToScenarioChanges({ scopeTasks: 0, scopePercent: 0, capacityPercent: 130 }, 55, "2026-10-14");
    expect(r.changes).toEqual([{ kind: "availability", percent: 130, from: "2026-10-14", until: "" }]);
  });
  it("the default What-if gives no rows", () => {
    expect(whatIfToScenarioChanges({ scopeTasks: 0, scopePercent: 0, capacityPercent: 100 }, 55, "2026-10-14").changes).toEqual([]);
  });
});
