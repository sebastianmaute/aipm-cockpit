import { describe, test, it, expect } from "vitest";
import { pick, changedFieldGroups, buildBulkFieldEdits, type FieldGroup } from "./field-groups";

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
  CALENDAR_EVENT_UNDO_GROUPS,
} from "./field-groups";
import type { CalendarEvent } from "../calendar-event";

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

describe("CALENDAR_EVENT_UNDO_GROUPS", () => {
  const base: CalendarEvent = {
    id: 1, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "daily", interval: 1 },
    exceptions: [{ date: "2026-06-03", kind: "skip" }],
  };

  it("emits ONE entry when de-recurring drops both recurrence and exceptions", () => {
    // sanitizeCalendarEvent clears exceptions whenever recurrence is gone, so
    // split entries would let undo restore the rule with its skips/moves lost.
    const next: CalendarEvent = { ...base, recurrence: undefined, exceptions: undefined };
    const out = changedFieldGroups(base, next, CALENDAR_EVENT_UNDO_GROUPS);
    expect(out).toHaveLength(1);
    expect(out[0].before).toEqual({
      startDate: "2026-06-01",
      recurrence: { freq: "daily", interval: 1 },
      exceptions: [{ date: "2026-06-03", kind: "skip" }],
    });
    expect(out[0].after).toEqual({
      startDate: "2026-06-01", recurrence: undefined, exceptions: undefined,
    });
  });

  it("emits ONE entry carrying all three keys when only startDate moved", () => {
    // sanitizeRecurrence cross-validates until >= startDate, so startDate has
    // to revert together with the rule or an undo lands on a row the next load
    // re-strips. The two unchanged values are written back identical.
    const out = changedFieldGroups(base, { ...base, startDate: "2026-07-01" }, CALENDAR_EVENT_UNDO_GROUPS);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0].before).sort()).toEqual(["exceptions", "recurrence", "startDate"]);
  });

  it("emits a separate single-key entry for an ungrouped field", () => {
    const out = changedFieldGroups(base, { ...base, title: "Renamed" }, CALENDAR_EVENT_UNDO_GROUPS);
    expect(out).toHaveLength(1);
    expect(out[0].before).toEqual({ title: "Standup" });
  });
});

describe("buildBulkFieldEdits", () => {
  type Row = { id: number; sev: string; owner?: string; localModifiedAt?: string; noteLog?: string[] };

  it("emits one edit per row carrying only the CHANGED keys", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low", owner: "ann" }, after: { id: 1, sev: "High", owner: "ann" } },
    ]);
    expect(edits).toEqual([{ id: 1, before: { sev: "Low" }, after: { sev: "High" } }]);
  });

  it("skips a row nothing changed on", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low" }, after: { id: 1, sev: "Low" } },
      { before: { id: 2, sev: "Low" }, after: { id: 2, sev: "High" } },
    ]);
    expect(edits.map((e) => e.id)).toEqual([2]);
  });

  it("never captures id or localModifiedAt", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low", localModifiedAt: "t0" }, after: { id: 1, sev: "High", localModifiedAt: "t1" } },
    ]);
    expect(Object.keys(edits[0].before)).toEqual(["sev"]);
  });

  it("does NOT capture a write-through field even when it differs", () => {
    // A note added between the panel reading the row and building the patch must
    // not become part of what undo reverts — that is the whole defect this closes.
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low", noteLog: ["a"] }, after: { id: 1, sev: "High", noteLog: ["a", "b"] } },
    ]);
    expect(Object.keys(edits[0].before)).toEqual(["sev"]);
  });

  it("captures a field set from undefined and one cleared to undefined", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low" }, after: { id: 1, sev: "Low", owner: "ann" } },
      { before: { id: 2, sev: "Low", owner: "bo" }, after: { id: 2, sev: "Low" } },
    ]);
    expect(edits[0]).toEqual({ id: 1, before: { owner: undefined }, after: { owner: "ann" } });
    expect(edits[1]).toEqual({ id: 2, before: { owner: "bo" }, after: { owner: undefined } });
  });

  it("returns an empty array for an empty input", () => {
    expect(buildBulkFieldEdits<Row>([])).toEqual([]);
  });
});
