import { describe, test, expect } from "vitest";
import { periodCost, formatCurrency } from "./resource-cost";
import type { Role } from "./types";

const role: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 142, externalRate: 200 };

describe("periodCost", () => {
  test("internal/external = hours × rate; margin = external − internal", () => {
    expect(periodCost(110.2, role)).toEqual({
      internal: 110.2 * 142,
      external: 110.2 * 200,
      margin: 110.2 * 200 - 110.2 * 142,
    });
  });
  test("no role → all zero", () => {
    expect(periodCost(160, undefined)).toEqual({ internal: 0, external: 0, margin: 0 });
  });
  test("zero capacity → all zero", () => {
    expect(periodCost(0, role)).toEqual({ internal: 0, external: 0, margin: 0 });
  });
});

describe("formatCurrency", () => {
  test("formats with the given currency + locale (no fraction digits)", () => {
    expect(formatCurrency(16000, "USD", "en-US")).toBe("$16,000");
  });
  test("falls back to '<rounded> <currency>' on an invalid currency code", () => {
    expect(formatCurrency(1234.6, "NOTACURRENCY", "en-US")).toBe("1235 NOTACURRENCY");
  });
});
