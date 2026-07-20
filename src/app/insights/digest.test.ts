import { describe, expect, it } from "vitest";
import { computeInsightDigest, DIGEST_WINDOW_DAYS } from "./digest";
import type { Insight } from "./insight";

describe("computeInsightDigest window", () => {
  it("defaults to a 7-day window ending today, inclusive of both ends", () => {
    const d = computeInsightDigest([], "2026-07-20");
    expect(d.windowDays).toBe(DIGEST_WINDOW_DAYS);
    expect(d.to).toBe("2026-07-20");
    expect(d.from).toBe("2026-07-14"); // today minus 6 days
  });

  it("honours an explicit windowDays", () => {
    expect(computeInsightDigest([], "2026-07-20", 1).from).toBe("2026-07-20");
    expect(computeInsightDigest([], "2026-07-20", 30).from).toBe("2026-06-21");
  });

  it("returns an empty digest for an unparseable today rather than throwing", () => {
    const d = computeInsightDigest([], "not-a-date");
    expect(d.isEmpty).toBe(true);
    expect(d.firedCount).toBe(0);
  });

  it("treats a non-positive or non-finite windowDays as the default", () => {
    expect(computeInsightDigest([], "2026-07-20", 0).windowDays).toBe(DIGEST_WINDOW_DAYS);
    expect(computeInsightDigest([], "2026-07-20", -5).windowDays).toBe(DIGEST_WINDOW_DAYS);
    expect(computeInsightDigest([], "2026-07-20", Number.NaN).windowDays).toBe(DIGEST_WINDOW_DAYS);
  });

  it("is empty for an empty input", () => {
    const d = computeInsightDigest([], "2026-07-20");
    expect(d).toMatchObject({ firedCount: 0, actedCount: 0, openNow: 0, isEmpty: true });
    expect(d.wins).toEqual([]);
    expect(d.regressions).toEqual([]);
  });
});

function ins(over: Partial<Insight> & { id: number }): Insight {
  return {
    key: `k${over.id}`,
    type: "stalledWork",
    severity: "medium",
    data: { count: 5 },
    status: "active",
    firstSeenAt: "2026-07-20",
    lastSeenAt: "2026-07-20",
    occurrences: 1,
    ...over,
  } as Insight;
}

describe("computeInsightDigest buckets", () => {
  const today = "2026-07-20"; // window 2026-07-14 .. 2026-07-20

  it("counts firstSeenAt inside the window and excludes older", () => {
    const d = computeInsightDigest(
      [ins({ id: 1, firstSeenAt: "2026-07-14" }), ins({ id: 2, firstSeenAt: "2026-07-13" })],
      today,
    );
    expect(d.firedCount).toBe(1);
  });

  it("EXCLUDES future-dated events so a skewed clock cannot inflate counts", () => {
    const d = computeInsightDigest([ins({ id: 1, firstSeenAt: "2026-07-21" })], today);
    expect(d.firedCount).toBe(0);
  });

  it("counts actedAt in window regardless of the record's current status", () => {
    const d = computeInsightDigest(
      [ins({ id: 1, status: "resolved", actedAt: "2026-07-18", resolvedAt: "2026-07-19" })],
      today,
    );
    expect(d.actedCount).toBe(1);
  });

  it("collects resolved records that carry an outcome as wins", () => {
    const win = ins({
      id: 1, status: "resolved", actedAt: "2026-07-15", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    });
    const noOutcome = ins({ id: 2, status: "resolved", resolvedAt: "2026-07-18" });
    const d = computeInsightDigest([win, noOutcome], today);
    expect(d.wins.map((w) => w.id)).toEqual([1]);
  });

  it("collects worsened outcomes measured in the window as regressions", () => {
    const bad = ins({
      id: 1, status: "acted", actedAt: "2026-07-15",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-07-19" },
    });
    const stale = ins({
      id: 2, status: "acted", actedAt: "2026-03-01",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-03-02" },
    });
    const d = computeInsightDigest([bad, stale], today);
    expect(d.regressions.map((r) => r.id)).toEqual([1]);
  });

  it("counts openNow as live active+acknowledged, NOT windowed", () => {
    const d = computeInsightDigest(
      [
        ins({ id: 1, status: "active", firstSeenAt: "2025-01-01" }),
        ins({ id: 2, status: "acknowledged", firstSeenAt: "2025-01-01" }),
        ins({ id: 3, status: "dismissed" }),
        ins({ id: 4, status: "resolved" }),
      ],
      today,
    );
    expect(d.openNow).toBe(2);
    expect(d.isEmpty).toBe(false);
  });

  it("sorts wins by date descending, then id ascending", () => {
    const mk = (id: number, on: string) =>
      ins({ id, status: "resolved", resolvedAt: on,
        outcome: { direction: "improved", baseline: 3, measuredAt: on } });
    const d = computeInsightDigest([mk(2, "2026-07-16"), mk(9, "2026-07-18"), mk(4, "2026-07-18")], today);
    expect(d.wins.map((w) => w.id)).toEqual([4, 9, 2]);
  });

  it("is not empty when only wins exist", () => {
    const d = computeInsightDigest(
      [ins({ id: 1, status: "resolved", firstSeenAt: "2025-01-01", resolvedAt: "2026-07-18",
        outcome: { direction: "improved", baseline: 3, measuredAt: "2026-07-18" } })],
      today,
    );
    expect(d.isEmpty).toBe(false);
  });
});

describe("computeInsightDigest bucket exclusivity", () => {
  const today = "2026-07-20";

  // A resolved record means the condition CLEARED. In-app such a record always
  // carries `improved` (computeClearedOutcome hardcodes it), but sanitizeInsights
  // re-derives direction from baseline/current and will admit resolved+worsened
  // from an imported or hand-edited blob. Counting it as BOTH a win and a
  // regression inflates the digest in two directions at once.
  it("never counts one record as both a win and a regression", () => {
    const contradictory = ins({
      id: 1,
      status: "resolved",
      actedAt: "2026-07-15",
      resolvedAt: "2026-07-18",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-07-18" },
    });
    const d = computeInsightDigest([contradictory], today);
    const inWins = d.wins.some((w) => w.id === 1);
    const inRegressions = d.regressions.some((r) => r.id === 1);
    expect(inWins && inRegressions).toBe(false);
  });

  // SUPERSEDED BEHAVIOUR, changed deliberately after review. This originally
  // asserted the contradictory record landed in `wins` — exclusivity was
  // achieved by excluding `resolved` from regressions. But that put a record
  // under "Resolved after you acted" with a red dot reading "Worsened by 5".
  // Wins are now gated on `direction === "improved"`, so a contradictory record
  // is claimed by NEITHER bucket: we assert no win we cannot support, and no
  // live regression on a condition that has cleared.
  it("claims a contradictory resolved record for neither bucket", () => {
    const contradictory = ins({
      id: 1,
      status: "resolved",
      resolvedAt: "2026-07-18",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-07-18" },
    });
    const d = computeInsightDigest([contradictory], today);
    expect(d.regressions).toEqual([]);
    expect(d.wins).toEqual([]);
  });
});

describe("computeInsightDigest review fixes", () => {
  const today = "2026-07-20";

  // The panel's default list hides only TERMINAL statuses (dismissed/resolved),
  // so an `acted` record RENDERS in it. The digest sits directly above that list
  // in the same scroller, so a count that excluded `acted` would read "2 open
  // now" above three visible rows — and an acted-but-not-yet-measured insight is
  // the normal steady state of the whole SP3 outcome flow, not an edge case.
  it("counts acted as open, matching the list rendered directly below it", () => {
    const d = computeInsightDigest(
      [
        ins({ id: 1, status: "active" }),
        ins({ id: 2, status: "acknowledged" }),
        ins({ id: 3, status: "acted", actedAt: "2026-07-15" }),
        ins({ id: 4, status: "dismissed" }),
        ins({ id: 5, status: "resolved" }),
      ],
      today,
    );
    expect(d.openNow).toBe(3);
  });

  // A win is a claim that things got BETTER. Gating only on "has an outcome"
  // let a resolved+worsened record render under "Resolved after you acted"
  // carrying a red dot reading "Worsened by 5" — one row asserting both
  // directions, and an inflated win count. sanitizeOutcome RE-DERIVES direction
  // from baseline/current, so an imported blob reaches this shape.
  it("counts only improved outcomes as wins", () => {
    const worse = ins({
      id: 1, status: "resolved", resolvedAt: "2026-07-18",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-07-18" },
    });
    const flat = ins({
      id: 2, status: "resolved", resolvedAt: "2026-07-18",
      outcome: { direction: "unchanged", baseline: 4, current: 4, delta: 0, measuredAt: "2026-07-18" },
    });
    const good = ins({
      id: 3, status: "resolved", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    });
    const d = computeInsightDigest([worse, flat, good], today);
    expect(d.wins.map((w) => w.id)).toEqual([3]);
    expect(d.regressions).toEqual([]); // still exclusive — not double-counted
  });

  // The engine's contract is "never throws". `new Date(...).toISOString()` throws
  // RangeError once the offset leaves the ±8.64e15 ms Date range, and emits a
  // malformed negative-year string well before that.
  it("survives an absurd windowDays without throwing or emitting a malformed date", () => {
    for (const days of [1_000_000, 1_000_000_000, Number.MAX_SAFE_INTEGER]) {
      const d = computeInsightDigest([], today, days);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(d.from)).toBe(true);
      expect(d.from <= d.to).toBe(true);
    }
  });
});
