import { describe, expect, it } from "vitest";
import { applyTemplate } from "./template-apply";
import { emptyWorkspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type {
  BudgetBucket,
  ChangeItem,
  Milestone,
  RaidItem,
  Stakeholder,
  Task,
  TaskDependency,
} from "./types";

function mkTask(id: number, name: string, deps: TaskDependency[] = []): Task {
  return {
    id,
    taskName: name,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    priority: "Medium",
    blockers: "",
    notes: "",
    dependencies: deps,
  };
}
function tpl(seed: TemplateSeed | undefined): ProjectTemplate {
  return {
    id: "t",
    name: "T",
    features: [],
    fieldVisibility: { task: { fields: ["taskName"] } },
    seed,
  };
}

describe("applyTemplate", () => {
  it("replaces fieldVisibility", () => {
    const ws = applyTemplate(emptyWorkspace(), tpl(undefined), { includeSeed: false });
    expect(ws.fieldVisibility?.task.fields).toEqual(["taskName"]);
  });
  it("is immutable (does not mutate the input workspace)", () => {
    const base = emptyWorkspace();
    applyTemplate(base, tpl({ tasks: [mkTask(1, "A")] }), { includeSeed: true });
    expect(base.tasks).toHaveLength(0);
  });
  it("appends seed tasks with fresh ids after the workspace max and remaps {taskId} deps", () => {
    const base = { ...emptyWorkspace(), tasks: [mkTask(5, "Existing")] };
    const ws = applyTemplate(
      base,
      tpl({ tasks: [mkTask(1, "S1"), mkTask(2, "S2", [{ taskId: 1, type: "FS" }])] }),
      { includeSeed: true },
    );
    expect(ws.tasks).toHaveLength(3);
    const s1 = ws.tasks.find((t) => t.taskName === "S1")!;
    const s2 = ws.tasks.find((t) => t.taskName === "S2")!;
    expect(s1.id).toBeGreaterThan(5);
    expect(s2.id).toBeGreaterThan(5);
    expect(s1.id).not.toBe(s2.id);
    expect(s2.dependencies).toEqual([{ taskId: s1.id, type: "FS" }]); // internal dep remapped, type kept
  });
  it("does not append when includeSeed is false", () => {
    const ws = applyTemplate(emptyWorkspace(), tpl({ tasks: [mkTask(1, "S")] }), { includeSeed: false });
    expect(ws.tasks).toHaveLength(0);
  });
  it("drops dependency refs that point outside the seed", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({ tasks: [mkTask(1, "S1", [{ taskId: 999, type: "FS" }])] }),
      { includeSeed: true },
    );
    expect(ws.tasks[0].dependencies).toEqual([]);
  });
  it("remaps milestone.linkedTaskIds to new seed task ids", () => {
    const milestone: Milestone = { id: 1, name: "M1", date: "2026-01-01", linkedTaskIds: [1] };
    const seed: TemplateSeed = { tasks: [mkTask(1, "S1")], milestones: [milestone] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    expect(ws.milestones?.[0].linkedTaskIds).toEqual([ws.tasks[0].id]);
  });
  it("clears person FKs on seed RAID/stakeholders", () => {
    const raid: RaidItem = {
      id: 1,
      category: "R",
      title: "R1",
      status: "Open",
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      ownerResourceId: 7,
      raisedDate: "",
      targetDate: "",
      closedDate: "",
      probability: 3,
      impact: 3,
    };
    const seed: TemplateSeed = { raid: [raid] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    expect(ws.raid[0].ownerResourceId).toBeNull();
  });
  it("clears the person FK resourceId on seed tasks", () => {
    const task: Task = { ...mkTask(1, "S1"), resourceId: 7 };
    const seed: TemplateSeed = { tasks: [task] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    expect(ws.tasks).toHaveLength(1);
    expect(ws.tasks[0].resourceId).toBeUndefined();
  });
  it("remaps stakeholder raci keys to new milestone ids and clears resourceId", () => {
    const milestone: Milestone = { id: 1, name: "M1", date: "2026-01-01", linkedTaskIds: [] };
    const stakeholder: Stakeholder = {
      id: 1,
      name: "Alice",
      category: "Internal",
      influence: "High",
      interest: "Medium",
      resourceId: 9,
      raci: { "1": "R" },
    };
    const seed: TemplateSeed = { milestones: [milestone], stakeholders: [stakeholder] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    const newMilestoneId = ws.milestones![0].id;
    const sh = ws.stakeholders![0];
    expect(sh.resourceId).toBeNull();
    expect(Object.keys(sh.raci)).toEqual([String(newMilestoneId)]);
    expect(sh.raci[String(newMilestoneId)]).toBe("R");
  });
  it("remaps change linkedRaidIds to new seed raid ids", () => {
    const raid: RaidItem = {
      id: 1,
      category: "R",
      title: "Risk1",
      status: "Open",
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      raisedDate: "",
    };
    const change: ChangeItem = {
      id: 1,
      title: "Change1",
      description: "desc",
      type: "Scope",
      status: "Proposed",
      raisedDate: "2026-01-01",
      linkedTaskIds: [],
      linkedRaidIds: [1],
      stakeholderIds: [],
    };
    const seed: TemplateSeed = { raid: [raid], changes: [change] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    expect(ws.changes![0].linkedRaidIds).toEqual([ws.raid[0].id]);
  });
  it("remaps budget successorId to the new bucket id and nullifies out-of-seed references", () => {
    const bucket1: BudgetBucket = {
      id: 1,
      name: "Phase1",
      type: "tm",
      currency: "EUR",
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      status: "open",
      allocations: [],
    };
    const bucket2: BudgetBucket = {
      id: 2,
      name: "Phase2",
      type: "tm",
      currency: "EUR",
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      status: "open",
      successorId: 1,
      allocations: [],
    };
    const bucket3: BudgetBucket = {
      id: 3,
      name: "Phase3",
      type: "fixed",
      currency: "EUR",
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      status: "open",
      successorId: 999,
      allocations: [],
    };
    const seed: TemplateSeed = { budgets: [bucket1, bucket2, bucket3] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    const b1 = ws.budgets!.find((b) => b.name === "Phase1")!;
    const b2 = ws.budgets!.find((b) => b.name === "Phase2")!;
    const b3 = ws.budgets!.find((b) => b.name === "Phase3")!;
    expect(b2.successorId).toBe(b1.id);
    expect(b3.successorId).toBeNull();
  });
});
