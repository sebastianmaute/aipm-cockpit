import { describe, expect, it } from "vitest";
import type { ForecastHistoryEntry } from "./forecast-history";
import type { MilestoneChance } from "./forecast/app-forecast";
import type { Milestone } from "./types";
import { AT_RISK_LIMIT, milestonesAtRisk, weeklyChange } from "./forecast-tile-model";

const NONE: ReadonlySet<string> = new Set();
const entry = (date: string, p80: string | null): ForecastHistoryEntry => ({
  date,
  p50: p80,
  p80,
  p95: p80,
  chanceOnTime: 0.5,
});
const TODAY = "2026-10-16";
const change = (history: ForecastHistoryEntry[], p80: string | null, holidaySet = NONE) =>
  weeklyChange({ history, today: TODAY, p80, holidaySet });

describe("weeklyChange", () => {
  it("compares with the entry exactly 7 days back", () => {
    expect(change([entry("2026-10-09", "2027-02-01")], "2027-02-12")).toEqual({ kind: "later", workingDays: 9 });
  });

  it("falls back to the nearest earlier entry 7–13 days back", () => {
    expect(change([entry("2026-10-05", "2027-02-01")], "2027-02-12")).toEqual({ kind: "later", workingDays: 9 });
    expect(change([entry("2026-10-02", "2027-02-01")], "2027-02-12")).toEqual({ kind: "pending", from: "2026-10-09" });
  });

  it("an entry newer than 7 days is never the comparison", () => {
    expect(change([entry("2026-10-12", "2027-02-01")], "2027-02-12")).toEqual({ kind: "pending", from: "2026-10-19" });
  });

  it("earlier finish reads earlier", () => {
    expect(change([entry("2026-10-09", "2027-02-12")], "2027-02-01")).toEqual({ kind: "earlier", workingDays: 9 });
  });

  it("same date reads same", () => {
    expect(change([entry("2026-10-09", "2027-02-01")], "2027-02-01")).toEqual({ kind: "same" });
  });

  it("dates differing only across a weekend read same", () => {
    expect(change([entry("2026-10-09", "2027-02-05")], "2027-02-07")).toEqual({ kind: "same" });
  });

  it("holidays are not counted", () => {
    const h = new Set(["2027-02-08"]);
    expect(change([entry("2026-10-09", "2027-02-01")], "2027-02-12", h)).toEqual({ kind: "later", workingDays: 8 });
  });

  it("beyond the horizon on either side", () => {
    expect(change([entry("2026-10-09", "2027-02-01")], null)).toEqual({ kind: "beyond" });
    expect(change([entry("2026-10-09", null)], "2027-02-12")).toEqual({ kind: "beyond" });
    expect(change([], null)).toEqual({ kind: "beyond" });
  });

  it("no history reads pending from today + 7", () => {
    expect(change([], "2027-02-12")).toEqual({ kind: "pending", from: "2026-10-23" });
  });
});

const ms = (id: number, date: string): Milestone => ({ id, name: `M${id}`, date, linkedTaskIds: [] });
const chance = (id: number, c: number): MilestoneChance => ({ id, state: "chance", chance: c, chancePrioritised: c });

describe("milestonesAtRisk", () => {
  const milestones = [ms(1, "2027-03-01"), ms(2, "2027-02-01"), ms(3, "2027-01-01"), ms(4, "2027-04-01"), ms(5, "2027-05-01"), ms(6, "2027-06-01"), ms(7, "2027-07-01")];

  it("orders by chance, then date, then id, and limits to three", () => {
    const out = milestonesAtRisk(
      [chance(1, 0.31), chance(2, 0.31), chance(3, 0.2), chance(4, 0.31), chance(5, 0.9)],
      milestones,
    );
    expect(AT_RISK_LIMIT).toBe(3);
    expect(out.map((m) => m.id)).toEqual([3, 2, 1]);
    expect(out[0]).toEqual({ id: 3, name: "M3", date: "2027-01-01", chance: 0.2 });
  });

  it("breaks a chance and date tie by id", () => {
    const same = [ms(8, "2027-01-01"), ms(7, "2027-01-01")];
    expect(milestonesAtRisk([chance(8, 0.5), chance(7, 0.5)], same).map((m) => m.id)).toEqual([7, 8]);
  });

  it("excludes certain, overdue, no-linked-tasks and unknown ids", () => {
    const out = milestonesAtRisk(
      [chance(1, 1), { id: 2, state: "overdue" }, { id: 3, state: "no-linked-tasks" }, chance(99, 0.1), chance(4, 0.4)],
      milestones,
    );
    expect(out.map((m) => m.id)).toEqual([4]);
  });
});
