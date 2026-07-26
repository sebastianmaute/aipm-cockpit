import { describe, expect, it } from "vitest";
import { resolveCalendarDrag } from "./calendar-drag";
import type { Absence, Resource } from "./types";

const abs: Absence = {
  id: 7,
  assignee: "Anna",
  assigneeEmail: "anna@example.com",
  startDate: "2026-07-06",
  endDate: "2026-07-08",
  type: "vacation",
  resourceId: 3,
};

describe("resolveCalendarDrag", () => {
  it("moves the whole range, preserving the span", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-07", dropDate: "2026-07-09",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    });
    expect(out).toEqual({ kind: "move", patch: { startDate: "2026-07-08", endDate: "2026-07-10" } });
  });

  it("moves backwards across a month boundary", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-06-30",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    });
    expect(out?.patch).toEqual({ startDate: "2026-06-30", endDate: "2026-07-02" });
  });

  it("reassigns when dropped on another row, rewriting all three identity fields", () => {
    const ben: Resource = {
      id: 9, firstName: "Ben", lastName: "Stone", email: "ben@example.com",
    } as Resource;
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-06",
      currentRowKey: "anna", dropRowKey: "ben stone", mode: "move",
      dropRow: { display: "Ben Stone", email: "ben@example.com", resource: ben },
    });
    expect(out).toEqual({
      kind: "reassign",
      patch: {
        startDate: "2026-07-06", endDate: "2026-07-08",
        assignee: "Ben Stone", assigneeEmail: "ben@example.com", resourceId: 9,
      },
    });
  });

  it("clears the FK when the target row has no backing resource", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-06",
      currentRowKey: "anna", dropRowKey: "cara", mode: "move",
      dropRow: { display: "Cara", email: "", resource: undefined },
    });
    expect(out?.patch).toMatchObject({ assignee: "Cara", assigneeEmail: undefined, resourceId: undefined });
  });

  it("resizes the end", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-08", dropDate: "2026-07-11",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-end",
    });
    expect(out).toEqual({ kind: "resize", patch: { startDate: "2026-07-06", endDate: "2026-07-11" } });
  });

  it("collapses to a single day when a resize crosses over", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-08", dropDate: "2026-07-04",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-end",
    });
    expect(out?.patch).toEqual({ startDate: "2026-07-06", endDate: "2026-07-06" });
  });

  it("resizes the start and clamps the other way", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-20",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-start",
    });
    expect(out?.patch).toEqual({ startDate: "2026-07-20", endDate: "2026-07-20" });
  });

  it("returns null for a no-op drop so a stray click writes nothing", () => {
    expect(resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-07", dropDate: "2026-07-07",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    })).toBeNull();
  });

  it("returns null for a malformed drop date rather than producing NaN dates", () => {
    expect(resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-07", dropDate: "not-a-date",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    })).toBeNull();
  });

  it("returns null when an end-resize is dropped back on the same edge", () => {
    expect(resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-08", dropDate: "2026-07-08",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-end",
    })).toBeNull();
  });

  it("returns null when a start-resize is dropped back on the same edge", () => {
    expect(resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-06",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-start",
    })).toBeNull();
  });

  it("shifts the dates AND reassigns when a drag crosses both axes", () => {
    const ben: Resource = {
      id: 9, firstName: "Ben", lastName: "Stone", email: "ben@example.com",
    } as Resource;
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-09",
      currentRowKey: "anna", dropRowKey: "ben stone", mode: "move",
      dropRow: { display: "Ben Stone", email: "ben@example.com", resource: ben },
    });
    expect(out).toEqual({
      kind: "reassign",
      patch: {
        startDate: "2026-07-09", endDate: "2026-07-11",
        assignee: "Ben Stone", assigneeEmail: "ben@example.com", resourceId: 9,
      },
    });
  });
});
