import { describe, it, expect } from "vitest";
import { forEachTagPair, replaceTagPairs, type TagPairSpec } from "./tag-pair-walk";

const SPEC: TagPairSpec = {
  openPattern: "<(w:tbl)\\b",
  closeName: (m) => m[1],
  hasAttributes: true,
};

describe("forEachTagPair", () => {
  it("visits each pair with its inner text", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>a</w:tbl><w:tbl>b</w:tbl>", SPEC, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual(["a", "b"]);
  });

  it("stops when visit returns false", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>a</w:tbl><w:tbl>b</w:tbl>", SPEC, (p) => {
      pairs.push(p.inner);
      return false;
    });
    expect(pairs).toEqual(["a"]);
  });

  it("leaves an unclosed open tag alone instead of consuming the rest", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>unclosed", SPEC, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual([]);
  });

  it("stays linear when the input has no '>' anywhere at all", () => {
    // 20k unclosed opens with no ">" anywhere: every one hits the
    // `if (gt === -1) return;` branch on the very FIRST iteration, so this
    // does not exercise the closeRe===null retirement path below (that one
    // needs a ">" present so the walk gets past the first open) — see
    // "keeps retired-name lookups cheap ..." for that. Quadratic scanning
    // here would take seconds, linear is ms.
    const input = "<w:tbl ".repeat(20_000);
    const start = performance.now();
    forEachTagPair(input, SPEC, () => true);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it("retires one name's close lookup without affecting a different name", () => {
    // §558 fix round 3, item 8: SPEC above always returns "w:tbl", so the
    // per-name retirement map (`closers`) never holds more than one entry
    // anywhere in this file - the multi-name path is exercised only
    // indirectly, through docx's BLOCK_PAIR. This spec returns "a" or "b"
    // depending on which one matched. "<a>" here has no closing "</a>"
    // anywhere, so it retires; "<b>value</b>" appears AFTER that retirement
    // and must still be found - a global (rather than per-name) retirement
    // flag would incorrectly skip it too.
    const twoNames: TagPairSpec = {
      openPattern: "<([ab])\\b",
      closeName: (m) => m[1],
      hasAttributes: true,
    };
    const pairs: string[] = [];
    forEachTagPair("<a><b>value</b>", twoNames, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual(["value"]);
  });

  it("pins that skipSelfClosing silently no-ops without hasAttributes (documented coupling, not enforced)", () => {
    // §558 fix round 4, N4: self-close DETECTION lives entirely inside the
    // `hasAttributes` block (it needs that block's `gt` lookup to find the
    // tag's own ">"), so setting skipSelfClosing without hasAttributes:
    // true does nothing - TagPairSpec's own docs state the coupling in
    // prose, but nothing enforces it. Pinning the CURRENT behaviour here
    // rather than making the two independent: no spec in this codebase
    // needs skipSelfClosing without hasAttributes, and self-close detection
    // is inherently about knowing where the tag's own ">" is - exactly what
    // hasAttributes computes.
    const spec: TagPairSpec = {
      openPattern: "<a\\b",
      closeName: () => "a",
      hasAttributes: false,
      skipSelfClosing: true,
    };
    const pairs: string[] = [];
    forEachTagPair("<a/>real</a>", spec, (p) => {
      pairs.push(p.inner);
      return true;
    });
    // If skipSelfClosing worked without hasAttributes, <a/> would be
    // skipped, leaving no "a" left to match - instead the self-close is
    // invisible and "/>real" is swallowed as one (wrong) pair's inner text.
    expect(pairs).toEqual(["/>real"]);
  });

  it("keeps retired-name lookups cheap, so a missing close stays linear", () => {
    // A single ">" at the very end (no space after "w:tbl", so `\b` still
    // matches against the following "<") means the FIRST open pays for one
    // real `indexOf(">", ...)` scan, finds no close, and retires the name to
    // null. Every one of the other N-1 opens must then consult that
    // retirement — this is the fixture the docstring's ordering ★ note
    // exists for, and it is the one the previous (renamed) test above does
    // NOT cover: that one returns out of the whole function on the first
    // open, so its N-1 remaining opens are never reached.
    //
    // Measured on this machine at N=80,000 (git commit 0ac53c0c code, i.e.
    // the retired-name check placed BEFORE the attribute scan):
    //   correct order (checked-first):  ~5.4ms
    //   swapped order (scanned-first): ~433.2ms   (~80x slower)
    // Reordering the two checks inside forEachTagPair (running the
    // `indexOf(">", ...)` scan before the `closeRe === null` check) turns
    // this back into the O(n^2) walk the docstring warns against, because
    // every retired open re-scans to the one ">" at the end of the input.
    // The 50ms ceiling sits roughly midway between the two on a log scale
    // (correct-order margin ~9x under budget, swapped ~9x over it), with
    // room either way for a slower or faster CI box — the ~80x gap between
    // the two orderings is what actually makes this test discriminating,
    // not the exact ceiling chosen.
    const n = 80_000;
    const input = "<w:tbl".repeat(n) + ">";
    const start = performance.now();
    forEachTagPair(input, SPEC, () => true);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("replaceTagPairs", () => {
  it("replaces each pair and keeps the text around it", () => {
    const out = replaceTagPairs("x<w:tbl>a</w:tbl>y", SPEC, (p) => "[" + p.inner + "]");
    expect(out).toBe("x[a]y");
  });
});
