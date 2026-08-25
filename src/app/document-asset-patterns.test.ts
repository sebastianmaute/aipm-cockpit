// src/app/document-asset-patterns.test.ts — the divergence table for the three
// data-asset-id patterns, plus the two source scans that keep the module's
// contract honest.
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
import {
  ANY_TAG_ASSET_ID_RE,
  IMG_TAG_RE,
  ASSET_IMG_TEST_RE,
} from "./document-asset-patterns";

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
    // "The URL must be of scheme file". Same shape as document-model.test.ts's
    // "does not touch the DOM" scan, which reads ONE path — so moving a pattern
    // out of that file drops it from that guard silently. This is the
    // replacement coverage.
    const src = readFileSync("src/app/document-asset-patterns.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    it("strips comments without stripping the code", () => {
      // ★★★ THE ANTI-VACUITY GUARD FOR BOTH SCANS BELOW. A stripper that ate
      // the whole file would make them pass while checking nothing, and a
      // stripper that ate nothing would make them fail on the header's own
      // prose. Both directions are pinned here: the raw source DOES name
      // DOMPurify (in a comment), the stripped source does NOT, and all three
      // declarations survive.
      expect(src).toMatch(/DOMPurify/);
      expect(codeOnly).not.toMatch(/DOMPurify/);
      expect(codeOnly).toMatch(/export const ANY_TAG_ASSET_ID_RE\b/);
      expect(codeOnly).toMatch(/export const IMG_TAG_RE\b/);
      expect(codeOnly).toMatch(/export const ASSET_IMG_TEST_RE\b/);
    });

    it("does not touch the DOM", () => {
      // Guard: document-model.ts — DOM-free by contract, and the validator every
      // load path routes through — depends on this module, so a DOM reference
      // here breaks bare-node use (the sample generator).
      expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
    });

    it("imports nothing", () => {
      // Guard: an import here could grow the settings-types -> workspace ->
      // document-model cycle (open-followups §92).
      const IMPORT = /(^|\n)\s*import[\s{]/;
      expect(codeOnly).not.toMatch(IMPORT);
      // ★ Non-vacuity: the detector fires on a real import statement.
      expect('import { X } from "./y";\n' + codeOnly).toMatch(IMPORT);
    });
  });
});
