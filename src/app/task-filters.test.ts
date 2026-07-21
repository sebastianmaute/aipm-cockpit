import { describe, it, expect } from "vitest";
import { resolveEffectiveFilters, FILTER_ALL } from "./task-filters";

const options = {
  assignees: ["Alice", "Bob"],
  groups: ["G1"],
  labels: ["frontend"],
};

const raw = (over: Partial<{ assignee: string; group: string; label: string }> = {}) => ({
  assignee: FILTER_ALL,
  group: FILTER_ALL,
  label: FILTER_ALL,
  ...over,
});

describe("resolveEffectiveFilters", () => {
  it("passes a filter through when its value still exists on a task", () => {
    const eff = resolveEffectiveFilters(raw({ assignee: "Alice" }), options);
    expect(eff.assignee).toBe("Alice");
  });

  // The reported bug: filter by an assignee, reassign every one of their tasks,
  // and the option disappears while the filter state keeps pointing at it. The
  // filter goes on hiding every row while the <select>, left without a matching
  // option, falls back to "All" and stops explaining the empty table.
  it("falls back to All when the filtered-for assignee no longer exists", () => {
    const eff = resolveEffectiveFilters(raw({ assignee: "Alice" }), {
      ...options,
      assignees: ["Bob"],
    });
    expect(eff.assignee).toBe(FILTER_ALL);
  });

  it("falls back to All for a group that no longer exists", () => {
    const eff = resolveEffectiveFilters(raw({ group: "G1" }), { ...options, groups: [] });
    expect(eff.group).toBe(FILTER_ALL);
  });

  it("falls back to All for a label that no longer exists", () => {
    const eff = resolveEffectiveFilters(raw({ label: "frontend" }), { ...options, labels: [] });
    expect(eff.label).toBe(FILTER_ALL);
  });

  // Label filtering itself is case-insensitive, so the validity check must be
  // too — otherwise a saved view holding a differently-cased label is reset even
  // though it still matches live tasks.
  it("keeps a label whose case differs from the stored option", () => {
    const eff = resolveEffectiveFilters(raw({ label: "FRONTEND" }), options);
    expect(eff.label).toBe("FRONTEND");
  });

  // Assignee/group are compared exactly by the row filter, so their validity
  // check must be exact too — a case-folded match here would keep a filter that
  // matches no row, which is the very state this function exists to prevent.
  it("resets an assignee whose case differs, because the row filter compares exactly", () => {
    const eff = resolveEffectiveFilters(raw({ assignee: "ALICE" }), options);
    expect(eff.assignee).toBe(FILTER_ALL);
  });

  // An unassigned task contributes "" to the assignee options (uniqueAssignees
  // has no filter(Boolean)), so the blank option is a real, selectable filter.
  it("treats the blank assignee as a valid filter while unassigned tasks exist", () => {
    const eff = resolveEffectiveFilters(raw({ assignee: "" }), { ...options, assignees: ["", "Bob"] });
    expect(eff.assignee).toBe("");
  });

  it("resets the blank assignee once every task has an assignee", () => {
    const eff = resolveEffectiveFilters(raw({ assignee: "" }), options);
    expect(eff.assignee).toBe(FILTER_ALL);
  });

  // Unlike the assignee dropdown, the group <select> renders a permanent
  // "No group" option, so the empty group filter must survive even though
  // uniqueGroups drops blanks. Resetting it would make "No group" unselectable.
  it("keeps the No-group filter, which is always offered regardless of the options", () => {
    const eff = resolveEffectiveFilters(raw({ group: "" }), { ...options, groups: [] });
    expect(eff.group).toBe("");
  });

  it("leaves All alone even when there are no options at all", () => {
    const eff = resolveEffectiveFilters(raw(), { assignees: [], groups: [], labels: [] });
    expect(eff).toEqual({ assignee: FILTER_ALL, group: FILTER_ALL, label: FILTER_ALL });
  });

  it("resolves each filter independently", () => {
    const eff = resolveEffectiveFilters(
      raw({ assignee: "Alice", group: "gone", label: "frontend" }),
      options,
    );
    expect(eff).toEqual({ assignee: "Alice", group: FILTER_ALL, label: "frontend" });
  });
});
