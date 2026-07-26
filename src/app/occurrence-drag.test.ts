import { describe, it, expect } from "vitest";
import { resolveOccurrenceDrag } from "./occurrence-drag";
import type { Occurrence } from "./recurrence";

function occ(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    eventId: 1,
    date: "2026-07-27",
    time: "09:00",
    durationMinutes: 15,
    originalDate: "2026-07-27",
    isMoved: false,
    ...overrides,
  };
}

describe("resolveOccurrenceDrag", () => {
  it("moves the occurrence actually grabbed, not the first same-eventId occurrence in the list", () => {
    // Three occurrences of the SAME daily series (same eventId) — the exact
    // scenario the bug shipped in: resolving by eventId alone always
    // returned the first one (07-27) regardless of which chip was dragged.
    const series = [
      occ({ date: "2026-07-27", originalDate: "2026-07-27" }),
      occ({ date: "2026-07-28", originalDate: "2026-07-28" }),
      occ({ date: "2026-07-29", originalDate: "2026-07-29" }),
    ];
    // Drag the MIDDLE occurrence (07-28) to 07-30.
    const result = resolveOccurrenceDrag({
      occurrences: series,
      eventId: 1,
      originDate: "2026-07-28",
      dropDate: "2026-07-30",
    });
    expect(result).not.toBeNull();
    expect(result?.occurrence.date).toBe("2026-07-28");
    expect(result?.occurrence.originalDate).toBe("2026-07-28");
    expect(result?.toDate).toBe("2026-07-30");
  });

  it("resolves an already-moved occurrence by its current rendered date, keeping its true originalDate", () => {
    // An occurrence relocated by a prior exception: rendered on 08-05, but
    // its originalDate (what applyOccurrenceMove must key the exception by)
    // is still the rule-produced 08-03.
    const moved = occ({ date: "2026-08-05", originalDate: "2026-08-03", isMoved: true });
    const result = resolveOccurrenceDrag({
      occurrences: [moved],
      eventId: 1,
      originDate: "2026-08-05", // the chip's CURRENT rendered date
      dropDate: "2026-08-06",
    });
    expect(result?.occurrence).toBe(moved);
    expect(result?.occurrence.originalDate).toBe("2026-08-03");
  });

  it("returns null (no-op) when dropped back on the same date", () => {
    const series = [occ({ date: "2026-07-27" })];
    const result = resolveOccurrenceDrag({
      occurrences: series,
      eventId: 1,
      originDate: "2026-07-27",
      dropDate: "2026-07-27",
    });
    expect(result).toBeNull();
  });

  it("returns null when the grabbed occurrence no longer exists (e.g. removed mid-drag)", () => {
    const result = resolveOccurrenceDrag({
      occurrences: [],
      eventId: 1,
      originDate: "2026-07-27",
      dropDate: "2026-07-30",
    });
    expect(result).toBeNull();
  });
});
