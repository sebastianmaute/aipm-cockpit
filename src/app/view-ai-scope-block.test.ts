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

  it("states that user guides win on conflict", () => {
    expect(buildViewScopeBlock("dashboard").toLowerCase()).toContain("operating guide");
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
