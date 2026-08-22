import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { emuFromPx, mediaExtension, fitExtent, EMU_PER_INCH } from "./ooxml-media";
import { ASSET_MIME_ALLOWED } from "./document-asset-upload";

describe("mediaExtension", () => {
  it("maps every allowed mime and rejects everything else", () => {
    expect(mediaExtension("image/png")).toBe("png");
    expect(mediaExtension("image/jpeg")).toBe("jpeg");
    expect(mediaExtension("image/webp")).toBe("webp");
    // SVG is permanently excluded upstream; a miss must be null, never a guess.
    expect(mediaExtension("image/svg+xml")).toBeNull();
    expect(mediaExtension("")).toBeNull();
  });

  it("covers every mime the upload path admits", () => {
    // ★★ The switch is deliberately a literal, so this is the only thing
    // stopping the two lists from drifting. A fourth allowed mime with no case
    // here would export as a placeholder in OOXML while HTML kept the image.
    for (const mime of ASSET_MIME_ALLOWED) {
      expect(mediaExtension(mime)).not.toBeNull();
    }
    expect(ASSET_MIME_ALLOWED.length).toBeGreaterThan(0); // guard against a vacuous loop
  });
});

describe("module contract", () => {
  it("does not touch the DOM", () => {
    // Guard: this module must stay usable under bare node (both renderers
    // that import it are synchronous and one runs at build/export time with
    // no browser present). A source scan is the enforcement — mirrors
    // document-model.test.ts's "does not touch the DOM".
    const src = readFileSync("src/app/ooxml-media.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/DOMParser|\bBlob\b|\batob\b|\bwindow\b|\bdocument\b\s*\./);
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

  it("rejects a bound too small to hold anything, rather than clamping past it", () => {
    // Without the >= 1 bound guard these return {cxEmu:1, cyEmu:1} — an extent
    // LARGER than the box it was asked to fit into.
    expect(fitExtent({ width: 100, height: 100 }, 0, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 100, height: 100 }, 1_000_000, 0)).toBeNull();
    expect(fitExtent({ width: 100, height: 100 }, -5, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 100, height: 100 }, NaN, 1_000_000)).toBeNull();
  });

  it("rejects a non-finite or negative dimension", () => {
    expect(fitExtent({ width: Infinity, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 10, height: Infinity }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: NaN, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: -10, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 10, height: -10 }, 1_000_000, 1_000_000)).toBeNull();
    // ★★★ BOTH infinite is the case the bottom `cxEmu < 1` guard CANNOT catch:
    // scale is 0, both dimensions come out NaN, and every comparison against
    // NaN is false. The one-at-a-time cases above are caught by whichever
    // dimension stayed finite and rounded to 0 — so without this line,
    // deleting `positiveFinite` passes the whole suite while emitting
    // cx="NaN" into the drawing XML.
    expect(fitExtent({ width: Infinity, height: Infinity }, 1_000_000, 1_000_000)).toBeNull();
  });

  it("rounds rather than truncates, in both directions", () => {
    // Every INTEGER px maps to an exact EMU (914400/96 = 9525), so rounding only
    // engages on fractional input — which is why every existing example landed on
    // an exact integer and none of them could tell round from floor.
    expect(emuFromPx(0.5)).toBe(4763); // floor would give 4762
    // 97px tall at a 0.5 scale is 461962.5 EMU — the one example that separates
    // the two modes inside fitExtent itself.
    expect(fitExtent({ width: 192, height: 97 }, EMU_PER_INCH, 10 * EMU_PER_INCH))
      .toEqual({ cxEmu: 914400, cyEmu: 461963 });
  });

  it("rejects a source dimension too small to round to a single EMU", () => {
    // 1e-5 px x 9525 = 0.09525 EMU, which rounds to 0. The old Math.max(1, …)
    // clamp turned that into an invisible 1-EMU picture; null falls back to the
    // placeholder, which is the honest disclosure.
    expect(fitExtent({ width: 1e-5, height: 1e-5 }, 1_000_000, 1_000_000)).toBeNull();
  });
});
