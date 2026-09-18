// src/app/tag-pair-walk.ts — the shared linear alternative to a lazy
// `<name\b[^>]*>([\s\S]*?)</name\s*>` pair regex, which goes O(n^2) on
// repetitive unclosed markup. Measured and hardened in html-extract.ts;
// this module is that walk, moved so other OOXML extractors can reuse it
// unchanged rather than re-deriving it.

/** A `<name ...>inner</name>` pair located by forEachTagPair. */
export interface TagPair {
  /** Index of the open tag's "<". */
  start: number;
  /** Index just past the close tag's ">". */
  end: number;
  /** The whole pair, open and close tags included. */
  whole: string;
  /** The text between the open tag and the close tag. */
  inner: string;
  /** The open-tag match, for its capture groups. */
  openMatch: RegExpExecArray;
}

/** How to locate one family of pairs. */
export interface TagPairSpec {
  /** Open-tag pattern, compiled "gi" — e.g. `<h([1-6])\b`. */
  openPattern: string;
  /** The close-tag NAME an open match must be closed by — e.g. "h2" for
   *  `<h2 ...>`. Derived from the open match rather than given as a fixed
   *  close pattern because two of the call sites closed on a `\1`
   *  backreference (the heading level, and td-vs-th). */
  closeName: (openMatch: RegExpExecArray) => string;
  /** True for the `<name\b[^>]*>` shape, whose inner text starts after the
   *  open tag's ">"; false for the bare `<name\b` shape, whose inner text
   *  starts immediately (those call sites only read `whole`). */
  hasAttributes: boolean;
  /** When true, an open tag that is ITSELF self-closing (`<name/>` or
   *  `<name attr="..."/>` — detected the same way `hasAttributes` finds the
   *  open tag's own ">") is skipped entirely: `visit` is never called for
   *  it, and the walk moves on to the next open of the same name. Requires
   *  `hasAttributes: true` (the check needs that ">").
   *
   *  Without this flag, a self-closing open is paired with the NEXT
   *  same-named close tag, silently merging real content between them into
   *  this pair's `inner`/`whole` — extractRuns (office-xml.ts) hit exactly
   *  this on `<t/>`: `<si><t/></si><si><t>hello</t></si>` extracted
   *  `["</si><si><t>hello"]` instead of `["hello"]` (§558 fix round 3).
   *
   *  Default (omitted): OFF, preserving every existing call site's
   *  behaviour — html-extract.ts's TABLE/ROW/CELL/HEADING/LIST_ITEM pairs
   *  and docx/pptx/xlsx's own block-level pairs never saw a self-closing
   *  form of their own tag from the ORIGINAL lazy-regex shape they replace
   *  either (that regex shape merges forward on one too, identically to
   *  the un-flagged behaviour here — see forEachTagPair's own note), so
   *  turning this on for them would be a NEW divergence, not a fix. */
  skipSelfClosing?: boolean;
}

/** Walk every `<name ...>...</name>` pair in document order, linearly, calling
 *  `visit` on each; `visit` returns false to stop the walk.
 *
 *  This is the shared replacement for the `<name\b[^>]*>([\s\S]*?)</name\s*>`
 *  pair regex — the O(n^2) shape stripComments and dropTagSubtree above
 *  already avoid, quadratic by two mechanisms at once: an unterminated open
 *  tag makes the lazy `[\s\S]*?` rescan to end of input from every open, and
 *  `[^>]*` on input with no ">" at all backtracks to EOF from every start
 *  position. Five steps of this pipeline went on using it — tables, their
 *  rows, their cells, headings and list items — while the two comments above
 *  explained why it was banned.
 *
 *  Measured at MAX_HTML_INPUT_CHARS, one unit repeated to fill, before ->
 *  after this walk (2026-09-03): "<h1" with no ">" anywhere 27,864 -> 895ms,
 *  "<h1>" 8,871 -> 12ms, "<li>" 3,548 -> 11ms, "<table>" 1,130 -> 8ms, one
 *  <table> of unterminated "<tr" 14,858 -> 7ms, one <table> of unterminated
 *  "<td" 31,418 -> 12ms. Every one of those produced 42 characters of output.
 *  ★ The surviving 895ms is NOT this walk: 815ms of it is the generic
 *  TAG_STRIP_RE pass at the end of extractHtmlMarkdown, bounded (finite, not
 *  cheap) by MAX_TAG_SCAN_CHARS. 500k bare "<" characters, an input that
 *  reaches no pair walk at all, cost 2,511ms on the same machine — that is
 *  the pipeline's floor, and it is what a processing-time test must clear.
 *
 *  Linear because every scan only moves forward: open tags are visited in
 *  increasing order, and one close scanner is kept per close NAME, so a name
 *  whose close is missing is searched for exactly once and then retired. The
 *  name set is bounded per call site (1 for table/tr/li, 2 for td/th, 6 for
 *  h1-h6), so the whole walk is O(n) in the clamped input length.
 *
 *  ★ The unterminated-input fallback here is NOT dropTagSubtree's, and copying
 *  that one would silently delete the rest of the document. A pair regex that
 *  finds no close does not match AT ALL, so an unclosed open tag is left in
 *  place for the later generic TAG_STRIP_RE to remove. */
export function forEachTagPair(html: string, spec: TagPairSpec, visit: (pair: TagPair) => boolean): void {
  const openRe = new RegExp(spec.openPattern, "gi");
  // null = this name has already been shown to have no close left anywhere in
  // the input, so no open of the same name further right can match either.
  const closers = new Map<string, RegExp | null>();
  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(html)) !== null) {
    const name = spec.closeName(openMatch);
    let closeRe = closers.get(name);
    if (closeRe === undefined) {
      closeRe = new RegExp("</" + name + "\\s*>", "gi");
      closers.set(name, closeRe);
    }
    // ★ Before the attribute scan below, not after. That scan can run to end
    // of input, and a retired name would otherwise pay for it again at every
    // remaining open tag — which is the same O(n^2) this walk exists to
    // remove (measured: a <table> full of unterminated "<td" spent 994ms
    // here with the two swapped, against 9ms in this order).
    if (closeRe === null) continue;
    let innerStart = openRe.lastIndex;
    if (spec.hasAttributes) {
      const gt = html.indexOf(">", innerStart);
      // `[^>]*>` cannot match here, nor at any open further right.
      if (gt === -1) return;
      // ★ Checked BEFORE touching `closers` — a self-closing instance says
      // nothing about whether OTHER opens of this name have a real close
      // elsewhere (`<t/><t>real</t>` still needs the second one paired
      // normally), so this must never retire `name`. No caching needed
      // either: each self-close's own ">" is necessarily near ITS OWN start
      // (bounded by that one tag's attribute length), so this scan can't
      // reintroduce the O(n^2) shape forEachXmlElement's cache exists for —
      // and a name with no ">" anywhere still aborts via the `gt === -1`
      // check above on the very first attempt, before any of this runs.
      if (spec.skipSelfClosing && html[gt - 1] === "/") {
        openRe.lastIndex = gt + 1;
        continue;
      }
      innerStart = gt + 1;
    }
    closeRe.lastIndex = innerStart;
    const closeMatch = closeRe.exec(html);
    if (closeMatch === null) {
      closers.set(name, null);
      continue;
    }
    const end = closeMatch.index + closeMatch[0].length;
    const keepGoing = visit({
      start: openMatch.index,
      end,
      whole: html.slice(openMatch.index, end),
      inner: html.slice(innerStart, closeMatch.index),
      openMatch,
    });
    if (!keepGoing) return;
    openRe.lastIndex = end;
  }
}

/** forEachTagPair with each pair replaced by `render`'s output — what
 *  String.replace did with the pair regex, minus the backtracking. */
export function replaceTagPairs(html: string, spec: TagPairSpec, render: (pair: TagPair) => string): string {
  let out = "";
  let cursor = 0;
  forEachTagPair(html, spec, (pair) => {
    out += html.slice(cursor, pair.start) + render(pair);
    cursor = pair.end;
    return true;
  });
  return out + html.slice(cursor);
}
