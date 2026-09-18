// src/app/office-xml.ts — pure, i18n-free shared helpers for OOXML text extraction.

import { forEachTagPair, type TagPairSpec } from "./tag-pair-walk";

const utf8 = new TextDecoder("utf-8");

/** Decode a byte array as UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Unescape the five predefined XML entities plus numeric (&#NN; / &#xHH;). */
export function unescapeXml(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/**
 * Return the ordered inner text of every `<tag ...>...</tag>` occurrence,
 * XML-unescaped. `\b` after the tag name guards against a prefix collision
 * (`<w:t>` must not match `<w:tbl>`) and `hasAttributes` skips to the open
 * tag's own closing `>` before reading inner text. Self-closing tags and
 * tags with child elements are out of scope — OOXML text tags (w:t/a:t/t) hold
 * pure text.
 *
 * Walked via the shared forEachTagPair cursor (tag-pair-walk.ts) rather than
 * a `[\s\S]*?` lazy pair regex — that shape is quadratic on repetitive
 * unclosed markup (every open re-scans to end of input), and this is a
 * shared primitive three extractors call, so the fix belongs here once
 * rather than at each caller (§558).
 */
export function extractRuns(xml: string, tag: string): string[] {
  const spec: TagPairSpec = { openPattern: `<${tag}\\b`, closeName: () => tag, hasAttributes: true };
  const out: string[] = [];
  forEachTagPair(xml, spec, (pair) => {
    out.push(unescapeXml(pair.inner));
    return true;
  });
  return out;
}
