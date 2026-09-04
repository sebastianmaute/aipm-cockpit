// The SOURCE-comment symbol report's shared layer.
//
// ★★★ WHY THIS EXISTS AT ALL. `check-agents-symbols.mjs` gates `AGENTS.md` and
// `docs/AGENTS/*.md` and NOTHING ELSE, so a backticked identifier that never
// existed, sitting in a docstring in `src/`, is completely ungated — forever.
// That is not hypothetical: `requireRowAndToken` shipped into a reproduce command
// in `chat-proposal-apply.ts` on 2026-09-04. It named a function that has never
// existed (the real one is `requireTaskWriteToken`), and the command still
// returned the right answer because `requireToken(` matched a substring of the
// real call — so it read as verified while half the pattern was fiction. It came
// in during a round that was CORRECTING a different unverifiable claim in the
// same docstring.
//
// ★★★ THIS IS A REPORT, NOT A GATE, AND THAT DISTINCTION IS LOAD-BEARING RATHER
// THAN MODEST. `check-agents-symbols.mjs` (the "TWO HOLES" block) records that
// stripping comments from the identifier universe was CONSIDERED AND REJECTED,
// because many legitimately-named things are string literals or key names, so
// stripping trades comment-shadowing for false findings — "and a gate that cries
// wolf gets switched off." That reasoning is correct for a BLOCKING gate whose
// every red must be real. It inverts here: this runs in no CI job, a human
// triages its output once, a false positive costs a glance, and a missed invented
// name ships forever. Same mechanism, opposite correct choice, because the
// consumer differs. Do NOT "align" this with the gate by restoring comment text
// to the universe — that would make it vacuous for the only class it exists to
// find (see the measurement in the next paragraph).
//
// ★★★ MEASURED, NOT REASONED. A first cut built the universe from raw file text,
// exactly as the gate does. It reported ZERO unresolved names over 516 cited
// across the branch — and would have reported zero with `requireRowAndToken`
// still in the tree, because that name resolved against its own docstring. The
// control that exposed it: `migrateTaskStatus`, which `AGENTS.md` documents as a
// function that never existed, RESOLVED under the raw-text universe; its only two
// hits in `src`/`scripts`/`e2e` are both comments. Switching to a code-only
// universe took the same corpus from 0 findings to 13.
//
// ★★ THE GATE'S STATED OBJECTION IS ANSWERED RATHER THAN IGNORED. String and
// no-substitution-template literal CONTENTS are collected explicitly below, so
// `propose_project`, `knowledge_items` and i18n key names stay in the universe.
// Only comment text is excluded.
//
// ★★ THE TYPESCRIPT PARSER DOES THE CODE/COMMENT SPLIT, never a hand-rolled
// stripper. Four hand-rolled comment strippers exist in this repo's history and
// all four gave wrong answers; over-blanking is the dangerous direction because
// it removes CODE from the universe and manufactures findings.
//
// ★ The NAME predicate is imported from `agents-symbols-lib.mjs` rather than
// re-declared, for the reason that module gives for its own extraction: two
// copies cannot disagree about what counts as an identifier only while nobody
// edits one of them.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";

import {
  ALLOWLIST,
  isGatedSymbolName,
  markedNear,
} from "./agents-symbols-lib.mjs";

const require = createRequire(import.meta.url);
/** The parser is a devDependency of this repo; a report that cannot parse is a
 *  report that must say so rather than fall back to a lexer of its own. */
const ts = require("typescript");

const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

/** ★★★ EVERY FILE THAT NAMES A SYMBOL IN ORDER TO CHECK IT MUST BE LISTED HERE.
 *  This module and its test quote — as STRING LITERALS, which this collector
 *  deliberately reads — the exact names the report exists to catch. Scanning them
 *  puts `requireRowAndToken` and `migrateTaskStatus` into the universe, the
 *  built-in control then reports PRESENT, and the report stops finding its own
 *  class.
 *
 *  ★★ This is the same hole `agents-symbols-lib.mjs` records for the gate, and
 *  its note that "the hole is PER-CONSUMER, not per-gate" is why a new consumer
 *  needs its own list rather than inheriting one. Two of the three files below
 *  would defeat the report on their own.
 *
 *  ★★ THE REPORT CANNOT DETECT ITS OWN DAMAGE. Dropping an entry here makes it
 *  report FEWER unresolved names and still exit 0 — a healthy run and a defeated
 *  one are indistinguishable from outside. The built-in control (below) is the
 *  detector, and `src-symbols-lib.test.mjs` pins membership. */
export const REPORT_SELF_FILES = new Set([
  path.join(HERE, "check-src-symbols.mjs"),
  path.join(HERE, "src-symbols-lib.mjs"),
  path.join(HERE, "src-symbols-lib.test.mjs"),
]);

/** Names used by the built-in control.
 *
 *  ★★★ `absent` MUST name things that genuinely do not exist in this repo's CODE,
 *  and `present` things that certainly do. The control is the ONLY thing standing
 *  between a working report and one that examined nothing — a scan reporting zero
 *  findings is indistinguishable from a scan whose corpus was empty. Both
 *  directions are asserted: absent-reported-present means the universe swallowed
 *  a comment (self-exclusion broke); present-reported-absent means the collector
 *  stopped reading code at all.
 *
 *  ★★ `migrateTaskStatus` is the durable one — `AGENTS.md` documents it as a
 *  function that never existed and it is quoted only in gate commentary, so it
 *  cannot quietly become real. `requireRowAndToken` is the branch's own instance
 *  and is retained because a control drawn from a real incident does not drift
 *  into folklore. If either ever becomes a real symbol, the control fails LOUDLY
 *  rather than silently — which is the correct direction. */
export const CONTROL_ABSENT = ["requireRowAndToken", "migrateTaskStatus"];
export const CONTROL_PRESENT = ["sanitizeRichText", "applyStatusChange"];

/** Collect identifiers and string-literal words from ONE file's CODE, ignoring
 *  every comment. Returns the number of nodes visited so a caller can tell a
 *  parsed file from a silently-skipped one. */
export function collectCodeIdentifiersFromFile(file, into) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let visited = 0;
  (function walk(node) {
    visited += 1;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      into.add(node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const m of node.text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) into.add(m[0]);
    }
    node.forEachChild(walk);
  })(sf);
  return visited;
}

/** Walk `dir`, adding every CODE identifier to `into`. `alsoExclude` is a set of
 *  absolute paths to skip, in addition to {@link REPORT_SELF_FILES}. Returns the
 *  count of files parsed — a caller that does not check it cannot tell a full
 *  walk from an empty one. */
export function collectCodeIdentifiers(dir, into, alsoExclude = new Set()) {
  let parsed = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return parsed;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      parsed += collectCodeIdentifiers(full, into, alsoExclude);
      continue;
    }
    if (!CODE_EXT.test(entry.name)) continue;
    if (REPORT_SELF_FILES.has(full) || alsoExclude.has(full)) continue;
    try {
      collectCodeIdentifiersFromFile(full, into);
      parsed += 1;
    } catch {
      // An unparseable file contributes nothing rather than aborting the report.
      // It is counted as not-parsed so the population line stays honest.
    }
  }
  return parsed;
}

/** True when a source line is a comment line: `//`, a block opener, or a JSDoc
 *  continuation. Deliberately line-shaped rather than range-shaped — this decides
 *  which lines to HARVEST citations from, and a citation inside a string literal
 *  that merely looks like a comment is a false positive in a report, not a defect
 *  in a gate.
 *
 *  ★ `*` must not match the block TERMINATOR, or every closing line is harvested. */
export function isCommentLine(line) {
  return /^\s*(\/\/|\/\*|\*(?!\/))/.test(line);
}

/** Backticked, identifier-shaped, mixed-case names cited on one comment line.
 *
 *  ★★ A backticked span is often a COMMAND or a phrase (`grep -n "foo(" src/x.ts`),
 *  so identifier-shaped tokens are taken OUT of the span rather than requiring the
 *  whole span to be one name. That is what surfaced the branch's real instance,
 *  which sat inside a `grep` invocation.
 *
 *  ★ Mixed-case only, mirroring the gate: SCREAMING_CASE constants are skipped
 *  there and skipped here, so the two cannot disagree about what counts as a name
 *  to check. It is a known, shared blind spot rather than a difference. */
export function citedNamesOnLine(line) {
  const out = [];
  for (const span of line.matchAll(/`([^`\n]+)`/g)) {
    for (const tok of span[1].matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
      const name = tok[0];
      // ★ The gate's own predicate, imported rather than restated. Its rule is
      //   identifier-shaped, longer than three characters, and MIXED CASE.
      if (!isGatedSymbolName(name)) continue;
      // ★★ The gate's ALLOWLIST is reused verbatim: it holds genuinely non-repo
      //   names (browser APIs, upstream fields) each WITH a reason. Re-deriving a
      //   second allowlist here is how the two would drift, and widening either
      //   one to quieten a report is how a check gets defeated — so this file
      //   adds no entries of its own.
      if (ALLOWLIST.has(name)) continue;
      out.push(name);
    }
  }
  return out;
}

/** Harvest `{name, file, line, text}` citations from every comment line of the
 *  given files. */
export function citationsInFiles(files) {
  const out = [];
  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = src.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isCommentLine(line)) {
        for (const name of citedNamesOnLine(line)) {
          // ★★ ABSENCE SUPPRESSION, reusing the gate's own `markedNear`/PROXIMITY
          //   rather than a rule of this file's own. A source comment routinely
          //   names a symbol precisely to say it is GONE ("the old `mimeForKind`
          //   fallback", "REPLACES a `documentCount` heuristic") and reporting
          //   those is the noise that gets a check switched off.
          //   ★ It inherits the gate's PROXIMITY BLEED hole with it: a marker
          //   within the window suppresses ANY name near it, not only the one it
          //   describes. Accepted here for the same reason the gate accepts it —
          //   no purely lexical rule separates the two — and cheaper here, since
          //   a missed report line is not a missed merge block.
          if (markedNear(src, offset + line.indexOf(name))) continue;
          out.push({ name, file, line: i + 1, text: line.trim() });
        }
      }
      offset += line.length + 1;
    }
  }
  return out;
}

/** Harvest citations from the ADDED lines of a unified diff (`git diff -U0`).
 *  Used by `--since`, so a reviewer can scope the report to one branch. */
export function citationsInDiff(diff) {
  const out = [];
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1);
    if (!isCommentLine(body)) continue;
    for (const name of citedNamesOnLine(body)) {
      // ★★ WEAKER ABSENCE SUPPRESSION THAN THE FILE PATH, and the difference is
      //   stated rather than hidden: a diff hunk has no surrounding document, so
      //   the marker window is this ONE line instead of PROXIMITY chars either
      //   side. A comment whose "was REMOVED" lands on the next line is therefore
      //   reported here and not by `citationsInFiles`. That is the safe direction
      //   for a report — extra lines to triage, never a silent drop — but do not
      //   read the two modes as equivalent.
      if (markedNear(body, body.indexOf(name))) continue;
      out.push({ name, file, line: null, text: body.trim() });
    }
  }
  return out;
}

/** Every code file under `dir`, excluding this report's own files. */
export function listCodeFiles(dir, alsoExclude = new Set()) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCodeFiles(full, alsoExclude));
    else if (CODE_EXT.test(entry.name) && !REPORT_SELF_FILES.has(full) && !alsoExclude.has(full)) {
      out.push(full);
    }
  }
  return out;
}
