import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR_ANCHORS, TOUR_STEPS, TOURS, findTour, visibleSteps, clampStep, type TourStep } from "./app-tour";
import { ALL_MODULE_IDS } from "./feature-modules";

const ALL = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;

describe("app-tour engine", () => {
  it("getting-started is first and its steps === TOUR_STEPS", () => {
    expect(TOURS[0].id).toBe("getting-started");
    expect(findTour("getting-started")?.steps).toBe(TOUR_STEPS);
    expect(TOUR_STEPS[0].id).toBe("welcome");
  });
  it("ships the themed tours with unique ids and at least one step each", () => {
    const ids = TOURS.map((t) => t.id);
    expect(ids).toEqual(["getting-started", "working-faster", "raid", "reporting", "planning", "stakeholders", "resources", "budget-changes", "documents", "ai", "help-yourself"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOURS) expect(t.steps.length).toBeGreaterThan(0);
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
  it("visibleSteps drops a child-view step whose parent module is off", () => {
    const steps = visibleSteps(findTour("reporting")!.steps, [], "turso");
    expect(steps.some((s) => s.view === "insights")).toBe(false);
    expect(steps.length).toBeGreaterThan(0);
  });
  it("visibleSteps drops Turso-only views off Turso and keeps view-less steps", () => {
    const trend: TourStep = { id: "t", kind: "modal", titleKey: "tourStepReportReportsTitle", bodyKey: "tourStepReportReportsBody", view: "trends" };
    const bare: TourStep = { id: "b", kind: "modal", titleKey: "tourStepWelcomeTitle", bodyKey: "tourStepWelcomeBody" };
    expect(visibleSteps([trend, bare], ALL_MODULE_IDS, "turso").map((s) => s.id)).toEqual(["t", "b"]);
    expect(visibleSteps([trend, bare], ALL_MODULE_IDS, "local-json").map((s) => s.id)).toEqual(["b"]);
    expect(visibleSteps([trend, bare], ALL_MODULE_IDS).map((s) => s.id)).toEqual(["b"]);
  });
  it("clampStep bounds the index", () => {
    expect(clampStep(-1, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(0, 0)).toBe(0);
  });
});

describe("tour anchors", () => {
  it("every anchor is used by a step and every step anchor exists", () => {
    const values = new Set(Object.values(TOUR_ANCHORS));
    const used = new Set(TOURS.flatMap((t) => t.steps.map((s) => s.anchorId).filter(Boolean)));
    for (const a of used) expect(values.has(a as never)).toBe(true);
    for (const v of values) expect(used.has(v)).toBe(true);
  });
  it("passes the undo anchor to UndoControl via dataTourId", () => {
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

describe("new tours and gap fills", () => {
  it("the planning tour's gantt step opens the gantt view", () => {
    expect(findTour("planning")!.steps.find((s) => s.id === "plan-gantt")!.view).toBe("gantt");
  });
  it("hides the resources tour when the resources module is off", () => {
    // every resources view (directory, workload, calendar, planning, manage-roles) belongs to the one "resources" module
    const withoutResourcesModule = ALL_MODULE_IDS.filter((m) => m !== "resources");
    const steps = findTour("resources")!.steps;
    expect(visibleSteps(steps, ALL_MODULE_IDS)).toHaveLength(steps.length);
    expect(visibleSteps(steps, withoutResourcesModule)).toHaveLength(0);
  });
  it("step ids are unique across all tours", () => {
    const ids = TOURS.flatMap((t) => t.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("the new tours and gap fills carry the specified step ids", () => {
    const ids = (tour: string) => findTour(tour)!.steps.map((s) => s.id);
    expect(ids("resources")).toEqual(["res-directory", "res-workload", "res-calendar", "res-planning", "res-roles"]);
    expect(ids("budget-changes")).toEqual(["bud-plan", "bud-evm", "chg-log", "chg-report", "chg-link"]);
    expect(ids("documents")).toEqual(["doc-ai", "doc-editor", "doc-versions"]);
    expect(ids("getting-started").at(-1)).toBe("more-tours");
    expect(ids("planning")).toEqual(["plan-milestones", "plan-gantt", "plan-gantt-view", "plan-critical"]);
    expect(ids("stakeholders")).toEqual(["stake-register", "stake-raci", "stake-raci-view", "stake-map", "stake-comms"]);
    expect(ids("reporting").slice(-5)).toEqual(["report-insights", "report-learning", "report-activity", "report-trends", "report-history"]);
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
