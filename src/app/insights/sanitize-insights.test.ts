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
});
