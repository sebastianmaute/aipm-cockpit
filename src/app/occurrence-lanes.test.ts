import { describe, expect, it } from "vitest";
import { packOccurrenceLanes } from "./occurrence-lanes";
import type { Occurrence } from "./recurrence";

const occ = (eventId: number, date: string, time = "09:00"): Occurrence =>
  ({ eventId, date, time, durationMinutes: 30, originalDate: date, isMoved: false });

describe("packOccurrenceLanes", () => {
  it("returns no lanes for an empty list", () => {
    expect(packOccurrenceLanes([])).toEqual([]);
  });

  it("puts non-colliding (different-date) occurrences in one lane", () => {
    const lanes = packOccurrenceLanes([occ(1, "2026-07-27"), occ(2, "2026-07-28"), occ(3, "2026-07-29")]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].map((o) => o.eventId)).toEqual([1, 2, 3]);
  });

  it("stacks same-day occurrences into separate lanes", () => {
    const lanes = packOccurrenceLanes([occ(1, "2026-07-27", "09:00"), occ(2, "2026-07-27", "11:00")]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toEqual([occ(1, "2026-07-27", "09:00")]);
    expect(lanes[1]).toEqual([occ(2, "2026-07-27", "11:00")]);
  });

  it("reuses an earlier lane once that date is free again", () => {
    const lanes = packOccurrenceLanes([
      occ(1, "2026-07-27", "09:00"),
      occ(2, "2026-07-27", "11:00"),
      occ(3, "2026-07-28", "09:00"),
    ]);
    expect(lanes).toHaveLength(2);
    // Event 3 (a different date) reuses lane 0 rather than opening lane 3.
    expect(lanes[0].map((o) => o.eventId)).toEqual([1, 3]);
    expect(lanes[1].map((o) => o.eventId)).toEqual([2]);
  });

  it("packs three same-day occurrences into three separate lanes, not two", () => {
    const lanes = packOccurrenceLanes([
      occ(1, "2026-07-27"),
      occ(2, "2026-07-27"),
      occ(3, "2026-07-27"),
    ]);
    expect(lanes).toHaveLength(3);
    for (const lane of lanes) expect(lane).toHaveLength(1);
  });

  it("keeps a series in a stable lane across the window even after an earlier-sorting same-date meeting displaces one occurrence", () => {
    // Series A (id 1): daily standup, 09:00, three days. Series B (id 2): a
    // one-off meeting on day one ONLY, sorting BEFORE A that day (08:00).
    // Input is pre-sorted by date then time, mirroring what the orchestrator
    // (resource-calendar.tsx) actually feeds this function.
    const seriesA1 = occ(1, "2026-07-27", "09:00");
    const seriesA2 = occ(1, "2026-07-28", "09:00");
    const seriesA3 = occ(1, "2026-07-29", "09:00");
    const seriesB = occ(2, "2026-07-27", "08:00");
    const lanes = packOccurrenceLanes([seriesB, seriesA1, seriesA2, seriesA3]);

    // B takes lane 0 on day one (it sorts first); A is bumped to lane 1 for
    // that one day — that part is a genuine, unavoidable collision. But A's
    // OTHER two occurrences (no collision on those dates) must stay with
    // lane 1 too, not drift back to lane 0 just because it happens to be
    // free on those dates.
    const laneOfA = lanes.findIndex((lane) => lane.some((o) => o.eventId === 1));
    expect(lanes[laneOfA].map((o) => o.date)).toEqual([
      "2026-07-27", "2026-07-28", "2026-07-29",
    ]);
    const otherLanesWithA = lanes.filter((lane, i) => i !== laneOfA && lane.some((o) => o.eventId === 1));
    expect(otherLanesWithA).toHaveLength(0);
  });
});
