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
 * ★★★ The open pattern is `(?=[\s>]|/>)`, a lookahead, NOT `\b` — `\b` is a
 * SECOND regression of the same shape as the one above, found in the same
 * review round. `\b` admits ANY non-word character after the tag name, not
 * just this lookahead's own alternatives — whitespace, an immediate ">", or
 * the two-character "/>" (a bare "/" alone is NOT admitted, see M-3 below) —
 * so `<t-alt>decoy</t-alt><t>real</t>` matched
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
 *
 * ★★★ M-3 (final-release-review.md): a THIRD regression, same shape again,
 * found in the pre-release review. The lookahead above used to be
 * `(?=[\s/>])` — admitting a bare "/" right after the tag name whether or
 * not it was actually followed by ">". `<a:t/a:r><a:r><a:t>t2</a:t>` (only
 * reachable on malformed input, per the review's fuzz) has `<a:t/` satisfy
 * that lookahead; the first ">" it then finds is the one that closes the
 * malformed `<a:t/a:r>` tag itself — it is preceded by "r", not "/" (it does
 * NOT belong to `<a:r>`) — so the tag-pair-walk's self-close check
 * (`html[gt-1] === "/"`, see the note above) does NOT fire, and `<a:t/a:r>`
 * is treated as an ordinary open, pairing with the far-away `</a:t>` and
 * merging `<a:r><a:t>t2` — raw markup — into the extracted text. The fix
 * splits the lookahead into two alternatives: `[\s>]` (unchanged — an
 * ordinary open, whitespace or an immediate ">") and the literal `/>` (a
 * bare "/" is now admitted ONLY when it is immediately followed by ">", i.e.
 * only for a real self-close). A lone "/" not followed by ">" now fails the
 * lookahead outright, so the malformed tag is skipped rather than merged
 * forward.
 *
 * ★ A separate divergence from the original regex — not part of the THIRD
 * regression's count above, a different axis (quote-awareness, not the
 * open-tag boundary) — found in the round-4 re-review, not fixed (both
 * behaviours are wrong, so there is nothing to
 * restore): `html[gt - 1] === "/"` (tag-pair-walk.ts) reads whatever
 * character sits right before the FIRST ">", with no awareness of
 * quoting. `<w:t a="x/>y">text</w:t>` has a literal ">" inside a quoted
 * attribute value — legal XML (AttValue excludes only "<", "&", and the
 * quote character, not ">") — so the real tag-closing ">" is the SECOND
 * one, not the first. This walk finds the first ">" (inside the quotes),
 * sees a "/" immediately before it, and misreads the whole tag as
 * self-closing — skipping it (no entry) where the original regex's same
 * first-">"-wins greediness instead yielded `y">text` as a run. Different
 * wrong answers, same root cause (neither this walk nor the regex it
 * replaces is attribute-quote-aware), pre-dating this whole slice.
 */
export function extractRuns(xml: string, tag: string): string[] {
  const spec: TagPairSpec = {
    openPattern: `<${tag}(?=[\\s>]|/>)`,
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
