import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplate } from "./template-apply";
import { __resetMintStateForTests } from "./id-mint-session";
import { emptyWorkspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { ChangeItem, RaidItem, Task } from "./types";

function mkTask(description: string): Task {
  return {
    id: 1,
    taskName: "T1",
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description,
    dependencies: [],
  };
}

function mkRaid(fields: Partial<RaidItem>): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "R1",
    status: "Open",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "2026-01-01",
    ...fields,
  };
}

function mkChange(fields: Partial<ChangeItem>): ChangeItem {
  return {
    id: 1,
    title: "C1",
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-01-01",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...fields,
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

describe("applyTemplate allow-lists the seed's rich fields", () => {
  beforeEach(() => __resetMintStateForTests());

  it("strips a script element from a seed task description", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({ tasks: [mkTask("<p>ok</p><script>alert(1)</script>")] }),
      { includeSeed: true },
    );
    expect(ws.tasks[0].description).not.toContain("script");
    expect(ws.tasks[0].description).toContain("ok");
  });

  it("strips a script element from a seed task note-log entry", () => {
    const task = mkTask("");
    task.noteLog = [
      {
        id: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        html: "<p>ok</p><script>alert(1)</script>",
        text: "ok",
      },
    ];
    const ws = applyTemplate(emptyWorkspace(), tpl({ tasks: [task] }), {
      includeSeed: true,
    });
    expect(ws.tasks[0].noteLog?.[0].html).not.toContain("script");
  });

  it("leaves legitimate rich markup intact on a task description", () => {
    // The allow-list must not be narrower than the sink the value lands in, or
    // a captured heading is destroyed on apply.
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({ tasks: [mkTask("<h2>Plan</h2><p>steps</p>")] }),
      { includeSeed: true },
    );
    expect(ws.tasks[0].description).toContain("<h2>Plan</h2>");
  });

  it("strips a script element from a seed RAID description", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({ raid: [mkRaid({ description: "<p>ok</p><script>alert(1)</script>" })] }),
      { includeSeed: true },
    );
    expect(ws.raid[0].description).not.toContain("script");
    expect(ws.raid[0].description).toContain("ok");
  });

  it("strips a script element from a seed RAID mitigation", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({ raid: [mkRaid({ mitigation: "<p>ok</p><script>alert(1)</script>" })] }),
      { includeSeed: true },
    );
    expect(ws.raid[0].mitigation).not.toContain("script");
    expect(ws.raid[0].mitigation).toContain("ok");
  });

  // ★★ Changes carry FOUR rich fields, and the note log only became reachable
  // here when the seed carry landed on the change route — so each one is its
  // own hole, silent and independent of the others.
  it("strips a script element from a seed change description", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({ changes: [mkChange({ description: "<p>ok</p><script>alert(1)</script>" })] }),
      { includeSeed: true },
    );
    expect((ws.changes ?? [])[0].description).not.toContain("script");
    expect((ws.changes ?? [])[0].description).toContain("ok");
  });

  it("strips a script element from a seed change impact description", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({
        changes: [mkChange({ impactDescription: "<p>ok</p><script>alert(1)</script>" })],
      }),
      { includeSeed: true },
    );
    expect((ws.changes ?? [])[0].impactDescription).not.toContain("script");
    expect((ws.changes ?? [])[0].impactDescription).toContain("ok");
  });

  it("strips a script element from a seed change resolution note", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({
        changes: [mkChange({ resolutionNotes: "<p>ok</p><script>alert(1)</script>" })],
      }),
      { includeSeed: true },
    );
    expect((ws.changes ?? [])[0].resolutionNotes).not.toContain("script");
    expect((ws.changes ?? [])[0].resolutionNotes).toContain("ok");
  });

  it("strips a script element from a seed change note-log entry", () => {
    const ws = applyTemplate(
      emptyWorkspace(),
      tpl({
        changes: [
          mkChange({
            noteLog: [
              {
                id: 1,
                timestamp: "2026-01-01T00:00:00.000Z",
                html: "<p>ok</p><script>alert(1)</script>",
                text: "ok",
              },
            ],
          }),
        ],
      }),
      { includeSeed: true },
    );
    expect((ws.changes ?? [])[0].noteLog?.[0].html).not.toContain("script");
    expect((ws.changes ?? [])[0].noteLog?.[0].html).toContain("ok");
  });
});
