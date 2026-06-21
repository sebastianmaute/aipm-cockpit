import { describe, expect, test } from "vitest";
import { computeCoaching } from "./dashboard-coaching";

const base = { taskCount: 0, milestoneCount: 0, budgetCount: 0, showMilestones: true, showBudget: true, aiConfigured: true };

describe("computeCoaching", () => {
  test("returns [] once any task exists (non-naggy on active projects)", () => {
    expect(computeCoaching({ ...base, taskCount: 1, aiConfigured: false })).toEqual([]);
  });

  test("blank project always offers Add-task first", () => {
    const ctas = computeCoaching(base);
    expect(ctas[0]).toEqual({ key: "task", labelKey: "coachingAddTask", view: "open-points" });
  });

  test("offers Configure-AI when the key is not set", () => {
    const ctas = computeCoaching({ ...base, aiConfigured: false, showMilestones: false, showBudget: false });
    expect(ctas.map((c) => c.key)).toEqual(["task", "ai"]);
    expect(ctas[1].view).toBe("settings");
  });

  test("offers Add-milestone only when the module is on and none exist", () => {
    expect(computeCoaching({ ...base }).some((c) => c.key === "milestone")).toBe(true);
    expect(computeCoaching({ ...base, milestoneCount: 2 }).some((c) => c.key === "milestone")).toBe(false);
    expect(computeCoaching({ ...base, showMilestones: false }).some((c) => c.key === "milestone")).toBe(false);
  });

  test("offers Set-up-budget only when the module is on and none exist", () => {
    expect(computeCoaching({ ...base }).some((c) => c.key === "budget")).toBe(true);
    expect(computeCoaching({ ...base, budgetCount: 1 }).some((c) => c.key === "budget")).toBe(false);
    expect(computeCoaching({ ...base, showBudget: false }).some((c) => c.key === "budget")).toBe(false);
  });

  test("full order on a fully-blank project with no AI key", () => {
    const ctas = computeCoaching({ ...base, aiConfigured: false });
    expect(ctas.map((c) => c.key)).toEqual(["task", "ai", "milestone", "budget"]);
    expect(ctas.map((c) => c.view)).toEqual(["open-points", "settings", "milestones", "budget"]);
  });
});
