// src/app/csv-codecs.test.ts
import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { emptyWorkspace } from "./workspace";

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
