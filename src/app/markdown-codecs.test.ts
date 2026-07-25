// src/app/markdown-codecs.test.ts
import { describe, it, expect } from "vitest";
import { workspaceToMarkdown, markdownToWorkspace, statusToMarkdown, markdownToStatus } from "./markdown-codecs";
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

// The status narrative became rich HTML in R3, and the markdown backend writes
// it as ONE `- narrative: <value>` line decoded by a single-line regex. Nothing
// pinned that, and the golden fixture's narrative is still plain text — so the
// one property the format depends on (normalizeNarrativeHtml collapses newlines,
// therefore the value is always single-line) had no test behind it.
describe("markdown status narrative round-trip", () => {
  const RICH = "<p>Week 30</p><p>Shipped <strong>auth</strong></p><ul><li>one</li></ul>";

  it("survives statusToMarkdown -> markdownToStatus intact", () => {
    const status = { ragOverride: "A" as const, narrative: RICH, narrativeUpdatedAt: "2026-07-25" };
    expect(markdownToStatus(statusToMarkdown(status))).toEqual(status);
  });

  it("survives the whole-workspace markdown round-trip", () => {
    const ws = { ...emptyWorkspace(), status: { narrative: RICH } };
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).status?.narrative).toBe(RICH);
  });

  // The single-line regex is why normalizeNarrativeHtml collapses newlines: a
  // value that reached storage WITH one truncates at the first break. Asserted
  // so the coupling is visible if either side is ever "simplified".
  it("truncates at an embedded newline - the reason the editor normalizes", () => {
    const back = markdownToStatus(statusToMarkdown({ narrative: "<p>a</p>\n<p>b</p>" }));
    expect(back.narrative).toBe("<p>a</p>");
  });
});

describe("markdown features section", () => {
  it("emits nothing when undefined", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Functions");
  });
  it("emits and round-trips features incl. explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "gantt"] as const };
    expect(workspaceToMarkdown(ws)).toContain("## Functions");
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).features).toEqual(expect.arrayContaining(["raid", "gantt"]));
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(workspaceToMarkdown(simple)).toContain("## Functions"); // empty STILL emits
    expect(markdownToWorkspace(workspaceToMarkdown(simple)).features).toEqual([]);
  });
});
