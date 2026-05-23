import { describe, test, expect } from "vitest";
import { generatePeriods } from "./resource-capacity";

describe("generatePeriods - month", () => {
  test("inclusive month range with correct keys and bounds", () => {
    const p = generatePeriods("2026-01-15", "2026-03-02", "month");
    expect(p.map((x) => x.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(p[0]).toEqual({ key: "2026-01", start: "2026-01-01", end: "2026-01-31" });
    expect(p[1].end).toBe("2026-02-28");
  });
});

describe("generatePeriods - week", () => {
  test("ISO weeks covering the range, Monday..Sunday", () => {
    // 2026-01-01 is a Thursday; ISO week 2026-W01 is Mon 2025-12-29 .. Sun 2026-01-04
    const p = generatePeriods("2026-01-01", "2026-01-10", "week");
    expect(p[0].key).toBe("2026-W01");
    expect(p[0].start).toBe("2025-12-29");
    expect(p[0].end).toBe("2026-01-04");
    expect(p[1].key).toBe("2026-W02");
    expect(p[1].start).toBe("2026-01-05");
  });
});
