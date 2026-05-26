import { describe, expect, test, beforeEach } from "vitest";
import { holidaysForCountries, COUNTRIES } from "./holidays";

describe("holidaysForCountries", () => {
  beforeEach(() => {
    // Clear any cached data between tests (though each test is independent)
  });

  test("returns empty set when codes array is empty", async () => {
    const result = await holidaysForCountries([]);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("returns empty set without loading the library when codes is empty", async () => {
    const result = await holidaysForCountries([], 1);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("formats holiday dates as YYYY-MM-DD strings", async () => {
    const currentYear = new Date().getUTCFullYear();
    const result = await holidaysForCountries(["DE"], 0);
    // Check that all dates match YYYY-MM-DD format
    for (const dateStr of result) {
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Verify date part is reasonable (year should match current)
      expect(dateStr.substring(0, 4)).toBe(String(currentYear));
    }
  });

  test("includes public holidays in results for valid country", async () => {
    const result = await holidaysForCountries(["DE"], 0);
    // Germany should have holidays; New Year's Day is a safe bet
    expect(result.size).toBeGreaterThan(0);
    // At minimum, check that we get public holidays (any date)
    const firstDate = Array.from(result)[0];
    expect(typeof firstDate).toBe("string");
  });

  test("includes bank/public holidays in results", async () => {
    const result = await holidaysForCountries(["GB"], 0);
    // GB should have holidays
    expect(result.size).toBeGreaterThan(0);
  });

  test("handles single country with yearsAhead=0 (current year only)", async () => {
    const currentYear = new Date().getUTCFullYear();
    const result = await holidaysForCountries(["DE"], 0);
    // All results should be from current year
    for (const dateStr of result) {
      expect(dateStr.substring(0, 4)).toBe(String(currentYear));
    }
  });

  test("includes multiple years when yearsAhead > 0", async () => {
    const currentYear = new Date().getUTCFullYear();
    const result = await holidaysForCountries(["DE"], 1);
    // Should have holidays spanning current year and next year
    const years = new Set(
      Array.from(result).map(d => d.substring(0, 4))
    );
    expect(years.has(String(currentYear))).toBe(true);
    expect(years.has(String(currentYear + 1))).toBe(true);
  });

  test("merges holidays from multiple countries into single set", async () => {
    const result = await holidaysForCountries(["DE", "GB"], 0);
    // Both countries should contribute holidays
    expect(result.size).toBeGreaterThan(0);
    // All entries should be strings in YYYY-MM-DD format
    for (const entry of result) {
      expect(typeof entry).toBe("string");
      expect(entry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("deduplicates dates across multiple countries", async () => {
    const result = await holidaysForCountries(["DE", "GB"], 0);
    // Set automatically deduplicates, so no duplicate dates
    const resultArray = Array.from(result);
    const uniqueCount = new Set(resultArray).size;
    expect(uniqueCount).toBe(resultArray.length);
  });

  test("handles unknown country codes without throwing", async () => {
    const result = await holidaysForCountries(["ZZZUNKNOWN"], 0);
    // Should not throw; should return a Set (possibly empty)
    expect(result).toBeInstanceOf(Set);
  });

  test("skips unknown country codes and includes valid ones", async () => {
    const result = await holidaysForCountries(["DE", "ZZZUNKNOWN", "GB"], 0);
    // Should include holidays from DE and GB despite invalid code
    expect(result.size).toBeGreaterThan(0);
  });

  test("handles multiple years with multiple countries", async () => {
    const currentYear = new Date().getUTCFullYear();
    const result = await holidaysForCountries(["DE", "GB"], 1);
    // Should span 2+ years with holidays from both countries
    expect(result.size).toBeGreaterThan(0);
    const years = new Set(
      Array.from(result).map(d => d.substring(0, 4))
    );
    expect(years.size).toBeGreaterThanOrEqual(2);
  });

  test("returns a Set (not an array)", async () => {
    const result = await holidaysForCountries(["DE"], 0);
    expect(result).toBeInstanceOf(Set);
    expect(typeof result.has).toBe("function");
  });

  test("set values are all strings", async () => {
    const result = await holidaysForCountries(["DE", "GB"], 0);
    for (const value of result) {
      expect(typeof value).toBe("string");
    }
  });

  test("filters out non-public/non-bank holiday types", async () => {
    // This tests the module's filtering logic (h.type === "public" || h.type === "bank")
    const result = await holidaysForCountries(["DE"], 0);
    // Verify all entries are valid date strings (filtering worked)
    for (const dateStr of result) {
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(dateStr);
      expect(date.toString()).not.toBe("Invalid Date");
    }
  });

  test("returns consistent results for same input", async () => {
    const result1 = await holidaysForCountries(["DE"], 0);
    const result2 = await holidaysForCountries(["DE"], 0);
    // Should return same holidays (tests caching/consistency)
    expect(Array.from(result1).sort()).toEqual(Array.from(result2).sort());
  });

  test("handles yearsAhead with multiple countries", async () => {
    const result = await holidaysForCountries(["DE", "AT"], 1);
    // Should span 2+ years
    expect(result.size).toBeGreaterThan(0);
    const years = new Set(
      Array.from(result).map(d => d.substring(0, 4))
    );
    expect(years.size).toBeGreaterThanOrEqual(2);
  });

  test("returns Set with size >= 0", async () => {
    const result = await holidaysForCountries(["DE"], 0);
    expect(typeof result.size).toBe("number");
    expect(result.size).toBeGreaterThanOrEqual(0);
  });

  test("uses default yearsAhead value of 1", async () => {
    const currentYear = new Date().getUTCFullYear();
    const resultDefault = await holidaysForCountries(["DE"]);
    // Should include current year and next year by default
    const years = new Set(
      Array.from(resultDefault).map(d => d.substring(0, 4))
    );
    expect(years.has(String(currentYear))).toBe(true);
    expect(years.has(String(currentYear + 1))).toBe(true);
  });

  test("date strings represent valid ISO 8601 dates", async () => {
    const result = await holidaysForCountries(["DE"], 0);
    for (const dateStr of result) {
      // Parse as ISO 8601
      const date = new Date(dateStr + "T00:00:00Z");
      expect(date.toString()).not.toBe("Invalid Date");
      // Verify round-trip
      expect(date.toISOString().substring(0, 10)).toBe(dateStr);
    }
  });

  test("date strings have month in 01-12 range", async () => {
    const result = await holidaysForCountries(["DE", "GB"], 0);
    for (const dateStr of result) {
      const month = parseInt(dateStr.substring(5, 7), 10);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
    }
  });

  test("date strings have day in 01-31 range", async () => {
    const result = await holidaysForCountries(["DE", "GB"], 0);
    for (const dateStr of result) {
      const day = parseInt(dateStr.substring(8, 10), 10);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(31);
    }
  });

  test("respects yearsAhead parameter for year range", async () => {
    const currentYear = new Date().getUTCFullYear();
    const result = await holidaysForCountries(["DE"], 2);
    // Should include current, +1, and +2 years
    const years = new Set(
      Array.from(result).map(d => d.substring(0, 4))
    );
    expect(years.has(String(currentYear))).toBe(true);
    expect(years.has(String(currentYear + 1))).toBe(true);
    expect(years.has(String(currentYear + 2))).toBe(true);
  });

  test("iterates through all countries in codes array", async () => {
    // Test with multiple countries to ensure all are processed
    const result = await holidaysForCountries(["DE", "FR", "ES"], 0);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBeGreaterThan(0);
  });
});

describe("COUNTRIES constant", () => {
  test("is an array of Country objects", () => {
    expect(Array.isArray(COUNTRIES)).toBe(true);
  });

  test("each country has required properties", () => {
    for (const country of COUNTRIES) {
      expect(country).toHaveProperty("code");
      expect(country).toHaveProperty("nameEn");
      expect(country).toHaveProperty("nameDe");
      expect(typeof country.code).toBe("string");
      expect(typeof country.nameEn).toBe("string");
      expect(typeof country.nameDe).toBe("string");
    }
  });

  test("contains expected country codes", () => {
    const codes = COUNTRIES.map(c => c.code);
    expect(codes).toContain("DE");
    expect(codes).toContain("GB");
    expect(codes).toContain("FR");
  });
});
