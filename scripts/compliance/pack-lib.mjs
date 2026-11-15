/** Pure gate library for the compliance pack under `docs/compliance/{en,de}/`.
 *  Strings in, results out; no file I/O. `check-compliance-pack.mjs` is the
 *  reader. Same split as `followup-index-lib.mjs` and its CLI. */
import { ENTRY_RE } from "../followup-claims-lib.mjs";
import { headingState, stateIsClosed } from "../followup-index-lib.mjs";

export const PACK_FILES = Object.freeze([
  "README.md",
  "vendor-touchpoints.md",
  "dpia-input.md",
  "record-of-processing-input.md",
  "works-council-annex.md",
  "ai-act-readiness.md",
  "tom-sheet.md",
  "model-notices.md",
  "ai-literacy.md",
]);

/** The per-language files of the AI briefs under `docs/briefs/{en,de}/`: one page per reader, plus the appendix
 *  that carries the generated blocks. */
export const BRIEF_FILES = Object.freeze([
  "ceo.md",
  "cio.md",
  "ciso.md",
  "caio.md",
  "coo.md",
  "dpo.md",
  "pm.md",
  "appendix.md",
]);

export const BLOCK_NAMES = Object.freeze([
  "ai-paths",
  "ai-paths-people",
  "browser-hosts",
  "server-destinations",
  "deployment-switches",
  "open-gaps",
  "figures",
  "team-month",
]);

export const PACK_LANGS = Object.freeze(["en", "de"]);

const MARKER_RE = /^\s*<!-- PACK:([A-Za-z0-9-]+):(BEGIN|END) -->\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const PACK_COMMENT_RE = /<!--\s*PACK:/;
const HEADING_RE = /^(#{1,6})\s+\S/;

const splitLines = (src) => src.split(/\r?\n/);

/** Per line: is it inside (or part of) a fenced code block? A fence closes on
 *  the same character with at least as many characters. */
function fencedFlags(lines) {
  const flags = [];
  let open = null;
  for (const line of lines) {
    const m = FENCE_RE.exec(line);
    if (open) {
      flags.push(true);
      if (m && m[1][0] === open.ch && m[1].length >= open.len && line.trim() === m[1]) open = null;
    } else if (m) {
      flags.push(true);
      open = { ch: m[1][0], len: m[1].length };
    } else {
      flags.push(false);
    }
  }
  return flags;
}

/** Marker pairs of one file: blocks with their line span, plus errors. */
function scanBlocks(src) {
  const lines = splitLines(src);
  const fenced = fencedFlags(lines);
  const blocks = [];
  const errors = [];
  const seen = new Set();
  let open = null;
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const m = MARKER_RE.exec(line);
    if (!m) {
      if (PACK_COMMENT_RE.test(line)) {
        errors.push(`line ${i + 1}: malformed PACK marker (a marker must stand alone on its line)`);
      }
      return;
    }
    const [, name, kind] = m;
    const at = `line ${i + 1}`;
    if (!BLOCK_NAMES.includes(name)) {
      errors.push(`${at}: unknown block name "${name}"`);
      return;
    }
    if (kind === "BEGIN") {
      if (open) {
        errors.push(`${at}: block "${name}" begins inside block "${open.name}" (nested)`);
        return;
      }
      if (seen.has(name)) {
        errors.push(`${at}: block "${name}" is used twice in one file`);
        return;
      }
      seen.add(name);
      open = { name, begin: i };
      return;
    }
    if (!open) {
      errors.push(`${at}: END of "${name}" without a BEGIN`);
      return;
    }
    if (open.name !== name) {
      errors.push(`${at}: END of "${name}" closes block "${open.name}"`);
      return;
    }
    blocks.push({ name, begin: open.begin, end: i });
    open = null;
  });
  if (open) errors.push(`line ${open.begin + 1}: block "${open.name}" has no END`);
  return { lines, blocks, errors };
}

/** The blocks of one file; bodies are joined with LF whatever the file's EOL. */
export function parseBlocks(src) {
  const { lines, blocks, errors } = scanBlocks(src);
  return {
    blocks: blocks.map((b) => ({ name: b.name, body: lines.slice(b.begin + 1, b.end).join("\n") })),
    errors,
  };
}

/** Rewrite the body of every block named in `rendered`. The file's line ending
 *  (CRLF if it has any) is kept.
 *  @throws when the file's markers are malformed. */
export function replaceBlocks(src, rendered) {
  const { lines, blocks, errors } = scanBlocks(src);
  if (errors.length > 0) throw new Error(`CANNOT REPLACE: ${errors.join("; ")}`);
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const out = [];
  let cursor = 0;
  for (const b of blocks) {
    if (!Object.hasOwn(rendered, b.name)) continue;
    out.push(...lines.slice(cursor, b.begin + 1));
    const body = rendered[b.name].replace(/(\r?\n)+$/, "");
    if (body !== "") out.push(...splitLines(body));
    cursor = b.end;
  }
  out.push(...lines.slice(cursor));
  return out.join(eol);
}

/** Heading levels (as `#` runs) and block names, in document order. */
export function structureOf(src) {
  const lines = splitLines(src);
  const fenced = fencedFlags(lines);
  const headings = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const m = HEADING_RE.exec(line);
    if (m) headings.push(m[1]);
  });
  return { headings, blocks: scanBlocks(src).blocks.map((b) => b.name) };
}

/** EN and DE: same files, same heading levels in order, same block names in
 *  order. Prose may differ. One message per defect, naming the file. */
export function parityViolations(en, de) {
  const out = [];
  const names = [...new Set([...Object.keys(en), ...Object.keys(de)])].sort();
  for (const name of names) {
    if (!Object.hasOwn(de, name)) {
      out.push(`${name}: only in en`);
      continue;
    }
    if (!Object.hasOwn(en, name)) {
      out.push(`${name}: only in de`);
      continue;
    }
    const a = structureOf(en[name]);
    const b = structureOf(de[name]);
    const levels = (s) => s.headings.map((h) => h.length).join(",");
    if (levels(a) !== levels(b)) {
      out.push(`${name}: heading levels differ (en ${levels(a)}; de ${levels(b)})`);
    }
    if (a.blocks.join(",") !== b.blocks.join(",")) {
      out.push(`${name}: block names differ (en [${a.blocks.join(", ")}]; de [${b.blocks.join(", ")}])`);
    }
  }
  return out;
}

/** Claims the pack must never make, in either language. An entry is a literal
 *  phrase or `{ re, label }` with a RegExp source. Both are matched
 *  case-insensitively between word boundaries; spaces in a literal match any
 *  whitespace run, and a single German literal also takes adjective endings.
 *  `konform` also matches as the tail of a closed compound (`DSGVO-konforme`,
 *  `datenschutzkonform`) but never `Konformität` or `Konformitätsbewertung`;
 *  `compliance` is never matched. */
export const DENY_PHRASES = Object.freeze({
  en: Object.freeze([
    "compliant",
    { re: "complies\\s+with", label: "complies with" },
    { re: "in\\s+compliance\\s+with", label: "in compliance with" },
    { re: "not\\s+(?:a\\s+)?high[- ]risk(?:\\s+system)?", label: "not high-risk" },
    { re: "eu[- ]hosted", label: "eu-hosted" },
    { re: "hosted\\s+in\\s+(?:the\\s+eu|germany)", label: "hosted in the EU or Germany" },
    { re: "stays?\\s+in\\s+the\\s+eu", label: "stays in the EU" },
    // Not "never sent": the app's own disclosure texts, which the generated blocks publish, list the fields a
    // path withholds as "Never sent: …". That is a fact about one request, not a claim about the product.
    { re: "never\\s+leaves?", label: "never leaves" },
    { re: "no\\s+(?:personal\\s+)?data\\s+(?:is\\s+sent|leaves)", label: "no data is sent / leaves" },
    "fully auditable",
    { re: "instant(?:ly)?\\s+revo(?:cation|ke|kes|ked|king)", label: "instant revocation" },
    "always in the loop",
    // Brief claims (docs/briefs): each is a promise the product does not make.
    { re: "sovereign(?:ty)?", label: "sovereign" },
    { re: "(?:savings|time\\s+saved)\\s+(?:are|is|were|have\\s+been|has\\s+been)\\s+(?:measured|proven|verified)", label: "savings stated as measured" },
    { re: "(?:measured|proven|verified)\\s+(?:time\\s+)?savings", label: "measured savings" },
    { re: "(?:(?:it|that)['’]s|is|are)\\s+(?:fully\\s+)?secure", label: "is secure" },
    { re: "(?:gateway|central(?:ly)?\\s+governance)\\s+(?:is|are)\\s+proven", label: "gateway proven" },
    { re: "central(?:ised|ized)?\\s+governance", label: "central governance" },
    { re: "per[- ]feature\\s+cost\\s+(?:control|limits?|caps?)", label: "per-feature cost control" },
    { re: "anthropic(?:'s|’s)?\\s+(?:terms|guarantees?)\\s+(?:guarantee|ensure|bind|protect)\\w*", label: "Anthropic's terms as guarantees" },
    { re: "anthropic\\s+guarantees", label: "Anthropic guarantees" },
    { re: "always\\s+(?:a\\s+)?human\\s+in\\s+the\\s+loop", label: "always a human in the loop" },
    { re: "(?:humans?|people|a\\s+person)\\s+always\\s+(?:stays?|remains?|are|is)\\s+in\\s+the\\s+loop", label: "humans always stay in the loop" },
    { re: "always\\s+(?:stays?|remains?)\\s+in\\s+the\\s+loop", label: "always stays in the loop" },
  ]),
  de: Object.freeze([
    { re: "\\p{L}*konform(?:e|er|es|en|em)?", label: "konform" },
    { re: "(?:dsgvo|gdpr)-konformität", label: "DSGVO-Konformität" },
    { re: "kein(?:e|es|en)?\\s+hochrisik\\p{L}*", label: "kein Hochrisiko" },
    { re: "nicht\\s+(?:als\\s+)?hochrisik\\p{L}*", label: "nicht Hochrisiko" },
    { re: "nicht\\s+hochriskant", label: "nicht hochriskant" },
    { re: "in\\s+der\\s+eu\\s+gehostet|eu[- ]gehostet|in\\s+deutschland\\s+gehostet", label: "in der EU gehostet" },
    { re: "(?:verlässt|verlassen)(?:\\s+\\p{L}+){0,3}\\s+nie(?:mals)?", label: "verlässt nie(mals)" },
    "keine personenbezogenen daten",
    "vollständig auditierbar",
    { re: "sofortiger\\s+widerruf|sofort\\s+widerrufbar", label: "sofortiger Widerruf" },
    "immer ein mensch",
    // Brief claims (docs/briefs): each is a promise the product does not make.
    { re: "\\p{L}*souverän\\p{L}*", label: "souverän" },
    { re: "vollständig\\s+(?:nachvollziehbar|prüfbar)\\p{L}*", label: "vollständig nachvollziehbar" },
    { re: "(?:ist|sind)\\s+(?:vollständig\\s+)?sicher", label: "ist sicher" },
    { re: "(?:einsparungen|zeitersparnis)\\s+(?:sind|ist|wurden?)\\s+(?:gemessen|belegt|nachgewiesen)", label: "Einsparung als gemessen" },
    { re: "(?:gemessene|belegte|nachgewiesene)\\s+(?:einsparung|zeitersparnis)\\p{L}*", label: "gemessene Einsparung" },
    { re: "zentrale\\p{L}*\\s+(?:governance|steuerung)", label: "zentrale Governance" },
    { re: "gateway\\s+(?:ist\\s+)?(?:belegt|nachgewiesen|bewiesen)", label: "Gateway belegt" },
    { re: "sofort\\s+widerrufen", label: "sofort widerrufen" },
    { re: "kostenkontrolle\\s+(?:je|pro)\\s+funktion", label: "Kostenkontrolle je Funktion" },
    { re: "anthropic\\s+garantiert", label: "Anthropic garantiert" },
    { re: "anthropics?\\s+bedingungen\\s+garantier\\p{L}*", label: "Anthropics Bedingungen garantieren" },
    { re: "(?:immer|stets)\\s+eine?n?\\s+(?:mensch|person)\\p{L}*\\s+(?:beteiligt|dabei|eingebunden)", label: "immer ein Mensch beteiligt" },
    { re: "mensch\\s+(?:ist|bleibt)\\s+(?:immer|stets)\\s+(?:beteiligt|dabei|eingebunden)", label: "Mensch ist immer beteiligt" },
    { re: "(?:mensch|person)\\s+(?:ist|bleibt)\\s+(?:immer|stets)\\s+(?:beteiligt|dabei|eingebunden)", label: "Person ist immer beteiligt" },
  ]),
});

const DE_ENDINGS = "(?:e|er|es|en|em)?";
const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}])";

/** [label, RegExp] for one deny-list entry. */
function entryRegex(entry, lang) {
  if (typeof entry !== "string") {
    return [entry.label, new RegExp(`${BOUNDARY_BEFORE}(?:${entry.re})${BOUNDARY_AFTER}`, "iu")];
  }
  const body = entry
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const ending = lang === "de" && !/\s/.test(entry) ? DE_ENDINGS : "";
  return [entry, new RegExp(`${BOUNDARY_BEFORE}${body}${ending}${BOUNDARY_AFTER}`, "iu")];
}

/** Longest quoted span that still reads as a mention rather than a claim. */
const MAX_QUOTED_CHARS = 40;

/** Blank out what a claim check must not see: inline code (within one line, so
 *  a stray backtick never swallows the next line) and short quoted spans (which
 *  may wrap). A longer quotation is text the pack would itself be making. The
 *  result has the input's length, so offsets still map to source lines. */
function stripExempt(text) {
  const blank = (m) => " ".repeat(m.length);
  const n = MAX_QUOTED_CHARS;
  return text
    .replace(/`[^`\n]*`/g, blank)
    .replace(new RegExp(`"[^"]{0,${n}}"`, "g"), blank)
    .replace(new RegExp(`“[^”]{0,${n}}”`, "g"), blank)
    .replace(new RegExp(`„[^“”]{0,${n}}[“”]`, "g"), blank);
}

const TABLE_ROW_RE = /^\s*\|/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;
const BLOCKQUOTE_PREFIX_RE = /^\s*(?:>\s?)+/;
const COMMENT_LINE_RE = /^\s*<!--/;

/** The text units a claim check reads. The pack is hard-wrapped, so a phrase may
 *  straddle a line break: a unit is a paragraph, its lines joined with their
 *  line breaks. A unit ends at a blank line or a fenced block; a list item starts
 *  a new one; a heading, a table row and an HTML comment line are each a unit of
 *  their own (so table rows are still checked one row at a time). Blockquote `>`
 *  markers are blanked so a wrapped quotation joins too. `lineOf[k]` is the
 *  0-based source line of character k, so a hit maps back to its first line. */
function textUnits(lines) {
  const fenced = fencedFlags(lines);
  const units = [];
  let cur = null;
  const close = () => {
    if (cur) units.push(cur);
    cur = null;
  };
  lines.forEach((line, i) => {
    if (fenced[i] || line.trim() === "") return close();
    const standalone = TABLE_ROW_RE.test(line) || HEADING_RE.test(line) || COMMENT_LINE_RE.test(line);
    if (standalone || LIST_ITEM_RE.test(line)) close();
    const prefix = BLOCKQUOTE_PREFIX_RE.exec(line);
    const body = prefix ? " ".repeat(prefix[0].length) + line.slice(prefix[0].length) : line;
    if (!cur) {
      cur = { text: "", lineOf: [] };
    } else {
      cur.text += "\n";
      cur.lineOf.push(i);
    }
    cur.text += body;
    for (let k = 0; k < body.length; k++) cur.lineOf.push(i);
    if (standalone) close();
  });
  close();
  return units;
}

/** Deny-list hits outside fenced code, inline code and short quoted spans,
 *  matched across hard line wraps within a paragraph (`textUnits`). `>`
 *  blockquotes are NOT exempt. One message per phrase and line, naming the line
 *  the hit starts on. */
export function claimViolations(src, lang) {
  const phrases = DENY_PHRASES[lang];
  if (!phrases) throw new Error(`unknown language "${lang}"`);
  const regexes = phrases.map((p) => {
    const [label, re] = entryRegex(p, lang);
    return [label, new RegExp(re.source, "giu")];
  });
  const hits = [];
  for (const unit of textUnits(splitLines(src))) {
    const text = stripExempt(unit.text);
    for (const [phrase, re] of regexes) {
      for (const m of text.matchAll(re)) hits.push([unit.lineOf[m.index], phrase]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const messages = hits.map(([i, phrase]) => `line ${i + 1}: denied phrase "${phrase}"`);
  return [...new Set(messages)];
}

/** Statute abbreviations that mark a `§` number as a section of a law, not a
 *  register entry. An explicit list: any other capitalised word next to the
 *  number (`AI §805`, `§794 RACI`, `§810 KI-Funktionen`) is prose, and the
 *  number stays a register citation. `SGB` may carry a book numeral (`SGB IX`). */
export const STATUTE_ABBREVIATIONS = [
  "ArbVG", "BDSG", "BetrVG", "BGB", "DS-GVO", "DSGVO", "GDPR", "HGB", "KI-VO", "SGB", "TDDDG", "TTDSG", "UWG",
];

const STATUTE_ALT = STATUTE_ABBREVIATIONS.map((a) => (a === "SGB" ? String.raw`SGB(?:\s+[IVX]+)?` : a)).join("|");
const STATUTE_BEFORE = new RegExp(String.raw`(?:^|[^\p{L}\p{N}-])(?:${STATUTE_ALT})\s*$`, "u");
const STATUTE_AFTER = new RegExp(
  String.raw`^(?:\(|\s*(?:Abs|Nr|No|S)\.|\s+Satz(?!\p{L})|\s+(?:${STATUTE_ALT})(?![\p{L}\p{N}-]))`,
  "u",
);

/** The [start, end) ranges of the inline code spans in one Markdown block's text (its lines joined by "\n"): a run
 *  of N backticks opens a span that the next run of exactly N closes, so a span can cross a hard wrap; a run with no
 *  closing run is literal text. A backtick right after an odd number of backslashes is escaped and cannot open a
 *  span (the rest of its run still can); inside a span a backslash escapes nothing, so any run of N closes it. */
function codeSpanRanges(text) {
  const runs = [...text.matchAll(/`+/g)].map((m) => {
    const slashes = /\\*$/.exec(text.slice(0, m.index))[0].length;
    return { at: m.index, len: m[0].length, escaped: slashes % 2 === 1 };
  });
  const ranges = [];
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i].escaped ? { at: runs[i].at + 1, len: runs[i].len - 1 } : runs[i];
    if (open.len === 0) continue;
    const close = runs.findIndex((r, j) => j > i && r.len === open.len);
    if (close === -1) continue;
    ranges.push([open.at, runs[close].at + runs[close].len]);
    i = close;
  }
  return ranges;
}

/** Where a new Markdown block starts even without a blank line before it: a table row, a list item, a heading or a
 *  block quote line. Code spans never cross into such a line. */
const BLOCK_START = /^\s*(?:\||[-*+]\s|\d+[.)]\s|#|>)/;

/** A line that is a whole block on its own: a table row, a heading, a thematic break (`---`, `***`, `___`), a
 *  setext underline (`===`; a `---` one is a thematic break here) or an HTML comment line. Code spans cross neither
 *  into nor out of it. */
const ONE_LINE_BLOCK = /^\s*(?:\||#|<!--|(?:[-*_][ \t]*){3,}$|=+[ \t]*$)/;

/** Per line, the line's code-span ranges as [start, end) offsets into that line, paired across the lines of its
 *  block (`codeSpanRanges`). `skip(i)` marks lines that are not prose: they end a block and get no ranges. */
function lineCodeSpans(lines, skip) {
  const perLine = lines.map(() => []);
  let block = [];
  const flush = () => {
    if (block.length === 0) return;
    const starts = [];
    let off = 0;
    for (const i of block) {
      starts.push(off);
      off += lines[i].length + 1;
    }
    for (const [s, e] of codeSpanRanges(block.map((i) => lines[i]).join("\n"))) {
      block.forEach((i, k) => {
        const from = Math.max(s, starts[k]) - starts[k];
        const to = Math.min(e, starts[k] + lines[i].length) - starts[k];
        if (from < to) perLine[i].push([from, to]);
      });
    }
    block = [];
  };
  lines.forEach((line, i) => {
    if (skip(i) || line.trim() === "" || BLOCK_START.test(line) || ONE_LINE_BLOCK.test(line)) flush();
    if (!skip(i) && line.trim() !== "") block.push(i);
    if (ONE_LINE_BLOCK.test(line)) flush();
  });
  flush();
  return perLine;
}

/** Register citations in a pack file's prose. The rule: `§` directly followed
 *  (no space) by a number of three or more digits, at least 400. Statute
 *  sections are never register citations and are skipped: `§§`, `§ 87` (space),
 *  any number below 400, a number followed by `(` or by `Abs.`/`Nr.`/`No.`/`S.`/
 *  `Satz`, and a number preceded or followed by one of `STATUTE_ABBREVIATIONS`
 *  (`BetrVG §90`, `§401 SGB`, `§611a BGB`; a single lowercase letter right after
 *  the number belongs to the section). Generated block bodies, fenced code and
 *  inline code spans are not prose and are skipped too: a quoted test title can
 *  carry a register number without citing that gap. A span is paired within its
 *  Markdown block, so it can cross a hard wrap but never a blank line, a table
 *  row, a list item, a heading, a quote line, a thematic break or an HTML comment
 *  line (`lineCodeSpans`), and an escaped backtick opens none. Not recognised, so
 *  not used as boundaries: a span CommonMark carries across two quote lines (each
 *  `>` line starts its own), indented code blocks and HTML blocks other than a
 *  comment line; none occurs in the pack or brief files.
 *  A register citation is recognised ONLY as `§NNN` (no space, NNN at least 400): a German-style
 *  `§ NNN` or a lower number is never checked against the register.
 *  @returns {{ n: number, line: number }[]} in document order, 1-based lines. */
export function proseGapCitations(src) {
  const { lines, blocks } = scanBlocks(src);
  const fenced = fencedFlags(lines);
  const inBlock = (i) => blocks.some((b) => i > b.begin && i < b.end);
  const cite = /(?<![§\p{L}\p{N}])§(\d{3,})(?!\d)(?:[a-z](?!\p{L}))?/gu;
  const statuteBefore = STATUTE_BEFORE;
  const statuteAfter = STATUTE_AFTER;
  const out = [];
  const skip = (i) => fenced[i] || inBlock(i);
  const spansByLine = lineCodeSpans(lines, skip);
  lines.forEach((line, i) => {
    if (skip(i)) return;
    const spans = spansByLine[i];
    for (const m of line.matchAll(cite)) {
      if (spans.some(([s, e]) => m.index >= s && m.index < e)) continue;
      const n = Number(m[1]);
      if (n < 400) continue;
      if (statuteBefore.test(line.slice(0, m.index))) continue;
      if (statuteAfter.test(line.slice(m.index + m[0].length))) continue;
      out.push({ n, line: i + 1 });
    }
  });
  return out;
}

/** Register entries (`## <n>. <title>`) as [n, closed] pairs, outside fences. */
function registerEntries(registerSrc) {
  const lines = splitLines(registerSrc);
  const fenced = fencedFlags(lines);
  const entries = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const m = ENTRY_RE.exec(line);
    if (m) entries.push([Number(m[1]), stateIsClosed(headingState(m[2].trim()))]);
  });
  return entries;
}

/** Numbers of the register's entries that are not closed. */
export function openRegisterNumbers(registerSrc) {
  return new Set(registerEntries(registerSrc).filter(([, closed]) => !closed).map(([n]) => n));
}

/** Every cited gap must be an open register entry. */
export function gapViolations(cited, registerSrc) {
  const entries = registerEntries(registerSrc);
  const open = new Set(entries.filter(([, closed]) => !closed).map(([n]) => n));
  const known = new Set(entries.map(([n]) => n));
  return cited
    .filter((n) => !open.has(n))
    .map((n) =>
      known.has(n)
        ? `§${n} is cited as an open gap but is closed`
        : `§${n} is cited as an open gap but is not in the register`,
    );
}

/** Every register citation in a file's prose (`proseGapCitations`) must be an
 *  open register entry and must be in `cited` (CITED_GAPS), so the open-gaps
 *  table lists every gap the prose relies on. One message per citation. */
export function proseGapViolations(src, cited, registerSrc) {
  const entries = registerEntries(registerSrc);
  const open = new Set(entries.filter(([, closed]) => !closed).map(([n]) => n));
  const known = new Set(entries.map(([n]) => n));
  const out = [];
  for (const { n, line } of proseGapCitations(src)) {
    if (!known.has(n)) out.push(`line ${line}: §${n} is cited but is not in the register`);
    else if (!open.has(n)) out.push(`line ${line}: §${n} is cited but is closed`);
    else if (!cited.includes(n)) out.push(`line ${line}: §${n} is cited but is not in CITED_GAPS (pack-config.mjs)`);
  }
  return out;
}

export const REVIEW_LINE = {
  en: /^Text last reviewed for version (\d+\.\d+\.\d+) on (\d{4}-\d{2}-\d{2})\.$/m,
  de: /^Text zuletzt geprüft für Version (\d+\.\d+\.\d+) am (\d{4}-\d{2}-\d{2})\.$/m,
};

/** -1, 0 or 1 for two `x.y.z` versions, compared numerically per part. */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Each README carries one review line; EN and DE agree and the version is not
 *  newer than the app's. */
export function reviewLineViolations(enReadme, deReadme, appVersion) {
  const out = [];
  const en = REVIEW_LINE.en.exec(enReadme.replace(/\r\n/g, "\n"));
  const de = REVIEW_LINE.de.exec(deReadme.replace(/\r\n/g, "\n"));
  if (!en) out.push("en README: review line missing or malformed");
  if (!de) out.push("de README: review line missing or malformed");
  if (!en || !de) return out;
  if (en[1] !== de[1]) out.push(`review versions differ (en ${en[1]}; de ${de[1]})`);
  if (en[2] !== de[2]) out.push(`review dates differ (en ${en[2]}; de ${de[2]})`);
  for (const [lang, m] of [["en", en], ["de", de]]) {
    if (compareVersions(m[1], appVersion) > 0) {
      out.push(`${lang} review version ${m[1]} is newer than the app version ${appVersion}`);
    }
  }
  return out;
}

/** Keys allowed in `docs/briefs/figures.json`, by level. The file is machine-written by the measured run, so an
 *  unknown key is a sign something else was pasted in. Free-key maps are checked by FREE_KEY instead. */
const FIGURE_KEYS = {
  top: ["schema", "commit", "runDate", "model", "data", "hiddenWhenProtected", "paths", "behaviour", "relayKeyCheck", "rates"],
  path: [
    "id", "protection", "protectionUnverifiedCalls", "calls", "inputTokens", "cacheWriteTokens", "cacheReadTokens",
    "outputTokens", "usdPerCall", "medianLatencyMs",
  ],
  behaviour: [
    "protectedNameHitsOn", "emailHitsOn", "documentedExceptionHitsOn", "positiveControlHitsOff", "inferenceGeo", "requests",
  ],
  relayKeyCheck: ["runs", "warmExtraMs"],
  relayRun: ["path", "coldExtraMs"],
  rate: ["input", "output", "cacheWrite", "cacheRead"],
};
const FREE_KEY = /^[a-z0-9._-]{1,64}$/i;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const PROTECTIONS = ["off", "on", "relay"];
/** usdPerCall is "measured tokens at list prices" (the figures caption says so); allow rounding to four places. */
const COST_TOLERANCE = 5e-5;

/** Cross-row checks: no duplicate (id, protection), no hidden id with an "on" row, and every usdPerCall follows
 *  from its tokens at the listed rates of the run's model. Rates are per million tokens. */
function pathRowViolations(figures, out) {
  const rows = Array.isArray(figures.paths) ? figures.paths.filter(isObj) : [];
  const seen = new Set();
  for (const p of rows) {
    const key = `${p.id}/${p.protection}`;
    if (seen.has(key)) out.push(`figures.paths: duplicate row ${key}`);
    seen.add(key);
  }
  const hidden = Array.isArray(figures.hiddenWhenProtected) ? figures.hiddenWhenProtected : [];
  for (const id of hidden) {
    if (rows.some((p) => p.id === id && p.protection === "on")) {
      out.push(`figures.hiddenWhenProtected: "${id}" has an "on" row`);
    }
  }
  const rate = isObj(figures.rates) && isObj(figures.rates[figures.model]) ? figures.rates[figures.model] : null;
  if (!rate) {
    out.push(`figures.rates: no rates for the run's model "${figures.model}"`);
    return;
  }
  rows.forEach((p, i) => {
    const nums = [p.calls, p.inputTokens, p.cacheWriteTokens, p.cacheReadTokens, p.outputTokens, p.usdPerCall];
    if (!nums.every(isNum) || !["input", "output", "cacheWrite", "cacheRead"].every((k) => isNum(rate[k])) || p.calls <= 0) return;
    const usd =
      (p.inputTokens * rate.input + p.cacheWriteTokens * rate.cacheWrite + p.cacheReadTokens * rate.cacheRead +
        p.outputTokens * rate.output) / 1e6 / p.calls;
    if (Math.abs(usd - p.usdPerCall) > COST_TOLERANCE) {
      out.push(`figures.paths[${i}].usdPerCall: ${p.usdPerCall} does not follow from its tokens at the listed rates (${usd.toFixed(4)})`);
    }
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Collects one message per defect while walking the figures file. */
function checker(out) {
  const keys = (obj, allowed, where) => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) out.push(`${where}: key "${k}" is not allowed`);
  };
  return {
    keys,
    /** `v` must be a plain object; returns it, or null after reporting. */
    object(v, where) {
      if (isObj(v)) return v;
      out.push(`${where}: must be an object`);
      return null;
    },
    array(v, where) {
      if (Array.isArray(v)) return v;
      out.push(`${where}: must be an array`);
      return null;
    },
    num(v, where) {
      if (!isNum(v)) out.push(`${where}: must be a finite number`);
    },
    str(v, where) {
      if (typeof v !== "string" || v === "") out.push(`${where}: must be a non-empty string`);
    },
    date(v, where) {
      if (typeof v !== "string" || !DATE_RE.test(v)) out.push(`${where}: must be a YYYY-MM-DD date`);
    },
    /** A free-key map of finite numbers; every key matches FREE_KEY. */
    numberMap(v, where) {
      const o = this.object(v, where);
      if (!o) return;
      for (const [k, n] of Object.entries(o)) {
        if (!FREE_KEY.test(k)) out.push(`${where}: key "${k}" does not match ${FREE_KEY}`);
        this.num(n, `${where}.${k}`);
      }
    },
  };
}

/** The measured-figures file: schema 1, ONE 40-hex commit for the whole run, allowlisted keys only, and every
 *  value the shape the renderer reads (objects, arrays, finite numbers, dates, key-pattern ids).
 *  @returns {string[]} one message per defect. */
export function figuresViolations(figures) {
  const out = [];
  if (!isObj(figures)) return ["figures: not an object"];
  const c = checker(out);
  c.keys(figures, FIGURE_KEYS.top, "figures");
  if (figures.schema !== 1) out.push(`figures: schema is ${JSON.stringify(figures.schema)}, expected 1`);
  if (typeof figures.commit !== "string" || !COMMIT_RE.test(figures.commit)) {
    out.push("figures: commit must be a single 40-hex commit (a run measured at mixed commits is not one run)");
  }
  c.date(figures.runDate, "figures.runDate");
  c.str(figures.model, "figures.model");
  c.str(figures.data, "figures.data");

  const hidden = c.array(figures.hiddenWhenProtected, "figures.hiddenWhenProtected");
  (hidden ?? []).forEach((id, i) => {
    if (typeof id !== "string" || !FREE_KEY.test(id)) {
      out.push(`figures.hiddenWhenProtected[${i}]: must be a string matching ${FREE_KEY}`);
    }
  });

  (c.array(figures.paths, "figures.paths") ?? []).forEach((p, i) => {
    const where = `figures.paths[${i}]`;
    const o = c.object(p, where);
    if (!o) return;
    c.keys(o, FIGURE_KEYS.path, where);
    c.str(o.id, `${where}.id`);
    c.str(o.protection, `${where}.protection`);
    for (const k of FIGURE_KEYS.path.slice(2)) c.num(o[k], `${where}.${k}`);
    if (typeof o.id === "string" && !FREE_KEY.test(o.id)) out.push(`${where}.id: must match ${FREE_KEY}`);
    if (!PROTECTIONS.includes(o.protection)) out.push(`${where}.protection: must be one of ${PROTECTIONS.join(", ")}`);
    if (isNum(o.calls) && o.calls < 1) out.push(`${where}.calls: must be at least 1`);
    for (const k of FIGURE_KEYS.path.slice(2)) if (isNum(o[k]) && o[k] < 0 && k !== "calls") out.push(`${where}.${k}: must not be negative`);
    if (isNum(o.protectionUnverifiedCalls) && isNum(o.calls) && o.protectionUnverifiedCalls > o.calls) {
      out.push(`${where}.protectionUnverifiedCalls: exceeds calls`);
    }
  });
  pathRowViolations(figures, out);

  const b = c.object(figures.behaviour, "figures.behaviour");
  if (b) {
    c.keys(b, FIGURE_KEYS.behaviour, "figures.behaviour");
    for (const k of ["protectedNameHitsOn", "emailHitsOn", "positiveControlHitsOff"]) c.num(b[k], `figures.behaviour.${k}`);
    for (const k of ["documentedExceptionHitsOn", "inferenceGeo", "requests"]) c.numberMap(b[k], `figures.behaviour.${k}`);
  }

  const r = c.object(figures.relayKeyCheck, "figures.relayKeyCheck");
  if (r) {
    c.keys(r, FIGURE_KEYS.relayKeyCheck, "figures.relayKeyCheck");
    (c.array(r.runs, "figures.relayKeyCheck.runs") ?? []).forEach((run, i) => {
      const where = `figures.relayKeyCheck.runs[${i}]`;
      const o = c.object(run, where);
      if (!o) return;
      c.keys(o, FIGURE_KEYS.relayRun, where);
      c.str(o.path, `${where}.path`);
      c.num(o.coldExtraMs, `${where}.coldExtraMs`);
    });
    if (r.warmExtraMs !== null) c.num(r.warmExtraMs, "figures.relayKeyCheck.warmExtraMs");
  }

  const rates = c.object(figures.rates, "figures.rates");
  if (rates) {
    c.date(rates.fetchedAt, "figures.rates.fetchedAt");
    for (const [k, v] of Object.entries(rates)) {
      if (k === "fetchedAt") continue;
      if (!FREE_KEY.test(k)) out.push(`figures.rates: key "${k}" does not match ${FREE_KEY}`);
      const o = c.object(v, `figures.rates.${k}`);
      if (!o) continue;
      c.keys(o, FIGURE_KEYS.rate, `figures.rates.${k}`);
      for (const f of FIGURE_KEYS.rate) c.num(o[f], `figures.rates.${k}.${f}`);
    }
  }
  return out;
}

const EVIDENCE_ID_RE = /(?<![\p{L}\p{N}])E(\d+)(?![\p{L}\p{N}])/gu;
const EVIDENCE_ROW_RE = /^\s*\|\s*E(\d+)\s*\|/;
// The evidence table's header, English then German; no other table's rows are evidence rows.
const EVIDENCE_HEADER_RE =
  /^\s*\|\s*Id\s*\|\s*(?:Claim|Aussage)\s*\|\s*(?:Label|Belegart)\s*\|\s*(?:Source|Quelle)\s*\|\s*$/;

/** Evidence ids cited in one text's prose (outside fences and generated blocks), as a sorted unique list. In the
 *  appendix (`isAppendix`) a table row's own id cell defines the row and is not a citation; on a page it is one. */
function citedEvidenceIds(src, isAppendix = false) {
  const { lines, blocks } = scanBlocks(src);
  const fenced = fencedFlags(lines);
  const ids = new Set();
  lines.forEach((line, i) => {
    if (fenced[i] || blocks.some((b) => i >= b.begin && i <= b.end)) return;
    const text = isAppendix ? line.replace(EVIDENCE_ROW_RE, "|") : line;
    for (const m of text.matchAll(EVIDENCE_ID_RE)) ids.add(Number(m[1]));
  });
  return [...ids].sort((a, b) => a - b);
}

/** Row ids (`| E<n> |`) of an appendix evidence table, outside generated blocks and fenced code. */
function evidenceRowIds(appendix) {
  const { lines, blocks } = scanBlocks(appendix);
  const fenced = fencedFlags(lines);
  const ids = new Set();
  let inTable = false;
  lines.forEach((line, i) => {
    if (fenced[i] || blocks.some((b) => i >= b.begin && i <= b.end)) {
      inTable = false;
      return;
    }
    if (EVIDENCE_HEADER_RE.test(line)) {
      inTable = true;
      return;
    }
    if (!/^\s*\|/.test(line)) {
      inTable = false;
      return;
    }
    const m = inTable ? EVIDENCE_ROW_RE.exec(line) : null;
    if (m) ids.add(Number(m[1]));
  });
  return ids;
}

const idList = (ids) => [...ids].sort((x, y) => x - y).map((n) => "E" + n).join(", ");

/** Evidence ids: every `E<n>` a page cites must be a row id (`| E<n> |`, outside generated blocks and fenced
 *  code) of the appendix table, and the English and German pages of one reader must cite identical id sets.
 *  `pages` maps `<lang>/<file>` to its text. With `appendixDe`, German pages are checked against it and both
 *  appendices must carry the same row ids; without it, every page is checked against `appendix`.
 *  @returns {string[]} one message per defect. */
export function evidenceViolations(pages, appendix, appendixDe) {
  const out = [];
  const enRows = evidenceRowIds(appendix);
  const deRows = appendixDe === undefined ? enRows : evidenceRowIds(appendixDe);
  if (idList(enRows) !== idList(deRows)) {
    out.push(`appendix: evidence row ids differ (en [${idList(enRows)}]; de [${idList(deRows)}])`);
  }
  for (const [lang, src, rows] of [["en", appendix, enRows], ["de", appendixDe ?? appendix, deRows]]) {
    for (const n of citedEvidenceIds(src, true)) {
      if (!rows.has(n)) out.push(`${lang}/appendix.md: cites E${n}, which is not a row of the appendix evidence table`);
    }
    if (appendixDe === undefined) break;
  }
  const cited = {};
  for (const [name, src] of Object.entries(pages)) {
    cited[name] = citedEvidenceIds(src);
    const rows = name.startsWith("de/") ? deRows : enRows;
    for (const n of cited[name]) if (!rows.has(n)) out.push(`${name}: cites E${n}, which is not a row of the appendix evidence table`);
  }
  for (const name of Object.keys(pages)) {
    const m = /^en\/(.+)$/.exec(name);
    if (!m) continue;
    const twin = `de/${m[1]}`;
    if (!Object.hasOwn(pages, twin)) continue;
    if (cited[name].join(",") !== cited[twin].join(",")) {
      out.push(`${m[1]}: evidence ids differ (en [${idList(cited[name])}]; de [${idList(cited[twin])}])`);
    }
  }
  return out;
}

/** A README must link every page of both languages (`](en/<file>)` and `](de/<file>)`). */
export function linkViolations(readme, files) {
  const out = [];
  for (const lang of PACK_LANGS) {
    for (const f of files) if (!readme.includes(`](${lang}/${f})`)) out.push(`README.md: no link to ${lang}/${f}`);
  }
  return out;
}
