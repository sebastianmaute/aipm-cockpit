import { describe, expect, it } from "vitest";
import { isRealCalendarDate, sanitizeIsoDate } from "./sanitize-core";

describe("isRealCalendarDate (§544, §542)", () => {
  it.each(["2024-02-29", "2026-12-31", "2026-01-01", "2200-06-15"])("accepts the real date %s", (d) => {
    expect(isRealCalendarDate(d)).toBe(true);
  });
  it.each(["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01", ""])(
    "refuses %s", (d) => {
      expect(isRealCalendarDate(d)).toBe(false);
    },
  );
  // ★ NO 1900–2100 BOUND: that is `sanitizeIsoDate`'s own policy, kept there.
  it("has no 1900–2100 bound, while sanitizeIsoDate keeps its own", () => {
    expect(isRealCalendarDate("2200-06-15")).toBe(true);
    expect(sanitizeIsoDate("2200-06-15")).toBe("");
  });
});
