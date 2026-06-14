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
});
