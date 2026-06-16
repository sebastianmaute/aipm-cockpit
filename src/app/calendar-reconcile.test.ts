import { describe, it, expect } from "vitest";
import { planCalendarReconcile, type ExistingEvent } from "./calendar-reconcile";
import type { Milestone } from "./types";

function ms(id: number, over: Partial<Milestone> = {}): Milestone {
  return { id, name: `M${id}`, date: "2026-07-01", linkedTaskIds: [], ...over };
}
const ev = (id: string): ExistingEvent => ({ id });

describe("planCalendarReconcile", () => {
  it("creates a milestone with no outlookEventId", () => {
    const p = planCalendarReconcile([ms(1)], []);
    expect(p.create.map((m) => m.id)).toEqual([1]);
    expect(p.update).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("updates a milestone whose stored id exists in Outlook", () => {
    const p = planCalendarReconcile([ms(1, { outlookEventId: "e1" })], [ev("e1")]);
    expect(p.update).toEqual([{ milestone: ms(1, { outlookEventId: "e1" }), eventId: "e1" }]);
    expect(p.create).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("updates by stored id even when absent from Outlook (dup-proof against indexing lag)", () => {
    const p = planCalendarReconcile([ms(1, { outlookEventId: "stale" })], []);
    expect(p.update).toEqual([{ milestone: ms(1, { outlookEventId: "stale" }), eventId: "stale" }]);
    expect(p.create).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("deletes an orphaned tagged event with no matching milestone", () => {
    const p = planCalendarReconcile([ms(1, { outlookEventId: "e1" })], [ev("e1"), ev("orphan")]);
    expect(p.update.map((u) => u.eventId)).toEqual(["e1"]);
    expect(p.delete).toEqual(["orphan"]);
  });
  it("empty milestones + existing events => delete all", () => {
    expect(planCalendarReconcile([], [ev("a"), ev("b")]).delete.sort()).toEqual(["a", "b"]);
  });
});
