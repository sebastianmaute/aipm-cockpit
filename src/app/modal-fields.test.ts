// src/app/modal-fields.test.ts
import { describe, expect, it } from "vitest";
import { MODAL_FIELDS, MODAL_IDS } from "./modal-fields";

const TIER_RANK = { simple: 0, advanced: 1, full: 2 } as const;

describe("MODAL_FIELDS registry", () => {
  it("covers all 9 modals", () => {
    expect(MODAL_IDS).toEqual([
      "task", "raid", "change", "milestone",
      "stakeholder", "resource", "absence", "budget", "calendarEvent",
    ]);
  });

  it("every modal has unique field ids", () => {
    for (const id of MODAL_IDS) {
      const ids = MODAL_FIELDS[id].map((f) => f.id);
      expect(new Set(ids).size, `${id} has duplicate ids`).toBe(ids.length);
    }
  });

  it("every required field is in the simple tier (so it's always shown)", () => {
    for (const id of MODAL_IDS) {
      for (const f of MODAL_FIELDS[id]) {
        if (f.required) expect(TIER_RANK[f.tier], `${id}.${f.id}`).toBe(0);
      }
    }
  });

  it("each modal has at least one simple field", () => {
    for (const id of MODAL_IDS) {
      expect(MODAL_FIELDS[id].some((f) => f.tier === "simple"), id).toBe(true);
    }
  });

  it("time tracking is an advanced-tier field, so the estimate row is never half empty", () => {
    const task = MODAL_FIELDS.task;
    const estimate = task.find((f) => f.id === "estimate");
    const tracking = task.find((f) => f.id === "timeSpent");
    expect(tracking?.tier).toBe(estimate?.tier);
    // Pin the intended tier too, not just that the two travel together -
    // this would also pass if "estimate" were later moved to "full".
    expect(tracking?.tier).toBe("advanced");
  });

  it("keeps the persisted id 'timeSpent'", () => {
    // The id IS the key under which each user's cog-checklist choice is
    // stored. Renaming it silently resets the preference for everyone who set it.
    expect(MODAL_FIELDS.task.some((f) => f.id === "timeSpent")).toBe(true);
    expect(MODAL_FIELDS.task.some((f) => f.id === "timeTracking")).toBe(false);
  });
});
