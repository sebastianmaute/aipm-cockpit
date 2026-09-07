// src/app/insights/recommend-plan.test.ts
import { describe, test, expect } from "vitest";
import { describeRecommendationPlan } from "./recommend-plan";
import type { Workspace } from "../workspace";

function ws(): Workspace {
  return {
    tasks: [{ id: 12, taskName: "T", dueDate: "2026-07-01" }],
    raid: [{ id: 5, category: "R", title: "Risk A" }],
    changes: [],
    milestones: [],
    stakeholders: [],
  } as unknown as Workspace;
}

describe("describeRecommendationPlan", () => {
  test("previews an update_task field diff", () => {
    const plan = describeRecommendationPlan([{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }], ws());
    expect(plan.updates.some((u) => u.field === "dueDate" && u.after === "2026-08-01")).toBe(true);
  });

  test("rejects an update whose id is gone", () => {
    const plan = describeRecommendationPlan([{ name: "update_task", input: { id: 999 } }], ws());
    expect(plan.rejected.length).toBeGreaterThanOrEqual(1);
  });

  test("previews a create as a new item", () => {
    const plan = describeRecommendationPlan([{ name: "create_task", input: { taskName: "New" } }], ws());
    expect(plan.creates).toHaveLength(1);
  });

  test("previews a delete without a false self-id rejection", () => {
    const plan = describeRecommendationPlan([{ name: "delete_raid_item", input: { id: 5 } }], ws());
    expect(plan.deletes).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  test("rejects a delete whose id no longer exists", () => {
    const plan = describeRecommendationPlan([{ name: "delete_raid_item", input: { id: 999 } }], ws());
    expect(plan.deletes).toHaveLength(0);
    expect(plan.rejected.length).toBeGreaterThanOrEqual(1);
  });

  test("grounds multiple calls independently by their own ids", () => {
    const plan = describeRecommendationPlan(
      [
        { name: "update_task", input: { id: 12, taskName: "Renamed" } },
        { name: "update_raid_item", input: { id: 5, title: "Risk A renamed" } },
      ],
      ws(),
    );
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        { entity: "task", field: "taskName", before: "T", after: "Renamed", raw: "Renamed" },
        { entity: "raid", field: "title", before: "Risk A", after: "Risk A renamed", raw: "Risk A renamed" },
      ]),
    );
    expect(plan.rejected).toHaveLength(0);
  });

  // ★★★ THE MERGED-ENTITY CASE (§393). `describeRecommendationPlan` grounds each
  // call against its OWN descriptor and pushes every result into ONE `EditPlan`,
  // so `updates` can hold a raid diff and a change diff side by side — and the
  // label map is entity-qualified BECAUSE IT MUST BE: `impact` is a 1-5 scale on
  // a RAID item and a Low/Medium/High/Critical enum on a change. Before the
  // per-diff `entity`, the only answer available was plan-level
  // (`recommendationPlanEntity`), which returned `undefined` for exactly this
  // shape and left both rows rendering their raw property name.
  test("resolves both entities' labels in a merged recommendation plan", () => {
    const mixed = {
      tasks: [],
      raid: [{ id: 5, category: "R", title: "Risk A", impact: 2 }],
      changes: [{ id: 7, title: "CR", impact: "Low" }],
      milestones: [],
      stakeholders: [],
    } as unknown as Workspace;
    const plan = describeRecommendationPlan(
      [
        { name: "update_raid_item", input: { id: 5, impact: 4 } },
        { name: "update_change", input: { id: 7, impact: "High" } },
      ],
      mixed,
    );
    expect(plan.updates.map((u) => [u.entity, u.field])).toEqual([
      ["raid", "impact"],
      ["change", "impact"],
    ]);
    expect(plan.rejected).toHaveLength(0);
  });
});

// ★★ The `recommendationPlanEntity` suite that stood here was REMOVED with the
// helper (§393). Its four cases all pinned the plan-level answer — "one register
// or nothing" — which the per-diff `entity` above replaces: the merged case it
// asserted `undefined` for is exactly the one now labelled correctly on both
// rows. Nothing it covered is lost; it covered a fallback that no longer exists.
