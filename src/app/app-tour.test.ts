import { describe, expect, it } from "vitest";
import { TOUR_STEPS, TOURS, findTour, visibleSteps, clampStep } from "./app-tour";
import type { AppView } from "./nav-config";

const ALL = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;

describe("app-tour engine", () => {
  it("getting-started is first and its steps === TOUR_STEPS", () => {
    expect(TOURS[0].id).toBe("getting-started");
    expect(findTour("getting-started")?.steps).toBe(TOUR_STEPS);
    expect(TOUR_STEPS[0].id).toBe("welcome");
  });
  it("ships the six themed tours with unique ids and at least one step each", () => {
    const ids = TOURS.map((t) => t.id);
    expect(ids).toEqual(["getting-started", "raid", "reporting", "planning", "stakeholders", "ai"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOURS) expect(t.steps.length).toBeGreaterThan(0);
  });
  it("every step view (when set) is a valid AppView used by other tours", () => {
    const valid = new Set<AppView>(["dashboard", "projects", "open-points", "actions", "chat", "reports", "raid", "milestones", "stakeholders", "steering-committee", "settings"]);
    for (const t of TOURS) for (const s of t.steps) if (s.view) expect(valid.has(s.view)).toBe(true);
  });
  it("findTour returns undefined for an unknown id", () => {
    expect(findTour("nope")).toBeUndefined();
  });
  it("visibleSteps(steps, features) keeps all when modules enabled, drops disabled-module steps", () => {
    expect(visibleSteps(TOUR_STEPS, [...ALL]).length).toBe(TOUR_STEPS.length);
    const none = visibleSteps(TOUR_STEPS, []);
    expect(none.some((s) => s.id === "welcome")).toBe(true); // no-view step survives
    expect(none.length).toBeLessThan(TOUR_STEPS.length);
    // a fully module-gated tour collapses to 0 visible steps
    expect(visibleSteps(findTour("raid")!.steps, []).length).toBe(0);
  });
  it("clampStep bounds the index", () => {
    expect(clampStep(-1, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(0, 0)).toBe(0);
  });
});

describe("TOURS iconView", () => {
  it("every tour declares an iconView AppView", () => {
    for (const tr of TOURS) {
      expect(typeof tr.iconView).toBe("string");
      expect(tr.iconView.length).toBeGreaterThan(0);
    }
  });
});
