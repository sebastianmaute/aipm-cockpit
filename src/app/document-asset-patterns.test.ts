// src/app/document-asset-patterns.test.ts — the divergence table for the three
// data-asset-id patterns, plus the source scans that keep the module's contract
// honest.
//
// ★★ The table is the point: every row asserts ALL THREE patterns against the
// SAME input, so anyone changing one of them sees, in one place, what the other
// two do with it. Three files apart, nothing kept them in step (§209/§218).
//
// ★ Every expectation here was DERIVED by running the patterns, not copied from
// a brief or a docstring. A row that surprises you is a fact about the pattern,
// not a typo.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { stripComments } from "../test/strip-comments";
import * as PATTERNS from "./document-asset-patterns";
import {
  ANY_TAG_ASSET_ID_RE,
  IMG_TAG_ASSET_ID_RE,
  ASSET_IMG_TEST_RE,
  ASSET_IMG_TAG_RE,
} from "./document-asset-patterns";

const ids = (re: RegExp, html: string): string[] => Array.from(html.matchAll(re), (m) => m[1]);

/** [input, what the cap counts, what an export can draw, does the LOAD PREDICATE see an image]
 *
 *  ★★ The fourth column is `ASSET_IMG_TEST_RE.test(html)` and NOTHING MORE. It
 *   is ONE of the two terms of `sanitizeBlock`'s drop condition, so a `false`
 *   here does NOT mean the block is dropped — `htmlTextLength(html) === 0` has
 *   to hold as well. This column used to be called "does the block survive
 *   load", which read as an end-to-end claim it never made, and that wording
 *   helped hide a real block-deletion bug: the row below with a `>` inside an
 *   attribute asserted `false` and was described as harmless, while for
 *   neighbouring shapes the same `false` was deleting user content. Whole-guard
 *   behaviour is pinned in `document-model.test.ts`, against the real
 *   `sanitizeProjectDocuments`. */
const TABLE: ReadonlyArray<readonly [string, string[], string[], boolean]> = [
  // The ordinary case — all three agree.
  ['<img data-asset-id="a">', ["a"], ["a"], true],
  // A reference the sanitizer kept on a NON-img element: spends a cap slot,
  // draws nothing, and cannot keep an otherwise-empty paragraph alive.
  ['<span data-asset-id="s"></span>', ["s"], [], false],
  // Typed prose. No start tag carries the attribute, so nothing counts it.
  ['<p>data-asset-id="abc"</p>', [], [], false],
  // The crafted alt: the quote-aware alternation consumes alt="…" whole, so it
  // cannot supply an opening quote and the REAL id is the one that surfaces.
  ['<img alt="data-asset-id=" data-asset-id="real">', ["real"], ["real"], true],
  // Single-quoted: only the load predicate accepts it. The two extractors are
  // double-quote-only because they run on DOMPurify-normalised html.
  ["<img data-asset-id='sq'>", [], [], true],
  // All-caps ATTRIBUTE name: only the case-INSENSITIVE load predicate sees it.
  ['<IMG DATA-ASSET-ID="d">', [], [], true],
  // Caps TAG name with a lower-case attribute: the cap counter is tag-agnostic
  // so it counts; IMG_TAG_ASSET_ID_RE anchors on a literal lower-case `<img`.
  ['<IMG data-asset-id="up">', ["up"], [], true],
  // Empty value: both extractors CAPTURE it (their callers filter empties), and
  // the load predicate rejects it — an empty id renders nothing anywhere.
  ['<img data-asset-id="">', [""], [""], false],
  // A `>` INSIDE an attribute value — reachable from the product's own rename
  // control, since the serialiser does not re-escape it there. All three step
  // over it. The predicate used to answer `false` here (an unguarded `[^>]*`
  // stopped at that `>`), which deleted real image blocks on load for the
  // sibling shape below; it is quote-aware as of 0.259.2.
  ['<img alt="a>b" data-asset-id="real">', ["real"], ["real"], true],
  // ★★★ THE SHAPE THAT WAS BEING DELETED. Same defect as the row above, but the
  // text after the `>` is itself tag-like, so htmlPlainProjection ate the
  // remainder too and BOTH terms of the drop condition went false. A genuine
  // <img> with a genuine id vanished on load. See the end-to-end test in
  // document-model.test.ts — this row alone would not have caught it.
  ['<img alt="><c d" data-asset-id="real">', ["real"], ["real"], true],
  // ★★★ THE LAZY/GREEDY DIVERGENCE, and the reason `drawable ⊄ all`. The cap
  // counter is LAZY and reports the FIRST id on a tag; the export extractor is
  // GREEDY and backtracks to the LAST. Not reachable through a full load (the
  // parser collapses a duplicated attribute), so this pins raw-html behaviour.
  // ★★ It lives HERE because this is the only file that reads the two patterns
  // against each other. It was previously pinned only in
  // document-asset-usage.test.ts, at the CALLER level, while both this file's
  // header and open-followups §209 claimed the table gated it.
  ['<img data-asset-id="a" data-asset-id="b">', ["a"], ["b"], true],
  // ★★★ THE TAG-NAME CLASS. `<a"b` is not a tag name, so nothing may match.
  // This row is why the class is a POSITIVE `[a-zA-Z0-9-]*` rather than a
  // negated one: widen it to `[^\s/>]*` and the name eats `a"b`, the attribute
  // is reached, and every assertion below turns non-empty. That mutant used to
  // survive the whole suite — the ReDoS guard it deletes had no test at all.
  ['<a"b data-asset-id="q">', [], [], false],
  // ★★ HYPHEN-PREFIXED DECOY. `\b` matches between `-` and `d`, so a `\b`
  // spelling accepted `foo-data-asset-id` — and because the cap counter is
  // LAZY, the decoy WON over the real attribute later in the same tag: the id
  // that actually counts went missing and a bogus one took its place. The
  // lookbehind `(?<![-\w])` is what rejects it.
  ['<img foo-data-asset-id="s" data-asset-id="real">', ["real"], ["real"], true],
  // ★★ A decoy in the ALT with no real reference anywhere, and the ONE row
  // where the predicate is deliberately WIDER than the two extractors. Branch 1
  // of the union is the un-quote-aware `[^>]*`, which matches the decoy inside
  // the quoted value, so the predicate answers `true` and an otherwise-empty
  // paragraph is KEPT — as a source-less image, which is what the html already
  // said. That is the false-TRUE direction, and it is the safe one: this
  // predicate guards a DELETION, so over-keeping costs a stray empty image and
  // under-keeping destroys user content. A single quote-aware regex answers
  // `false` here, and the same narrowing cost four real blocks (below).
  // Both extractors correctly report nothing, so it spends no cap slot and no
  // export fetch.
  ['<img alt="data-asset-id=x">', [], [], true],
  // ★★★ THE FOUR SHAPES A NARROWED PREDICATE DELETED ON LOAD. Each carries a
  // REAL `data-asset-id` — confirmed by running it through an actual HTML
  // parser, not by reading the spec — because the tokenizer RECOVERS from the
  // malformation and reconsumes in before-attribute-name state. The pre-fix
  // predicate kept all four; a `[\s/]`-anchored, quote-aware, `<`-excluding one
  // dropped all four, silently, on every load. See open-followups §250.
  //
  // Missing separator after a double-quoted value: `missing-whitespace-between-
  // attributes`. Both extractors recover it too, via the same lookbehind —
  // under `[\s/]` they returned NOTHING, so the cap undercounted and the export
  // could not draw the image either.
  ['<img alt="x"data-asset-id="real">', ["real"], ["real"], true],
  // The same, after a single-quoted value.
  ["<img alt='x'data-asset-id=\"real\">", ["real"], ["real"], true],
  // An UNPAIRED quote inside an unquoted attribute value. Quote-awareness alone
  // flips this one — branch 3 of the alternation waits for a closing `'` that
  // never comes — which is why "quote-awareness can only keep more blocks" was
  // false. Union branch 1 recovers it for the predicate.
  ["<img alt=it's data-asset-id=\"real\">", [], [], true],
  // ★★★ THE ONE REAL ATTRIBUTE NOTHING HERE RECOVERS, AND IT IS A DELIBERATE
  // TRADE. A `<` inside an unquoted attribute value is a genuine attribute to a
  // parser, but no pattern in this module may scan past a `<`: doing so lets
  // every `<img` in the input restart a scan over the whole tail, which is
  // quadratic on hostile input that reaches the predicate unbounded and
  // uncapped on every load. A union branch spelled `[^>]*` DID recover this
  // shape and was measured slower than the pattern it replaced. The block is
  // dropped; the freeze was judged worse. Reaching it needs raw stored html —
  // DOMPurify quotes the value. See ASSET_IMG_TEST_RE's docstring.
  ['<img alt=a<b data-asset-id="real">', ["real"], [], false],
  // ★★★ THE MIRROR OF THE ROW ABOVE, AND IT DIVERGES THE OTHER WAY. With the
  // bare `<` AFTER the target attribute the predicate says KEEP and the cap
  // COUNTS the id, but the export still cannot draw it: `IMG_TAG_ASSET_ID_RE`
  // needs a closing `>` reachable without crossing a `<`, and there is none.
  // So the loader keeps a paragraph, `assetRefsInDocument().all` charges it
  // against the 20-image cap, and every renderer emits nothing for it.
  // ★★ Only the BEFORE case was documented, in this table and in the module —
  // which read as though a bare `<` always cost the block. It does not; which
  // side of the attribute it falls on decides which consumer loses. Neither
  // direction is fixable without scanning past `<`, so this is a
  // characterization, not a defect to close.
  ['<img data-asset-id="real" alt=a<b>', ["real"], [], true],
];

/** Every statement that names another module: static and type-only imports,
 *  `export … from` in all its spellings, `import(…)`, `require(…)` and
 *  `import x = require(…)`.
 *
 *  ★★★ THE PARSER, NOT A REGEX. The easy shapes to miss are `export * as N
 *   from` and `export type {…} from`; the easy one to over-match is a module
 *   specifier sitting inside a STRING, which is not an edge. Every one of the
 *   three is pinned by the test below. */
function moduleEdges(src: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      found.push(node.getText(sf));
    } else if (ts.isImportEqualsDeclaration(node)) {
      found.push(node.getText(sf));
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      found.push(node.getText(sf));
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return found;
}

/** Browser-only globals and types. A DOM-free module may not name any of them.
 *
 *  ★ `globalThis` is deliberately ABSENT: it is legal in node and naming it is
 *   not itself a DOM touch — `globalThis.document` is caught by `document`. */
const DOM_NAMES = new Set([
  "document",
  "window",
  "navigator",
  "location",
  "DOMPurify",
  "DOMParser",
  "XMLSerializer",
  "HTMLElement",
  "Element",
  "Node",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "getComputedStyle",
]);

/** Every identifier in `src` naming a browser global — including one used as a
 *  property (`globalThis.document`), an element-access string
 *  (`document["createElement"]`) or an alias source (`const d = document`).
 *
 *  ★★ IDENTIFIERS AND STRING LITERALS IN ELEMENT ACCESS ONLY. A DOM name inside
 *   an ordinary string is NOT a reference — a comment or a message may say
 *   "document" — so ordinary string literals are skipped and the two control
 *   cases in the test below pin that. */
function domReferences(src: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && DOM_NAMES.has(node.text)) {
      found.push(node.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      DOM_NAMES.has(node.argumentExpression.text)
    ) {
      found.push(node.argumentExpression.text);
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return found;
}

describe("document-asset-patterns", () => {
  describe("the divergence table", () => {
    for (const [html, anyTagIds, imgIds, survivesLoad] of TABLE) {
      it("agrees with the measured answers for " + JSON.stringify(html), () => {
        expect(ids(ANY_TAG_ASSET_ID_RE, html)).toEqual(anyTagIds);
        expect(ids(IMG_TAG_ASSET_ID_RE, html)).toEqual(imgIds);
        expect(ASSET_IMG_TEST_RE.test(html)).toBe(survivesLoad);
      });
    }
  });

  // ★★★ THE INVARIANT THAT BROKE IN 0.262.2, ASSERTED OVER THE SAME CORPUS.
  // `ASSET_IMG_TAG_RE` is what `degradeToPlain` uses to carry images across an
  // overflow, and `IMG_TAG_ASSET_ID_RE` is what the three renderers use to draw
  // them. So the degrade must recognise EVERY tag the export can draw, or the
  // overflow path deletes an image the user can see — which is exactly what
  // shipped: the degrade's matcher was private to `rich-text-plain.ts`, was not
  // quote-aware, and dropped `<img title="Q1 > Q2" data-asset-id="real">`.
  //
  // ★★ THIS IS A CONTAINMENT ASSERTION, NOT AN EQUALITY ONE, and the direction
  // is the whole point. The reverse does NOT hold and must not be asserted:
  // `ASSET_IMG_TAG_RE` deliberately also carries single-quoted, unquoted,
  // spaced-`=` and uppercase ids that the export pattern returns nothing for.
  // Collapsing the two was proposed during review; it would trade three silent
  // drops for four. They are incomparable, not nested.
  describe("the degrade carries every image the LOAD kept", () => {
    // ★★★ THE REFERENCE IS THE LOAD PREDICATE, NOT THE EXPORT PATTERN, AND THE
    // FIRST CUT GOT THIS WRONG. It iterated rows with a non-empty EXPORT id and
    // skipped the rest, on the reasoning that a tag no export can draw is not
    // worth carrying. That reasoning is false: on-screen rendering uses
    // `querySelectorAll("img[data-asset-id]")` — the BROWSER PARSER — so
    // `<img alt=it's data-asset-id="real">`, which every regex here reads as
    // having no id, is painted for the user like any other image. Its corpus row
    // has an empty export column, so the first cut SKIPPED the one row that
    // would have caught the loss it was written to prevent.
    // ★★ `survivesLoad` is the right column because it is what decides whether
    // the block reaches the screen at all. If the load keeps it, the degrade
    // must not delete its image.
    // ★★★ ONE ROW IS A KNOWN, PRE-EXISTING GAP AND IS ASSERTED AS A SET RATHER
    // THAN SKIPPED. `<img data-asset-id="real" alt=a<b>` carries a bare `<` in
    // an UNQUOTED value; both branches' guards require a `>` before any `<`, so
    // neither can match it, and the pre-0.262.2 pattern could not either — it is
    // not a regression. It IS a real loss: the browser recovers that markup and
    // paints the image, so an overflow deletes a picture the user can see.
    // Closing it needs a guard that scans past `<`, which is the quadratic this
    // whole slice exists to remove — so it is accepted, not repaired.
    // ★★ Written as an exact set, never a `continue`: a skip makes the exemption
    // invisible and lets it grow silently. If another row joins this list, that
    // is a new loss and this test says so by name.
    const KNOWN_UNMATCHABLE = ['<img data-asset-id="real" alt=a<b>'];

    it("matches every load-kept row except the documented bare-`<` gap", () => {
      const missed: string[] = [];
      for (const [html, , , survivesLoad] of TABLE) {
        if (!survivesLoad) continue;
        ASSET_IMG_TAG_RE.lastIndex = 0;
        if ((html.match(ASSET_IMG_TAG_RE)?.length ?? 0) === 0) missed.push(html);
      }
      expect(missed).toEqual(KNOWN_UNMATCHABLE);
    });

    // ★★ ANTI-VACUITY: the loop above proves nothing if no row is load-kept.
    it("actually exercises the load-kept rows", () => {
      expect(TABLE.filter(([, , , keeps]) => keeps).length).toBeGreaterThan(5);
    });
  });

  // ★★ MULTIPLICITY, separately. The containment loop above asserts "at least
  // one", which would pass on a row holding two tags where only the first
  // matched. No corpus row carries two today, so this is the pin for that.
  it("carries EVERY tag in a row, not just the first", () => {
    const two = '<img alt="a>b" data-asset-id="one"><img alt=it\'s data-asset-id="two">';
    ASSET_IMG_TAG_RE.lastIndex = 0;
    // One from each branch of the union: the first needs quote-awareness, the
    // second needs its absence.
    expect(two.match(ASSET_IMG_TAG_RE)?.length ?? 0).toBe(2);
  });

  // ★★★ THE SUPERSET PROPERTY, PINNED. Branch 2 of the union IS the pre-0.262.2
  // private pattern, so this matcher cannot lose a tag that used to be carried.
  // A first cut shipped branch 1 alone and silently dropped four shapes; this is
  // what makes that unrepeatable.
  it("never matches less than the non-quote-aware branch alone", () => {
    const BRANCH_2_ONLY =
      /<img\b(?=[^<>]*>)[^<>]*(?<![-\w])data-asset-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*)[^<>]*>/gi;
    for (const [html] of TABLE) {
      BRANCH_2_ONLY.lastIndex = 0;
      ASSET_IMG_TAG_RE.lastIndex = 0;
      const old = html.match(BRANCH_2_ONLY)?.length ?? 0;
      const now = html.match(ASSET_IMG_TAG_RE)?.length ?? 0;
      expect(now).toBeGreaterThanOrEqual(old);
    }
  });

  it("carries the quoting and case variants the export pattern cannot read", () => {
    // ★ These four are the reason this is a fourth pattern rather than a reuse.
    // Each returns NOTHING from IMG_TAG_ASSET_ID_RE (it requires a
    // double-quoted id and is /g, not /gi) and must still survive a degrade.
    for (const html of [
      "<img data-asset-id='a8'>",
      "<img data-asset-id=a9>",
      '<img data-asset-id = "a10">',
      '<IMG DATA-ASSET-ID="a11">',
    ]) {
      expect(ids(IMG_TAG_ASSET_ID_RE, html)).toEqual([]);
      ASSET_IMG_TAG_RE.lastIndex = 0;
      expect(html.match(ASSET_IMG_TAG_RE)?.length ?? 0).toBe(1);
    }
  });

  it("keeps ASSET_IMG_TEST_RE non-global so repeated .test() calls agree", () => {
    // ★★ A /g here would carry lastIndex between calls and drop every OTHER
    // image-only paragraph in a document — a load-time data loss that only
    // shows up on the second image. Two identical calls is the whole guard.
    const html = '<img data-asset-id="a">';
    expect(ASSET_IMG_TEST_RE.test(html)).toBe(true);
    expect(ASSET_IMG_TEST_RE.test(html)).toBe(true);
    expect(ASSET_IMG_TEST_RE.global).toBe(false);
  });

  describe("the module's own contract", () => {
    // ★ cwd-relative, NOT `new URL(..., import.meta.url)` — under vitest
    // `import.meta.url` is not a file: URL, so readFileSync throws
    // "The URL must be of scheme file".
    const PATH = "src/app/document-asset-patterns.ts";
    const src = readFileSync(PATH, "utf8");
    // ★★★ THE SHARED PARSER-BACKED STRIPPER, NEVER A LOCAL REGEX PAIR. The
    // obvious `replace(/\/\*[\s\S]*?\*\//g, "")` treats a slash followed by a
    // star as a comment opener WHEREVER it appears — including inside a regex
    // literal, which is all this module contains. Measured on a three-line
    // fixture: a `/<br\s*\/*>/` opened a phantom comment that a later
    // `/<\/[^>]*/` closed, a real `document.createElement` between them was
    // blanked, and the DOM scan below PASSED over it. Over-blank is the
    // dangerous direction, and it is silent.
    const codeOnly = stripComments(src, PATH);
    const exported = Object.entries(PATTERNS);

    it("leaves every pattern BODY readable after stripping", () => {
      // ★★★ THE ANTI-VACUITY GUARD FOR BOTH SCANS BELOW, anchored on the regex
      // SOURCES rather than on the declaration names on purpose: the names sit
      // on their own lines above the bodies, so a stripper that ate only the
      // bodies would leave a name-based check green while gutting what the
      // scans read. Self-maintaining — a new exported pattern is covered the
      // moment it is exported, with no list to keep in step.
      expect(exported.length).toBeGreaterThan(0);
      for (const [name, value] of exported) {
        expect(value, `${name} should be a RegExp`).toBeInstanceOf(RegExp);
        expect(codeOnly).toContain((value as RegExp).source);
      }
      // A stripper that ate a whole declaration goes red here.
      expect((codeOnly.match(/export const /g) ?? []).length).toBe(exported.length);
      // And one that stripped NOTHING goes red here: the header names DOMPurify
      // in prose, so the DOM scan below would otherwise be reading a comment.
      expect(src).toMatch(/DOMPurify/);
      expect(codeOnly).not.toMatch(/DOMPurify/);
    });

    it("does not touch the DOM", () => {
      // Guard: document-model.ts — DOM-free by contract, and the validator every
      // load path routes through — depends on this module, so a DOM reference
      // here breaks bare-node use (the sample generator).
      //
      // ★★★ IDENTIFIERS FROM THE PARSER, NOT A REGEX. This was
      // `/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./`, which fired only
      // on a literal `document.`, a bare `window`, and DOMPurify by name. A
      // cold review measured what it MISSED: `new DOMParser()`, `XMLSerializer`,
      // `navigator.*`, `location.*`, `HTMLElement`, `document?.createElement`,
      // `globalThis.document`, `document["createElement"]`, and any aliasing
      // (`const d = document; d.createElement(…)`). A `DOMParser` reference —
      // precisely what breaks the bare-node generator this guard exists to
      // protect — shipped green. Its sibling `moduleEdges` guard was already
      // parser-backed; the two read as peers and were not.
      expect(domReferences(src, PATH)).toEqual([]);
    });

    it("detects every shape of DOM reference", () => {
      // ★ Non-vacuity for the scan above, per SHAPE. Without this the guard
      // could be silently narrowed back to a regex and still report green — the
      // exact failure it was just widened to fix. The last two are the control:
      // a DOM name inside a STRING or as an unrelated local is not a reference,
      // and a scan flagging them would go red on innocent code.
      for (const shape of [
        "const d = document;",
        "document.createElement('p');",
        "document?.createElement('p');",
        'document["createElement"]("p");',
        "globalThis.document.title;",
        "new DOMParser().parseFromString(s, 'text/html');",
        "new XMLSerializer().serializeToString(n);",
        "navigator.clipboard.readText();",
        "location.href;",
        "const e: HTMLElement = x;",
        "window.setTimeout(f, 0);",
        "DOMPurify.sanitize(s);",
      ]) {
        expect(domReferences(shape, "probe.ts")).not.toEqual([]);
      }
      expect(domReferences('const s = "document.createElement";', "probe.ts")).toEqual([]);
      expect(domReferences("const documentTitle = 1;", "probe.ts")).toEqual([]);
    });

    it("names no other module at all", () => {
      // Guard: any module edge here could grow the settings-types -> workspace
      // -> document-model cycle (open-followups §92). A re-export counts — it
      // is a real edge, it is the shape used one file over in
      // document-export-assets.ts, and a regex-based guard missed it.
      expect(moduleEdges(src, PATH)).toEqual([]);
    });

    it("detects every shape of module edge", () => {
      // ★ Non-vacuity for the scan above, per SHAPE rather than per regex: each
      // of these is a way to add a dependency and the guard must see all of
      // them. The last two are the control — a specifier inside a STRING and a
      // local-only export are not edges, and a scan flagging them would go red
      // on innocent code.
      for (const edge of [
        'import { X } from "./y";',
        'import X from "./y";',
        'import "./y";',
        'import type { T } from "./y";',
        'export { X } from "./y";',
        'export * from "./y";',
        'export * as N from "./y";',
        'export type { T } from "./y";',
        'const p = import("./y");',
        'const y = require("./y");',
        "import T = require('./y');",
      ]) {
        expect(moduleEdges(edge, PATH), edge).toHaveLength(1);
      }
      expect(moduleEdges("const s = \"import { X } from './y'\";", PATH)).toEqual([]);
      expect(moduleEdges("export const Z = 1;", PATH)).toEqual([]);
    });
  });
});
