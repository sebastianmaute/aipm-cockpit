import { describe, expect, test } from "vitest";
import { densityClasses } from "./dashboard-density";

describe("densityClasses", () => {
  test("comfortable keeps the current spacing (no-op for existing users)", () => {
    expect(densityClasses("comfortable")).toEqual({ outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3", sectionGap: "gap-4", tileRow: "auto-rows-[80px]" });
  });

  test("compact tightens rhythm, KPI gap, and card padding", () => {
    expect(densityClasses("compact")).toEqual({ outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2", sectionGap: "gap-2", tileRow: "auto-rows-[64px]" });
  });

  test("exposes a grid row unit per density", () => {
    // ★ 80px comfortable was settled by eye-verify on 2026-08-14 against the
    // prototype. 64px compact has NOT had the same check — see the spec.
    expect(densityClasses("comfortable").tileRow).toBe("auto-rows-[80px]");
    expect(densityClasses("compact").tileRow).toBe("auto-rows-[64px]");
  });
});
