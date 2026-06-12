import { describe, expect, it } from "vitest";
import { MODAL_FIELDS, MODAL_IDS } from "./modal-fields";
import { applyTier, sanitizeFieldVisibility, visibleFields } from "./field-visibility";

describe("field-visibility integration", () => {
  it("every modal survives a simple→advanced→full→sanitize round-trip", () => {
    for (const id of MODAL_IDS) {
      for (const tier of ["simple", "advanced", "full"] as const) {
        const cfg = { [id]: applyTier(id, tier) };
        const back = sanitizeFieldVisibility(cfg);
        expect(back?.[id], `${id}/${tier}`).toBeDefined();
        const vis = visibleFields(id, back![id]);
        expect(vis.size, `${id}/${tier}`).toBeGreaterThan(0);
      }
    }
  });

  it("required fields are present in every tier for every modal", () => {
    // The simple tier is the smallest visible set; every required field id must
    // appear in it (and therefore in advanced/full, which nest above simple).
    for (const id of MODAL_IDS) {
      const requiredIds = MODAL_FIELDS[id].filter((f) => f.required).map((f) => f.id);
      const simple = visibleFields(id, applyTier(id, "simple"));
      for (const reqId of requiredIds) {
        expect(simple.has(reqId), `${id}.${reqId} missing from simple tier`).toBe(true);
      }
    }
  });
});
