import { describe, it, expect } from "vitest";
import { EXIT, mulberry32 } from "./ai-eval-lib.mjs";

describe("EXIT", () => {
  it("matches the repo's two-failure-code convention", () => {
    // 0 pass, 1 a real regression, 2 the harness could not measure.
    // A run that measures nothing must never report 0.
    expect(EXIT).toEqual({ PASS: 0, REGRESSION: 1, UNUSABLE: 2 });
  });
});

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays inside [0, 1)", () => {
    const r = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("pins the exact output stream, so an algorithm swap cannot pass", () => {
    // ★★ The three tests above are all self-referential — same-seed agreement,
    //    cross-seed difference, and range. A DIFFERENT but still valid seeded
    //    PRNG satisfies every one of them. These literals are the only thing
    //    that pins THIS algorithm, and the seeded anchor arm's whole value is
    //    that it regenerates byte-identically forever.
    const r = mulberry32(12345);
    expect([r(), r(), r()]).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985,
    ]);
  });
});

import { PROBES, TOKEN_IDS, plantedToken, probeById } from "./ai-eval-lib.mjs";

describe("plantedToken", () => {
  it("is stable for a given block and salt", () => {
    expect(plantedToken("date", 7)).toBe(plantedToken("date", 7));
  });

  it("differs between blocks at the same salt", () => {
    expect(plantedToken("date", 7)).not.toBe(plantedToken("insights", 7));
  });

  it("differs between salts for the same block", () => {
    expect(plantedToken("date", 7)).not.toBe(plantedToken("date", 8));
  });

  it("is alphabetic and long enough not to collide with ordinary prose", () => {
    for (const p of PROBES) {
      const tok = plantedToken(p.id, 1);
      expect(tok).toMatch(/^[a-z]{16,}$/);
    }
  });

  it("never collides within a run, across every id used together", () => {
    // ★★★ MEASURED, not assumed: before the ordered-universe guarantee, 11 of
    //     these 3000 salts produced a within-run collision, including
    //     insights/activityRecap at 2126 and anchor/anchorDecoy at 1418 — a
    //     target equal to its own decoy, which the scorer can only ever call
    //     ambiguous, silently, forever.
    //
    //  ★★★ THIS RANGE ALONE CANNOT KILL A "remove the retry" MUTANT, and it
    //  is not vacuity to say so — it is the mutation-test result. Folding the
    //  attempt counter into the hash key gives each (id, salt, 0) candidate an
    //  effectively fresh 32-bit draw, so a natural collision among ~14000
    //  attempt-0 draws only becomes likely near the birthday bound
    //  (sqrt(2**32) ≈ 65536) — measured first collision at salt 66350
    //  ("viewScope" vs "chatPointer"), none in 1..3000. Coverage of ordinary
    //  usage, not a substitute for the targeted pin below.
    for (let salt = 1; salt <= 3000; salt += 1) {
      const tokens = TOKEN_IDS.map((id) => plantedToken(id, salt));
      expect(new Set(tokens).size).toBe(TOKEN_IDS.length);
    }
  });

  it("resolves the salt where a first-candidate-only draw naturally collides", () => {
    // ★★★ THE MUTATION-KILLING PIN. At salt 66350, generateToken(id, 66350, 0)
    //     alone gives "viewScope" and "chatPointer" the same string — measured
    //     by disabling the retry loop and scanning up to salt 200000, where it
    //     was the first of only four such coincidences. Removing the retry
    //     loop turns this assertion red; the 1..3000 sweep above does not.
    expect(plantedToken("viewScope", 66350)).not.toBe(
      plantedToken("chatPointer", 66350),
    );
  });

  it("refuses an id outside the declared universe", () => {
    expect(() => plantedToken("chatpointer", 1)).toThrow(/unknown token id/i);
  });

  it("no longer collides at the exact salts the first cut failed at", () => {
    // Named regression pins, not just the range scan above — a range scan can
    // pass again after someone "simplifies" the retry loop away by luck of
    // whatever salts they happened to weaken; these three are known-bad.
    expect(plantedToken("insights", 2126)).not.toBe(
      plantedToken("activityRecap", 2126),
    );
    expect(plantedToken("anchor", 1418)).not.toBe(
      plantedToken("anchorDecoy", 1418),
    );
    expect(plantedToken("insights", 3449)).not.toBe(
      plantedToken("chatPointer", 3449),
    );
  });
});

describe("PROBES", () => {
  it("covers the five blocks slice B relocated", () => {
    expect(PROBES.map((p) => p.id)).toEqual([
      "date", "viewScope", "insights", "activityRecap", "chatPointer",
    ]);
  });

  it("gives every probe a distractor in a DIFFERENT block", () => {
    for (const p of PROBES) {
      expect(p.distractorBlock).not.toBe(p.id);
      expect(PROBES.map((q) => q.id)).toContain(p.distractorBlock);
    }
  });

  it("asks each question in a form whose only correct answer is the token", () => {
    for (const p of PROBES) {
      expect(p.question).toContain("exactly as written");
    }
  });

  it("looks a probe up by id and throws on an unknown one", () => {
    expect(probeById("date").id).toBe("date");
    expect(() => probeById("nope")).toThrow(/unknown probe/i);
  });
});
