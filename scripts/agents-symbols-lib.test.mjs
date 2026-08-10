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
  it("names both gate files, not just the CLI", () => {
    expect(GATE_SELF_FILES.some((f) => f.endsWith("check-agents-symbols.mjs"))).toBe(true);
    expect(GATE_SELF_FILES.some((f) => f.endsWith("agents-symbols-lib.mjs"))).toBe(true);
  });

  it("★★★ the allowlist sentinel does NOT resolve as real code", () => {
    // `compareX` appears ONLY in ALLOWLIST. If the lib holding that allowlist
    // is scanned, this set contains it, the allowlist entry goes dead, and the
    // gate stops reporting the stale-claim class the entry was masking.
    const known = new Set();
    collectIdentifiers("scripts", known);
    expect(known.has("compareX")).toBe(false);
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
