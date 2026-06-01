import { describe, expect, test } from "vitest";
import {
  sanitizeBudgetBucket,
  sanitizeFxRates,
  encodeAllocations,
  decodeAllocations,
  encodeDisciplineAllocations,
  decodeDisciplineAllocations,
} from "./sanitize";
import type { BucketAllocation, DisciplineAllocation } from "./types";

describe("sanitizeBudgetBucket", () => {
  const base = {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } }],
  };
  test("accepts a well-formed bucket", () => {
    const b = sanitizeBudgetBucket(base)!;
    expect(b.id).toBe(1);
    expect(b.type).toBe("tm");
    expect(b.allocations[0].resourceIds).toEqual([5, 7]);
    expect(b.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
  });
  test("rejects missing id / name", () => {
    expect(sanitizeBudgetBucket({ ...base, id: 0 })).toBeNull();
    expect(sanitizeBudgetBucket({ ...base, name: "  " })).toBeNull();
  });
  test("defaults bad type/currency/status", () => {
    const b = sanitizeBudgetBucket({ ...base, type: "x", currency: "JPY", status: "weird" })!;
    expect(b.type).toBe("tm");
    expect(b.currency).toBe("EUR");
    expect(b.status).toBe("open");
  });
  test("swaps reversed dates", () => {
    const b = sanitizeBudgetBucket({ ...base, startDate: "2026-06-30", endDate: "2026-01-01" })!;
    expect(b.startDate).toBe("2026-01-01");
    expect(b.endDate).toBe("2026-06-30");
  });
  test("keeps fixedPriceAmount only for fixed type", () => {
    expect(sanitizeBudgetBucket({ ...base, type: "fixed", fixedPriceAmount: 1000 })!.fixedPriceAmount).toBe(1000);
    expect(sanitizeBudgetBucket({ ...base, type: "tm", fixedPriceAmount: 1000 })!.fixedPriceAmount).toBeUndefined();
  });
  test("parses allocations from an encoded string (CSV/MD path)", () => {
    const enc = encodeAllocations(base.allocations as never);
    const b = sanitizeBudgetBucket({ ...base, allocations: enc })!;
    expect(b.allocations[0].roleId).toBe(3);
    expect(b.allocations[0].actualHours).toEqual({ "2026-01": 38 });
  });
});

describe("sanitizeBudgetBucket order field", () => {
  const base = {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [],
  };

  test("order: 3 (number) → kept as 3", () => {
    expect(sanitizeBudgetBucket({ ...base, order: 3 })!.order).toBe(3);
  });

  test("order: 0 (number) → kept as 0 (valid non-negative integer)", () => {
    expect(sanitizeBudgetBucket({ ...base, order: 0 })!.order).toBe(0);
  });

  test('order: "3" (string, as CSV decode yields) → kept as 3', () => {
    expect(sanitizeBudgetBucket({ ...base, order: "3" })!.order).toBe(3);
  });

  test('order: "" (empty string from absent CSV cell) → undefined', () => {
    expect(sanitizeBudgetBucket({ ...base, order: "" })!.order).toBeUndefined();
  });

  test("order: -1 → undefined (negative rejected)", () => {
    expect(sanitizeBudgetBucket({ ...base, order: -1 })!.order).toBeUndefined();
  });

  test("order: 1.5 → undefined (non-integer rejected)", () => {
    expect(sanitizeBudgetBucket({ ...base, order: 1.5 })!.order).toBeUndefined();
  });

  test("order absent → undefined", () => {
    expect(sanitizeBudgetBucket({ ...base })!.order).toBeUndefined();
  });

  test("order: undefined → undefined", () => {
    expect(sanitizeBudgetBucket({ ...base, order: undefined })!.order).toBeUndefined();
  });
});

describe("sanitizeBudgetBucket blended-mode fields", () => {
  const blendedBase = {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [],
    planningMode: "blended",
    disciplineAllocations: [
      { disciplineId: 2, resourceIds: [5], budgetHours: { "2026-01": 30 }, actualHours: {} },
    ],
    rateOverrideInternal: 90,
    rateOverrideExternal: 200,
  };

  test("round-trips planningMode, disciplineAllocations, and rate overrides", () => {
    const b = sanitizeBudgetBucket(blendedBase)!;
    expect(b.planningMode).toBe("blended");
    expect(b.disciplineAllocations).toEqual([
      { disciplineId: 2, resourceIds: [5], budgetHours: { "2026-01": 30 }, actualHours: {} },
    ]);
    expect(b.rateOverrideInternal).toBe(90);
    expect(b.rateOverrideExternal).toBe(200);
  });

  test("round-trips an explicit detailed planningMode", () => {
    expect(sanitizeBudgetBucket({ ...blendedBase, planningMode: "detailed" })!.planningMode).toBe("detailed");
  });

  test("detailed bucket (no planningMode) leaves blended fields undefined", () => {
    const b = sanitizeBudgetBucket({
      id: 1, name: "PAM", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open", allocations: [],
    })!;
    expect(b.planningMode).toBeUndefined();
    expect(b.disciplineAllocations).toBeUndefined();
    expect(b.rateOverrideInternal).toBeUndefined();
    expect(b.rateOverrideExternal).toBeUndefined();
  });

  test("parses disciplineAllocations from an encoded string (CSV/MD path)", () => {
    const enc = encodeDisciplineAllocations(blendedBase.disciplineAllocations as DisciplineAllocation[]);
    const b = sanitizeBudgetBucket({ ...blendedBase, disciplineAllocations: enc })!;
    expect(b.planningMode).toBe("blended");
    expect(b.disciplineAllocations).toEqual([
      { disciplineId: 2, resourceIds: [5], budgetHours: { "2026-01": 30 }, actualHours: {} },
    ]);
  });
});

describe("encode/decode disciplineAllocations round-trip", () => {
  test("round-trips", () => {
    const allocs: DisciplineAllocation[] = [
      { disciplineId: 2, resourceIds: [5, 7], budgetHours: { "2026-01": 30, "2026-02": 10 }, actualHours: { "2026-01": 28 } },
      { disciplineId: 4, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    expect(decodeDisciplineAllocations(encodeDisciplineAllocations(allocs))).toEqual(allocs);
  });
});

describe("encode/decode allocations round-trip", () => {
  test("round-trips", () => {
    const allocs: BucketAllocation[] = [
      { roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40, "2026-02": 20 }, actualHours: { "2026-01": 38 } },
      { roleId: 9, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    expect(decodeAllocations(encodeAllocations(allocs))).toEqual(allocs);
  });
});

describe("sanitizeFxRates", () => {
  test("accepts an EUR-base table", () => {
    const fx = sanitizeFxRates({ base: "EUR", date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, JPY: 999 } })!;
    expect(fx.rates.USD).toBe(1.08);
    expect(fx.rates.JPY).toBeUndefined();
    expect(fx.rates.EUR).toBe(1);
  });
  test("rejects non-EUR base / missing date", () => {
    expect(sanitizeFxRates({ base: "USD", date: "2026-05-26", fetchedAt: "x", rates: {} })).toBeNull();
    expect(sanitizeFxRates({ base: "EUR", date: "", fetchedAt: "x", rates: {} })).toBeNull();
  });
});
