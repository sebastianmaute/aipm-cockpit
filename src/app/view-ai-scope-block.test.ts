import { describe, it, expect } from "vitest";
import { buildViewScopeBlock, buildViewStateBlock } from "./view-ai-scope-block";

describe("buildViewScopeBlock", () => {
  it("names the view and states its purpose", () => {
    const text = buildViewScopeBlock("workload");
    expect(text).toContain("workload");
    expect(text).toContain("capacity versus allocation");
  });

  it("lists tool hints when the view has them", () => {
    expect(buildViewScopeBlock("workload")).toContain("list_allocations");
  });

  it("omits the tools line entirely for a view with no hints", () => {
    const text = buildViewScopeBlock("help");
    expect(text).not.toContain("Relevant tools");
  });

  // ★ Assert the PRECEDENCE CLAUSE, never the bare phrase. The block names
  // "operating guide" TWICE — once descriptively, once in the rule — so a
  // `toContain("operating guide")` assertion stays green after the rule is
  // inverted to "...where the two conflict, this view scope wins", which is
  // the one thing this test exists to prevent. The rule is deliberately the
  // INVERSE of assembleGuideBlock's "earlier wins", so nothing else guards it.
  it("states that the OPERATING GUIDE wins on conflict, not the view scope", () => {
    const text = buildViewScopeBlock("dashboard");
    expect(text).toContain("where the two conflict, the operating guide wins");
    expect(text).not.toContain("view scope wins");
  });
});

describe("buildViewStateBlock", () => {
  it("returns an empty string when there is no digest", () => {
    expect(buildViewStateBlock(undefined)).toBe("");
  });

  it("wraps a digest in a labelled block", () => {
    const text = buildViewStateBlock("3 people over capacity");
    expect(text).toContain("VIEW STATE");
    expect(text).toContain("3 people over capacity");
  });
});
