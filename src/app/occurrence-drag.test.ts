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
      originalDate: "2026-07-28",
      dropDate: "2026-07-30",
    });
    expect(result).not.toBeNull();
    expect(result?.occurrence.date).toBe("2026-07-28");
    expect(result?.occurrence.originalDate).toBe("2026-07-28");
    expect(result?.toDate).toBe("2026-07-30");
  });

  it("resolves an already-moved occurrence by its originalDate, keeping its true identity", () => {
    // An occurrence relocated by a prior exception: rendered on 08-05, but
    // its originalDate (what applyOccurrenceMove must key the exception by,
    // and what THIS resolver now matches on) is still the rule-produced
    // 08-03.
    const moved = occ({ date: "2026-08-05", originalDate: "2026-08-03", isMoved: true });
    const result = resolveOccurrenceDrag({
      occurrences: [moved],
      eventId: 1,
      originDate: "2026-08-05", // the chip's CURRENT rendered date (no-op check only)
      originalDate: "2026-08-03", // the chip's true identity (match key)
      dropDate: "2026-08-06",
    });
    expect(result?.occurrence).toBe(moved);
    expect(result?.occurrence.originalDate).toBe("2026-08-03");
  });

  it("resolves each chip to itself when a moved occurrence renders onto a sibling's own natural date", () => {
    // The residual bug a second review round found: sanitizeExceptions does
    // not forbid a move's toDate landing on a date another occurrence of the
    // SAME series already naturally occupies. Two occurrences then share
    // BOTH eventId and rendered date — (eventId, date) is ambiguous again,
    // just with a narrower blast radius than id alone. eventId+originalDate
    // must still tell them apart.
    const movedOntoSibling = occ({ date: "2026-07-27", time: "08:00", originalDate: "2026-07-25", isMoved: true });
    const natural = occ({ date: "2026-07-27", time: "09:00", originalDate: "2026-07-27", isMoved: false });
    const pool = [movedOntoSibling, natural];

    // Grab the MOVED chip (08:00, rendered 07-27, true identity 07-25).
    const resultMoved = resolveOccurrenceDrag({
      occurrences: pool,
      eventId: 1,
      originDate: "2026-07-27",
      originalDate: "2026-07-25",
      dropDate: "2026-07-30",
    });
    expect(resultMoved?.occurrence).toBe(movedOntoSibling);

    // Grab the NATURAL chip (09:00, rendered and identity both 07-27).
    const resultNatural = resolveOccurrenceDrag({
      occurrences: pool,
      eventId: 1,
      originDate: "2026-07-27",
      originalDate: "2026-07-27",
      dropDate: "2026-07-31",
    });
    expect(resultNatural?.occurrence).toBe(natural);
  });

  it("returns null (no-op) when dropped back on the same RENDERED date", () => {
    const series = [occ({ date: "2026-07-27", originalDate: "2026-07-27" })];
    const result = resolveOccurrenceDrag({
      occurrences: series,
      eventId: 1,
      originDate: "2026-07-27",
      originalDate: "2026-07-27",
      dropDate: "2026-07-27",
    });
    expect(result).toBeNull();
  });

  it("returns null when the grabbed occurrence no longer exists (e.g. removed mid-drag)", () => {
    const result = resolveOccurrenceDrag({
      occurrences: [],
      eventId: 1,
      originDate: "2026-07-27",
      originalDate: "2026-07-27",
      dropDate: "2026-07-30",
    });
    expect(result).toBeNull();
  });

  it("fails to resolve — rather than resolving to the wrong occurrence — if origin/original dates are swapped by caller error", () => {
    // Re-running the reviewer's original adversarial idea against the new
    // two-field shape: the SAME already-moved occurrence as above (rendered
    // 08-05, true identity 08-03), but originDate and originalDate are fed
    // in SWAPPED. The no-op check (originDate vs dropDate) doesn't fire —
    // 08-03 !== 08-06 — so it proceeds to match on the (wrong) originalDate
    // 08-05, which does not equal the occurrence's real originalDate
    // (08-03). Resolution must fail cleanly, not silently succeed against
    // the wrong understanding of which occurrence this is.
    const moved = occ({ date: "2026-08-05", originalDate: "2026-08-03", isMoved: true });
    const result = resolveOccurrenceDrag({
      occurrences: [moved],
      eventId: 1,
      originDate: "2026-08-03", // WRONG slot — this is actually the rule date
      originalDate: "2026-08-05", // WRONG slot — this is actually the rendered date
      dropDate: "2026-08-06",
    });
    expect(result).toBeNull();
  });
});
