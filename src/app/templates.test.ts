import { describe, expect, it } from "vitest";
import { sanitizeTemplate, sanitizeTemplates, templateFromWorkspace } from "./templates";
import { emptyWorkspace } from "./workspace";

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

describe("templateFromWorkspace", () => {
  it("captures features + fieldVisibility, no seed when includeContent is false", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    const t = templateFromWorkspace(ws, ["raid"], { name: "My T", includeContent: false }, "id1");
    expect(t.id).toBe("id1");
    expect(t.name).toBe("My T");
    expect(t.features).toEqual(["raid"]);
    expect(t.fieldVisibility.task.fields).toEqual(["taskName"]);
    expect(t.seed).toBeUndefined();
    expect(t.builtIn).toBeFalsy();
  });
  it("captures seedable content when includeContent is true", () => {
    const task = { id: 1, taskName: "A", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", status: "To Do" as const, priority: "Medium" as const, blockers: "", notes: "" };
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const t = templateFromWorkspace(ws, [], { name: "T", includeContent: true }, "id2");
    expect(t.seed?.tasks).toHaveLength(1);
  });
  it("trims the name and description", () => {
    const t = templateFromWorkspace(emptyWorkspace(), [], { name: "  Trimmed  ", description: "  d  ", includeContent: false }, "id3");
    expect(t.name).toBe("Trimmed");
    expect(t.description).toBe("d");
  });
});
