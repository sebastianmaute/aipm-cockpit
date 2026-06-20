import { describe, expect, it } from "vitest";
import { TOUR_STEPS, visibleSteps, clampStep } from "./app-tour";

describe("app-tour engine", () => {
  it("has a welcome step first and includes a steering-committee step", () => {
    expect(TOUR_STEPS[0].id).toBe("welcome");
    expect(TOUR_STEPS.some((s) => s.id === "steering")).toBe(true);
  });
  it("visibleSteps keeps core steps when all modules enabled", () => {
    const all = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;
    const out = visibleSteps([...all]);
    expect(out.length).toBe(TOUR_STEPS.length);
  });
  it("visibleSteps drops a step whose view's module is disabled", () => {
    const out = visibleSteps([]); // no modules enabled
    expect(out.some((s) => s.id === "welcome")).toBe(true); // welcome (no view) always survives
    // at least one module-gated step (e.g. milestones/raid/stakeholders) is dropped
    expect(out.length).toBeLessThan(TOUR_STEPS.length);
  });
  it("clampStep bounds the index", () => {
    expect(clampStep(-1, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(2, 5)).toBe(2);
    expect(clampStep(0, 0)).toBe(0);
  });
});
