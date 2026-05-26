import { describe, expect, test } from "vitest";
import { BUDGET_TYPES, SUPPORTED_CURRENCIES, isBudgetCurrency } from "./types";

describe("budget constants", () => {
  test("supported currencies are EUR/USD/GBP", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["EUR", "USD", "GBP"]);
  });
  test("budget types are tm and fixed", () => {
    expect(BUDGET_TYPES).toEqual(["tm", "fixed"]);
  });
  test("isBudgetCurrency narrows valid codes", () => {
    expect(isBudgetCurrency("USD")).toBe(true);
    expect(isBudgetCurrency("JPY")).toBe(false);
    expect(isBudgetCurrency(42)).toBe(false);
  });
});
