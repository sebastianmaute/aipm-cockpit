// src/app/html-extract.ts — hostile HTML -> Markdown, for AI ingestion.
//
// ★★ DELIBERATELY NOT `htmlPlainProjection` (rich-text-plain.ts). That helper is
// genuinely DOM-free and would mostly work, but it imports sanitize-html.ts,
// which pulls DOMPurify into the module graph and costs this extractor family
// its zero-import purity. It is also a different job: that one projects
// ALREADY-SANITIZED rich text, this one strips a hostile web page. Sharing
// would couple two things that only look alike.
//
// ★ Output is model-facing only. It is never rendered as HTML anywhere, so this
// module is an EXTRACTOR, not a sanitizer — do not cite it as an XSS boundary.
// ★★ The subtree-drop guarantee (script/style/nav/... removed) covers LITERAL
// markup only. Entity-encoded markup that a browser would have shown as
// on-page TEXT (`&lt;script&gt;alert(1)&lt;/script&gt;`) is reproduced as text
// here too — that is faithful extraction of what a human reader saw, not a
// leak, and is deliberate. Callers must still not treat the resulting
// Markdown's STRUCTURE (headings, tables, lists) as trusted: this module
// defends against catastrophic cost and outright injection of forged
// structure, not against every possible reconstruction.

/** Elements whose entire subtree is noise for a reader. */
const DROP_SUBTREE = ["script", "style", "head", "nav", "footer", "aside", "noscript", "svg"];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•", copy: "©",
};

/** Hostile input on this path can be arbitrarily large; clamp before any O(n)
 *  or worse work begins. 500k chars is comfortably above any real ingested
 *  document while keeping worst-case cost bounded. */
const MAX_HTML_INPUT_CHARS = 500_000;

/** A "tag" longer than this is not a tag — bounds the generic tag-stripper's
 *  scan so a malformed/unterminated "<" cannot force an O(n^2) walk to EOF at
 *  every occurrence (measured: 100k unterminated "<" characters took ~25s
 *  unbounded). Shared by the top-level strip and cellText's own. */
const MAX_TAG_SCAN_CHARS = 4096;
const TAG_STRIP_RE = new RegExp("<[^>]{0," + MAX_TAG_SCAN_CHARS + "}?>", "g");

/** A rendered Markdown table is capped on both axes so one pathologically
 *  wide or tall table cannot amplify the output size fed to the model
 *  (measured: a 58KB table input rendered 8MB of padded output before this
 *  cap existed). Excess columns/rows are dropped, not truncated mid-cell. */
const MAX_TABLE_COLUMNS = 64;
const MAX_TABLE_ROWS = 1000;

/** cellText decodes entities in its own scope; if extractHtmlMarkdown's later
 *  whole-document decodeEntities() pass saw the literal "&" that decode just
 *  produced, it would decode it a SECOND time — letting a double-encoded
 *  entity (e.g. `&amp;#124;`) smuggle a raw "|" or newline past cellText's
 *  own escaping, forging table/heading structure. cellText replaces its own
 *  "&" with this sentinel immediately after decoding; extractHtmlMarkdown
 *  restores it to "&" once, only after its own decode pass has already run
 *  over everything else.
 *  ★ A SINGLE private-use codepoint, not a spaced word — a multi-character
 *  sentinel with its own internal whitespace (an earlier " AMP " version)
 *  does not round-trip for two ADJACENT raw "&" characters: cellText's own
 *  whitespace collapse merges the two tokens' shared space before the
 *  document-level restore runs, corrupting ordinary content like `a && b`.
 *  A single non-whitespace character has no boundary for that collapse to
 *  merge, so concatenation always round-trips. U+E000 is Private Use Area,
 *  never assigned by Unicode, so it cannot collide with real decoded text —
 *  except a literal U+E000 byte in the HOSTILE INPUT itself, which is why
 *  extractHtmlMarkdown strips it at clamp time, before this sentinel is ever
 *  introduced (see MAX_HTML_INPUT_CHARS clamp). */
const AMP_SENTINEL = "\uE000";

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip HTML comments before anything else touches the markup. A comment
 *  hiding a boundary character (`<!-- hidden > INJECTED --><p>ok</p>`)
 *  defeats the generic tag-stripper's `>`-only boundary and leaks its
 *  payload as plain text otherwise. Walks via indexOf rather than a
 *  backtracking `<!--[\s\S]*?-->` regex — that shape is the same O(n^2)
 *  pattern dropTagSubtree below exists to avoid, on input with many
 *  unterminated "<!--" runs. An unterminated comment drops to end of input,
 *  mirroring dropTagSubtree's unterminated-tag fallback. */
function stripComments(html: string): string {
  let out = "";
  let cursor = 0;
  let openIdx = html.indexOf("<!--", cursor);
  while (openIdx !== -1) {
    out += html.slice(cursor, openIdx);
    const closeIdx = html.indexOf("-->", openIdx + 4);
    if (closeIdx === -1) {
      cursor = html.length;
      break;
    }
    cursor = closeIdx + 3;
    out += " ";
    openIdx = html.indexOf("<!--", cursor);
  }
  out += html.slice(cursor);
  return out;
}

/** Drop a trailing unterminated tag ("<span" with no ">"), the last thing
 *  extractHtmlMarkdown does before decoding.
 *
 *  ★★★ This replaces `s.replace(/<[^>]*$/g, " ")`, which READ as bounded — it
 *  is anchored to end of input, so it can match at most once — and is in fact
 *  the worst quadratic in this file. `$` cannot be reached from a "<" that has
 *  a ">" after it, so every such "<" backtracks its whole `[^>]*` run and
 *  fails, from every start position. TAG_STRIP_RE normally eats the ">"s
 *  first and hides this; a ">" further than MAX_TAG_SCAN_CHARS from any "<"
 *  survives that pass and exposes it. Measured 2026-09-03 at
 *  MAX_HTML_INPUT_CHARS ("<" x 494,999 + "x" x 5000 + ">"): 71,472ms for this
 *  one regex, inside an 86,454ms extractHtmlMarkdown — against 27,864ms for
 *  the worst of the three pair-regex steps. The walk below is two index
 *  lookups.
 *
 *  Same match, by construction: the regex matches from the FIRST "<" that has
 *  no ">" after it through end of input, which is the first "<" to the right
 *  of the last ">". */
function stripTrailingOpenTag(s: string): string {
  const lastClose = s.lastIndexOf(">");
  const openIdx = s.indexOf("<", lastClose + 1);
  return openIdx === -1 ? s : `${s.slice(0, openIdx)} `;
}

function dropSubtrees(html: string): string {
  let out = html;
  for (const tag of DROP_SUBTREE) {
    out = dropTagSubtree(out, tag);
  }
  return out;
}

/** Drop every <tag>...</tag> subtree (case-insensitive). Walks via indexOf
 *  /exec rather than a backtracking `<tag\b[\s\S]*?</tag>` pair regex — that
 *  shape is O(n^2) when many open tags have no matching close (measured:
 *  16,000 unterminated "<script" occurrences took ~1.75s with the pair
 *  regex; this walk is O(n)).
 *
 *  ★★ An open tag with no matching close drops from there to end of input,
 *  and that DOES NOT mirror the pair regex, which this comment used to claim.
 *  A pair regex with no close does not match AT ALL. Measured 2026-09-03:
 *  the input `<p>before</p><script>var x = 1;` matched against
 *  `/<script\b[\s\S]*?<\/script\s*>/gi` yields null, so a `.replace` with it
 *  returns the input UNCHANGED and the script body survives as on-page text.
 *  Dropping to EOF is a deliberate hardening of that,
 *  pinned by the "drops to end of input for an unterminated drop-subtree tag"
 *  test — not a behaviour to preserve out of fidelity. forEachTagPair below
 *  keeps the pair regex's real fallback instead: what it drops is formatting,
 *  not the noise subtrees this function exists to suppress, so an unclosed
 *  <li> is better left as text than used to delete the document's tail. */
function dropTagSubtree(html: string, tag: string): string {
  const openRe = new RegExp("<" + tag + "\\b", "gi");
  const closeRe = new RegExp("</" + tag + "\\s*>", "gi");
  let out = "";
  let cursor = 0;
  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(html)) !== null) {
    out += html.slice(cursor, openMatch.index);
    closeRe.lastIndex = openMatch.index;
    const closeMatch = closeRe.exec(html);
    if (closeMatch === null) {
      cursor = html.length;
      break;
    }
    cursor = closeMatch.index + closeMatch[0].length;
    out += " ";
    openRe.lastIndex = cursor;
  }
  out += html.slice(cursor);
  return out;
}

/** A `<name ...>inner</name>` pair located by forEachTagPair. */
interface TagPair {
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
interface TagPairSpec {
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
function forEachTagPair(html: string, spec: TagPairSpec, visit: (pair: TagPair) => boolean): void {
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
function replaceTagPairs(html: string, spec: TagPairSpec, render: (pair: TagPair) => string): string {
  let out = "";
  let cursor = 0;
  forEachTagPair(html, spec, (pair) => {
    out += html.slice(cursor, pair.start) + render(pair);
    cursor = pair.end;
    return true;
  });
  return out + html.slice(cursor);
}

const TABLE_PAIR: TagPairSpec = { openPattern: "<table\\b", closeName: () => "table", hasAttributes: false };
const ROW_PAIR: TagPairSpec = { openPattern: "<tr\\b", closeName: () => "tr", hasAttributes: false };
const CELL_PAIR: TagPairSpec = {
  openPattern: "<(t[dh])\\b",
  closeName: (openMatch) => openMatch[1].toLowerCase(),
  hasAttributes: true,
};
const HEADING_PAIR: TagPairSpec = {
  openPattern: "<h([1-6])\\b",
  closeName: (openMatch) => "h" + openMatch[1],
  hasAttributes: true,
};
const LIST_ITEM_PAIR: TagPairSpec = { openPattern: "<li\\b", closeName: () => "li", hasAttributes: true };

function cellText(html: string): string {
  const stripped = html.replace(TAG_STRIP_RE, "");
  const decoded = decodeEntities(stripped);
  // Protect any literal "&" this decode produced — see AMP_SENTINEL.
  const protectedText = decoded.replace(/&/g, AMP_SENTINEL);
  return protectedText
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
}

/** Render <table> to a Markdown table before generic tag-stripping flattens it.
 *  Tables are the one structure whose loss actually changes meaning — a
 *  resourcing mail's allocations live in one. Both axes are capped
 *  (MAX_TABLE_ROWS / MAX_TABLE_COLUMNS) so a pathological table cannot
 *  amplify the rendered output; excess rows/columns are simply dropped. */
function renderTables(html: string): string {
  return replaceTagPairs(html, TABLE_PAIR, (table) => renderOneTable(table.whole));
}

/** Render one `<table>...</table>` to Markdown. All three levels walk via
 *  forEachTagPair: a single enormous table full of unterminated "<tr" or
 *  "<td" is the adversarial case for the inner two, and measured just as
 *  badly as the outer one (see forEachTagPair). */
function renderOneTable(table: string): string {
  const rows: string[][] = [];
  forEachTagPair(table, ROW_PAIR, (tr) => {
    const cells: string[] = [];
    forEachTagPair(tr.whole, CELL_PAIR, (cell) => {
      cells.push(cellText(cell.inner));
      return cells.length < MAX_TABLE_COLUMNS;
    });
    if (cells.length > 0) rows.push(cells);
    return rows.length < MAX_TABLE_ROWS;
  });
  if (rows.length === 0) return " ";
  // reduce, not Math.max(...rows.map(...)) — a spread argument list this
  // large would blow the call-stack argument limit on an unclamped input.
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const lines = [
    `| ${pad(rows[0]).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

/** ★★★ WHAT `extractHtmlMarkdown` RETURNS FOR AN EMPTY DOCUMENT, and it is
 *  NOT the empty string — which makes `body.content !== ""` a false test for
 *  "this mail has no readable body". A rights-protected wrapper whose body
 *  part is `<html><body></body></html>` — the shape Outlook actually produces
 *  — yielded this placeholder, so a caller asking whether the body was empty
 *  was told "no" and skipped its protected-mail handling entirely.
 *
 *  ★ Exported so that caller can compare against the value rather than
 *  restating the literal. `office-extract.ts` deliberately keeps its own copy
 *  of the same string: it is the same MESSAGE to a reader but a different
 *  FACT (an office document that yielded nothing, not an HTML body), and
 *  collapsing the two would make either one impossible to reword alone. */
export const NO_EXTRACTABLE_TEXT = "_(document contained no extractable text)_";

/** ★★ Every step below is linear in the clamped input length, and that is a
 *  property of the whole pipeline, not of any one step: input reaching here is
 *  hostile by assumption and is processed on the browser MAIN THREAD, so one
 *  quadratic step is enough to freeze the tab. The `<tag>...</tag>` pair regex
 *  is the recurring way to reintroduce one — stripComments, dropTagSubtree and
 *  forEachTagPair above each replace one instance of it, and no
 *  `[\s\S]*?` regex is left here. stripTrailingOpenTag replaces the fourth
 *  and worst one, which wore no `[\s\S]*?` at all. TAG_STRIP_RE is the one
 *  unbounded-looking scan left and is the exception: it is bounded by
 *  MAX_TAG_SCAN_CHARS to a linear pass with a 4096 constant, which is the
 *  pipeline's cost floor rather than a quadratic. Both are measured in the
 *  comments on forEachTagPair and stripTrailingOpenTag. */
export function extractHtmlMarkdown(html: string): string {
  const truncated = html.length > MAX_HTML_INPUT_CHARS ? html.slice(0, MAX_HTML_INPUT_CHARS) : html;
  // A literal AMP_SENTINEL byte in hostile input must not survive to the
  // restore step below, or it would be reinterpreted as a decoded "&" —
  // smuggling a character past cellText's escaping the same way the
  // double-decode this sentinel exists to fix once did.
  const clamped = truncated.split(AMP_SENTINEL).join("");
  let s = stripComments(clamped);
  s = dropSubtrees(s);
  s = renderTables(s);
  s = replaceTagPairs(s, HEADING_PAIR, (h) =>
    `\n\n${"#".repeat(Number(h.openMatch[1]))} ${cellText(h.inner)}\n\n`);
  s = replaceTagPairs(s, LIST_ITEM_PAIR, (li) => `\n- ${cellText(li.inner)}`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|ul|ol|section|article|h[1-6]|blockquote)\s*>/gi, "\n\n");
  s = s.replace(TAG_STRIP_RE, " ");            // every remaining tag, incl. unterminated
  s = stripTrailingOpenTag(s);                  // a trailing "<span" with no ">"
  s = decodeEntities(s);
  s = s.split(AMP_SENTINEL).join("&");          // restore cellText's protected "&", once
  s = s.replace(/[ \t ]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s === "" ? NO_EXTRACTABLE_TEXT : s;
}
