// src/app/csv-codecs.test.ts
import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { workspaceToJson, jsonToWorkspace, emptyWorkspace } from "./workspace";
import type { Task } from "./types";

describe("csv fieldVisibility section", () => {
  it("emits no field-visibility section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# FIELD-VISIBILITY");
  });
  it("emits the field-visibility section when present", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    expect(workspaceToCsv(ws)).toContain("# FIELD-VISIBILITY");
  });
  it("round-trips fieldVisibility through CSV", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName", "assignee"] } } };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.fieldVisibility?.task.fields).toEqual(["taskName", "assignee"]);
  });
});

describe("csv milestone outlookEventId", () => {
  it("round-trips Milestone.outlookEventId through CSV", () => {
    const ws = {
      ...emptyWorkspace(),
      milestones: [
        { id: 1, name: "Kickoff", date: "2026-01-15", linkedTaskIds: [], outlookEventId: "AAMk-evt-1" },
      ],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.milestones?.[0]?.outlookEventId).toBe("AAMk-evt-1");
  });
});

describe("Task.outlookEventId persistence", () => {
  const task: Task = {
    id: 1,
    taskName: "Wire calendar",
    assignee: "Alex",
    assigneeEmail: "alex@example.com",
    dueDate: "2026-02-01",
    lastUpdateDate: "2026-01-10",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    outlookEventId: "E9",
  };

  it("survives workspaceToCsv -> csvToWorkspace", () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks[0]?.outlookEventId).toBe("E9");
  });

  it("survives workspaceToMarkdown -> markdownToWorkspace", () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.tasks[0]?.outlookEventId).toBe("E9");
  });

  it("survives workspaceToJson -> jsonToWorkspace", () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.tasks[0]?.outlookEventId).toBe("E9");
  });
});

describe("csv features section", () => {
  it("emits no section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# FUNCTIONS");
  });
  it("emits and round-trips features, preserving explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid"] as const };
    expect(workspaceToCsv(ws)).toContain("# FUNCTIONS");
    expect(csvToWorkspace(workspaceToCsv(ws)).features).toEqual(["raid"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(workspaceToCsv(simple)).toContain("# FUNCTIONS"); // empty STILL emits
    expect(csvToWorkspace(workspaceToCsv(simple)).features).toEqual([]);
  });
});
