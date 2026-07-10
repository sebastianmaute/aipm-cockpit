import { describe, it, expect } from "vitest";
import { buildDigest, type DigestInput } from "./digest-model";
import type { DashboardModel } from "../dashboard";
import type { RaidItem, Task, Milestone } from "../types";

function task(id: number): Task {
  return { id, title: `T${id}`, status: "To Do" } as unknown as Task;
}
function milestone(id: number, date: string): Milestone {
  return { id, name: `M${id}`, date } as unknown as Milestone;
}
function raid(id: number, severity: RaidItem["severity"]): RaidItem {
  return { id, category: "Risk", status: "Open", severity } as unknown as RaidItem;
}
function model(over: Partial<DashboardModel>): DashboardModel {
  return {
    overall: { computed: "A", effective: "A", overridden: false },
    overdue: [], dueSoonMilestones: [], overdueMilestones: [], openRaidCount: 0,
    ...over,
  } as unknown as DashboardModel;
}

const BASE: DigestInput = {
  model: model({}),
  raid: [],
  prior: null,
};

describe("buildDigest", () => {
  it("projects RAG, overdue count, milestones-due-soon and open RAID with high count", () => {
    const input: DigestInput = {
      model: model({
        overall: { computed: "R", effective: "R", overridden: false },
        overdue: [task(1), task(2)],
        overdueMilestones: [milestone(10, "2026-07-01")],
        dueSoonMilestones: [milestone(11, "2026-07-15")],
        openRaidCount: 4,
      }),
      raid: [raid(1, "High"), raid(2, "Critical"), raid(3, "Low")],
      prior: null,
    };
    const d = buildDigest(input, "2026-07-10T09:00:00.000Z");
    expect(d.rag).toBe("R");
    expect(d.ragPrev).toBeNull();
    expect(d.overdue).toEqual({ count: 2, delta: null });
    expect(d.milestonesDueSoon.map((m) => m.id)).toEqual([10, 11]);
    expect(d.openRaid).toEqual({ count: 4, high: 2, delta: null });
    expect(d.generatedAt).toBe("2026-07-10T09:00:00.000Z");
  });

  it("counts high severity only over NON-terminal (open) RAID", () => {
    const openCritical = { id: 1, category: "R", status: "Open", severity: "Critical" } as unknown as RaidItem;
    const closedCritical = { id: 2, category: "R", status: "Closed", severity: "Critical" } as unknown as RaidItem;
    const openHigh = { id: 3, category: "A", status: "Open", severity: "High" } as unknown as RaidItem;
    const closedHigh = { id: 4, category: "D", status: "Delivered", severity: "High" } as unknown as RaidItem;
    const d = buildDigest(
      { model: model({ openRaidCount: 2 }), raid: [openCritical, closedCritical, openHigh, closedHigh], prior: null },
      "2026-07-10T09:00:00.000Z",
    );
    // Only the two OPEN high/critical items count; the closed ones are excluded.
    expect(d.openRaid.high).toBe(2);
  });

  it("computes deltas against a prior snapshot", () => {
    const input: DigestInput = {
      model: model({ overall: { computed: "R", effective: "R", overridden: false }, overdue: [task(1), task(2), task(3)], openRaidCount: 5 }),
      raid: [],
      prior: { rag: "A", overdue: 1, openRaid: 2 },
    };
    const d = buildDigest(input, "2026-07-10T09:00:00.000Z");
    expect(d.ragPrev).toBe("A");
    expect(d.overdue).toEqual({ count: 3, delta: 2 });
    expect(d.openRaid.delta).toBe(3);
  });

  it("returns a minimal model for an empty project (no crash)", () => {
    const d = buildDigest(BASE, "2026-07-10T09:00:00.000Z");
    expect(d.overdue.count).toBe(0);
    expect(d.milestonesDueSoon).toEqual([]);
    expect(d.openRaid).toEqual({ count: 0, high: 0, delta: null });
  });
});
