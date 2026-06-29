import { describe, it, expect } from "vitest";
import { HELP_ENTRIES, HELP_SECTIONS, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
import { allNavViews } from "./nav-config";

describe("help-content backbone", () => {
  it("has unique entry ids", () => {
    const ids = HELP_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("HELP_SECTIONS is exactly the features group", () => {
    expect(HELP_SECTIONS).toEqual(HELP_ENTRIES.filter((e) => e.group === "features"));
  });

  it("every relatedConcepts id resolves to a real entry", () => {
    const ids = new Set(HELP_ENTRIES.map((e) => e.id));
    for (const e of HELP_ENTRIES) {
      for (const r of e.relatedConcepts ?? []) expect(ids.has(r)).toBe(true);
    }
  });

  it("every relatedViews entry is a valid AppView", () => {
    const views = new Set<string>(allNavViews());
    for (const e of HELP_ENTRIES) {
      for (const v of e.relatedViews ?? []) expect(views.has(v)).toBe(true);
    }
  });

  it("every group in HELP_GROUP_ORDER has a label", () => {
    for (const g of HELP_GROUP_ORDER) expect(HELP_GROUP_LABEL[g]).toBeTruthy();
  });

  it("has the concept, workflow and automated entries", () => {
    expect(HELP_ENTRIES.filter((e) => e.group === "concepts").length).toBeGreaterThanOrEqual(10);
    expect(HELP_ENTRIES.filter((e) => e.group === "workflows").length).toBeGreaterThanOrEqual(6);
    expect(HELP_ENTRIES.filter((e) => e.group === "automated").length).toBeGreaterThanOrEqual(1);
  });
});
