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
