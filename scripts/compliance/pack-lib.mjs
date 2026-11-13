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

export const BLOCK_NAMES = Object.freeze([
  "ai-paths",
  "ai-paths-people",
  "browser-hosts",
  "server-destinations",
  "deployment-switches",
  "open-gaps",
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
    { re: "instant(?:ly)?\\s+revo(?:cation|ked)", label: "instant revocation" },
    "always in the loop",
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

/** Register citations in a pack file's prose. The rule: `§` directly followed
 *  (no space) by a number of three or more digits, at least 400. Statute
 *  sections are never register citations and are skipped: `§§`, `§ 87` (space),
 *  any number below 400, a number followed by `(` or by `Abs.`/`Nr.`/`No.`/`S.`/
 *  `Satz`, and a number preceded or followed by one of `STATUTE_ABBREVIATIONS`
 *  (`BetrVG §90`, `§401 SGB`, `§611a BGB`; a single lowercase letter right after
 *  the number belongs to the section). Generated block bodies and fenced code
 *  are not prose and are skipped too.
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
  lines.forEach((line, i) => {
    if (fenced[i] || inBlock(i)) return;
    for (const m of line.matchAll(cite)) {
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
