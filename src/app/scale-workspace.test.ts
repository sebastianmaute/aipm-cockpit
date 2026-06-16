import { describe, it, expect } from "vitest";
import { scaleWorkspace } from "./scale-workspace";
import { emptyWorkspace, workspaceToJson, jsonToWorkspace, type Workspace } from "./workspace";
import type { Task, RaidItem, Milestone, Stakeholder } from "./types";

/** A minimal but referentially-linked workspace: 1 task, 1 raid (linking that
 *  task + a stakeholder), 1 milestone (linking the task), 1 stakeholder. */
function tinyWs(): Workspace {
  const base = emptyWorkspace();
  const task: Task = {
    id: 1,
    taskName: "Build thing",
    assignee: "Ada",
    assigneeEmail: "ada@example.com",
    dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    blockers: "",
    notes: "",
  };
  const stakeholder: Stakeholder = {
    id: 1,
    name: "Sponsor Sam",
    category: "Sponsor",
    influence: "High",
    interest: "High",
    raci: { "1": "A" },
  };
  const raid: RaidItem = {
    id: 1,
    category: "R",
    title: "Some risk",
    status: "Open",
    linkedTaskIds: [1],
    causedByRaidIds: [],
    stakeholderIds: [1],
    raisedDate: "2026-01-01",
  };
  const milestone: Milestone = {
    id: 1,
    name: "Phase 1 done",
    date: "2026-02-01",
    linkedTaskIds: [1],
  };
  return {
    ...base,
    tasks: [task],
    raid: [raid],
    milestones: [milestone],
    stakeholders: [stakeholder],
  };
}

describe("scaleWorkspace", () => {
  it("factor 1 preserves entity counts", () => {
    const ws = tinyWs();
    const out = scaleWorkspace(ws, 1);
    expect(out.tasks.length).toBe(1);
    expect(out.raid.length).toBe(1);
    expect(out.milestones?.length).toBe(1);
    expect(out.stakeholders?.length).toBe(1);
  });

  it("factor 1 keeps the original ids and names pristine", () => {
    const out = scaleWorkspace(tinyWs(), 1);
    expect(out.tasks[0].id).toBe(1);
    expect(out.tasks[0].taskName).toBe("Build thing");
  });

  it("factor 3 triples tasks/raid/milestones/stakeholders", () => {
    const out = scaleWorkspace(tinyWs(), 3);
    expect(out.tasks.length).toBe(3);
    expect(out.raid.length).toBe(3);
    expect(out.milestones?.length).toBe(3);
    expect(out.stakeholders?.length).toBe(3);
  });

  it("factor 2 remaps FKs with no dangling refs and unique ids", () => {
    const out = scaleWorkspace(tinyWs(), 2);
    const taskIds = new Set(out.tasks.map((t) => t.id));
    const stakeholderIds = new Set((out.stakeholders ?? []).map((s) => s.id));

    // Every raid.linkedTaskIds element points to an output task.
    for (const r of out.raid) {
      for (const tid of r.linkedTaskIds) {
        expect(taskIds.has(tid)).toBe(true);
      }
      for (const sid of r.stakeholderIds) {
        expect(stakeholderIds.has(sid)).toBe(true);
      }
    }
    // Every milestone.linkedTaskIds element points to an output task.
    for (const m of out.milestones ?? []) {
      for (const tid of m.linkedTaskIds) {
        expect(taskIds.has(tid)).toBe(true);
      }
    }

    // Ids unique across all replicas.
    const allTaskIds = out.tasks.map((t) => t.id);
    expect(new Set(allTaskIds).size).toBe(allTaskIds.length);
    const allRaidIds = out.raid.map((r) => r.id);
    expect(new Set(allRaidIds).size).toBe(allRaidIds.length);
  });

  it("factor 2 keeps each replica's FKs WITHIN its own replica (no cross-talk)", () => {
    const out = scaleWorkspace(tinyWs(), 2);
    // Replica 0: task id 1, raid links task 1. Replica 1: task id 100001, raid links 100001.
    const replica1Raid = out.raid.find((r) => r.id >= 100000);
    expect(replica1Raid).toBeDefined();
    expect(replica1Raid!.linkedTaskIds).toEqual([100001]);
    expect(replica1Raid!.stakeholderIds).toEqual([100001]);
  });

  it("factor 2 suffixes replica names but leaves originals pristine", () => {
    const out = scaleWorkspace(tinyWs(), 2);
    const original = out.tasks.find((t) => t.id === 1);
    const replica = out.tasks.find((t) => t.id === 100001);
    expect(original!.taskName).toBe("Build thing");
    expect(replica!.taskName).toBe("Build thing (2)");
  });

  it("remaps the stakeholder RACI milestone keys per replica", () => {
    const out = scaleWorkspace(tinyWs(), 2);
    const replicaSh = (out.stakeholders ?? []).find((s) => s.id === 100001);
    expect(replicaSh).toBeDefined();
    // RACI key was milestone "1" -> replica milestone "100001".
    expect(Object.keys(replicaSh!.raci)).toEqual(["100001"]);
    expect(replicaSh!.raci["100001"]).toBe("A");
  });

  it("does not replicate singletons (project/plan/status)", () => {
    const ws = { ...tinyWs(), project: undefined };
    const out = scaleWorkspace(ws, 3);
    // plan stays a single object (same currency), status stays a single object.
    expect(out.plan).toBeDefined();
    expect(out.status).toBeDefined();
  });

  it("round-trips through JSON preserving counts at factor 3", () => {
    const out = scaleWorkspace(tinyWs(), 3);
    const round = jsonToWorkspace(workspaceToJson(out));
    expect(round.tasks.length).toBe(3);
    expect(round.raid.length).toBe(3);
    expect(round.milestones?.length).toBe(3);
    expect(round.stakeholders?.length).toBe(3);
  });
});
