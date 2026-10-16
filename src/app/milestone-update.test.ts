import { describe, expect, it, vi } from "vitest";
import { commitMilestoneUpdate, moveMilestoneDate, type MilestoneUpdateDeps } from "./milestone-update";
import type { Milestone } from "./types";

const STAMP = "2026-10-16T10:00:00.000Z";
const a: Milestone = { id: 1, name: "Pilot Go-Live", date: "2026-10-23", linkedTaskIds: [] };
const b: Milestone = { id: 2, name: "Rollout", date: "2026-12-11", linkedTaskIds: [] };

/** A setter that applies updaters to a local list, so a test can read the result. */
function harness(initial: readonly Milestone[]) {
  let list = initial;
  const setMilestones = vi.fn((u: readonly Milestone[] | ((p: readonly Milestone[]) => readonly Milestone[])) => {
    list = typeof u === "function" ? u(list) : u;
  });
  const captureFieldEdit = vi.fn();
  const logActivity = vi.fn();
  const logActivityChanges = vi.fn();
  const deps: MilestoneUpdateDeps = { setMilestones, captureFieldEdit, logActivity, logActivityChanges };
  return { deps, captureFieldEdit, logActivity, logActivityChanges, read: () => list };
}

describe("commitMilestoneUpdate", () => {
  it("replaces only the row with the same id", () => {
    const h = harness([a, b]);
    const next = { ...a, date: "2026-10-30", localModifiedAt: STAMP };
    commitMilestoneUpdate(a, next, h.deps);
    expect(h.read()).toEqual([next, b]);
  });

  it("captures the date change for undo, stamping localModifiedAt", () => {
    const h = harness([a]);
    commitMilestoneUpdate(a, { ...a, date: "2026-10-30", localModifiedAt: STAMP }, h.deps);
    expect(h.captureFieldEdit).toHaveBeenCalledTimes(1);
    expect(h.captureFieldEdit.mock.calls[0][0]).toMatchObject({
      kind: "milestone.updated",
      id: 1,
      before: { date: "2026-10-23" },
      after: { date: "2026-10-30" },
      stampField: "localModifiedAt",
      name: "Pilot Go-Live",
    });
  });

  it("captures nothing when suppressFieldUndo is set", () => {
    const h = harness([a]);
    commitMilestoneUpdate(a, { ...a, date: "2026-10-30" }, h.deps, { suppressFieldUndo: true });
    expect(h.captureFieldEdit).not.toHaveBeenCalled();
  });

  it("logs the changed fields when a change logger is wired", () => {
    const h = harness([a]);
    commitMilestoneUpdate(a, { ...a, date: "2026-10-30" }, h.deps);
    expect(h.logActivityChanges).toHaveBeenCalledWith(
      "milestone.updated",
      [expect.objectContaining({ field: "date", from: "2026-10-23", to: "2026-10-30" })],
      1,
    );
    expect(h.logActivity).not.toHaveBeenCalled();
  });

  it("falls back to a plain activity row without a change logger", () => {
    const h = harness([a]);
    commitMilestoneUpdate(a, { ...a, date: "2026-10-30" }, { ...h.deps, logActivityChanges: undefined });
    expect(h.logActivity).toHaveBeenCalledWith("milestone.updated", 1);
  });
});

describe("moveMilestoneDate", () => {
  it("moves an open milestone and stamps it", () => {
    const h = harness([a, b]);
    expect(moveMilestoneDate([a, b], 1, "2026-10-30", h.deps, () => STAMP)).toBe("moved");
    expect(h.read()[0]).toEqual({ ...a, date: "2026-10-30", localModifiedAt: STAMP });
    expect(h.read()[1]).toBe(b);
  });

  it("leaves an achieved milestone where it is", () => {
    const done = { ...a, achievedDate: "2026-10-20" };
    const h = harness([done]);
    expect(moveMilestoneDate([done], 1, "2026-10-30", h.deps)).toBe("achieved");
    expect(h.read()).toEqual([done]);
    expect(h.captureFieldEdit).not.toHaveBeenCalled();
  });

  it("reports a milestone deleted by a concurrent writer", () => {
    const h = harness([b]);
    expect(moveMilestoneDate([b], 1, "2026-10-30", h.deps)).toBe("vanished");
    expect(h.read()).toEqual([b]);
  });

  it("writes nothing for a move back onto the same date", () => {
    const h = harness([a]);
    expect(moveMilestoneDate([a], 1, "2026-10-23", h.deps)).toBe("unchanged");
    expect(h.logActivityChanges).not.toHaveBeenCalled();
    expect(h.captureFieldEdit).not.toHaveBeenCalled();
  });
});
