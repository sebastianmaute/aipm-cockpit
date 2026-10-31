// src/app/insights/recommend-plan.test.ts
import { describe, test, expect } from "vitest";
import { describeRecommendationPlan } from "./recommend-plan";
import type { Workspace } from "../workspace";
import type { AbsenceCtx } from "../absence-clash";

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
    const plan = describeRecommendationPlan(
      [{ name: "create_task", input: { taskName: "New", assignee: "Dana Ortiz", dueDate: "2026-09-25" } }],
      ws(),
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  // §782 — the card used to title this from `title` and show it as a normal
  // create, while runTool refused it for want of taskName and assignee.
  test("shows a create the dispatcher would refuse as rejected, with the missing fields, never as a create", () => {
    const plan = describeRecommendationPlan(
      [{ name: "create_task", input: { title: "Review T&M burn", dueDate: "2026-09-25" } }],
      ws(),
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.rejected).toEqual([
      { toolName: "create_task", reason: "bad-input", detail: "create_task: taskName, assignee required" },
    ]);
  });

  test("a refused create leaves its valid sibling in the plan", () => {
    const plan = describeRecommendationPlan(
      [
        { name: "create_milestone", input: { name: "Budget review", targetDate: "2026-10-01" } },
        { name: "update_task", input: { id: 12, dueDate: "2026-08-01" } },
      ],
      ws(),
    );
    expect(plan.rejected.map((r) => r.detail)).toEqual(["create_milestone: date required"]);
    expect(plan.updates.some((u) => u.field === "dueDate")).toBe(true);
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

  // §534 — `confirmInsightRecommendation` strips each call against
  // describeRecommendationPlan([call]); the modal renders
  // describeRecommendationPlan(allCalls). They agree only while the merged
  // plan's rejections are exactly the per-call ones, in order.
  test("the merged plan's rejections are the concatenation of each call's own (§534)", () => {
    const calls = [
      { name: "update_task", input: { id: 12, assigneeEmail: "not-an-email", dueDate: "2026-08-01" } },
      { name: "update_task", input: { id: 999 } },
    ];
    const perCall = calls.flatMap((c) => describeRecommendationPlan([c], ws()).rejected);
    expect(perCall.map((r) => r.field)).toEqual(["assigneeEmail", undefined]); // anti-vacuity: both kinds present
    expect(describeRecommendationPlan(calls, ws()).rejected).toEqual(perCall);
  });
});

// ★★ The `recommendationPlanEntity` suite that stood here was REMOVED with the
// helper (§393). Its four cases all pinned the plan-level answer — "one register
// or nothing" — which the per-diff `entity` above replaces: the merged case it
// asserted `undefined` for is exactly the one now labelled correctly on both
// rows. Nothing it covered is lost; it covered a fallback that no longer exists.

// §773 — a recommended change that lands work on someone's absence carries the clash into the merged plan.
describe("describeRecommendationPlan — absence clashes", () => {
  const absence = {
    absences: [{ id: 1, assignee: "Dana Ortiz", type: "vacation", startDate: "2026-09-21", endDate: "2026-09-25" }],
    resources: [],
    holidaySet: new Set<string>(),
  } as unknown as AbsenceCtx;

  test("a create_task due inside its assignee's absence yields one note", () => {
    const plan = describeRecommendationPlan(
      [{ name: "create_task", input: { taskName: "New", assignee: "Dana Ortiz", dueDate: "2026-09-25" } }],
      ws(),
      undefined,
      absence,
    );
    expect(plan.clashes).toEqual([
      expect.objectContaining({ entity: "task", id: null, title: "New", clash: expect.objectContaining({ person: "Dana Ortiz", which: "due" }) }),
    ]);
  });

  test("an update_task giving the task to someone away on its due date yields one note", () => {
    const plan = describeRecommendationPlan(
      [{ name: "update_task", input: { id: 12, assignee: "Dana Ortiz", dueDate: "2026-09-22" } }],
      ws(),
      undefined,
      absence,
    );
    expect(plan.clashes).toEqual([expect.objectContaining({ entity: "task", id: 12, title: "T" })]);
  });

  test("no absence context, no clashes", () => {
    const plan = describeRecommendationPlan(
      [{ name: "create_task", input: { taskName: "New", assignee: "Dana Ortiz", dueDate: "2026-09-25" } }],
      ws(),
    );
    expect(plan.clashes).toEqual([]);
  });
});

// §773 N-1 — a later call on the same row is judged against the row as the earlier calls leave it.
describe("describeRecommendationPlan — a row changed by two calls (§773 N-1)", () => {
  const absence = {
    absences: [{ id: 1, assignee: "Dana Ortiz", type: "vacation", startDate: "2026-09-21", endDate: "2026-09-25" }],
    resources: [],
    holidaySet: new Set<string>(),
  } as unknown as AbsenceCtx;
  const wsMs = (): Workspace =>
    ({ ...ws(), milestones: [{ id: 3, name: "Beta", date: "2026-10-30", linkedTaskIds: [12] }] }) as unknown as Workspace;

  test("an owner change, then a due-date move onto the new owner's absence, warns on the move", () => {
    const plan = describeRecommendationPlan(
      [
        { name: "update_task", input: { id: 12, assignee: "Dana Ortiz" } },
        { name: "update_task", input: { id: 12, dueDate: "2026-09-22" } },
      ],
      ws(),
      undefined,
      absence,
    );
    expect(plan.clashes).toEqual([
      expect.objectContaining({ entity: "task", id: 12, clash: expect.objectContaining({ person: "Dana Ortiz", date: "2026-09-22" }) }),
    ]);
  });

  test("an owner change away from the absent person, then a move into her absence, does not warn about her", () => {
    const onDana = (): Workspace =>
      ({ ...ws(), tasks: [{ id: 12, taskName: "T", assignee: "Dana Ortiz", dueDate: "2026-07-01" }] }) as unknown as Workspace;
    const plan = describeRecommendationPlan(
      [
        { name: "update_task", input: { id: 12, assignee: "Sam Lee" } },
        { name: "update_task", input: { id: 12, dueDate: "2026-09-22" } },
      ],
      onDana(),
      undefined,
      absence,
    );
    expect(plan.clashes).toEqual([]);
  });

  test("a milestone moved after its linked task changed owner judges the new owner", () => {
    const plan = describeRecommendationPlan(
      [
        { name: "update_task", input: { id: 12, assignee: "Dana Ortiz" } },
        { name: "update_milestone", input: { id: 3, date: "2026-09-23" } },
      ],
      wsMs(),
      undefined,
      absence,
    );
    expect(plan.clashes).toEqual([
      expect.objectContaining({ entity: "milestone", id: 3, clash: expect.objectContaining({ person: "Dana Ortiz", date: "2026-09-23" }) }),
    ]);
  });

  test("the card's field lines are still described against the stored row", () => {
    const calls = [
      { name: "update_task", input: { id: 12, assignee: "Dana Ortiz" } },
      { name: "update_task", input: { id: 12, dueDate: "2026-09-22" } },
    ];
    const strip = (p: ReturnType<typeof describeRecommendationPlan>) => ({ ...p, clashes: [] });
    expect(strip(describeRecommendationPlan(calls, ws(), undefined, absence))).toEqual(strip(describeRecommendationPlan(calls, ws())));
  });
});
