import { describe, it, expect } from "vitest";
import { parseAnalysis } from "./action-ai";
import { buildAnalysisContext, buildAnalysisSystemPrompt, CONTEXT_CAP_PER_CATEGORY } from "./action-ai";

describe("parseAnalysis", () => {
  it("parses a valid analysis", () => {
    const out = parseAnalysis({
      summary: "Focus on the two overdue risks first.",
      actions: [
        { title: "Unblock milestone M2", why: "Tasks 4 and 7 block it.", severity: "now", entity: { view: "milestones", id: "2" } },
        { title: "Review stale risks", why: "Three risks untouched 30d.", severity: "soon" },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.summary).toContain("overdue");
    expect(out!.actions).toHaveLength(2);
    expect(out!.actions[0].entity).toEqual({ view: "milestones", id: "2" });
    expect(out!.actions[1].entity).toBeUndefined();
  });

  it("returns null when summary missing or actions not an array", () => {
    expect(parseAnalysis({ actions: [] })).toBeNull();
    expect(parseAnalysis({ summary: "x", actions: "nope" })).toBeNull();
    expect(parseAnalysis(null)).toBeNull();
  });

  it("clamps unknown severity to 'soon' and drops entries without title/why", () => {
    const out = parseAnalysis({
      summary: "s",
      actions: [
        { title: "Keep", why: "reason", severity: "whenever" },
        { title: "", why: "no title" },
        { title: "No why", why: "" },
      ],
    });
    expect(out!.actions).toHaveLength(1);
    expect(out!.actions[0].severity).toBe("soon");
  });

  it("drops a malformed entity and caps the actions array at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, why: "w", severity: "monitor" }));
    const out = parseAnalysis({
      summary: "s",
      actions: [{ title: "bad-entity", why: "w", severity: "now", entity: { view: 5, id: {} } }, ...many],
    });
    expect(out!.actions.length).toBeLessThanOrEqual(8);
    expect(out!.actions[0].entity).toBeUndefined();
  });
});

describe("buildAnalysisContext", () => {
  const base = {
    projectName: "Apollo", today: "2026-06-19", mode: "advanced", enabledModules: ["raid", "milestones"],
    taskCount: 3,
    tasks: [{ id: 7, title: "Wire auth" }],
    raid: [{ id: 1, title: "Vendor risk" }],
    milestones: [{ id: 2, title: "Beta" }],
    changes: [{ id: 9, title: "Scope add" }],
    stakeholders: [{ id: 3, name: "Acme" }],
    queue: [{ title: "Risk R1 needs owner", why: "no owner", tier: "now" as const }],
  };

  it("includes project name, real ids, the queue, and a view tag per entity", () => {
    const txt = buildAnalysisContext(base);
    expect(txt).toContain("Apollo");
    expect(txt).toContain("open-points#7");
    expect(txt).toContain("raid#1");
    expect(txt).toContain("milestones#2");
    expect(txt).toContain("changes#9");
    expect(txt).toContain("stakeholders#3");
    expect(txt).toContain("Risk R1 needs owner");
  });

  it("caps each category and notes truncation", () => {
    const many = Array.from({ length: CONTEXT_CAP_PER_CATEGORY + 5 }, (_, i) => ({ id: i + 1, title: `T${i}` }));
    const txt = buildAnalysisContext({ ...base, tasks: many });
    const matches = txt.match(/open-points#/g) ?? [];
    expect(matches.length).toBe(CONTEXT_CAP_PER_CATEGORY);
    expect(txt.toLowerCase()).toContain("truncated");
  });
});

describe("buildAnalysisSystemPrompt", () => {
  it("frames Claude as a PM advisor and is stable (cacheable prefix)", () => {
    const p = buildAnalysisSystemPrompt();
    expect(p).toBe(buildAnalysisSystemPrompt());
    expect(p.toLowerCase()).toContain("project manager");
    expect(p).toContain("report_analysis");
  });
});
