import { describe, expect, test } from "vitest";
import { BUDGET_TYPES, SUPPORTED_CURRENCIES, isBudgetCurrency, isContractPriced } from "./types";

describe("budget constants", () => {
  test("supported currencies are EUR/USD/GBP/INR (§477)", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["EUR", "USD", "GBP", "INR"]);
  });
  test("budget types are tm, fixed and end-to-end (§488)", () => {
    expect(BUDGET_TYPES).toEqual(["tm", "fixed", "e2e"]);
  });
  test("fixed and end-to-end are priced by contract, T&M is not", () => {
    expect(BUDGET_TYPES.filter(isContractPriced)).toEqual(["fixed", "e2e"]);
  });
  test("isBudgetCurrency narrows valid codes", () => {
    expect(isBudgetCurrency("USD")).toBe(true);
    expect(isBudgetCurrency("JPY")).toBe(false);
    expect(isBudgetCurrency(42)).toBe(false);
  });
});
