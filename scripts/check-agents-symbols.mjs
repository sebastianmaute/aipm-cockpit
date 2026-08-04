#!/usr/bin/env node
// scripts/check-agents-symbols.mjs — fail when AGENTS.md names a code symbol
// that does not exist.
//
// WHY: nothing gates AGENTS.md, and a false symbol name there does not stay in
// the doc. `migrateTaskStatus` (a function that never existed) was read by three
// separate contributors in one release; each grepped src/, found nothing to
// contradict it, and wrote the claim into code comments and a commit message as
// justification for editing test fixtures. This catches that class: not whether
// a CLAIM is true, only whether the thing it names is real.
//
// ★ THE HARD PART IS NOT MATCHING, IT IS SUPPRESSION. AGENTS.md deliberately
// names symbols that do NOT exist — as prohibitions ("`tursoUrlRegionWarning`
// … was removed. Do NOT reintroduce it"), as rejected designs ("a generic
// `makeEntityCrudHandlers` factory was evaluated and deliberately NOT built"),
// and as history ("the old `RegistersBand` wrapper was RETIRED"). Those are the
// file's most valuable lines. A checker that flags them gets switched off within
// a release, and this repo's own rule is that a defeated gate is worse than no
// gate — it reports success. So an absent symbol is only a finding when nothing
// nearby marks it as deliberately gone.
//
// ★ Whole-identifier matching, not substring. `onGrant` looks present under a
// substring search because the code has `onGrantWrite`; the doc naming the
// wrong prop is exactly what this should catch.
//
// ★★ TWO HOLES, both known, neither closed. Say so rather than implying cover:
//
// 1. COMMENT-SHADOWING. The scan reads raw file text, so a name surviving only
//    in a CODE COMMENT counts as existing — including the comment that records
//    its own rename. Two live stale claims passed this gate on the day it
//    shipped (`NoteBody`, whose sink is really `RichTextView`, and
//    `fetchBookingsForCustomer`), each kept "alive" by exactly one comment.
//    Stripping comments was considered and REJECTED: many legitimately-named
//    things are string literals or key names (`propose_project`,
//    `knowledge_items`, i18n keys), so it trades this hole for false findings,
//    and a gate that cries wolf gets switched off.
// 2. PROXIMITY BLEED. An absence marker within the window suppresses ANY symbol
//    near it, not just the one it describes — `onToggleComplete` is masked today
//    by an unrelated "no such function exists" two lines away. No purely lexical
//    rule separates "this marker belongs to this symbol" from "a marker is
//    nearby".
//
// Both mean a GREEN run is weaker evidence than it looks: it proves no name is
// absent EVERYWHERE, not that every claim is true. Grep before trusting a bullet.

import fs from "node:fs";
import path from "node:path";

// ★★ AGENTS.md plus every file split out of it. The subsystem reference moved to
// docs/AGENTS/ on 2026-08-04 so it would stop costing ~59k tokens on every
// session; scanning only AGENTS.md afterwards would have silently dropped 73% of
// the prose this gate exists to police. The directory is globbed rather than
// listed so a NEW subsystem file is covered the moment it is written — an
// explicit list is a thing you forget to extend.
const DOC_DIR = "docs/AGENTS";
const DOCS = [
  "AGENTS.md",
  ...(fs.existsSync(DOC_DIR)
    ? fs
        .readdirSync(DOC_DIR)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => path.join(DOC_DIR, f))
    : []),
];
const CODE_DIRS = ["src", "scripts", "e2e"];
const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Backticked text that looks like a TypeScript identifier the doc is
 *  asserting exists in this repo. Deliberately narrow: mixed case (so `Task`
 *  and `sanitizeText` qualify but `config` and `TODO` do not), no dots, no
 *  dashes, length > 3. Anything with a dot is an external API path or a member
 *  expression; anything starting `--` is a CSS token. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Words that mark a symbol as deliberately absent.
 *
 *  ★★ Checked against the whole PARAGRAPH, not the line. AGENTS.md bullets wrap
 *  across many lines and the marker routinely lands on a different one than the
 *  mention — "The old flash-only `pendingFlash`/" ends a line and "were REMOVED"
 *  begins the next. Line-scoped matching produced nine false findings for this
 *  reason alone, which is precisely the noise that gets a gate switched off.
 *
 *  Keep this list tight anyway: every entry is a way for a real stale claim to
 *  hide inside a paragraph that happens to discuss a removal. */
const ABSENCE_MARKERS = [
  "REMOVED",
  "RETIRED",
  "DELETED",
  "GONE",
  "is gone",
  "are gone",
  "no such",
  "does not exist",
  "never existed",
  "NOT built",
  "not built",
  "Do NOT",
  "do NOT",
  "the dead ",
  "takes no ",
  "was renamed",
  "were renamed",
  "RENAMED",
  "(was ",
  "deprecated",
  "vestigial",
];

/** Symbols that are legitimately absent and carry no absence marker, each with
 *  the reason. Additions need a reason — an unexplained entry here is how this
 *  gate rots into a rubber stamp.
 *
 *  ★ Kept to only what ACTUALLY fires. `known.has(name)` short-circuits before
 *  this map, so an entry for a name that also appears in the code is dead — and
 *  worse than dead: if that name later leaves the codebase, the entry silently
 *  masks the stale claim instead of reporting it. A first draft carried 25 such
 *  entries (browser APIs, upstream TimeLog fields, `Record`) that all resolve in
 *  code anyway. Before adding one, confirm the name is absent from
 *  src/scripts/e2e — otherwise you are pre-authorising a future false claim. */
const ALLOWLIST = new Map([
  ["compareX", "placeholder for a panel's own comparator, not a real function"],
  ["resolveJsonModule", "a tsconfig compiler option, not repo code"],
  ["UnsupportedApiVersion", "an upstream TimeLog API error string"],
]);

/** ★★★ THIS FILE MUST EXCLUDE ITSELF, and the reason is not hygiene.
 *  It scans `scripts/`, and it NAMES in its own comments and allowlist exactly
 *  the symbols it is meant to catch — `migrateTaskStatus`, the retired flash
 *  channel, the rejected factories. Scanning itself therefore makes every one
 *  of them "exist", so the gate silently stops finding the class it was built
 *  for. Caught only because a real stale claim went missing at every proximity
 *  window; the tool was defeating itself and still exiting 0 on the cases it
 *  did report. */
const SELF = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function collectIdentifiers(dir, into) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectIdentifiers(path.join(dir, entry.name), into);
      continue;
    }
    if (!CODE_EXT.test(entry.name)) continue;
    if (path.resolve(dir, entry.name) === SELF) continue;
    const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
    for (const m of src.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) into.add(m[0]);
  }
}

function main() {
  for (const doc of DOCS) {
    if (!fs.existsSync(doc)) {
      console.error(`${doc} not found — run from the repo root.`);
      process.exit(2);
    }
  }
  // ★★ Same principle as the identifier floor below: a gate that scans nothing
  // passes everything. If the split files vanish (moved, renamed, folder gone)
  // this must FAIL rather than quietly go back to checking AGENTS.md alone —
  // that would leave ~73% of the prose unscanned while still printing a pass.
  if (DOCS.length < 2) {
    console.error(
      `no ${DOC_DIR}/*.md found — the subsystem reference would go unscanned. ` +
        `Refusing to report a pass.`,
    );
    process.exit(2);
  }

  const known = new Set();
  for (const dir of CODE_DIRS) {
    if (fs.existsSync(dir)) collectIdentifiers(dir, known);
  }
  // A gate that scans nothing passes everything. Fail loudly instead.
  if (known.size < 1000) {
    console.error(
      `only ${known.size} identifiers found across ${CODE_DIRS.join(", ")} — ` +
        `the scan is broken, not the doc. Refusing to report a pass.`,
    );
    process.exit(2);
  }

  // ★★ Suppression is PROXIMITY-based, and both simpler rules were tried and
  // rejected against the real file:
  //   - same LINE only  -> 9 false findings, because these bullets wrap and the
  //                        marker lands on the next line ("…`pendingFlash`/" \n
  //                        "`requestFlash`… were REMOVED").
  //   - whole PARAGRAPH -> hid a REAL stale claim: `onToggleComplete` sits in a
  //                        long bullet that happens to discuss a removal
  //                        elsewhere, so the marker suppressed it.
  // A marker must therefore be NEAR the mention. 240 chars is about two wrapped
  // lines either side — wide enough for the wrap case, narrow enough that an
  // unrelated removal later in the same bullet does not grant cover.
  const PROXIMITY = 240;

  const findings = [];
  // ★ `seen` spans ALL docs on purpose: one dead name restated in three
  // subsystem files is one stale claim, not three findings. `verified` likewise
  // counts distinct names, so the pass line does not inflate with the split.
  const seen = new Set();
  const verified = new Set(); // doc symbols that resolved — the honest pass count

  for (const docPath of DOCS) {
    const lines = fs.readFileSync(docPath, "utf8").split(/\r?\n/);
    const doc = lines.join("\n");
    const lineStart = [];
    {
      let off = 0;
      for (const l of lines) {
        lineStart.push(off);
        off += l.length + 1;
      }
    }
    // ★★ Proximity is scoped to ONE file. Concatenating the docs first would let
    // an absence marker at the top of one file suppress a real stale claim at the
    // bottom of the previous one — the PROXIMITY BLEED hole above, widened across
    // file boundaries where it is even harder to spot.
    const markedNear = (absoluteIndex) => {
      const from = Math.max(0, absoluteIndex - PROXIMITY);
      // ★ Collapse whitespace before matching. These bullets wrap mid-phrase, so
      // "REPLACING the dead\n  `onTakeTour`" leaves a NEWLINE where the marker
      // "the dead " expects a space — the suppression silently failed and the
      // line was reported as a stale claim when the doc was correct.
      const window = doc.slice(from, absoluteIndex + PROXIMITY).replace(/\s+/g, " ");
      return ABSENCE_MARKERS.some((w) => window.includes(w));
    };

    lines.forEach((line, i) => {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const name = m[1];
        if (!IDENTIFIER.test(name)) continue;
        if (name.length <= 3) continue;
        if (!/[a-z]/.test(name) || !/[A-Z_]/.test(name)) continue; // mixed case only
        if (known.has(name)) {
          verified.add(name);
          continue;
        }
        if (ALLOWLIST.has(name) || seen.has(name)) continue;
        if (markedNear(lineStart[i] + m.index)) continue;
        seen.add(name);
        findings.push({ doc: docPath, name, line: i + 1, text: line.trim() });
      }
    });
  }

  if (findings.length === 0) {
    console.log(
      `${DOCS.length} doc(s): ${verified.size} named symbols all resolve ` +
        `(against ${known.size} identifiers in ${CODE_DIRS.join("/")})`,
    );
    return;
  }

  console.error(`${findings.length} symbol(s) named in the docs do not exist in the codebase:\n`);
  for (const f of findings) {
    console.error(`  ${f.doc}:${f.line}  \`${f.name}\``);
    console.error(`    ${f.text.slice(0, 140)}`);
  }
  console.error(
    `\nEach is one of:\n` +
      `  - a stale claim -> fix the doc (this is what the gate is for)\n` +
      `  - a symbol you renamed -> update the doc to the new name\n` +
      `  - deliberately absent -> say so NEAR the mention (within ~240 chars) using one of:\n` +
      `      ${ABSENCE_MARKERS.slice(0, 8).join(", ")} ...\n` +
      `  - genuinely not repo code -> add it to ALLOWLIST with a reason\n`,
  );
  process.exit(1);
}

main();
