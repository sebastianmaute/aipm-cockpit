import { describe, it, expect } from "vitest";
import { buildViewScopeBlock, buildViewStateBlock } from "./view-ai-scope-block";
import { toolNamesFor } from "./chat-api";

// ★★ THE REAL SETS, from the same `toolNamesFor` the wire uses — never a
//    hand-written `new Set(["search_history"])`. A fabricated set makes every
//    assertion below a statement about the fixture: the suppression test would
//    stay green after `search_history` was renamed, dropped from TOOL_DEFS, or
//    detached from the toggle, which is the whole class this file now guards.
const ALL = toolNamesFor({}); // history search ON (the default)
const NO_HISTORY = toolNamesFor({ historySearch: false }); // the kill switch thrown

describe("buildViewScopeBlock", () => {
  it("names the view and states its purpose", () => {
    const text = buildViewScopeBlock("workload", ALL);
    expect(text).toContain("workload");
    expect(text).toContain("capacity versus allocation");
  });

  it("lists tool hints when the view has them", () => {
    expect(buildViewScopeBlock("workload", ALL)).toContain("list_allocations");
  });

  it("omits the tools line entirely for a view with no hints", () => {
    const text = buildViewScopeBlock("help", ALL);
    expect(text).not.toContain("Relevant tools");
  });

  // ★ Assert the PRECEDENCE CLAUSE, never the bare phrase. The block names
  // "operating guide" TWICE — once descriptively, once in the rule — so a
  // `toContain("operating guide")` assertion stays green after the rule is
  // inverted to "...where the two conflict, this view scope wins", which is
  // the one thing this test exists to prevent. The rule is deliberately the
  // INVERSE of assembleGuideBlock's "earlier wins", so nothing else guards it.
  it("states that the OPERATING GUIDE wins on conflict, not the view scope", () => {
    const text = buildViewScopeBlock("dashboard", ALL);
    expect(text).toContain("where the two conflict, the operating guide wins");
    expect(text).not.toContain("view scope wins");
  });

  // ★★★ THE THREE ADVERTISING SURFACES vs THE TOOL LIST. `historySearch: false`
  // removes `search_history` from the request (`toolsFor`) while this block went
  // on naming it in BOTH its hint line and Activity's `reading` — the model was
  // instructed, every turn, to call a tool it had not been given. These two
  // tests are the only thing holding the seam on this surface.
  describe("a view whose hint names a tool the request will not carry", () => {
    it("advertises search_history on Activity while the tool is offered", () => {
      const text = buildViewScopeBlock("activity", ALL);
      expect(text).toContain("Relevant tools here: search_history.");
      expect(text).toContain("search_history reads this log");
    });

    // ★ The POSITIVE control above is what stops this one passing vacuously —
    //   a `buildViewScopeBlock` that never emitted a hint line at all, or a
    //   registry entry with the hint deleted, would satisfy the negatives here
    //   and fail the positives there.
    it("names it in neither the hint line nor the reading once it is dropped", () => {
      const text = buildViewScopeBlock("activity", NO_HISTORY);
      expect(text).not.toContain("search_history");
      expect(text).not.toContain("Relevant tools");
    });

    // ★★ SUPPRESSION, NOT AMPUTATION. Dropping one hint must not silence a
    //    view's other hints, and must not touch a `reading` that never depended
    //    on the tool — a filter written as "clear toolHints when history is off"
    //    passes the test above and fails this one.
    it("leaves every other view's hints and reading intact", () => {
      const text = buildViewScopeBlock("open-points", NO_HISTORY);
      expect(text).toContain("Relevant tools here: list_tasks, get_task.");
      expect(text).toContain("only Done counts as delivered");
    });
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
