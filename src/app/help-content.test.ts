import { describe, it, expect } from "vitest";
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL, helpGroupOrder } from "./help-content";
import { allNavViews } from "./nav-config";

describe("help-content backbone", () => {
  it("has unique entry ids", () => {
    const ids = HELP_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(HELP_ENTRIES.filter((e) => e.group === "automated").length).toBeGreaterThanOrEqual(3);
    // ★ `features` is the bulk of the file (44 today) and was the one group
    // with no floor at all, so a mass deletion there would have passed every
    // assertion in this describe block.
    expect(HELP_ENTRIES.filter((e) => e.group === "features").length).toBeGreaterThanOrEqual(40);
  });
});

describe("concept primers", () => {
  it("every concept entry has one", () => {
    const missing = HELP_ENTRIES.filter((e) => e.group === "concepts" && !e.primerKey).map((e) => e.id);
    expect(missing).toEqual([]);
  });

  // Primers are the Guided level's whole payload. Putting one on a feature or
  // workflow entry would render it at Guided with nothing having decided what
  // it should say there.
  it("no other group has one", () => {
    const stray = HELP_ENTRIES.filter((e) => e.group !== "concepts" && e.primerKey).map((e) => e.id);
    expect(stray).toEqual([]);
  });
});

describe("helpGroupOrder", () => {
  it("gives Guided and Standard today's order", () => {
    expect(helpGroupOrder("guided")).toEqual(["concepts", "workflows", "features", "automated"]);
    expect(helpGroupOrder("standard")).toEqual(["concepts", "workflows", "features", "automated"]);
  });

  it("gives Expert reference-first order", () => {
    expect(helpGroupOrder("expert")).toEqual(["features", "automated", "workflows", "concepts"]);
  });

  // Guards the reorder against a typo that drops or duplicates a group — an
  // Expert user would silently lose a whole section of Help.
  it("covers every group exactly once at every level", () => {
    for (const level of ["guided", "standard", "expert"] as const) {
      const order = helpGroupOrder(level);
      expect([...order].sort()).toEqual([...HELP_GROUP_ORDER].sort());
      expect(new Set(order).size).toBe(order.length);
    }
  });
});
