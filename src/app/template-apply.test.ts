import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplate, appendSeed } from "./template-apply";
import { __resetMintStateForTests } from "./id-mint-session";
import { emptyWorkspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type {
  BudgetBucket,
  ChangeItem,
  Milestone,
  RaidItem,
  Resource,
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
    status: "To Do",
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
  // Session-scoped minter carries state across applies — isolate every test.
  beforeEach(() => __resetMintStateForTests());

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
  it("links seed task/RAID/stakeholder owners to seeded resources by name", () => {
    const resource: Resource = { id: 1, firstName: "Ada", lastName: "Lovelace", roleId: null, utilizationMode: "percent", utilization: {} };
    const task: Task = { ...mkTask(1, "Build"), assignee: "Ada Lovelace" };
    const raid: RaidItem = {
      id: 1, category: "R", title: "R1", status: "Open", linkedTaskIds: [], causedByRaidIds: [],
      stakeholderIds: [], owner: "ada lovelace", raisedDate: "", targetDate: "", closedDate: "", probability: 3, impact: 3,
    };
    const stakeholder: Stakeholder = { id: 1, name: "Ada Lovelace", category: "Internal", influence: "High", interest: "Medium", raci: {} };
    const seed: TemplateSeed = { resources: [resource], tasks: [task], raid: [raid], stakeholders: [stakeholder] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    const rid = ws.resources![0].id;
    expect(ws.resources).toHaveLength(1);
    expect(ws.tasks[0].resourceId).toBe(rid);
    expect(ws.raid[0].ownerResourceId).toBe(rid); // case-insensitive name match
    expect(ws.stakeholders![0].resourceId).toBe(rid);
  });
  it("leaves an assignee with no matching seeded resource unlinked (plain string, no FK)", () => {
    const resource: Resource = { id: 1, firstName: "Ada", lastName: "Lovelace", roleId: null, utilizationMode: "percent", utilization: {} };
    const task: Task = { ...mkTask(1, "Build"), assignee: "Someone Else" };
    const ws = applyTemplate(emptyWorkspace(), tpl({ resources: [resource], tasks: [task] }), { includeSeed: true });
    expect(ws.tasks[0].resourceId).toBeUndefined();
    expect(ws.tasks[0].assignee).toBe("Someone Else");
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
  it("mints per-kind ids above each existing max and never reuses a deleted max-id row across a session", () => {
    const existingMilestone: Milestone = { id: 20, name: "M", date: "2026-01-01", linkedTaskIds: [] };
    const base = { ...emptyWorkspace(), tasks: [mkTask(10, "Existing")], milestones: [existingMilestone] };
    const seededMilestone: Milestone = { id: 1, name: "SM", date: "2026-01-01", linkedTaskIds: [] };
    const ws1 = applyTemplate(
      base,
      tpl({ tasks: [mkTask(1, "S")], milestones: [seededMilestone] }),
      { includeSeed: true },
    );
    const seededTask = ws1.tasks.find((t) => t.taskName === "S")!;
    const seededMs = ws1.milestones!.find((m) => m.name === "SM")!;
    expect(seededTask.id).toBeGreaterThan(10); // above the TASK max — its own kind's counter
    expect(seededMs.id).toBeGreaterThan(20); // above the MILESTONE max — a separate per-kind counter

    // Delete the freshly-minted max-id task, then apply again IN THE SAME SESSION.
    const afterDelete = { ...ws1, tasks: ws1.tasks.filter((t) => t.id !== seededTask.id) };
    const ws2 = applyTemplate(afterDelete, tpl({ tasks: [mkTask(1, "S2")] }), { includeSeed: true });
    const seededTask2 = ws2.tasks.find((t) => t.taskName === "S2")!;
    expect(seededTask2.id).toBeGreaterThan(seededTask.id); // monotonic — the deleted id is NOT reused
  });
});

describe("appendSeed", () => {
  it("appends re-mapped seed rows non-destructively", () => {
    const ws = emptyWorkspace();
    const seed: TemplateSeed = {
      milestones: [{ id: 9, name: "Kickoff", date: "2026-07-01", linkedTaskIds: [] }],
    };
    const next = appendSeed(ws, seed);
    expect(next.milestones?.length).toBe((ws.milestones?.length ?? 0) + 1);
    expect(next.milestones?.at(-1)?.name).toBe("Kickoff");
  });
});
