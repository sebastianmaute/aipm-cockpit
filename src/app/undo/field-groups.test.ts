import { describe, test, expect } from "vitest";
import { pick, changedFieldGroups, type FieldGroup } from "./field-groups";

interface Row { id: number; a: string; b: string; c: string; tags: string[]; localModifiedAt?: string }

const GROUPS: readonly FieldGroup<Row>[] = [["b", "c"]];

describe("pick", () => {
  test("copies only the named keys", () => {
    const r: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    expect(pick(r, ["a", "c"])).toEqual({ a: "x", c: "z" });
  });
});

describe("changedFieldGroups", () => {
  test("1:1 keys become one entry each", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    const next: Row = { id: 1, a: "X", b: "y", c: "z", tags: [] };
    const out = changedFieldGroups(prev, next, GROUPS);
    expect(out).toEqual([{ before: { a: "x" }, after: { a: "X" } }]);
  });

  test("a grouped key drags its partners into one entry", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    const next: Row = { id: 1, a: "x", b: "Y", c: "z", tags: [] };
    const out = changedFieldGroups(prev, next, GROUPS);
    expect(out).toEqual([{ before: { b: "y", c: "z" }, after: { b: "Y", c: "z" } }]);
  });

  test("array fields are compared structurally (diffFields would skip them)", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: ["p"] };
    const next: Row = { id: 1, a: "x", b: "y", c: "z", tags: ["p", "q"] };
    const out = changedFieldGroups(prev, next, GROUPS);
    expect(out).toEqual([{ before: { tags: ["p"] }, after: { tags: ["p", "q"] } }]);
  });

  test("id and localModifiedAt are never captured", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [], localModifiedAt: "t0" };
    const next: Row = { id: 1, a: "x", b: "y", c: "z", tags: [], localModifiedAt: "t1" };
    expect(changedFieldGroups(prev, next, GROUPS)).toEqual([]);
  });

  test("no changes → no entries", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    expect(changedFieldGroups(prev, { ...prev }, GROUPS)).toEqual([]);
  });
});

import {
  TASK_UNDO_GROUPS, CHANGE_UNDO_GROUPS, RAID_UNDO_GROUPS,
  MILESTONE_UNDO_GROUPS, STAKEHOLDER_UNDO_GROUPS, RESOURCE_UNDO_GROUPS,
} from "./field-groups";

describe("per-entity undo groups", () => {
  test("task pairs status+completedDate and the assignee identity", () => {
    expect(TASK_UNDO_GROUPS).toContainEqual(["status", "completedDate"]);
    expect(TASK_UNDO_GROUPS).toContainEqual(["assignee", "assigneeEmail", "resourceId"]);
  });
  test("change pairs status+decisionDate", () => {
    expect(CHANGE_UNDO_GROUPS).toContainEqual(["status", "decisionDate"]);
  });
  test("raid/milestone/stakeholder/resource default to no multi-key groups", () => {
    expect(RAID_UNDO_GROUPS).toEqual([]);
    expect(MILESTONE_UNDO_GROUPS).toEqual([]);
    expect(STAKEHOLDER_UNDO_GROUPS).toEqual([]);
    expect(RESOURCE_UNDO_GROUPS).toEqual([]);
  });
});
