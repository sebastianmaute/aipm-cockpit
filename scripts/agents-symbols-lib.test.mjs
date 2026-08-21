// Unit tests for the symbol gate's shared layer.
//
// ★★★ THE SELF-EXCLUSION TESTS ARE THE LOAD-BEARING ONES. The gate's own
// comments and allowlist NAME the symbols it exists to catch, so a gate file
// that is scanned makes those names "exist" and the gate silently stops finding
// the class it was built for. That hazard predates this split — `check-agents-
// symbols.mjs` already excluded itself — but the split MULTIPLIES it: the
// allowlist now lives in a second file, and excluding only the original leaves
// `compareX` resolving as real code. Per the gate's own comment, a dead
// allowlist entry is worse than no entry: it masks a future stale claim
// instead of reporting it.
//
// ★★ The gate cannot see any of this itself. Both failure directions — an entry
// dropped, a non-gate file added — leave `node scripts/check-agents-symbols.mjs`
// exiting 0. These tests are the only detector, which is why they check exact
// membership rather than a loose "the three files are in there somewhere".
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ABSENCE_MARKERS,
  ALLOWLIST,
  GATE_SELF_FILES,
  collectIdentifiers,
  collectIdentifiersFromFiles,
  isGatedSymbolName,
  markedNear,
} from "./agents-symbols-lib.mjs";

describe("isGatedSymbolName", () => {
  it("accepts a mixed-case identifier longer than three characters", () => {
    expect(isGatedSymbolName("sanitizeText")).toBe(true);
    expect(isGatedSymbolName("Task")).toBe(true);
  });

  it("rejects an all-lowercase name", () => {
    expect(isGatedSymbolName("config")).toBe(false);
    expect(isGatedSymbolName("cfg")).toBe(false);
  });

  it("rejects a MIXED-CASE name of three characters or fewer", () => {
    // ★★ The separating input for `name.length <= 3`, and the only SHAPE that
    // can separate it: with the guard deleted, a short name still returns false
    // unless the mixed-case rule ACCEPTS it. The one short name asserted
    // elsewhere in this file ("cfg") is all-lowercase, so the case rule rejects
    // it either way — measured: delete the length guard and this is the only
    // test in the suite that goes red.
    expect(isGatedSymbolName("Tab")).toBe(false);
    expect(isGatedSymbolName("aB")).toBe(false);
  });

  it("regression: SCREAMING_CASE is out of scope — the gate's known blind spot", () => {
    // Not a bug to fix here. AGENTS.md documents this gap at three stars; the
    // followups gate inherits the SAME predicate so the two agree, and widening
    // it is a separate decision with its own false-positive budget.
    expect(isGatedSymbolName("HELP_ENTRIES")).toBe(false);
    expect(isGatedSymbolName("TABLE_NAMES")).toBe(false);
  });

  it("rejects member expressions and CSS tokens", () => {
    expect(isGatedSymbolName("window.setTimeout")).toBe(false);
    expect(isGatedSymbolName("--ui-pink")).toBe(false);
  });
});

describe("markedNear", () => {
  const doc = "the old `pendingFlash` channel\n  was REMOVED in 0.190";

  it("suppresses a mention whose absence marker wraps onto the next line", () => {
    expect(markedNear(doc, doc.indexOf("pendingFlash"))).toBe(true);
  });

  it("does not suppress when the marker is beyond the proximity window", () => {
    // ★★ The gap is a LITERAL distance, deliberately. It used to be built from
    // the constant itself (`" ".repeat(PROXIMITY + 50)`), so a mutant that
    // WIDENED the window widened this fixture with it and the test stayed green
    // — the fixture scaled with the mutation and pinned nothing.
    const far = `\`pendingFlash\`${" ".repeat(300)}REMOVED`;
    expect(markedNear(far, far.indexOf("pendingFlash"))).toBe(false);
  });

  it("regression: whitespace is collapsed before matching", () => {
    // "the dead " is a marker with a trailing space; a wrap puts a NEWLINE
    // there and the suppression silently failed, reporting a correct doc.
    const wrapped = "REPLACING the dead\n  `onTakeTour` entry point";
    expect(markedNear(wrapped, wrapped.indexOf("onTakeTour"))).toBe(true);
  });
});

describe("GATE_SELF_FILES", () => {
  it("holds EXACTLY the three gate files", () => {
    // ★★ Exact membership, not "the three are in there somewhere". An exclusion
    // that grows too BROAD is invisible to every other assertion here, because
    // a real source file always brings identifiers of its own: measured by
    // adding `doc-claims-lib.mjs` to the set, which left the floor below green,
    // left the load-bearing check green, and left the gate itself reporting the
    // same count at exit 0 — this assertion was the only thing that noticed.
    // (`stripFencedBlocks` does not save us either; it lives in several other
    // scripts/ files.) A legitimate addition therefore has to edit this list on
    // purpose.
    expect([...GATE_SELF_FILES].map((p) => path.basename(p)).sort()).toEqual([
      "agents-symbols-lib.mjs",
      "agents-symbols-lib.test.mjs",
      "check-agents-symbols.mjs",
    ]);
  });

  it("names files that exist on disk", () => {
    // A typo'd or directory-named entry excludes nothing. Caught here directly
    // rather than later, as a confusing leak of somebody else's sentinel name.
    for (const p of GATE_SELF_FILES) {
      expect(fs.existsSync(p), `${p} is not on disk`).toBe(true);
      expect(fs.statSync(p).isFile(), `${p} is not a file`).toBe(true);
    }
  });

  it("★★★ every entry is load-bearing — each holds a gated name the scan lacks", () => {
    // ★★★ DERIVED, never a sentinel list. The previous shape hardcoded four
    // names and claimed each "lives ONLY in the gate's own three files" —
    // nothing can enforce that, and it stopped being true in the VERY NEXT
    // commit, when an unrelated test reused one of them as a fixture. The
    // tempting repair (drop the offending name) leaves one entry with NO
    // separating input, which is exactly the mutant the original list let
    // survive.
    //
    // What this asserts instead: excluding this file genuinely changes the
    // scan, in the class the gate cares about. If an entry stops contributing
    // any gated name, its exclusion has become dead weight and should go.
    const known = new Set();
    collectIdentifiers("scripts", known);
    for (const file of GATE_SELF_FILES) {
      const own = new Set();
      for (const m of fs.readFileSync(file, "utf8").matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
        if (!known.has(m[0]) && isGatedSymbolName(m[0])) own.add(m[0]);
      }
      expect(
        own.size,
        `${path.basename(file)} contributes no gated name the scan lacks — excluding it changes nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("still collects ordinary identifiers from scripts/", () => {
    // A scan that excludes too much passes everything. Prove it scanned.
    const known = new Set();
    collectIdentifiers("scripts", known);
    expect(known.size).toBeGreaterThan(500);
    expect(known.has("stripFencedBlocks")).toBe(true);
  });
});

describe("ABSENCE_MARKERS / ALLOWLIST", () => {
  it("every allowlist entry carries a reason", () => {
    // The loop below is vacuous on an empty map, and an empty ALLOWLIST is a
    // plausible future state — the gate's own comment argues for pruning it.
    expect(ALLOWLIST.size, "ALLOWLIST is empty, so the loop asserts nothing").toBeGreaterThan(0);
    for (const [name, reason] of ALLOWLIST) {
      expect(typeof reason, `${name} has no reason`).toBe("string");
      expect(reason.length, `${name}'s reason is empty`).toBeGreaterThan(10);
    }
  });

  it("carries the two markers AGENTS.md's own prohibition wording relies on", () => {
    // ★ NOT the markers the CLI prints — its failure advice lists only the
    // first eight, and both of these sit past that cut. They are asserted
    // because AGENTS.md phrases its never-existed and rejected-design notes in
    // exactly these words: measured by removing each from the array and
    // re-running the gate, which then reported `migrateTaskStatus` and
    // `makeEntityCrudHandlers` as stale claims. Dropping either marker
    // un-suppresses a correct doc.
    expect(ABSENCE_MARKERS).toContain("never existed");
    expect(ABSENCE_MARKERS).toContain("NOT built");
  });
});

describe("collectIdentifiersFromFiles", () => {
  it("collects identifiers from an explicit file list", () => {
    const into = new Set();
    collectIdentifiersFromFiles(["eslint.config.mjs"], into);
    expect(into.has("globalIgnores")).toBe(true);
  });

  // ★★ ANTI-VACUITY: a name that appears nowhere must still be absent.
  it("does not invent identifiers", () => {
    const into = new Set();
    collectIdentifiersFromFiles(["eslint.config.mjs"], into);
    expect(into.has("noSuchIdentifierAnywhere")).toBe(false);
  });

  // ★ Honours the same exclusion set as the directory walk.
  it("honours alsoExclude", () => {
    const into = new Set();
    const excl = new Set([path.resolve("eslint.config.mjs")]);
    collectIdentifiersFromFiles(["eslint.config.mjs"], into, excl);
    expect(into.has("globalIgnores")).toBe(false);
  });

  // ★★★ THE FAIL-LOUD POSTURE IS THE POINT OF THESE TWO, and until they were
  // written NOTHING pinned it. `check-agents-symbols.mjs` is a BLOCKING CI gate
  // and reaches this function through `collectIdentifiers` with no try/catch of
  // its own, so an unreadable file MUST throw and stop the run. Wrapping the
  // read in a catch would drop that file's identifiers and report a spurious
  // missing symbol instead — a gate lying about why it failed.
  //
  // ★★★ THIS IS A MEASURED TEST GAP, NOT A HYPOTHETICAL. An earlier cut of the
  // extraction DID add a `try/catch` here, silently converting the blocking gate
  // from fail-loud to fail-quiet. It was caught by whole-branch review, and when
  // the mutant was reinstated afterwards the whole file stayed green — 17/17.
  // A survivor is a question, and the answer here was "missing test": these are
  // the separating input. Reinstating the catch turns both red.
  it("★★★ throws on an unreadable target rather than skipping it", () => {
    // A directory is the cheapest unreadable target that needs no fixture:
    // `readFileSync` on one throws EISDIR on both POSIX and Windows.
    expect(() => collectIdentifiersFromFiles(["src"], new Set())).toThrow();
  });

  it("★★★ throws on a missing file rather than skipping it", () => {
    expect(() =>
      collectIdentifiersFromFiles(["no-such-file-in-this-repo.mjs"], new Set()),
    ).toThrow();
  });
});
