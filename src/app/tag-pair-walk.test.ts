import { describe, it, expect } from "vitest";
import { forEachOpenTag, forEachTagPair, replaceTagPairs, type TagPairSpec } from "./tag-pair-walk";
import { expectLinearScaling } from "../test/scaling";

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

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("stays linear when the input has no '>' anywhere at all", { timeout: 120_000 }, () => {
    // Unclosed opens with no ">" anywhere: the first one hits the
    // `if (gt === -1) return;` branch on the very FIRST iteration, so this
    // does not exercise the closeRe===null retirement path below (that one
    // needs a ">" present so the walk gets past the first open) — see
    // "keeps retired-name lookups cheap ..." for that. Turning that `return`
    // into a `continue` makes every open rescan to end of input. Measured
    // 2026-09-19 (ratio large / small, limit 8): 4.1–4.3 green, 17.2 with
    // that mutant. n is 80,000, not the former fixed 20,000 / 4: one green call is a
    // single indexOf of a few µs, and at n 5,000 the helper calibrated
    // 16,384–32,768 loops against its 65,536 cap, so a CI machine 2–4x faster
    // would throw below the timer floor. At 80,000 it calibrates 2,048 loops
    // (fast-CI headroom, plan Review Focus 1).
    expectLinearScaling({
      label: "no '>' anywhere (forEachTagPair)",
      build: (n) => "<w:tbl ".repeat(n),
      run: (input) => {
        const seen: string[] = [];
        forEachTagPair(input, SPEC, (pair) => {
          seen.push(pair.inner);
          return true;
        });
        return seen;
      },
      // No open has a ">", so nothing is yielded. `check` cannot catch an
      // early bail here: the correct walk IS one (it returns at the first
      // open), and a sentinel pair after the soup would put a ">" in the
      // input, which is the one thing this fixture exists to withhold. The
      // mutant is caught on its ratio alone.
      check: (seen) => expect(seen).toEqual([]),
      n: 80_000,
    });
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

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("keeps retired-name lookups cheap, so a missing close stays linear", { timeout: 120_000 }, () => {
    // A single ">" at the very end (no space after "w:tbl", so `\b` still
    // matches against the following "<") means the FIRST open pays for one
    // real `indexOf(">", ...)` scan, finds no close, and retires the name to
    // null. Every one of the other N-1 opens must then consult that
    // retirement — this is the fixture the docstring's ordering ★ note
    // exists for, and it is the one the previous (renamed) test above does
    // NOT cover: that one returns out of the whole function on the first
    // open, so its N-1 remaining opens are never reached.
    //
    // Reordering the two checks inside forEachTagPair (running the
    // `indexOf(">", ...)` scan before the `closeRe === null` check) turns
    // this back into the O(n^2) walk the docstring warns against, because
    // every retired open re-scans to the one ">" at the end of the input.
    // Measured 2026-09-19 (ratio large / small, limit 8): 4.6 in the correct
    // order, 15.9 with the two checks swapped.
    expectLinearScaling({
      label: "retired-name lookups",
      build: (n) => "<w:tbl".repeat(n) + ">",
      run: (input) => {
        const seen: string[] = [];
        forEachTagPair(input, SPEC, (pair) => {
          seen.push(pair.inner);
          return true;
        });
        return seen;
      },
      // No open ever finds its close, so nothing is yielded. `check` cannot
      // tell a walk that stopped after the first retirement from one that
      // consulted it N-1 times: both yield nothing. A sentinel "</w:tbl>"
      // would give the first open a close and un-retire the name, removing
      // the path under test, so the mutant is caught on its ratio alone.
      check: (seen) => expect(seen).toEqual([]),
      n: 20_000,
    });
  });
});

describe("replaceTagPairs", () => {
  it("replaces each pair and keeps the text around it", () => {
    const out = replaceTagPairs("x<w:tbl>a</w:tbl>y", SPEC, (p) => "[" + p.inner + "]");
    expect(out).toBe("x[a]y");
  });
});

describe("forEachOpenTag", () => {
  const tagsOf = (xml: string, stopAfter = Infinity): string[] => {
    const tags: string[] = [];
    forEachOpenTag(xml, "<sheet\\b", (tag) => {
      tags.push(tag);
      return tags.length < stopAfter;
    });
    return tags;
  };

  it("visits each open tag through its first '>', whatever its form", () => {
    expect(tagsOf(`<sheets><sheet a="1"/><sheet b="2"></sheet><sheetX/></sheets>`)).toEqual([
      `<sheet a="1"/>`,
      `<sheet b="2">`,
    ]);
  });

  it("consumes an open that sits inside an earlier tag, as `<sheet\\b[^>]*>` did", () => {
    expect(tagsOf(`<sheet a <sheet b>`)).toEqual([`<sheet a <sheet b>`]);
  });

  it("stops at an open with no '>' after it, and when visit returns false", () => {
    expect(tagsOf(`<sheet a/><sheet b`)).toEqual([`<sheet a/>`]);
    expect(tagsOf(`<sheet a/><sheet b/>`, 1)).toEqual([`<sheet a/>`]);
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("stays linear on opens with no '>' anywhere at all", { timeout: 120_000 }, () => {
    // Skipping such an open instead of ending the walk makes every later one
    // rescan to end of input. indexOf is fast enough that this only shows at
    // scale. Measured 2026-09-19 (ratio large / small, limit 8): 4.1–4.3
    // green, 16.7 with `if (gt === -1) return;` turned into `continue`.
    // n is 100,000, not the former fixed 200,000 / 4: at 50,000 the helper calibrated
    // 2,048–4,096 loops; at 100,000 it calibrates 2,048, leaving headroom
    // under its 65,536 cap on a faster CI machine (plan Review Focus 1).
    expectLinearScaling({
      label: "no '>' anywhere (forEachOpenTag)",
      build: (n) => "<sheet ".repeat(n),
      run: (input) => tagsOf(input),
      // As in the forEachTagPair case above: the correct walk returns at the
      // first open, so `check` cannot catch an early bail, and a sentinel tag
      // would add the ">" the fixture withholds. The ratio catches the mutant.
      check: (tags) => expect(tags).toEqual([]),
      n: 100_000,
    });
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("stays linear on opens with no '>' before the end of a long input", { timeout: 120_000 }, () => {
    // Resuming the open scan anywhere short of the visited tag's ">" makes
    // every one of these opens rescan out to the single ">" at the end.
    // Measured 2026-09-19 (ratio large / small, limit 8): 4.3–4.4 green.
    // Dropping the `openRe.lastIndex = gt + 1` resume fails `check` first,
    // since every open then becomes its own tag; with `check` relaxed, the
    // same mutant measured 18.2. n is 80,000, not the former fixed 80,000 / 4: at
    // 20,000 the helper calibrated 4,096–8,192 loops; at 80,000 it
    // calibrates 2,048, leaving headroom under its 65,536 cap on a faster CI
    // machine (plan Review Focus 1).
    expectLinearScaling({
      label: "one '>' at the end (forEachOpenTag)",
      build: (n) => "<sheet ".repeat(n) + ">",
      run: (input) => tagsOf(input),
      // The first open's tag runs through the one ">", consuming every later
      // open inside it, as `<sheet\b[^>]*>` did. Compared by length, not by
      // value: a failing toEqual would print every tag, which overflows the
      // formatter at these sizes.
      check: (tags, n) => {
        expect(tags.length).toBe(1);
        expect(tags[0].length).toBe("<sheet ".length * n + 1);
      },
      n: 80_000,
    });
  });
});
