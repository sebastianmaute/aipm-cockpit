import { describe, it, expect } from "vitest";
import { buildTaskSeedFromAction } from "./action-task-seed";
import type { SuggestedAction } from "./next-actions/types";

function raidAction(): SuggestedAction {
  return {
    id: "raid:12:severity", source: "raid",
    title: { key: "actionRaidTitle", params: [12, "DB outage"] },
    why: { key: "actionRaidWhyNoOwner", params: ["High"] },
    score: 30, tier: "now",
    cta: { kind: "open", view: "raid", id: 12 },
  };
}

describe("buildTaskSeedFromAction", () => {
  it("uses the translated action title as the task name", () => {
    const seed = buildTaskSeedFromAction(raidAction(), "en-US");
    expect(seed.taskName).toBe("RAID 12: DB outage");
  });
  it("prepends a From: note with the translated source label and why", () => {
    const seed = buildTaskSeedFromAction(raidAction(), "en-US");
    expect(seed.notes).toBe("From: RAID — Severity High — no owner assigned\n\n");
  });
  it("builds the seed for a non-raid (budget) source", () => {
    const action = {
      id: "budget:overall:over", source: "budget",
      title: { key: "actionBudgetTitle", params: ["Acme"] },
      why: { key: "actionBudgetWhyCpi", params: ["0.80"] },
      score: 5, tier: "monitor", cta: { kind: "open", view: "budget", id: 0 },
    } as unknown as import("./next-actions/types").SuggestedAction;
    const seed = buildTaskSeedFromAction(action, "en-US");
    expect(seed.taskName).toBe("Budget: Acme");
    expect(seed.notes.startsWith("From: ")).toBe(true);
    expect(seed.notes.endsWith("\n\n")).toBe(true);
    expect(seed.notes).toContain("Budget");
    expect(seed.notes).toContain("Cost performance below target (CPI 0.80)");
  });
});
