// src/app/operating-guide.test.ts
import { describe, it, expect } from "vitest";
import {
  selectActiveGuides, assembleGuideBlock, guidesCharCount,
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

describe("assembleGuideBlock", () => {
  it("returns empty string for no guides", () => {
    expect(assembleGuideBlock([])).toBe("");
  });
  it("emits a precedence header and delimited guides in order", () => {
    const block = assembleGuideBlock([base({ id: "a", name: "First", content: "AAA", priority: 1 })]);
    expect(block).toContain("priority order");
    expect(block).toContain("On conflict the earlier one wins");
    expect(block).toContain('GUIDE 1 (priority 1) — "First"');
    expect(block).toContain("AAA");
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
