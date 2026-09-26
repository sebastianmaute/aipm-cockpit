import { describe, it, expect } from "vitest";
import {
  planCalendarReconcile,
  planEntityReconcile,
  type ExistingEvent,
  type HasEventLink,
} from "./calendar-reconcile";
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

describe("planEntityReconcile", () => {
  type Row = HasEventLink & { name: string };
  it("creates items without an event id", () => {
    const plan = planEntityReconcile<Row>([{ id: 1, name: "a" }], []);
    expect(plan.create.map((i) => i.id)).toEqual([1]);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
  });
  it("updates linked items and deletes orphan existing events", () => {
    const items: Row[] = [{ id: 1, name: "a", outlookEventId: "E1" }];
    const plan = planEntityReconcile<Row>(items, [{ id: "E1" }, { id: "E2" }]);
    expect(plan.update).toEqual([{ item: items[0], eventId: "E1" }]);
    expect(plan.delete).toEqual(["E2"]);
    expect(plan.create).toEqual([]);
  });
  it("keeps all linked ids so none are spuriously deleted", () => {
    const items: Row[] = [
      { id: 1, name: "a", outlookEventId: "E1" },
      { id: 2, name: "b", outlookEventId: "E2" },
    ];
    const plan = planEntityReconcile<Row>(items, [{ id: "E1" }, { id: "E2" }]);
    expect(plan.delete).toEqual([]);
    expect(plan.update).toHaveLength(2);
  });
});

describe("calendarOptOut (§486)", () => {
  const ev = (id: string): ExistingEvent => ({ id });
  it("planEntityReconcile never creates an opted-out unlinked item", () => {
    const p = planEntityReconcile([{ id: 1, calendarOptOut: true }, { id: 2 }], []);
    expect(p.create.map((i) => i.id)).toEqual([2]);
  });
  it("planEntityReconcile neither updates nor deletes an opted-out LINKED item's event", () => {
    const p = planEntityReconcile([{ id: 1, outlookEventId: "E1", calendarOptOut: true }], [ev("E1"), ev("E9")]);
    expect(p.update).toEqual([]);
    // E9 is an orphan nobody references, so it still goes — only the opted-out item's own event is kept.
    expect(p.delete).toEqual(["E9"]);
  });
  it("planCalendarReconcile applies the same rules to milestones", () => {
    const p = planCalendarReconcile(
      [ms(1, { calendarOptOut: true }), ms(2, { outlookEventId: "E2", calendarOptOut: true })],
      [ev("E2"), ev("E9")],
    );
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.delete).toEqual(["E9"]);
  });
  it("only a literal true opts out — a truthy string does not (§486 fix round 1)", () => {
    const bogus = { id: 1, calendarOptOut: "false" as unknown as boolean };
    expect(planEntityReconcile([bogus], []).create).toHaveLength(1);
    expect(planCalendarReconcile([ms(1, { calendarOptOut: "false" as unknown as boolean })], []).create).toHaveLength(1);
  });
  it("an item that opts back in is created again", () => {
    expect(planEntityReconcile([{ id: 1, calendarOptOut: false }], []).create).toHaveLength(1);
    expect(planCalendarReconcile([ms(1, { calendarOptOut: false })], []).create).toHaveLength(1);
  });
});
