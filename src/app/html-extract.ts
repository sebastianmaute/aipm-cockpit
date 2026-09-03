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
 *  over everything else. Plain text (not a control character) so it reads
 *  sanely if ever surfaced un-restored; the accepted tradeoff is that a
 *  genuine " AMP " substring elsewhere in the input collides with it.
 *  ★ Known gap, not a security regression: TWO adjacent raw "&" characters
 *  (e.g. literal "&&") do not round-trip — cellText's own whitespace
 *  collapse merges the two sentinel tokens' shared space before the
 *  document-level restore runs, so only the first is restored and "AMP "
 *  is left as literal leftover text. No structural character can result
 *  from this, and it is not covered by the current test suite. */
const AMP_SENTINEL = " AMP ";

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
 *  regex; this walk is O(n)). An open tag with no matching close drops from
 *  there to end of input, mirroring the original pair regex's unterminated
 *  fallback. */
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
  return html.replace(/<table\b[\s\S]*?<\/table\s*>/gi, (table) => {
    const rows: string[][] = [];
    const trRe = /<tr\b[\s\S]*?<\/tr\s*>/gi;
    let tr: RegExpExecArray | null;
    while (rows.length < MAX_TABLE_ROWS && (tr = trRe.exec(table)) !== null) {
      const cells: string[] = [];
      const cellRe = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
      let c: RegExpExecArray | null;
      while (cells.length < MAX_TABLE_COLUMNS && (c = cellRe.exec(tr[0])) !== null) {
        cells.push(cellText(c[2]));
      }
      if (cells.length > 0) rows.push(cells);
    }
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
  });
}

export function extractHtmlMarkdown(html: string): string {
  const clamped = html.length > MAX_HTML_INPUT_CHARS ? html.slice(0, MAX_HTML_INPUT_CHARS) : html;
  let s = stripComments(clamped);
  s = dropSubtrees(s);
  s = renderTables(s);
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, lvl: string, inner: string) =>
    `\n\n${"#".repeat(Number(lvl))} ${cellText(inner)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_m, inner: string) => `\n- ${cellText(inner)}`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|ul|ol|section|article|h[1-6]|blockquote)\s*>/gi, "\n\n");
  s = s.replace(TAG_STRIP_RE, " ");            // every remaining tag, incl. unterminated
  s = s.replace(/<[^>]*$/g, " ");               // a trailing "<span" with no ">"
  s = decodeEntities(s);
  s = s.split(AMP_SENTINEL).join("&");          // restore cellText's protected "&", once
  s = s.replace(/[ \t ]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s === "" ? "_(document contained no extractable text)_" : s;
}
