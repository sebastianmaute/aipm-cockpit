import { describe, it, expect } from "vitest";
import { planCalendarPull, type PulledEvent } from "./calendar-pull";

const ev = (id: string, date: string | null, isCancelled = false): PulledEvent => ({ id, date, endDate: null, isCancelled });
const rangeEv = (id: string, date: string | null, endDate: string | null, isCancelled = false): PulledEvent => ({ id, date, endDate, isCancelled });

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
  it("flags a deletion for a missing or cancelled event only (definitive)", () => {
    const args = (events: PulledEvent[]) => planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }], events, baseline: { e1: "2026-02-01" },
    });
    // Missing event (no matching id) => definitive deletion.
    expect(args([]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
    // Cancelled event => definitive deletion.
    expect(args([ev("e1", "2026-02-01", true)]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
  });
  it("does NOT delete a missing event when the fetch was truncated (eventsComplete:false)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [], // e1 absent — but the fetch was incomplete, so it may be unfetched
      baseline: { e1: "2026-02-01" },
      eventsComplete: false,
    });
    expect(plan.deletions).toEqual([]);
  });
  it("DELETES a missing event when the fetch was complete (eventsComplete:true / omitted)", () => {
    const complete = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [], baseline: { e1: "2026-02-01" }, eventsComplete: true,
    });
    expect(complete.deletions).toEqual([{ id: 1, eventId: "e1" }]);
    const omitted = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [], baseline: { e1: "2026-02-01" },
    });
    expect(omitted.deletions).toEqual([{ id: 1, eventId: "e1" }]);
  });
  it("STILL deletes a cancelled event even when the fetch was truncated (definitive)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-01", true)],
      baseline: { e1: "2026-02-01" },
      eventsComplete: false,
    });
    expect(plan.deletions).toEqual([{ id: 1, eventId: "e1" }]);
  });
  it("skips a present event with a null start date (transient/unreadable, not a deletion)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", null)],
      baseline: { e1: "2026-02-01" },
    });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
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

  // --- Range (absence) support: single-date path must stay byte-identical ---
  it("keeps the single-date apply object free of range keys (no newEndDate)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: { e1: "2026-02-01" },
    });
    // Exact match: an extra newEndDate key would fail this.
    expect(plan.applies[0]).toEqual({ id: 1, eventId: "e1", newDate: "2026-02-10" });
  });
  it("keeps the single-date conflict object free of range keys", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-05", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: { e1: "2026-02-01" },
    });
    expect(plan.conflicts[0]).toEqual({ id: 1, eventId: "e1", appDate: "2026-02-05", outlookDate: "2026-02-10" });
  });
  it("is a no-op for a range entity when both start and end match", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", endDate: "2026-02-05", outlookEventId: "e1" }],
      events: [rangeEv("e1", "2026-02-01", "2026-02-05")],
      baseline: {},
    });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
  });
  it("applies a start-only move on a range entity, carrying newEndDate", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", endDate: "2026-02-05", outlookEventId: "e1" }],
      events: [rangeEv("e1", "2026-02-02", "2026-02-05")],
      baseline: { e1: "2026-02-01|2026-02-05" },
    });
    expect(plan.applies).toEqual([{ id: 1, eventId: "e1", newDate: "2026-02-02", newEndDate: "2026-02-05" }]);
    expect(plan.conflicts).toEqual([]);
  });
  it("applies an end-only resize on a range entity", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", endDate: "2026-02-05", outlookEventId: "e1" }],
      events: [rangeEv("e1", "2026-02-01", "2026-02-07")],
      baseline: { e1: "2026-02-01|2026-02-05" },
    });
    expect(plan.applies).toEqual([{ id: 1, eventId: "e1", newDate: "2026-02-01", newEndDate: "2026-02-07" }]);
    expect(plan.conflicts).toEqual([]);
  });
  it("flags a range conflict (with appEndDate + outlookEndDate) on baseline mismatch", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-02", endDate: "2026-02-06", outlookEventId: "e1" }],
      events: [rangeEv("e1", "2026-02-03", "2026-02-08")],
      baseline: { e1: "2026-02-01|2026-02-05" },
    });
    expect(plan.applies).toEqual([]);
    expect(plan.conflicts).toEqual([
      { id: 1, eventId: "e1", appDate: "2026-02-02", outlookDate: "2026-02-03", appEndDate: "2026-02-06", outlookEndDate: "2026-02-08" },
    ]);
  });
  it("skips a range entity whose event has a valid start but null endDate (transient/unreadable, not a deletion)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", endDate: "2026-02-05", outlookEventId: "e1" }],
      events: [rangeEv("e1", "2026-02-01", null)],
      baseline: { e1: "2026-02-01|2026-02-05" },
    });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
  });
});
