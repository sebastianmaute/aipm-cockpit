// src/app/operating-guide.test.ts
import { describe, it, expect } from "vitest";
import {
  selectActiveGuides, partitionGuidesByViewScope, assembleGuideBlocks, guidesCharCount,
  GUIDE_CHAR_BUDGET, type OperatingGuide, type GuideContext,
} from "./operating-guide";

const base = (over: Partial<OperatingGuide>): OperatingGuide => ({
  id: "g", name: "G", content: "body", enabled: true, priority: 10,
  scope: {}, builtIn: false, ...over,
});
const ctx: GuideContext = { mode: "advanced", modules: ["raid", "milestones"], view: "milestones" };

describe("selectActiveGuides", () => {
  it("keeps an always-on enabled guide (empty scope = wildcard)", () => {
    const r = selectActiveGuides([base({ id: "a" })], ctx);
    expect(r.map((g) => g.id)).toEqual(["a"]);
  });
  it("drops a disabled guide", () => {
    expect(selectActiveGuides([base({ id: "a", enabled: false })], ctx)).toEqual([]);
  });
  it("drops a guide whose mode scope excludes the current mode", () => {
    const r = selectActiveGuides([base({ id: "a", scope: { modes: ["simple"] } })], ctx);
    expect(r).toEqual([]);
  });
  it("keeps a guide whose module scope includes a current module", () => {
    const r = selectActiveGuides([base({ id: "a", scope: { modules: ["raid"] } })], ctx);
    expect(r.map((g) => g.id)).toEqual(["a"]);
  });
  it("drops a guide whose view scope excludes the current view", () => {
    const r = selectActiveGuides([base({ id: "a", scope: { views: ["budget"] } })], ctx);
    expect(r).toEqual([]);
  });
  it("sorts by ascending priority then id", () => {
    const r = selectActiveGuides(
      [base({ id: "b", priority: 5 }), base({ id: "a", priority: 5 }), base({ id: "c", priority: 1 })],
      ctx,
    );
    expect(r.map((g) => g.id)).toEqual(["c", "a", "b"]);
  });
});

describe("partitionGuidesByViewScope", () => {
  it("treats an absent views list as always-on", () => {
    const g = base({ id: "a", scope: {} });
    expect(partitionGuidesByViewScope([g])).toEqual({ alwaysOn: [g], viewScoped: [] });
  });

  // ★ An EMPTY array is a wildcard too — `dimensionMatches` returns true for
  //   both `undefined` and `[]`, so a guide scoped `views: []` applies on
  //   every view and must land in the always-on half. Partitioning on
  //   `views == null` alone misfiles it, and the misfile is invisible until a
  //   view switch silently stops hitting the cache.
  it("treats an EMPTY views list as always-on, not view-scoped", () => {
    const g = base({ id: "a", scope: { views: [] } });
    expect(partitionGuidesByViewScope([g])).toEqual({ alwaysOn: [g], viewScoped: [] });
  });

  it("puts a guide naming any view in the view-scoped half", () => {
    const g = base({ id: "a", scope: { views: ["budget"] } });
    expect(partitionGuidesByViewScope([g])).toEqual({ alwaysOn: [], viewScoped: [g] });
  });

  it("preserves the incoming order within each half", () => {
    const a = base({ id: "a", scope: {}, priority: 1 });
    const b = base({ id: "b", scope: { views: ["budget"] }, priority: 2 });
    const c = base({ id: "c", scope: {}, priority: 3 });
    expect(partitionGuidesByViewScope([a, b, c])).toEqual({ alwaysOn: [a, c], viewScoped: [b] });
  });
});

describe("assembleGuideBlocks", () => {
  it("returns two empty strings for no guides", () => {
    expect(assembleGuideBlocks([])).toEqual({ alwaysOn: "", viewScoped: "" });
  });

  it("counts ONLY the always-on guides in the always-on header", () => {
    const one = assembleGuideBlocks([
      base({ id: "a", name: "Always", content: "AAA", scope: {} }),
      base({ id: "b", name: "Budget", content: "BBB", scope: { views: ["budget"] } }),
    ]);
    const two = assembleGuideBlocks([base({ id: "a", name: "Always", content: "AAA", scope: {} })]);
    // ★★ THE POINT OF THE WHOLE SLICE: the always-on text must not move when
    //    the number of view-scoped guides changes.
    expect(one.alwaysOn).toBe(two.alwaysOn);
  });

  it("numbers the view-scoped guides after the always-on ones", () => {
    const r = assembleGuideBlocks([
      base({ id: "a", name: "Always", content: "AAA", scope: {} }),
      base({ id: "b", name: "Budget", content: "BBB", scope: { views: ["budget"] } }),
    ]);
    expect(r.alwaysOn).toContain('=== GUIDE 1 (priority 10) — "Always" ===');
    expect(r.alwaysOn).toContain("AAA");
    expect(r.viewScoped).toContain('=== GUIDE 2 (priority 10) — "Budget" ===');
    expect(r.viewScoped).toContain("BBB");
    // The view-scoped half must not restate the always-on content.
    expect(r.viewScoped).not.toContain("AAA");
  });

  it("numbers from 1 and uses the plain header when there are no always-on guides", () => {
    const r = assembleGuideBlocks([
      base({ id: "b", name: "Budget", content: "BBB", scope: { views: ["budget"] } }),
    ]);
    expect(r.alwaysOn).toBe("");
    expect(r.viewScoped).toContain('=== GUIDE 1 (priority 10) — "Budget" ===');
    expect(r.viewScoped).toContain("You have 1 operating guide");
    expect(r.viewScoped).not.toContain("additional");
  });

  // ★ The path where `viewHeader` is computed and then discarded: with zero
  //   view-scoped guides, `viewScopedText` short-circuits to "" regardless of
  //   what `viewHeader` says.
  it("leaves viewScoped empty and numbers both always-on guides when nothing is view-scoped", () => {
    const r = assembleGuideBlocks([
      base({ id: "a", name: "Always A", content: "AAA", scope: {} }),
      base({ id: "b", name: "Always B", content: "BBB", scope: {} }),
    ]);
    expect(r.viewScoped).toBe("");
    expect(r.alwaysOn).toContain("You have 2 operating guides");
    expect(r.alwaysOn).toContain('=== GUIDE 1 (priority 10) — "Always A" ===');
    expect(r.alwaysOn).toContain('=== GUIDE 2 (priority 10) — "Always B" ===');
  });
});

describe("guidesCharCount", () => {
  it("sums content length", () => {
    expect(guidesCharCount([base({ content: "abc" }), base({ content: "de" })])).toBe(5);
  });
  it("exposes a positive budget", () => {
    expect(GUIDE_CHAR_BUDGET).toBeGreaterThan(0);
  });
});
