import { describe, it, expect } from "vitest";
import { planCalendarPull, type PulledEvent } from "./calendar-pull";

const ev = (id: string, date: string | null, isCancelled = false): PulledEvent => ({ id, date, isCancelled });

describe("planCalendarPull", () => {
  it("applies an Outlook move when the entity is unchanged since last sync", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: { e1: "2026-02-01" },
    });
    expect(plan.applies).toEqual([{ id: 1, eventId: "e1", newDate: "2026-02-10" }]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.deletions).toEqual([]);
  });
  it("flags a conflict when both sides changed", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-05", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: { e1: "2026-02-01" },
    });
    expect(plan.applies).toEqual([]);
    expect(plan.conflicts).toEqual([{ id: 1, eventId: "e1", appDate: "2026-02-05", outlookDate: "2026-02-10" }]);
  });
  it("flags a conflict (not an apply) when there is no baseline (bootstrap safety)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-05", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: {},
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.applies).toEqual([]);
  });
  it("flags a deletion for a missing or cancelled or null-date event", () => {
    const args = (events: PulledEvent[]) => planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }], events, baseline: { e1: "2026-02-01" },
    });
    expect(args([]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
    expect(args([ev("e1", "2026-02-01", true)]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
    expect(args([ev("e1", null)]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
  });
  it("is a no-op when dates already match", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-01")],
      baseline: {},
    });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
  });
  it("ignores entities without an outlookEventId", () => {
    const plan = planCalendarPull({ entities: [{ id: 1, date: "2026-02-01" }], events: [], baseline: {} });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
  });
});
