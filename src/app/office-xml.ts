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
 * XML-unescaped. `hasAttributes` skips to the open tag's own closing `>`
 * before reading inner text. A self-closing `<tag/>` or `<tag attr="..."/>`
 * is SKIPPED — it produces no entry in the returned array — never matched
 * as a pair with a later close tag. Tags with child elements are out of
 * scope — OOXML text tags (w:t/a:t/t) hold pure text.
 *
 * Walked via the shared forEachTagPair cursor (tag-pair-walk.ts) rather than
 * a `[\s\S]*?` lazy pair regex — that shape is quadratic on repetitive
 * unclosed markup (every open re-scans to end of input), and this is a
 * shared primitive three extractors call, so the fix belongs here once
 * rather than at each caller (§558).
 *
 * ★★★ `skipSelfClosing: true` is REQUIRED here and is not decorative. The
 * ORIGINAL lazy regex this replaced, `<tag(?:\s[^>]*)?>([\s\S]*?)</tag>`,
 * did not match a bare self-closing `<tag/>` at all (its optional-attribute
 * group only fires after a LEADING WHITESPACE, and a bare "/" satisfies
 * neither that nor the immediate-">" path), so callers never saw an entry
 * for one. Porting to forEachTagPair WITHOUT this flag regressed that: the
 * walk paired the self-closing open with the NEXT same-named close tag
 * instead, silently injecting raw XML markup into extracted text —
 * `<si><t/></si><si><t>hello</t></si>` yielded `["</si><si><t>hello"]`
 * instead of `["hello"]`. Fixed in fix round 3 of §558. The SAME check also
 * closes a bug the old regex already had for the ATTRIBUTE form
 * (`<t xml:space="preserve"/>` merged forward identically, pre-dating this
 * whole slice) — one fix, two bugs, only one of which was a regression.
 *
 * ★★★ The open pattern is `(?=[\s/>])`, a lookahead, NOT `\b` — `\b` is a
 * SECOND regression of the same shape as the one above, found in the same
 * review round. `\b` admits ANY non-word character after the tag name, not
 * just whitespace/"/"/">", so `<t-alt>decoy</t-alt><t>real</t>` matched
 * `<t-alt` as if it were `<t ...>` (boundary fires between "t" and "-") and
 * merged forward into `<t>real</t>` exactly like the self-closing bug did:
 * `["decoy</t-alt><t>real"]` instead of `["real"]`. The ORIGINAL regex never
 * had this hole — `(?:\s[^>]*)?>` only ever consumes from a LEADING
 * whitespace or an immediate ">", so `-` right after the tag name always
 * failed it outright. The lookahead restores that exact boundary (plus "/"
 * for the self-closing detection above to see) without reintroducing `\b`'s
 * over-admission. This is scoped to extractRuns alone: every other
 * TagPairSpec in this codebase already used `\b` in the ORIGINAL regex it
 * replaced (docx/pptx/xlsx/html's own comments all quote a `<name\b...`
 * shape), so `\b` there is faithful porting, not a second instance of this
 * bug — extractRuns's original shape was the one exception.
 */
export function extractRuns(xml: string, tag: string): string[] {
  const spec: TagPairSpec = {
    openPattern: `<${tag}(?=[\\s/>])`,
    closeName: () => tag,
    hasAttributes: true,
    skipSelfClosing: true,
  };
  const out: string[] = [];
  forEachTagPair(xml, spec, (pair) => {
    out.push(unescapeXml(pair.inner));
    return true;
  });
  return out;
}
