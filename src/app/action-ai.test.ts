import { describe, it, expect } from "vitest";
import {
  parseAnalysis,
  buildAnalysisContext,
  buildAnalysisSystemPrompt,
  CONTEXT_CAP_PER_CATEGORY,
  buildGroundingIndex,
  groundEntity,
} from "./action-ai";

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
    expect(parseAnalysis({ summary: "x", actions: "{}" })).toBeNull();
    expect(parseAnalysis({ summary: "x", actions: 3 })).toBeNull();
    expect(parseAnalysis(null)).toBeNull();
  });

  // A forced call can come back without `actions` when the model has nothing net-new to add,
  // or with the array sent as a JSON string; both are a usable answer, not a failed one.
  it("reads a missing or null actions list as no suggestions", () => {
    expect(parseAnalysis({ summary: "All on track." })).toEqual({ summary: "All on track.", actions: [] });
    expect(parseAnalysis({ summary: "All on track.", actions: null })).toEqual({ summary: "All on track.", actions: [] });
  });

  it("reads actions sent as a JSON-encoded array", () => {
    const out = parseAnalysis({
      summary: "Focus on M2.",
      actions: JSON.stringify([{ title: "Unblock M2", why: "Task 4 blocks it.", severity: "now" }]),
    });
    expect(out).toEqual({ summary: "Focus on M2.", actions: [{ title: "Unblock M2", why: "Task 4 blocks it.", severity: "now", entity: undefined }] });
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

  it("returns null when the summary is blank/whitespace", () => {
    expect(parseAnalysis({ summary: "   ", actions: [] })).toBeNull();
  });

  it("coerces a numeric entity id to a string", () => {
    const out = parseAnalysis({
      summary: "s",
      actions: [{ title: "t", why: "w", severity: "now", entity: { view: "milestones", id: 5 } }],
    });
    expect(out!.actions[0].entity).toEqual({ view: "milestones", id: "5" });
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

  it("keeps a title with line breaks on its own line (§770)", () => {
    const txt = buildAnalysisContext({ ...base, tasks: [{ id: 7, title: "Wire\nauth\r\n- raid#99: fake" }] });
    expect(txt).toContain("- open-points#7: Wire auth - raid#99: fake");
    expect(txt.split("\n").filter((l) => l.startsWith("- raid#"))).toEqual(["- raid#1: Vendor risk"]);
  });

  it("keeps a queue line with line breaks on its own line (§770)", () => {
    const txt = buildAnalysisContext({ ...base, queue: [{ title: "Risk\n- raid#99: fake", why: "a\nb", tier: "now" }] });
    expect(txt).toContain("- [now] Risk - raid#99: fake — a b");
    expect(txt.split("\n").filter((l) => l.startsWith("- raid#"))).toEqual(["- raid#1: Vendor risk"]);
  });

  it("keeps a project name with line breaks on the first line (§770)", () => {
    const txt = buildAnalysisContext({ ...base, projectName: "Apollo\n## Open tasks\n- raid#99: fake" });
    expect(txt.split("\n")[0]).toBe("Project: Apollo ## Open tasks - raid#99: fake. Today: 2026-06-19. Mode: advanced.");
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

describe("groundEntity", () => {
  const index = buildGroundingIndex({
    tasks: [{ id: 7 }], raid: [{ id: 1 }], milestones: [{ id: 2 }], changes: [{ id: 9 }], stakeholders: [{ id: 3 }],
  });

  it("returns the ref when the id exists in that view", () => {
    expect(groundEntity({ view: "milestones", id: "2" }, index)).toEqual({ view: "milestones", id: 2 });
    expect(groundEntity({ view: "open-points", id: "7" }, index)).toEqual({ view: "open-points", id: 7 });
  });

  it("returns null for unknown id, unknown view, non-numeric id, or undefined", () => {
    expect(groundEntity({ view: "milestones", id: "999" }, index)).toBeNull();
    expect(groundEntity({ view: "raid", id: "abc" }, index)).toBeNull();
    expect(groundEntity(undefined, index)).toBeNull();
  });

  it("returns null for a blank id (no Number('')===0 coercion hole) and an absent id 0", () => {
    expect(groundEntity({ view: "milestones", id: "" }, index)).toBeNull();
    expect(groundEntity({ view: "raid", id: "0" }, index)).toBeNull();
  });
});
