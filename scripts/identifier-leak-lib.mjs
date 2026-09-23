/** Pure half of the identifier-leak gate (`check-identifier-leaks.mjs` owns the
 *  I/O and the exit codes; no shebang here — a `#!` on an imported `.mjs` makes
 *  vitest throw naming the WRONG file).
 *
 *  ★★★ THE LIST OF IDENTIFIERS IS NEVER IN THIS REPOSITORY. A tracked pattern
 *  file would disclose, in the public tree, exactly what the gate exists to keep
 *  out of it. The CLI reads it from a file named by an environment variable, and
 *  every fixture in the test file is fictional.
 *
 *  List format, one entry per line:
 *    - blank lines and lines starting with `#` are ignored;
 *    - `@<class> ` (optional prefix) names the entry's CLASS — the only thing the
 *      CLI ever prints about a hit, so a report never echoes the identifier;
 *    - `word:<text>` matches <text> only as a whole word (so a short token does
 *      not flag every longer word that contains it) — the boundary is Unicode-aware
 *      (`\p{L}`/`\p{N}`/`_` count as word characters, not just ASCII), so a
 *      fragment glued directly onto a non-ASCII letter (e.g. a German umlaut) is
 *      correctly seen as part of that longer word, not a separate whole word;
 *    - anything else is a literal, matched as a substring.
 *  All matching is case-insensitive.
 */
import { ABSENCE_MARKERS } from "./agents-symbols-lib.mjs";

const WORD_PREFIX = "word:";
const CLASS_RE = /^@([A-Za-z0-9_-]+)\s+(.*)$/;
/** git's own binary heuristic: a NUL byte within the first 8000 bytes. */
const BINARY_PROBE_BYTES = 8000;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse the raw list-file text into entry strings (comments and blanks gone). */
export function parseList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

/** Compile list entries into `{ cls, re }` patterns. Throws on an entry with no
 *  text — an empty pattern would match every line, or none, and neither is a
 *  scan. */
export function buildPatterns(list) {
  return list.map((raw, i) => {
    let entry = raw.trim();
    let cls = `entry-${i + 1}`;
    const m = CLASS_RE.exec(entry);
    if (m) {
      cls = m[1];
      entry = m[2].trim();
    }
    const isWord = entry.startsWith(WORD_PREFIX);
    const text = isWord ? entry.slice(WORD_PREFIX.length) : entry;
    if (text.length === 0) {
      throw new Error(`list entry ${i + 1} (class ${cls}) has no text to match`);
    }
    const body = escapeRegExp(text);
    const source = isWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
    return { cls, re: new RegExp(source, "iu") };
  });
}

/** Classify one line. `leak` = a pattern matched and no absence marker is on the
 *  line; `allowed` = matched, but the line says the thing is deliberately absent;
 *  `clean` = nothing matched. ★★ The MARKER suppresses, never the file path — a
 *  path-based exemption would make every document a blind spot. `path` is taken
 *  for the report's sake and deliberately does not influence the verdict. */
export function classifyHit(path, line, patterns) {
  const classes = patterns.filter((p) => p.re.test(line)).map((p) => p.cls);
  if (classes.length === 0) return { kind: "clean", path, classes };
  const marked = ABSENCE_MARKERS.some((w) => line.includes(w));
  return { kind: marked ? "allowed" : "leak", path, classes };
}

/** True when `buf` looks binary by git's heuristic (the files `git grep -I`
 *  skips). */
export function isBinary(buf) {
  const n = Math.min(buf.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

/** Lines of the assistant trailers a commit or tag message must not carry, matched by KEY at line
 *  start, case-insensitively. The one definition: `verify-rewrite.mjs` (history rewrite check) and
 *  `check-commit-message-leaks.mjs` (CI's message scan) both import it. */
export const TRAILER_RE = /^\s*(claude-session:|co-authored-by:\s*claude\b)/i;

/** Scan one commit or tag message. Returns the number of lines any pattern hit, those lines per
 *  class (a line hit by two classes counts once in `hitLines` and once under each class), and the
 *  number of trailer lines. ★ No absence-marker suppression, unlike `classifyHit`: a message is
 *  permanent history, and `verify-rewrite.mjs --expect clean` counts it the same way. */
export function scanMessage(text, patterns) {
  let hitLines = 0;
  let trailerLines = 0;
  const classes = {};
  for (const line of text.split(/\r?\n/)) {
    if (TRAILER_RE.test(line)) trailerLines += 1;
    const hit = patterns.filter((p) => p.re.test(line)).map((p) => p.cls);
    if (hit.length === 0) continue;
    hitLines += 1;
    for (const cls of hit) classes[cls] = (classes[cls] ?? 0) + 1;
  }
  return { hitLines, trailerLines, classes };
}

/** Every non-clean line of one file's text, with 1-based line numbers. */
export function scanText(path, text, patterns) {
  const out = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const r = classifyHit(path, line, patterns);
    if (r.kind !== "clean") out.push({ ...r, line: idx + 1 });
  });
  return out;
}
