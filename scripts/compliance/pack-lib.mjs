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
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
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
    if (!m) return;
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

/** Claims the pack must never make, in either language. Matched
 *  case-insensitively on word boundaries; a single German word also matches its
 *  adjective endings and hyphen compounds (`DSGVO-konforme`), but not
 *  `Konformität`. */
export const DENY_PHRASES = Object.freeze({
  en: Object.freeze([
    "compliant",
    "not high-risk",
    "eu-hosted",
    "hosted in the eu",
    "never leaves",
    "no personal data is sent",
    "fully auditable",
    "instant revocation",
    "always in the loop",
  ]),
  de: Object.freeze([
    "konform",
    "kein hochrisiko",
    "nicht hochrisiko",
    "in der eu gehostet",
    "verlässt nie",
    "verlassen nie",
    "keine personenbezogenen daten",
    "vollständig auditierbar",
    "sofortiger widerruf",
    "immer ein mensch",
  ]),
});

const DE_ENDINGS = "(?:e|er|es|en|em)?";

function phraseRegex(phrase, lang) {
  const body = phrase
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const ending = lang === "de" && !/\s/.test(phrase) ? DE_ENDINGS : "";
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${ending}(?![\\p{L}\\p{N}])`, "iu");
}

/** Blank out what a claim check must not see: inline code and quotations. */
function stripExempt(line) {
  const blank = (m) => " ".repeat(m.length);
  return line
    .replace(/`[^`]*`/g, blank)
    .replace(/"[^"]*"/g, blank)
    .replace(/“[^”]*”/g, blank)
    .replace(/„[^“”]*[“”]/g, blank);
}

/** Deny-list hits outside fenced code, inline code, `>` lines and quotations. */
export function claimViolations(src, lang) {
  const phrases = DENY_PHRASES[lang];
  if (!phrases) throw new Error(`unknown language "${lang}"`);
  const regexes = phrases.map((p) => [p, phraseRegex(p, lang)]);
  const lines = splitLines(src);
  const fenced = fencedFlags(lines);
  const out = [];
  lines.forEach((line, i) => {
    if (fenced[i] || line.trimStart().startsWith(">")) return;
    const text = stripExempt(line);
    for (const [phrase, re] of regexes) {
      if (re.test(text)) out.push(`line ${i + 1}: denied phrase "${phrase}"`);
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
