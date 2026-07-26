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
});
