import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR_ANCHORS, TOUR_STEPS, TOURS, findTour, visibleSteps, clampStep, type TourStep } from "./app-tour";
import { ALL_MODULE_IDS } from "./feature-modules";
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
    expect(ids).toEqual(["getting-started", "working-faster", "raid", "reporting", "planning", "stakeholders", "ai", "help-yourself"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOURS) expect(t.steps.length).toBeGreaterThan(0);
  });
  it("every step view (when set) is a valid AppView used by other tours", () => {
    const valid = new Set<AppView>(["dashboard", "projects", "open-points", "actions", "chat", "reports", "raid", "milestones", "stakeholders", "steering-committee", "settings", "help"]);
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
  it("visibleSteps drops Turso-only views off Turso and keeps view-less steps", () => {
    const trend: TourStep = { id: "t", kind: "modal", titleKey: "tourStepReportReportsTitle", bodyKey: "tourStepReportReportsBody", view: "trends" };
    const bare: TourStep = { id: "b", kind: "modal", titleKey: "tourStepWelcomeTitle", bodyKey: "tourStepWelcomeBody" };
    expect(visibleSteps([trend, bare], ALL_MODULE_IDS, "turso").map((s) => s.id)).toEqual(["t", "b"]);
    expect(visibleSteps([trend, bare], ALL_MODULE_IDS, "file").map((s) => s.id)).toEqual(["b"]);
    expect(visibleSteps([trend, bare], ALL_MODULE_IDS).map((s) => s.id)).toEqual(["b"]);
  });
  it("clampStep bounds the index", () => {
    expect(clampStep(-1, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(0, 0)).toBe(0);
  });
});

describe("tour anchors", () => {
  it("places the undo anchor around the undo controls", () => {
    const src = readFileSync(join(__dirname, "task-manager.tsx"), "utf8");
    expect(src).toContain("dataTourId={TOUR_ANCHORS.undo}");
  });
});

const PRE_EXISTING: Record<string, string[]> = {
  "getting-started": ["welcome", "projects", "tasks", "actions", "chat", "dashboard", "reports", "raid", "milestones", "stakeholders", "steering", "settings"],
  raid: ["raid-overview", "raid-matrix", "raid-review"],
  reporting: ["report-dashboard", "report-reports", "report-evm"],
  planning: ["plan-milestones", "plan-gantt", "plan-critical"],
  stakeholders: ["stake-register", "stake-raci", "stake-comms"],
  ai: ["ai-chat", "ai-actions", "ai-settings"],
};

describe("tour content", () => {
  it("keeps every pre-existing tour and step id", () => {
    for (const [tour, ids] of Object.entries(PRE_EXISTING))
      expect(findTour(tour)!.steps.map((s) => s.id)).toEqual(expect.arrayContaining(ids));
  });
  it("working-faster spotlights the controls it teaches", () => {
    const byId = Object.fromEntries(findTour("working-faster")!.steps.map((s) => [s.id, s]));
    expect(byId["wf-undo"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.undo, view: "open-points" });
    expect(byId["wf-search"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.globalSearch });
    expect(byId["wf-select"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.selectAll });
    expect(byId["wf-views"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.savedViews });
    expect(byId["wf-board"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.tasksViewMode });
    expect(findTour("working-faster")!.steps).toHaveLength(10);
  });
  it("help-yourself is four centred cards", () => {
    const steps = findTour("help-yourself")!.steps;
    expect(steps.map((s) => s.id)).toEqual(["help-icon", "help-search", "help-escape", "help-popout"]);
    for (const s of steps) expect(s.kind).toBe("modal");
  });
  it("ai tour teaches inline edit and dictation", () => {
    expect(findTour("ai")!.steps.map((s) => s.id)).toEqual(["ai-chat", "ai-inline", "ai-dictation", "ai-actions", "ai-settings"]);
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
