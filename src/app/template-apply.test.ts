import { describe, expect, it } from "vitest";
import { applyTemplate } from "./template-apply";
import { emptyWorkspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { Milestone, RaidItem, Task, TaskDependency } from "./types";

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
});
