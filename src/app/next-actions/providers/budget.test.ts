// src/app/next-actions/providers/budget.test.ts
import { describe, expect, it } from "vitest";
import { budgetProvider } from "./budget";
import type { ActionInput } from "../types";
import type { DashboardModel } from "../../dashboard";
import { ACTION_WEIGHTS } from "../score";

const TODAY = "2026-06-15";

function input(
  budgetEffective: "R" | "A" | "G" | null,
  cpi: number | null,
  projectName = "Acme Project",
): ActionInput {
  return {
    tasks: [],
    raid: [],
    changes: [],
    milestones: [],
    stakeholders: [],
    commsReminders: [],
    dashboard: {
      budget: { effective: budgetEffective },
      evm: { cpi },
    } as unknown as DashboardModel,
    features: [],
    today: TODAY,
    now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 0,
    dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30,
    dismissed: new Set(),
    projectName,
  } as ActionInput;
}

describe("budgetProvider", () => {
  it("emits one action for Red budget with finite CPI", () => {
    const acts = budgetProvider.provide(input("R", 0.7));
    expect(acts).toHaveLength(1);
    const act = acts[0];
    expect(act.id).toBe("budget:overall:over");
    expect(act.source).toBe("budget");
    expect(act.moduleId).toBe("budget");
    expect(act.score).toBe(ACTION_WEIGHTS.riskCritical - ACTION_WEIGHTS.staticPenalty);
    expect(act.title).toEqual({ key: "actionBudgetTitle", params: ["Acme Project"] });
    expect(act.why).toEqual({ key: "actionBudgetWhyCpi", params: ["0.70"] });
    expect(act.cta).toEqual({ kind: "open", view: "budget", id: 0 });
  });

  it("uses riskHigh score (clamped after static penalty) for Amber budget", () => {
    const acts = budgetProvider.provide(input("A", 0.9));
    expect(acts).toHaveLength(1);
    expect(acts[0].score).toBe(
      Math.max(0, ACTION_WEIGHTS.riskHigh - ACTION_WEIGHTS.staticPenalty),
    );
  });

  it("returns empty array for Green budget", () => {
    expect(budgetProvider.provide(input("G", 1.1))).toEqual([]);
  });

  it("returns empty array for null budget", () => {
    expect(budgetProvider.provide(input(null, null))).toEqual([]);
  });

  it("shows n/a for non-finite CPI (Infinity) with Red budget", () => {
    const acts = budgetProvider.provide(input("R", Infinity));
    expect(acts).toHaveLength(1);
    expect(acts[0].why).toEqual({ key: "actionBudgetWhyCpi", params: ["n/a"] });
  });

  it("shows n/a for null CPI with Red budget", () => {
    const acts = budgetProvider.provide(input("R", null));
    expect(acts).toHaveLength(1);
    expect(acts[0].why).toEqual({ key: "actionBudgetWhyCpi", params: ["n/a"] });
  });
});

describe("budget confidence", () => {
  function redInput(over: Record<string, unknown> = {}) {
    return {
      tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
      commsReminders: [], features: [], projectName: "P",
      today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
      reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
      dismissed: new Set<string>(),
      dashboard: {
        budget: { effective: "R" },
        evm: { cpi: 0.8 },
      } as unknown as DashboardModel,
      ...over,
    } as ActionInput;
  }
  it("applies the static penalty so a red budget is not top-tier by default", () => {
    const [a] = budgetProvider.provide(redInput());
    expect(a.score).toBe(ACTION_WEIGHTS.riskCritical - ACTION_WEIGHTS.staticPenalty);
  });
  it("halves the penalty when the trend is worsening", () => {
    const [a] = budgetProvider.provide(redInput({ trends: { budget: "worsening" } }));
    const halved = Math.round(ACTION_WEIGHTS.staticPenalty / 2);
    expect(a.score).toBe(ACTION_WEIGHTS.riskCritical - halved);
  });
  it("uses the worsening why-key when worsening", () => {
    const [a] = budgetProvider.provide(redInput({ trends: { budget: "worsening" } }));
    expect(a.why.key).toBe("actionBudgetWhyWorsening");
  });
  it("uses the improving why-key when improving", () => {
    const [a] = budgetProvider.provide(redInput({ trends: { budget: "improving" } }));
    expect(a.why.key).toBe("actionBudgetWhyImproving");
  });
  it("honors a configured staticPenalty override", () => {
    const [a] = budgetProvider.provide(redInput({ staticPenalty: 10 }));
    expect(a.score).toBe(ACTION_WEIGHTS.riskCritical - 10);
  });
});
