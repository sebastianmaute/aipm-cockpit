import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { emuFromPx, mediaExtension, fitExtent, EMU_PER_INCH } from "./ooxml-media";

describe("mediaExtension", () => {
  it("maps every allowed mime and rejects everything else", () => {
    expect(mediaExtension("image/png")).toBe("png");
    expect(mediaExtension("image/jpeg")).toBe("jpeg");
    expect(mediaExtension("image/webp")).toBe("webp");
    // SVG is permanently excluded upstream; a miss must be null, never a guess.
    expect(mediaExtension("image/svg+xml")).toBeNull();
    expect(mediaExtension("")).toBeNull();
  });
});

describe("emuFromPx", () => {
  it("converts at 96 CSS px per inch", () => {
    expect(emuFromPx(96)).toBe(EMU_PER_INCH);
    expect(emuFromPx(0)).toBe(0);
  });
});

describe("fitExtent", () => {
  it("returns null when either dimension is absent — OOXML needs a concrete extent", () => {
    expect(fitExtent({ width: 100 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ height: 100 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({}, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 0, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
  });

  it("leaves an image that already fits at its natural size", () => {
    const ext = fitExtent({ width: 96, height: 48 }, 10 * EMU_PER_INCH, 10 * EMU_PER_INCH);
    expect(ext).toEqual({ cxEmu: EMU_PER_INCH, cyEmu: EMU_PER_INCH / 2 });
  });

  it("scales down to the WIDTH bound", () => {
    const ext = fitExtent({ width: 192, height: 96 }, EMU_PER_INCH, 10 * EMU_PER_INCH);
    expect(ext).toEqual({ cxEmu: EMU_PER_INCH, cyEmu: Math.round(EMU_PER_INCH / 2) });
  });

  it("scales down to the HEIGHT bound", () => {
    const ext = fitExtent({ width: 96, height: 192 }, 10 * EMU_PER_INCH, EMU_PER_INCH);
    expect(ext).toEqual({ cxEmu: Math.round(EMU_PER_INCH / 2), cyEmu: EMU_PER_INCH });
  });

  it("never exceeds either bound and preserves aspect within rounding", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 10_000, max: 10_000_000 }),
        fc.integer({ min: 10_000, max: 10_000_000 }),
        (w, h, maxW, maxH) => {
          const ext = fitExtent({ width: w, height: h }, maxW, maxH);
          expect(ext).not.toBeNull();
          const { cxEmu, cyEmu } = ext!;
          expect(cxEmu).toBeLessThanOrEqual(maxW);
          expect(cyEmu).toBeLessThanOrEqual(maxH);
          expect(cxEmu).toBeGreaterThan(0);
          expect(cyEmu).toBeGreaterThan(0);
          // ★★★ Aspect survives to the precision INTEGER EMUs allow, which is a
          // function of the RESULT size, not a flat percentage. cx and cy are
          // each rounded (and clamped to >= 1) independently, so the ratio's
          // relative error is bounded by 1/cx + 1/cy. A flat 1% band was BOTH
          // too tight at a sub-pixel target box (cy = 32 makes 1% unreachable)
          // and far too loose at the sizes this code actually runs at, where
          // the real bound is ~1e-6 — it would have passed an implementation
          // off by four orders of magnitude.
          const want = w / h;
          const got = cxEmu / cyEmu;
          const allowed = want * (1 / cxEmu + 1 / cyEmu) + 1e-9;
          expect(Math.abs(got - want)).toBeLessThanOrEqual(allowed);
        },
      ),
      { numRuns: 500 },
    );
  });
});
