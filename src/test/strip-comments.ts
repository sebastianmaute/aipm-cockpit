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
//      CODE: 47,380 non-whitespace characters across 164 files in `src`, e.g.
//      the `import` lines at the top of `api/jira/_helpers.ts`. That one is
//      still reproducible — the regexes are in git (`git show
//      333f1dd3:src/app/label-binding.guard.test.ts`), and the measurement is a
//      per-position comparison of what they blank against this module's ranges.
//   2. A string-tracking scanner. Treated a template literal as opaque to its
//      closing backtick, so `//` comments inside a `${…}` INTERPOLATION
//      survived — `combobox-shared.tsx` has seven of them, inside a `className`.
//      A backtick inside a REGEX LITERAL (`markdown.tsx` matches a fenced code
//      block with one) also opened a fifty-line phantom template.
//   3. The same scanner plus `${…}` and regex tracking. Fixed both of those and
//      introduced a worse one, in the DANGEROUS direction: JSX children are
//      TEXT, not code, so the bare URL in `timelog-settings.tsx` made it blank
//      thousands of characters of real markup from `//login.timelog.com…`
//      onward. (No figure is quoted: that code is deleted, so nothing can
//      re-derive one.)
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
//
// ★★ AND THE PARSER CUT REPRODUCED CUT 3's BUG IN MINIATURE, which is the
// argument for keeping that asymmetry in mind rather than trusting the parser
// wholesale. A `JsxText` leaf has no leading trivia — its `fullStart` IS its own
// start — so asking `getLeadingCommentRanges` at that position scans the JSX
// TEXT ITSELF and happily reports a "comment" when the text begins `//` or
// `/*`. Found by a cold review, and the regression test that was supposed to
// cover it could not see it: its fixture led with `https:`, so the `//` was not
// at the start of the text and the query never fired. `JsxText` is skipped
// below; the fixture now leads with `//`.
import ts from "typescript";

/**
 * Source with every comment blanked to spaces of the same length.
 *
 * `fileName` picks the parse mode and matters for `.ts` files — see below.
 * Callers that already hold a path should pass it; the default suits the
 * hand-written `.tsx`-shaped strings the tests feed in.
 */
export function stripComments(src: string, fileName = "scan.tsx"): string {
  // ★★ THE SCRIPT KIND IS NOT A FORMALITY, and parsing everything as TSX (which
  // this did until a cold review measured it) silently gives up on one real
  // shape: a NON-COMMA generic arrow, `const renameItem = <T>(item: T): T =>`
  // in `workspace.ts`, opens a JSX element under TSX and the parse is garbage
  // from there to end of file — 8,250 comment characters left readable in that
  // one file, and no `.tsx` file can exhibit it. Benign direction (see the
  // asymmetry above), and no consumer strips a `.ts` file today, but the
  // guarantee this module advertises is worth keeping true.
  // `setParentNodes` is required — `getChildren()` needs them.
  const tsx = !fileName.endsWith(".ts");
  const sf = ts.createSourceFile(
    tsx ? "scan.tsx" : "scan.ts",
    src,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out = src.split("");

  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      // Newlines survive so line numbers do not move.
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
    }
  };

  // ★ Leaf tokens only. Every comment is trivia of exactly one TOKEN — including
  // the very last one, which is why `EndOfFileToken` must be visited too (a
  // trailing comment at end of file hangs off it). Descending to leaves is a
  // SPEED choice, not a correctness one: an inner node's `fullStart` is just its
  // first leaf's, so querying every node blanks the identical bytes — measured
  // at 0 differing characters across `src`. (An earlier revision claimed the
  // narrowing FIXED an 86-character miss. It fixed nothing; taking the trailing
  // ranges below is what did.)
  const visit = (node: ts.Node) => {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      // JSX TEXT IS NOT CODE AND CARRIES NO TRIVIA — see the header. Querying it
      // scans the text itself and blanks real markup that begins `//`.
      if (node.kind === ts.SyntaxKind.JsxText) return;
      // BOTH lists, because they are disjoint and each misses half the file:
      // TypeScript calls a comment that follows code on the SAME line a TRAILING
      // comment of the token before it, and `getLeadingCommentRanges` does not
      // return it. Leading-only left every `x = 1; // …` and every JSX
      // `{/* … */}` readable — 111,108 non-whitespace characters across `src`,
      // measured by running this walk both ways over every file.
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
