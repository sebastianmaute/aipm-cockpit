import { describe, it, expect } from "vitest";
import { parseAnalysis } from "./action-ai";

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
