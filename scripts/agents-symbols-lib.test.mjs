// Unit tests for the symbol gate's pure layer.
//
// ★★★ THE SELF-EXCLUSION TEST IS THE LOAD-BEARING ONE. The gate's own comments
// and allowlist NAME the symbols it exists to catch, so a gate file that is
// scanned makes those names "exist" and the gate silently stops finding the
// class it was built for. That hazard predates this split — `check-agents-
// symbols.mjs` already excluded itself — but the split MULTIPLIES it: the
// allowlist now lives in a second file, and excluding only the original leaves
// `compareX` resolving as real code. Per the gate's own comment, a dead
// allowlist entry is worse than no entry: it masks a future stale claim
// instead of reporting it.
import { describe, expect, it } from "vitest";
import {
  ABSENCE_MARKERS,
  ALLOWLIST,
  GATE_SELF_FILES,
  PROXIMITY,
  collectIdentifiers,
  isGatedSymbolName,
  markedNear,
} from "./agents-symbols-lib.mjs";

describe("isGatedSymbolName", () => {
  it("accepts a mixed-case identifier longer than three characters", () => {
    expect(isGatedSymbolName("sanitizeText")).toBe(true);
    expect(isGatedSymbolName("Task")).toBe(true);
  });

  it("rejects all-lowercase and too-short names", () => {
    expect(isGatedSymbolName("config")).toBe(false);
    expect(isGatedSymbolName("cfg")).toBe(false);
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
    const far = `\`pendingFlash\`${" ".repeat(PROXIMITY + 50)}REMOVED`;
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
  it("names all three gate files, not just the CLI", () => {
    for (const f of [
      "check-agents-symbols.mjs",
      "agents-symbols-lib.mjs",
      "agents-symbols-lib.test.mjs",
    ]) {
      expect(
        GATE_SELF_FILES.some((p) => p.endsWith(f)),
        `${f} is scanned`,
      ).toBe(true);
    }
  });

  it("★★★ no sentinel name resolves as real code", () => {
    // Every name below lives ONLY in the gate's own three files. `compareX` is
    // an ALLOWLIST entry; the other three are doc mentions the gate suppresses
    // via an absence marker. A leak kills the allowlist entry and turns three
    // correct "that symbol is gone" claims into passes for the wrong reason.
    //
    // ★★ THE LIST IS SIZED TO THE MUTANTS, NOT TO THE HAZARD — each name is the
    // separating input for one GATE_SELF_FILES entry, so dropping any single
    // entry turns this red. Measured after the split, not assumed:
    //   check-agents-symbols.mjs -> `migrateTaskStatus` — one of SEVERAL names
    //     the CLI alone quotes, not the only one, so this list is sufficient
    //     rather than exhaustive (deliberately uncounted: a count here rots on
    //     every comment edit to these files). Some CLI-only name IS required:
    //     extracting the library moved `pendingFlash`/`onTakeTour` out of the
    //     CLI, so a list without one lets the CLI mutant survive.
    //   agents-symbols-lib.mjs   -> `compareX`, `pendingFlash`, `onTakeTour`
    //   this file                -> all four, which it quotes right here
    //
    // Re-derive rather than trust — both numbers rot as these files change.
    // Delete ONE path.resolve line from GATE_SELF_FILES, then run
    // `node scripts/check-agents-symbols.mjs`. Dropping THIS file's entry
    // prints 1139/37115 where a correct tree prints 1135/37095 — exit 0 either
    // way, which is the whole reason this test has to exist.
    const known = new Set();
    collectIdentifiers("scripts", known);
    for (const name of ["compareX", "pendingFlash", "onTakeTour", "migrateTaskStatus"]) {
      expect(known.has(name), `${name} leaked into the scan`).toBe(false);
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
    for (const [name, reason] of ALLOWLIST) {
      expect(typeof reason, `${name} has no reason`).toBe("string");
      expect(reason.length, `${name}'s reason is empty`).toBeGreaterThan(10);
    }
  });

  it("exposes the markers the CLI prints in its failure message", () => {
    expect(ABSENCE_MARKERS).toContain("never existed");
    expect(ABSENCE_MARKERS).toContain("NOT built");
  });
});
