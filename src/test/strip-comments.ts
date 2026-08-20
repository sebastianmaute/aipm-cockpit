// One comment stripper for every SOURCE assertion in the suite.
//
// ★★★ A SOURCE ASSERTION OVER A FILE THAT DOCUMENTS ITSELF WILL READ ITS OWN
// PROSE. That is not hypothetical: `rich-text-editor-lazy.test.tsx` once
// asserted `toContain("ssr: false")` against raw source and SURVIVED the
// `ssr: true` mutant, because the module's header discusses `ssr: false` in
// words. Measured — the mutated file passed 5/5. Strip first, always.
//
// ★★ LENGTH-PRESERVING: comments are blanked to spaces, newlines kept. The
// label-binding scanner compares match INDEXES and reports LINE NUMBERS, so
// deleting the text outright would move both.
//
// ★★★ IT USES THE TYPESCRIPT PARSER, AND EVERY HAND-ROLLED ALTERNATIVE TRIED
// HERE WAS WRONG IN A WAY ITS AUTHOR DID NOT NOTICE. Three of them, in order:
//
//   1. Three regexes, stripping a `//` comment only when it STARTED a line, to
//      protect the `//` of a URL. That left every TRAILING `code(); // …`
//      comment readable — including, in the lazy-editor suite, the assertion
//      added to prove no prose had been read. Its `{\s*/\*…\*/\s*}` rule also
//      spanned from an unrelated `{` to a much later `*/}` and blanked REAL
//      CODE: 45,377 characters of it across `src`, e.g. the `import` lines at
//      the top of `api/jira/_helpers.ts`.
//   2. A string-tracking scanner. Treated a template literal as opaque to its
//      closing backtick, so `//` comments inside a `${…}` INTERPOLATION
//      survived — `combobox-shared.tsx` has seven, one of which names
//      `<Input>`, which is verbatim the silent miss the label guard exists to
//      catch. A backtick inside a REGEX LITERAL (`markdown.tsx` matches a
//      fenced code block with one) also opened a fifty-line phantom template.
//   3. The same scanner plus `${…}` and regex tracking. Fixed both of those and
//      introduced a worse one, in the DANGEROUS direction: JSX children are
//      TEXT, not code, so the bare URL in `timelog-settings.tsx` made it blank
//      8,283 characters of real markup from `//login.timelog.com…` onward.
//
// Each cut was tested, reviewed and believed correct. The parser already knows
// JSX text from code, a template's text from its interpolations, a regex
// literal from a division, and a comment from all of them; approximating that
// by hand is a losing trade for a helper this small.
//
// ★★ THE ONE THING TO CHECK IF YOU CHANGE THIS: over-blanking versus
// under-blanking are NOT symmetric. Blanking a character that is not in a
// comment deletes code from the text an assertion reads — that is how cut 3
// broke. Leaving a comment character readable merely means an assertion can
// still match prose there, which is the behaviour every earlier cut had.
// `strip-comments.test.ts` pins both directions on the shapes that broke.
import ts from "typescript";

/** Source with every comment blanked to spaces of the same length. */
export function stripComments(src: string): string {
  // `ScriptKind.TSX` for every input: it is the superset that parses JSX, and
  // the suites feed this both `.ts` and `.tsx`. `setParentNodes` is required —
  // `getChildren()` needs them.
  const sf = ts.createSourceFile("scan.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = src.split("");

  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      // Newlines survive so line numbers do not move.
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
    }
  };

  // ★ LEAF tokens only. Every comment in a file is LEADING trivia of exactly one
  // token — including the very last one, which is why `EndOfFileToken` must be
  // visited too (a trailing comment at end of file hangs off it). Walking inner
  // NODES instead misses trailing comments: measured at 86 characters across
  // `src` before this was narrowed to leaves.
  const visit = (node: ts.Node) => {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      // BOTH lists, because they are disjoint and each misses half the file:
      // TypeScript calls a comment that follows code on the SAME line a TRAILING
      // comment of the token before it, and `getLeadingCommentRanges` does not
      // return it. Leading-only left every `x = 1; // …` and every JSX
      // `{/* … */}` readable — 111,108 characters across `src`, measured.
      // A leaf's `fullStart` IS the previous leaf's `end`, so one position
      // serves both queries and no previous-token state is needed.
      const at = node.getFullStart();
      for (const r of ts.getLeadingCommentRanges(src, at) ?? []) blank(r.pos, r.end);
      for (const r of ts.getTrailingCommentRanges(src, at) ?? []) blank(r.pos, r.end);
      return;
    }
    kids.forEach(visit);
  };
  visit(sf);

  return out.join("");
}
