import { describe, it, test, expect } from "vitest";
import {
  TASK_NAME_MAX,
  sanitizeTaskName,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizePriority,
  parseDependenciesString,
  serializeDependencies,
  sanitizePlan,
  sanitizeOptionalMinutes,
} from "./sanitize";
import {
  encodePeriodMap,
  decodePeriodMap,
  sanitizeResource,
  sanitizeBirthday,
  sanitizeRole,
  sanitizeDiscipline,
  sanitizeGrade,
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

describe("period map codec", () => {
  test("round-trips a map and drops invalid keys/values", () => {
    const map = { "2026-01": 80, "2026-W03": 12 };
    expect(decodePeriodMap(encodePeriodMap(map))).toEqual(map);
    expect(decodePeriodMap("2026-01=80|bad|2026-13=5|=7|2026-02=x")).toEqual({
      "2026-01": 80,
    });
  });
});

describe("sanitizeResource", () => {
  test("accepts an object map and clamps percent to 0..100", () => {
    const r = sanitizeResource({
      id: 3, name: "  Sample  ", roleId: 2, utilizationMode: "percent",
      utilization: { "2026-01": 150, "2026-02": -5 },
    });
    expect(r).not.toBeNull();
    expect(r!.firstName).toBe("Sample");
    expect(r!.utilization).toEqual({ "2026-01": 100, "2026-02": 0 });
  });

  test("accepts an encoded-string map (CSV path) and defaults bad mode", () => {
    const r = sanitizeResource({
      id: 4, name: "Bob", roleId: null, utilizationMode: "nope",
      utilization: "2026-01=12.5", absenceOverride: "2026-01=8",
    });
    expect(r!.utilizationMode).toBe("percent");
    expect(r!.utilization).toEqual({ "2026-01": 12.5 });
    expect(r!.absenceOverride).toEqual({ "2026-01": 8 });
  });

  test("returns null without id or name", () => {
    expect(sanitizeResource({ name: "x" })).toBeNull();
    expect(sanitizeResource({ id: 1, name: "" })).toBeNull();
  });
});

describe("sanitizePlan", () => {
  test("preserves a valid plan", () => {
    const p = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "USD" };
    expect(sanitizePlan(p, "2026-05-23")).toEqual(p);
  });
  test("clamps bad granularity to month and defaults missing currency", () => {
    const p = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-12-31", granularity: "fortnight" }, "2026-05-23");
    expect(p.granularity).toBe("month");
    expect(p.currency).toBe("EUR");
  });
  test("falls back to the default window when dates are invalid", () => {
    const p = sanitizePlan({ startDate: "nope", endDate: "", granularity: "week", currency: "GBP" }, "2026-05-23");
    expect(p.startDate).toBe("2026-05-01");
    expect(p.endDate).toBe("2027-04-30");
    expect(p.granularity).toBe("week");   // granularity/currency still honored
    expect(p.currency).toBe("GBP");
  });
});

describe("sanitizeRole / sanitizeDiscipline / sanitizeGrade", () => {
  test("role clamps negative rates to 0 and requires ids", () => {
    expect(sanitizeRole({ id: 1, disciplineId: 2, gradeId: 3, internalRate: -10, externalRate: 90 }))
      .toEqual({ id: 1, disciplineId: 2, gradeId: 3, internalRate: 0, externalRate: 90 });
    expect(sanitizeRole({ id: 1, disciplineId: 0, gradeId: 3 })).toBeNull();
  });
  test("discipline/grade need id + name", () => {
    expect(sanitizeDiscipline({ id: 2, name: " Dev " })).toEqual({ id: 2, name: "Dev" });
    expect(sanitizeGrade({ id: 0, name: "Junior" })).toBeNull();
  });
});

describe("sanitizeResource — address-book fields", () => {
  test("reads firstName/lastName and all contact fields", () => {
    const r = sanitizeResource({
      id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com",
      title: "Architect", businessPhone: "+49 30 1", location: "Berlin",
      department: "IAM", company: "iC", birthday: "06-14",
      notes: "VIP, line two", roleId: 2, utilizationMode: "percent", utilization: {},
    });
    expect(r).toMatchObject({
      id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com",
      title: "Architect", businessPhone: "+49 30 1", location: "Berlin",
      department: "IAM", company: "iC", birthday: "06-14", notes: "VIP, line two",
    });
  });
  test("falls back to splitting a legacy name field", () => {
    const r = sanitizeResource({ id: 2, name: "Sam Placeholder", utilizationMode: "percent", utilization: {} });
    expect(r).toMatchObject({ firstName: "Fictional", lastName: "Jordan" });
  });
  test("drops a record with no usable name", () => {
    expect(sanitizeResource({ id: 3, utilizationMode: "percent", utilization: {} })).toBeNull();
  });
  test("rejects an invalid birthday", () => {
    const r = sanitizeResource({ id: 4, firstName: "A", lastName: "B", birthday: "13-40", utilizationMode: "percent", utilization: {} });
    expect(r?.birthday).toBeUndefined();
  });
  test('treats the string "false" as inactive (CSV/MD load)', () => {
    const r = sanitizeResource({ id: 5, firstName: "X", lastName: "Y", active: "false", utilizationMode: "percent", utilization: {} });
    expect(r?.active).toBe(false);
  });
  test("treats boolean false as inactive", () => {
    const r = sanitizeResource({ id: 6, firstName: "X", lastName: "Y", active: false, utilizationMode: "percent", utilization: {} });
    expect(r?.active).toBe(false);
  });
  test("leaves active unset when truthy or absent", () => {
    expect(sanitizeResource({ id: 7, firstName: "X", lastName: "Y", active: "true", utilizationMode: "percent", utilization: {} })?.active).toBeUndefined();
    expect(sanitizeResource({ id: 8, firstName: "X", lastName: "Y", utilizationMode: "percent", utilization: {} })?.active).toBeUndefined();
  });
});

describe("sanitizeBirthday", () => {
  test("accepts MM-DD in range", () => { expect(sanitizeBirthday("02-29")).toBe("02-29"); });
  test("accepts YYYY-MM-DD", () => { expect(sanitizeBirthday("2026-06-14")).toBe("2026-06-14"); });
  test("rejects out-of-range", () => { expect(sanitizeBirthday("00-10")).toBeUndefined(); });
  test("rejects malformed", () => { expect(sanitizeBirthday("nope")).toBeUndefined(); });
  test("rejects non-strings", () => { expect(sanitizeBirthday(614 as unknown as string)).toBeUndefined(); });
});

describe("sanitizeResource — birthday widened to MM-DD or YYYY-MM-DD", () => {
  it("keeps a MM-DD birthday", () => {
    expect(sanitizeResource({ id: 1, firstName: "A", lastName: "B", birthday: "06-03" })?.birthday).toBe("06-03");
  });
  it("keeps a YYYY-MM-DD birthday", () => {
    expect(sanitizeResource({ id: 1, firstName: "A", lastName: "B", birthday: "1990-06-03" })?.birthday).toBe("1990-06-03");
  });
  it("drops a malformed birthday", () => {
    expect(sanitizeResource({ id: 1, firstName: "A", lastName: "B", birthday: "nope" })?.birthday).toBeUndefined();
  });
});

describe("sanitizeOptionalMinutes", () => {
  test("3 (number) → 3", () => {
    expect(sanitizeOptionalMinutes(3)).toBe(3);
  });

  test("0 (number) → 0  (zero is valid, must be kept)", () => {
    expect(sanitizeOptionalMinutes(0)).toBe(0);
  });

  test('"3" (string, as CSV/MD decode yields) → 3', () => {
    expect(sanitizeOptionalMinutes("3")).toBe(3);
  });

  test('"" (empty string) → undefined  (must NOT become 0)', () => {
    expect(sanitizeOptionalMinutes("")).toBeUndefined();
  });

  test("null → undefined", () => {
    expect(sanitizeOptionalMinutes(null)).toBeUndefined();
  });

  test("undefined → undefined", () => {
    expect(sanitizeOptionalMinutes(undefined)).toBeUndefined();
  });

  test("-1 → undefined  (negative rejected)", () => {
    expect(sanitizeOptionalMinutes(-1)).toBeUndefined();
  });

  test("1.5 → undefined  (non-integer rejected)", () => {
    expect(sanitizeOptionalMinutes(1.5)).toBeUndefined();
  });

  test("NaN → undefined", () => {
    expect(sanitizeOptionalMinutes(NaN)).toBeUndefined();
  });

  test('"abc" (non-numeric string) → undefined', () => {
    expect(sanitizeOptionalMinutes("abc")).toBeUndefined();
  });
});
