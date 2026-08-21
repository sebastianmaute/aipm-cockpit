// The symbol gate's SHARED layer, split out so the open-followups gate
// (`followup-claims-lib.mjs`) can apply the SAME predicate rather than growing
// a second, drifting copy.
//
// ★ NOT a pure layer, despite the shape of the exports: `collectIdentifiers`
// walks the tree with fs. The seam is drawn there deliberately — it is where
// GATE_SELF_FILES is applied, and a second gate that scanned the code itself
// would re-open the self-exclusion hole. The CLI (`check-agents-symbols.mjs`)
// keeps doc discovery, reporting and exit codes.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Shape only: a bare identifier. A dot means an external API path or a member
 *  expression, a leading `--` means a CSS token; both are excluded here. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The gate's predicate, as one function so two gates cannot drift.
 *
 *  Deliberately narrow: identifier-shaped, longer than three characters, and
 *  MIXED CASE — so `Task` and `sanitizeText` qualify while `config` and `TODO`
 *  do not, and every SCREAMING_CASE constant is out of scope. */
export function isGatedSymbolName(name) {
  if (!IDENTIFIER.test(name)) return false;
  if (name.length <= 3) return false;
  return /[a-z]/.test(name) && /[A-Z_]/.test(name);
}

/** Words that mark a symbol as deliberately absent.
 *
 *  ★★ Checked within PROXIMITY chars of the mention, not on the line. AGENTS.md
 *  bullets wrap across many lines and the marker routinely lands on a different
 *  one than the mention — "The old flash-only `pendingFlash`/" ends a line and
 *  "were REMOVED" begins the next. Line-scoped matching produced nine false
 *  findings for this reason alone, which is precisely the noise that gets a gate
 *  switched off.
 *
 *  Keep this list tight anyway: every entry is a way for a real stale claim to
 *  hide inside a paragraph that happens to discuss a removal. */
export const ABSENCE_MARKERS = [
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
export const ALLOWLIST = new Map([
  ["compareX", "placeholder for a panel's own comparator, not a real function"],
  ["resolveJsonModule", "a tsconfig compiler option, not repo code"],
  ["UnsupportedApiVersion", "an upstream TimeLog API error string"],
]);

// ★★ Suppression is PROXIMITY-based, and both simpler rules were tried and
// rejected against the real file:
//   - same LINE only  -> 9 false findings, because these bullets wrap and the
//                        marker lands on the next line ("…`pendingFlash`/" \n
//                        "`requestFlash`… were REMOVED").
//   - whole PARAGRAPH -> hid a REAL stale claim: as measured when this gate
//                        shipped, `onToggleComplete` sat in a long bullet that
//                        happened to discuss a removal elsewhere, so the marker
//                        suppressed it. ★ That example is HISTORICAL — the name
//                        left the docs entirely (`grep -rn "onToggleComplete"
//                        AGENTS.md docs/AGENTS/` exits 1, no match, 2026-08-10),
//                        so do not go looking for it. The RULE it bought is
//                        still live; a current example is not.
// A marker must therefore be NEAR the mention. The window below is about two
// wrapped lines either side — wide enough for the wrap case, narrow enough that
// an unrelated removal later in the same bullet does not grant cover.
//
// ★ The CLI interpolates this constant into its failure advice rather than
// restating the number, so changing the value on the next line changes the
// gate's advice with it. ★★ It said "and nowhere else in scripts/", with a grep
// attached to confirm — and two commits later that grep returned three hits,
// because the second gate's prose restated the number twice. A "this appears
// exactly once" clause about a shared constant cannot be maintained and is not
// worth the maintenance: prose elsewhere now says "the shared window" and names
// no figure. A test pins the boundary with a LITERAL distance — a fixture built
// from PROXIMITY scales with a mutation and pins nothing.
export const PROXIMITY = 240;

/** True when an absence marker sits within PROXIMITY chars of `index` in `doc`.
 *  Whitespace is collapsed first: these bullets wrap mid-phrase, so a marker
 *  like "the dead " meets a NEWLINE where it expects a space.
 *
 *  ★★ Proximity is scoped to ONE file — callers pass one doc's text. Concatenating
 *  the docs first would let an absence marker at the top of one file suppress a
 *  real stale claim at the bottom of the previous one — the PROXIMITY BLEED hole
 *  the CLI's header documents, widened across file boundaries where it is even
 *  harder to spot. */
export function markedNear(doc, index) {
  const from = Math.max(0, index - PROXIMITY);
  const window = doc.slice(from, index + PROXIMITY).replace(/\s+/g, " ");
  return ABSENCE_MARKERS.some((w) => window.includes(w));
}

/** ★★★ EVERY FILE THAT NAMES A SYMBOL IN ORDER TO GATE IT MUST BE LISTED HERE.
 *  These files quote the exact names the gate exists to catch — in comments, in
 *  ALLOWLIST and in test fixtures — so scanning them makes those names "exist"
 *  and the gate silently stops finding its own class. The CLI already excluded
 *  itself; the split adds two more files with the same property.
 *
 *  ★★ The CLI's original self-exclusion was caught only because a real stale
 *  claim went missing at every proximity window; the tool was defeating itself
 *  and still exiting 0 on the cases it did report.
 *
 *  ★★★ THE GATE CANNOT DETECT ITS OWN DAMAGE — THE TEST IS THE ONLY DETECTOR.
 *  Measured on this tree, both ways: dropping an entry makes the gate report
 *  MORE named symbols as resolving, and adding an unrelated scripts/ file
 *  leaves that count untouched — and BOTH still exit 0. A healthy run and a
 *  defeated one are indistinguishable from the outside, so
 *  `agents-symbols-lib.test.mjs` pins exact membership AND proves each entry is
 *  load-bearing. Reproduce by deleting one `path.join` line below and running
 *  `node scripts/check-agents-symbols.mjs`; the exit code — 0 either way — is
 *  the whole point.
 *
 *  ★★ Deliberately NO baseline counts for a healthy run, here or in the test. A
 *  whole-repo identifier count moves on almost every commit: the pair once
 *  written here was already stale by the next commit on this branch and nothing
 *  went red, because pairing a number with its reproduce command makes it
 *  falsifiable, not self-correcting.
 *
 *  ★ Derived from this module's own location, never the process cwd. The
 *  exclusion used to depend on an unwritten cross-file invariant: a
 *  `path.resolve("scripts/...")` evaluated at IMPORT time, whose correctness
 *  rested on a repo-root guard that runs later, in the CLI — and there is a
 *  second consumer now, so that dependency had to go. */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const GATE_SELF_FILES = new Set([
  path.join(HERE, "check-agents-symbols.mjs"),
  path.join(HERE, "agents-symbols-lib.mjs"),
  path.join(HERE, "agents-symbols-lib.test.mjs"),
]);

/** ★★★ `alsoExclude` EXISTS BECAUSE THE HOLE IS PER-CONSUMER, NOT PER-GATE.
 *  `GATE_SELF_FILES` above is about THIS gate and stays that way. But any tool
 *  that quotes doc prose verbatim in order to judge it has the same property —
 *  it writes the names it is checking into the tree it checks them against — and
 *  the second consumer (`check-followup-claims.mjs`, whose test file quotes the
 *  register line by line) reproduced the hole exactly. Hardcoding its three
 *  files here would put one gate's knowledge inside another's constant; passing
 *  them in keeps each gate owning its own list.
 *
 *  ★★ Same silence as `GATE_SELF_FILES`: the failure is one-way and invisible.
 *  A name deleted from `src/` goes on resolving forever because the caller's own
 *  fixture vouches for it, and the tool exits 0 either way. The caller's test is
 *  the only detector, which is why each list is pinned AND proved load-bearing. */
export function collectIdentifiers(dir, into, alsoExclude = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectIdentifiers(path.join(dir, entry.name), into, alsoExclude);
      }
      continue;
    }
    if (!CODE_EXT.test(entry.name)) continue;
    collectIdentifiersFromFiles([path.join(dir, entry.name)], into, alsoExclude);
  }
}

/** The per-file half of `collectIdentifiers`, exported so a caller can pass an
 *  explicit list instead of a directory.
 *
 *  ★★ EXTRACTED, NOT DUPLICATED. A second copy of the identifier regex or of the
 *  exclusion check is how two gates drift — the whole reason this module exists.
 *  `collectIdentifiers` calls this, so the directory walk and the file list
 *  cannot disagree about what an identifier is, or about who is excluded. */
export function collectIdentifiersFromFiles(files, into, alsoExclude = new Set()) {
  for (const file of files) {
    const abs = path.resolve(file);
    if (GATE_SELF_FILES.has(abs) || alsoExclude.has(abs)) continue;
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue; // absent in a partial checkout — same posture as the walk
    }
    for (const m of src.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) into.add(m[0]);
  }
}
