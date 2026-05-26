import { describe, expect, test } from "vitest";
import {
  sanitizeBudgetBucket,
  sanitizeFxRates,
  encodeAllocations,
  decodeAllocations,
} from "./sanitize";

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

describe("encode/decode allocations round-trip", () => {
  test("round-trips", () => {
    const allocs = [
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
