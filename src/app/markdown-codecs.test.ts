// src/app/markdown-codecs.test.ts
import { describe, it, expect } from "vitest";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";

describe("markdown fieldVisibility section", () => {
  it("emits nothing when undefined", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Field Visibility");
  });
  it("emits the section when present", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    expect(workspaceToMarkdown(ws)).toContain("## Field Visibility");
  });
  it("round-trips fieldVisibility through Markdown", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { raid: { fields: ["title", "status", "owner", "category", "description"] } } };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.fieldVisibility?.raid.fields).toContain("title");
  });
  it("emits nothing for an empty fieldVisibility object", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: {} };
    expect(workspaceToMarkdown(ws)).not.toContain("## Field Visibility");
  });
  it("round-trips with a populated plan without corrupting it", () => {
    const base = emptyWorkspace();
    const ws = { ...base, fieldVisibility: { task: { fields: ["taskName", "assignee", "dueDate", "status", "notes"] } } };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.plan.startDate).toBe(base.plan.startDate);
    expect(back.plan.endDate).toBe(base.plan.endDate);
    expect(back.fieldVisibility?.task.fields).toContain("taskName");
  });
});
