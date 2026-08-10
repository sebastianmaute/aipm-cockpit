// The symbol gate's pure layer, split out so `check-followup-claims.mjs` can
// apply the SAME predicate rather than growing a second, drifting copy.
// The CLI (`check-agents-symbols.mjs`) keeps all IO and exit handling.
import fs from "node:fs";
import path from "node:path";

export const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json)$/;
export const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Backticked text that looks like a TypeScript identifier the doc is
 *  asserting exists in this repo. Deliberately narrow: mixed case (so `Task`
 *  and `sanitizeText` qualify but `config` and `TODO` do not), no dots, no
 *  dashes, length > 3. Anything with a dot is an external API path or a member
 *  expression; anything starting `--` is a CSS token. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The gate's predicate, as one function so two gates cannot drift.
 *  Mixed case only — every SCREAMING_CASE constant is out of scope. */
export function isGatedSymbolName(name) {
  if (!IDENTIFIER.test(name)) return false;
  if (name.length <= 3) return false;
  return /[a-z]/.test(name) && /[A-Z_]/.test(name);
}

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
//   - whole PARAGRAPH -> hid a REAL stale claim: `onToggleComplete` sits in a
//                        long bullet that happens to discuss a removal
//                        elsewhere, so the marker suppressed it.
// A marker must therefore be NEAR the mention. 240 chars is about two wrapped
// lines either side — wide enough for the wrap case, narrow enough that an
// unrelated removal later in the same bullet does not grant cover.
export const PROXIMITY = 240;

/** True when an absence marker sits within PROXIMITY chars of `index` in `doc`.
 *  Whitespace is collapsed first: these bullets wrap mid-phrase, so a marker
 *  like "the dead " meets a NEWLINE where it expects a space.
 *
 *  ★★ Proximity is scoped to ONE file. Concatenating the docs first would let
 *  an absence marker at the top of one file suppress a real stale claim at the
 *  bottom of the previous one — the PROXIMITY BLEED hole the CLI documents,
 *  widened across file boundaries where it is even harder to spot. */
export function markedNear(doc, index) {
  const from = Math.max(0, index - PROXIMITY);
  const window = doc.slice(from, index + PROXIMITY).replace(/\s+/g, " ");
  return ABSENCE_MARKERS.some((w) => window.includes(w));
}

/** ★★★ EVERY FILE THAT NAMES A SYMBOL IN ORDER TO GATE IT MUST BE LISTED HERE.
 *  These files quote the exact names the gate exists to catch — in comments, in
 *  ALLOWLIST and in test fixtures — so scanning them makes those names "exist"
 *  and the gate silently stops finding its own class. The CLI already excluded
 *  itself; this split adds two more files with the same property.
 *
 *  ★★ The CLI's original self-exclusion was caught only because a real stale
 *  claim went missing at every proximity window; the tool was defeating itself
 *  and still exiting 0 on the cases it did report.
 *
 *  ★★★ THE TEST FILE IS NOT AN OVER-CAUTIOUS ADDITION — IT WAS MEASURED. Landing
 *  `agents-symbols-lib.test.mjs` alone, with no other change, moved the gate from
 *  `1135 named symbols … against 37095 identifiers` to `1138 … 37111` while still
 *  exiting 0. Three of the six names that live nowhere but this gate — `compareX`
 *  (its ALLOWLIST entry), `pendingFlash` and `onTakeTour` (both suppressed by
 *  absence markers in the docs) — became "real code" because the TEST quotes them,
 *  in a comment and in an assertion. So three doc claims that were correctly
 *  reported as absent silently started resolving, and nothing went red. That is
 *  the failure this list exists to prevent, reproduced by accident inside the very
 *  commit that was meant to pin it. */
export const GATE_SELF_FILES = [
  path.resolve("scripts/check-agents-symbols.mjs"),
  path.resolve("scripts/agents-symbols-lib.mjs"),
  path.resolve("scripts/agents-symbols-lib.test.mjs"),
];

export function collectIdentifiers(dir, into) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectIdentifiers(path.join(dir, entry.name), into);
      continue;
    }
    if (!CODE_EXT.test(entry.name)) continue;
    if (GATE_SELF_FILES.includes(path.resolve(dir, entry.name))) continue;
    const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
    for (const m of src.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) into.add(m[0]);
  }
}
