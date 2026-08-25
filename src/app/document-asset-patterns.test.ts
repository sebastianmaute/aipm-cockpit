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
import { ANY_TAG_ASSET_ID_RE, IMG_TAG_RE, ASSET_IMG_TEST_RE } from "./document-asset-patterns";

const ids = (re: RegExp, html: string): string[] => Array.from(html.matchAll(re), (m) => m[1]);

/** [input, what the cap counts, what an export can draw, does the block survive load] */
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
  // so it counts; IMG_TAG_RE anchors on a literal lower-case `<img`.
  ['<IMG data-asset-id="up">', ["up"], [], true],
  // Empty value: both extractors CAPTURE it (their callers filter empties), and
  // the load predicate rejects it — an empty id renders nothing anywhere.
  ['<img data-asset-id="">', [""], [""], false],
];

/** Every statement that names another module: static and type-only imports,
 *  `export … from` in all its spellings, `import(…)`, `require(…)` and
 *  `import x = require(…)`.
 *
 *  ★★★ THE PARSER, NOT A REGEX, AND THAT IS NOT FASTIDIOUSNESS. Measured over
 *   fourteen spellings: a regex covering `import` plus a re-export alternation
 *   still missed `export * as N from` and `export type {…} from`, and no regex
 *   can tell a module specifier from the same text inside a string literal.
 *   The parser answered all fourteen correctly, that last one included. */
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

describe("document-asset-patterns", () => {
  describe("the divergence table", () => {
    for (const [html, anyTagIds, imgIds, survivesLoad] of TABLE) {
      it("agrees with the measured answers for " + JSON.stringify(html), () => {
        expect(ids(ANY_TAG_ASSET_ID_RE, html)).toEqual(anyTagIds);
        expect(ids(IMG_TAG_RE, html)).toEqual(imgIds);
        expect(ASSET_IMG_TEST_RE.test(html)).toBe(survivesLoad);
      });
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
      expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
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
