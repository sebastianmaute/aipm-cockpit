import { describe, test, expect } from "vitest";
import { sanitizeInsights } from "./sanitize-insights";

describe("sanitizeInsights", () => {
  test("returns [] for non-array input, never throws", () => {
    expect(sanitizeInsights(undefined)).toEqual([]);
    expect(sanitizeInsights(null)).toEqual([]);
    expect(sanitizeInsights("nope" as unknown)).toEqual([]);
    expect(sanitizeInsights(42 as unknown)).toEqual([]);
  });

  test("drops records with an invalid type/severity/status", () => {
    const out = sanitizeInsights([
      { id: 1, key: "k", type: "bogus", severity: "high", status: "active",
        data: {}, firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1 },
      { id: 2, key: "k2", type: "overdueTrend", severity: "nope", status: "active",
        data: {}, firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1 },
    ]);
    expect(out).toEqual([]);
  });

  test("keeps a valid record and coerces occurrences to a positive int", () => {
    const out = sanitizeInsights([
      { id: 5, key: "milestoneSlip:12", type: "milestoneSlip", severity: "high",
        status: "acted", data: { count: 3, name: "M12" },
        entityRef: { view: "milestones", id: 12 },
        firstSeenAt: "2026-01-01", lastSeenAt: "2026-02-01", occurrences: 3.9,
        actedAt: "2026-02-02" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 5, key: "milestoneSlip:12", type: "milestoneSlip", severity: "high",
      status: "acted", occurrences: 3, entityRef: { view: "milestones", id: 12 },
    });
  });

  test("caps the list at MAX_INSIGHTS and truncates dismissReason", () => {
    const many = Array.from({ length: 260 }, (_, i) => ({
      id: i + 1, key: `k${i}`, type: "overdueTrend", severity: "low",
      status: "active", data: {}, firstSeenAt: "2026-01-01",
      lastSeenAt: "2026-01-01", occurrences: 1,
    }));
    expect(sanitizeInsights(many)).toHaveLength(200);
    const [one] = sanitizeInsights([
      { id: 1, key: "k", type: "overdueTrend", severity: "low", status: "dismissed",
        data: {}, firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01",
        occurrences: 1, dismissReason: "x".repeat(9999) },
    ]);
    expect(one.dismissReason?.length).toBe(500);
  });

  test("drops non-primitive data values and caps string values", () => {
    const [one] = sanitizeInsights([
      { id: 1, key: "k", type: "overdueTrend", severity: "low", status: "active",
        data: { good: 3, big: "y".repeat(9999), bad: { nested: 1 } },
        firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1 },
    ]);
    expect(one.data.good).toBe(3);
    expect((one.data.big as string).length).toBe(200);
    expect(one.data).not.toHaveProperty("bad");
  });

  function baseRaw() {
    return {
      id: 1, key: "raidAging:5", type: "raidAging", severity: "high", status: "active",
      data: {}, firstSeenAt: "2026-07-20", lastSeenAt: "2026-07-20", occurrences: 1,
    };
  }

  test("keeps a valid recommendation", () => {
    const rec = {
      summary: "Reschedule task 12 to next week", status: "proposed", generatedAt: "2026-07-20",
      proposedCalls: [{ name: "update_task", input: { id: 12, dueDate: "2026-07-27" } }],
    };
    const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: rec }]);
    expect(out.recommendation?.summary).toBe("Reschedule task 12 to next week");
    expect(out.recommendation?.proposedCalls).toHaveLength(1);
    expect(out.recommendation?.status).toBe("proposed");
  });

  test("drops recommendation with empty summary or non-array calls", () => {
    const [a] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "  ", proposedCalls: [] } }]);
    expect(a.recommendation).toBeUndefined();
    const [b] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "x", proposedCalls: "nope" } }]);
    expect(b.recommendation).toBeUndefined();
  });

  test("drops malformed proposedCalls and caps count", () => {
    const calls = [
      { name: "update_task", input: { id: 1 } },
      { name: 123, input: {} },
      { name: "update_task", input: "no" },
      ...Array.from({ length: 10 }, () => ({ name: "update_task", input: { id: 2 } })),
    ];
    const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "s", proposedCalls: calls } }]);
    expect(out.recommendation!.proposedCalls.length).toBeLessThanOrEqual(5);
    expect(out.recommendation!.proposedCalls.every((c) => typeof c.name === "string" && typeof c.input === "object")).toBe(true);
  });

  test("defaults bad status to proposed", () => {
    const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "s", status: "weird", proposedCalls: [{ name: "update_task", input: {} }] } }]);
    expect(out.recommendation!.status).toBe("proposed");
  });

  test("drops a proposedCall whose tool is not in the allow-set (security)", () => {
    const rec = {
      summary: "s",
      proposedCalls: [
        { name: "update_task", input: { id: 1 } },
        { name: "delete_all_tasks", input: {} },
        { name: "delete_task", input: { id: 2 } },
        { name: "update_settings", input: { dashboardDensity: "compact" } },
      ],
    };
    const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: rec }]);
    expect(out.recommendation!.proposedCalls).toHaveLength(1);
    expect(out.recommendation!.proposedCalls[0].name).toBe("update_task");
  });

  describe("outcome (SP3)", () => {
    function actedRaw() {
      return {
        id: 1, key: "stalledWork:7", type: "stalledWork", severity: "high",
        status: "acted", data: { count: 3 },
        firstSeenAt: "2026-05-01", lastSeenAt: "2026-06-01", occurrences: 2,
      };
    }

    test("keeps a well-formed outcome", () => {
      const outcome = {
        direction: "improved", baseline: 10, current: 4, delta: 6,
        measuredAt: "2026-06-05",
      };
      const [out] = sanitizeInsights([{ ...actedRaw(), outcome }]);
      expect(out.outcome).toEqual(outcome);
    });

    test("drops the outcome when direction is not in the enum", () => {
      const [out] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "sideways", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-05" },
      }]);
      expect(out.outcome).toBeUndefined();
    });

    test("drops the outcome when a number is non-finite or unparseable", () => {
      const [a] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "improved", baseline: "x", current: 4, delta: 6, measuredAt: "2026-06-05" },
      }]);
      expect(a.outcome).toBeUndefined();
      const [b] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "improved", baseline: 10, current: Infinity, delta: 6, measuredAt: "2026-06-05" },
      }]);
      expect(b.outcome).toBeUndefined();
    });

    // `delta` and `direction` are RE-DERIVED from baseline/current rather than
    // trusted, so a bad/absent delta no longer invalidates the record — it is
    // simply recomputed. (This assertion previously expected the whole outcome
    // to be dropped; re-deriving is strictly safer, so the expectation moved.)
    test("re-derives delta instead of trusting the persisted value", () => {
      const [out] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "improved", baseline: 10, current: 4, delta: null, measuredAt: "2026-06-05" },
      }]);
      expect(out.outcome).toEqual({
        direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-05",
      });
    });

    test("re-derives a direction that contradicts baseline/current", () => {
      // A tampered blob claiming a huge improvement while current > baseline.
      const [out] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "improved", baseline: 1, current: 99, delta: 1e308, measuredAt: "2026-06-05" },
      }]);
      expect(out.outcome).toMatchObject({ direction: "worsened", baseline: 1, current: 99, delta: -98 });
    });

    test("drops an outcome whose magnitude is out of range", () => {
      const [out] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "improved", baseline: 1e300, current: 4, delta: 6, measuredAt: "2026-06-05" },
      }]);
      expect(out.outcome).toBeUndefined();
    });

    // Direction-only shape (the condition cleared a threshold): current/delta are
    // legitimately ABSENT and must survive as such.
    test("keeps a direction-only outcome with no current/delta", () => {
      const [out] = sanitizeInsights([{
        ...actedRaw(),
        outcome: { direction: "improved", baseline: 10, measuredAt: "2026-06-05" },
      }]);
      expect(out.outcome).toEqual({ direction: "improved", baseline: 10, measuredAt: "2026-06-05" });
    });

    // ...but a PRESENT-yet-corrupt current must NOT be silently promoted to that
    // shape — that would turn a corrupt record into a fabricated "cleared" win.
    test("drops the outcome when current is present but invalid", () => {
      for (const bad of [Infinity, "x", 1e300, NaN]) {
        const [out] = sanitizeInsights([{
          ...actedRaw(),
          outcome: { direction: "improved", baseline: 10, current: bad, measuredAt: "2026-06-05" },
        }]);
        expect(out.outcome).toBeUndefined();
      }
    });

    test("omits the outcome key entirely when absent (byte-stability)", () => {
      const [out] = sanitizeInsights([actedRaw()]);
      expect("outcome" in out).toBe(false);
    });
  });

  // Regression: metricAtAction was silently dropped on EVERY load path because
  // the constructed literal is explicit and omitted it. That both disabled
  // measurement across a reload AND let a later re-act capture a WRONG baseline
  // from already-improved data (the "first act wins" guard reads this field).
  describe("metricAtAction round-trip (SP3)", () => {
    function actedRaw() {
      return {
        id: 1, key: "stalledWork:7", type: "stalledWork", severity: "high",
        status: "acted", data: { count: 3 },
        firstSeenAt: "2026-05-01", lastSeenAt: "2026-06-01", occurrences: 2,
      };
    }

    test("SURVIVES a load", () => {
      const [out] = sanitizeInsights([{ ...actedRaw(), metricAtAction: { count: 10 } }]);
      expect(out.metricAtAction).toEqual({ count: 10 });
    });

    test("drops non-numeric and out-of-range entries", () => {
      const [out] = sanitizeInsights([{
        ...actedRaw(),
        metricAtAction: { count: 10, bogus: "abc", huge: 1e300, empty: "" },
      }]);
      expect(out.metricAtAction).toEqual({ count: 10 });
    });

    test("drops the field when nothing valid survives", () => {
      const [out] = sanitizeInsights([{ ...actedRaw(), metricAtAction: { bogus: "abc" } }]);
      expect("metricAtAction" in out).toBe(false);
    });

    test("omits the key entirely when absent (byte-stability)", () => {
      const [out] = sanitizeInsights([actedRaw()]);
      expect("metricAtAction" in out).toBe(false);
    });
  });
});
