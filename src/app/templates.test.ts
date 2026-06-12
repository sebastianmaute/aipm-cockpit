import { describe, expect, it } from "vitest";
import { sanitizeTemplate, sanitizeTemplates } from "./templates";

describe("sanitizeTemplates", () => {
  it("returns [] for junk / legacy", () => {
    expect(sanitizeTemplates(undefined)).toEqual([]);
    expect(sanitizeTemplates(null)).toEqual([]);
    expect(sanitizeTemplates("x")).toEqual([]);
    expect(sanitizeTemplates({})).toEqual([]);
  });
  it("keeps a valid template and coerces features/fieldVisibility", () => {
    const out = sanitizeTemplates([
      { id: "t1", name: "T1", features: ["raid", "nope"], fieldVisibility: { milestone: { fields: ["name"] } } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
    expect(out[0].features).toEqual(["raid"]);
    expect(out[0].fieldVisibility.milestone.fields).toContain("name");
  });
  it("drops entries without id or name", () => {
    expect(sanitizeTemplates([{ name: "no id" }, { id: "x" }])).toEqual([]);
  });
  it("forces builtIn off on stored user templates", () => {
    const out = sanitizeTemplates([{ id: "t", name: "T", builtIn: true, features: [], fieldVisibility: {} }]);
    expect(out[0].builtIn).toBeFalsy();
  });
  it("sanitizeTemplate returns null for junk, object for valid", () => {
    expect(sanitizeTemplate(5)).toBeNull();
    expect(sanitizeTemplate({ id: "a", name: "A", features: [], fieldVisibility: {} })?.id).toBe("a");
  });
  it("preserves seed task dependencies through the round-trip", () => {
    const out = sanitizeTemplates([{
      id: "t", name: "T", features: [], fieldVisibility: {},
      seed: { tasks: [
        { id: 1, taskName: "A", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Low", blockers: "", notes: "" },
        { id: 2, taskName: "B", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Low", blockers: "", notes: "",
          dependencies: [{ taskId: 1, type: "FS" }] },
      ]}
    }]);
    expect(out[0].seed?.tasks?.[1].dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });
});
