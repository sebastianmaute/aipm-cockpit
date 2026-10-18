// §502 part 4 — the one copy of "worst first" and "below target" the Reports tables and the export decision share.
import { describe, expect, it } from "vitest";
import { belowTargetRows, milestoneRowsWorstFirst } from "./forecast-milestone-rows";
import type { MilestoneChance } from "./forecast/milestones";
import type { Milestone } from "./types";

const ms = (id: number, name: string, date: string): Milestone => ({ id, name, date, linkedTaskIds: [] }) as Milestone;
const chance = (id: number, c: number): MilestoneChance => ({ id, state: "chance", chance: c, chancePrioritised: c });

const MILESTONES = [ms(1, "B", "2026-11-01"), ms(2, "A", "2026-11-01"), ms(3, "Old", "2026-09-01"), ms(4, "Late", "2026-12-01"), ms(5, "Due", "2026-10-20")];
const CHANCES: MilestoneChance[] = [
  chance(4, 0.3), { id: 3, state: "overdue" }, chance(1, 0.8), chance(2, 0.8), chance(5, 0.79), { id: 9, state: "no-linked-tasks" },
];

describe("milestoneRowsWorstFirst", () => {
  it("orders by chance, then date, then name; states without a chance last, by date; unknown ids dropped", () => {
    expect(milestoneRowsWorstFirst(MILESTONES, CHANCES).map((r) => r.name)).toEqual(["Late", "Due", "A", "B", "Old"]);
  });
});

describe("belowTargetRows", () => {
  it("keeps the chances under the goal, worst first; a chance at the goal is on target", () => {
    const rows = milestoneRowsWorstFirst(MILESTONES, CHANCES);
    expect(belowTargetRows(rows, 80).map((r) => r.name)).toEqual(["Late", "Due"]);
    expect(belowTargetRows(rows, 95).map((r) => r.name)).toEqual(["Late", "Due", "A", "B"]);
    expect(belowTargetRows(rows, 50).map((r) => r.name)).toEqual(["Late"]);
  });
});
