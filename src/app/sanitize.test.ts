import { describe, test, expect } from "vitest";
import {
  TASK_NAME_MAX,
  sanitizeTaskName,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizePriority,
  parseDependenciesString,
  serializeDependencies,
} from "./sanitize";

describe("sanitizeTaskName", () => {
  test("trims surrounding whitespace", () => {
    expect(sanitizeTaskName("  hello  ")).toBe("hello");
  });

  test("caps oversized strings at TASK_NAME_MAX", () => {
    const oversized = "x".repeat(TASK_NAME_MAX + 50);
    expect(sanitizeTaskName(oversized)).toHaveLength(TASK_NAME_MAX);
  });

  test("returns empty string for non-string input", () => {
    expect(sanitizeTaskName(undefined)).toBe("");
    expect(sanitizeTaskName(42)).toBe("");
    expect(sanitizeTaskName(null)).toBe("");
  });
});

describe("sanitizeIsoDate", () => {
  test("accepts well-formed dates inside the 1900..2100 range", () => {
    expect(sanitizeIsoDate("2025-06-15")).toBe("2025-06-15");
  });

  test("rejects malformed strings", () => {
    expect(sanitizeIsoDate("2025-6-15")).toBe("");
    expect(sanitizeIsoDate("06/15/2025")).toBe("");
    expect(sanitizeIsoDate("not-a-date")).toBe("");
  });

  test("rejects out-of-range years", () => {
    expect(sanitizeIsoDate("1899-12-31")).toBe("");
    expect(sanitizeIsoDate("2101-01-01")).toBe("");
  });
});

describe("sanitizeLabels", () => {
  test("dedupes case-insensitively", () => {
    expect(sanitizeLabels(["Bug", "bug", "BUG"])).toEqual(["Bug"]);
  });

  test("parses pipe-separated strings", () => {
    expect(sanitizeLabels("frontend|backend|ops")).toEqual([
      "frontend",
      "backend",
      "ops",
    ]);
  });

  test("strips separator-conflicting characters from individual labels", () => {
    expect(sanitizeLabels(["a|b,c\nd"])).toEqual(["a b c d"]);
  });
});

describe("sanitizePriority", () => {
  test("returns the value when valid", () => {
    expect(sanitizePriority("High")).toBe("High");
  });

  test("falls back to provided default when invalid", () => {
    expect(sanitizePriority("Bogus", "Low")).toBe("Low");
  });

  test("defaults to Medium when invalid and no fallback provided", () => {
    expect(sanitizePriority(undefined)).toBe("Medium");
  });
});

describe("dependency CSV round-trip", () => {
  test("serializes and parses back to the same shape", () => {
    const deps = [
      { taskId: 12, type: "FS" as const },
      { taskId: 7, type: "SS" as const },
    ];
    const encoded = serializeDependencies(deps);
    expect(encoded).toBe("FS:12|SS:7");
    expect(parseDependenciesString(encoded)).toEqual(deps);
  });

  test("drops malformed parts on parse", () => {
    expect(parseDependenciesString("FS:12|garbage|SS:")).toEqual([
      { taskId: 12, type: "FS" },
    ]);
  });
});
