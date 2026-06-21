import { describe, expect, test } from "vitest";
import { densityClasses } from "./dashboard-density";

describe("densityClasses", () => {
  test("comfortable keeps the current spacing (no-op for existing users)", () => {
    expect(densityClasses("comfortable")).toEqual({ outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3" });
  });

  test("compact tightens rhythm, KPI gap, and card padding", () => {
    expect(densityClasses("compact")).toEqual({ outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2" });
  });
});
