// src/app/insights/recommend-plan.test.ts
import { describe, test, expect } from "vitest";
import { describeRecommendationPlan, recommendationPlanEntity } from "./recommend-plan";
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
        { field: "taskName", before: "T", after: "Renamed", raw: "Renamed" },
        { field: "title", before: "Risk A", after: "Risk A renamed", raw: "Risk A renamed" },
      ]),
    );
    expect(plan.rejected).toHaveLength(0);
  });
});

describe("recommendationPlanEntity", () => {
  // ★★★ The review modal labels its previewed field names through this. It must
  // answer `undefined` rather than guess, because `describeRecommendationPlan`
  // MERGES across entities into one `EditPlan` with no per-diff entity — so
  // naming a mixed plan after either half renames the other half's fields.
  test("names the single entity every field-bearing call targets", () => {
    expect(
      recommendationPlanEntity([
        { name: "update_task", input: { id: 12, dueDate: "2026-08-01" } },
        { name: "update_task", input: { id: 13, status: "Done" } },
      ]),
    ).toBe("task");
  });

  test("returns undefined when two registers are updated in one recommendation", () => {
    expect(
      recommendationPlanEntity([
        { name: "update_task", input: { id: 12 } },
        { name: "update_raid_item", input: { id: 5 } },
      ]),
    ).toBeUndefined();
  });

  test("returns undefined when nothing is updated", () => {
    expect(recommendationPlanEntity([{ name: "create_task", input: { taskName: "T" } }])).toBeUndefined();
    expect(recommendationPlanEntity([])).toBeUndefined();
  });

  // ★ Deletes and creates cannot contribute `updates`/`links`, so they must not
  // make an otherwise single-entity recommendation ambiguous.
  test("ignores delete and create calls when deciding", () => {
    expect(
      recommendationPlanEntity([
        { name: "update_raid_item", input: { id: 5 } },
        { name: "delete_task", input: { id: 12 } },
        { name: "create_milestone", input: { name: "M", date: "2026-09-01" } },
      ]),
    ).toBe("raid");
  });
});
