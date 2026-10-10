// The release notes as a small HTML fragment for the "Update available" window (update-window.ts).
// electron-updater hands over the GitHub release body as GitHub's own rendered HTML (the releases
// atom feed's <content>), so headings, lists, bold and code are already there; showing it as plain
// text ran every section and bullet together.
//
// ★★ SAFE BY CONSTRUCTION, NOT BY FILTERING. Nothing from the source is copied through as markup.
// The source is cut into tags and text; every text run is entity-decoded and then re-escaped, and
// every tag is either swapped for one of a fixed set of tags this module writes itself, with no
// attribute taken from the source, or dropped. (The one attribute it writes is the constant
// `class="plain"` on a body with no markup.) So no source attribute (href, src, on*, style) can
// reach the page, whatever the release body holds, and the page's CSP (`default-src 'none'`, one script by hash) stays the second
// line rather than the only one. There is no DOM in the main process, so there is no DOMPurify here;
// a filter that tried to keep "safe" source tags is exactly the hand-rolled sanitiser to avoid.
// ★ The output is balanced: a closing tag is written only for a tag this module opened, and every
// tag still open at the end is closed, so a malformed body cannot leave the page's structure open.
// Nesting is capped at MAX_DEPTH: tags opened past it are dropped (their text stays), which also
// bounds the work a pathologically nested body costs, as `max` bounds its text.

/** HTML that came out of `notesToSafeHtml`. The brand stops a raw string reaching the page. */
export type SafeNotesHtml = string & { readonly __safeNotesHtml: true };

/** The release notes as one string, from any shape electron-updater reports them in. */
export function notesSource(notes: unknown): string {
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (n && typeof n === "object" && "note" in n ? String((n as { note: unknown }).note ?? "") : ""))
      .join("\n");
  }
  return typeof notes === "string" ? notes : "";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  // The typographic ones a hand-written changelog is likeliest to carry; GitHub mostly emits UTF-8.
  mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™",
};

// One pass, so "&amp;lt;" decodes to the literal text "&lt;" and never on to "<". A code point
// outside Unicode is left as written (String.fromCodePoint would throw on it).
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] !== "#") return NAMED[body.toLowerCase()] ?? m;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// Source tag → the tag written in its place. Headings sit one level under the page's own h1/h2.
const KEPT: Record<string, string> = {
  h1: "h3", h2: "h3", h3: "h4", h4: "h4", h5: "h4", h6: "h4",
  p: "p", ul: "ul", ol: "ol", li: "li", pre: "pre", blockquote: "blockquote",
  strong: "strong", b: "strong", em: "em", i: "em", code: "code",
};
// Dropped tags whose boundary separates words: without a space, two table cells or two divs would
// fuse their text ("ab"). Any other dropped tag (a, span, sup, ...) leaves its text as it stands.
const SEPARATING = new Set(["div", "table", "thead", "tbody", "tr", "td", "th", "dl", "dt", "dd", "section", "details", "summary"]);
// Dropped together with everything inside them: their content is not release-note text.
const DROPPED_WITH_CONTENT = /<(script|style|template|svg|math|iframe|object|noscript|textarea|title|head)(?=[\s/>])[\s\S]*?<\/\1\s*>/gi;
// A tag name may contain `-` and ends at whitespace, `/` or `>`, so a custom element such as
// <li-item> or GitHub's <g-emoji> is its own (dropped) tag, never read as <li> or <g>.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])[^>]*>/g;
const MAX_DEPTH = 64;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// The first `n` code units of `s`, backing off one more rather than cutting a surrogate pair in half.
function head(s: string, n: number): string {
  let end = Math.max(0, n);
  if (end > 0 && end < s.length && isHighSurrogate(s.charCodeAt(end - 1))) end -= 1;
  return s.slice(0, end);
}

const EMPTY = "<p>No release notes.</p>" as SafeNotesHtml;

/**
 * The notes as an HTML fragment holding only tags this module writes. `max` bounds the visible
 * text (a flood guard against a pathological body, as `NOTES_MAX` is for the plain-text form).
 */
// Comments and script-like elements, removed until nothing changes: one pass can leave a new one
// behind, joined from the halves around a removed inner element (`<scr<script></script>ipt>`).
function stripDropped(s: string): string {
  let prev: string;
  let next = s;
  do {
    prev = next;
    next = prev.replace(/<!--[\s\S]*?-->/g, "").replace(DROPPED_WITH_CONTENT, "");
  } while (next !== prev);
  return next;
}

export function notesToSafeHtml(notes: unknown, max: number): SafeNotesHtml {
  const source = stripDropped(notesSource(notes));
  TAG.lastIndex = 0;
  // A body with no markup at all (a provider that sends plain text) keeps its own line breaks.
  if (!TAG.test(source)) {
    const text = decodeEntities(source).trim();
    if (text === "") return EMPTY;
    const shown = text.length > max ? `${head(text, max - 1)}…` : text;
    return `<div class="plain">${escapeHtml(shown)}</div>` as SafeNotesHtml;
  }

  const out: string[] = [];
  const open: string[] = [];
  let preDepth = 0;
  let budget = max;
  let visible = false;
  let clipped = false;

  const endsInSpace = () => /\s$/.test(out[out.length - 1] ?? "");
  // One space between words, however many source line ends, <br>s and dropped tags sat between them.
  const space = () => {
    if (!endsInSpace()) out.push(" ");
  };

  const writeText = (raw: string) => {
    if (clipped) return;
    let text = decodeEntities(raw);
    if (preDepth === 0) {
      text = text.replace(/\s+/g, " ");
      if (endsInSpace()) text = text.replace(/^ /, "");
    }
    if (text.trim() !== "") visible = true;
    if (text.length > budget) {
      text = `${head(text, budget - 1)}…`;
      clipped = true;
    }
    budget -= text.length;
    out.push(escapeHtml(text));
  };

  let at = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(source); m !== null && !clipped; m = TAG.exec(source)) {
    if (m.index > at) writeText(source.slice(at, m.index));
    at = TAG.lastIndex;
    if (clipped) break;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (name === "br") {
      // Release bodies are hard-wrapped prose, and GitHub renders each wrap as a <br>; kept as line
      // breaks, every paragraph would show the source file's ragged line ends.
      if (preDepth > 0) out.push("\n");
      else space();
      continue;
    }
    if (name === "hr") {
      if (!closing) out.push("<hr>");
      continue;
    }
    const tag = KEPT[name];
    if (tag === undefined) {
      if (SEPARATING.has(name)) space();
      continue;
    }
    if (!closing) {
      if (open.length >= MAX_DEPTH) continue;
      out.push(`<${tag}>`);
      open.push(tag);
      if (tag === "pre") preDepth += 1;
      continue;
    }
    // Close only what this module opened, and whatever it opened inside that since.
    const i = open.lastIndexOf(tag);
    if (i === -1) continue;
    while (open.length > i) {
      const t = open.pop() as string;
      if (t === "pre") preDepth -= 1;
      out.push(`</${t}>`);
    }
  }
  if (!clipped && at < source.length) writeText(source.slice(at));
  while (open.length > 0) out.push(`</${open.pop()}>`);
  return visible ? (out.join("").trim() as SafeNotesHtml) : EMPTY;
}
