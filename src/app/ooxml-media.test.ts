import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  emuFromPx,
  emuFromTwips,
  mediaExtension,
  fitExtent,
  EMU_PER_INCH,
  EMU_PER_TWIP,
} from "./ooxml-media";
import { ASSET_MIME_ALLOWED } from "./document-asset-upload";

describe("mediaExtension", () => {
  it("accepts EXACTLY the allowlist, and nothing beyond it", () => {
    // ★★★ THE LOOP BELOW PINS ONE DIRECTION ONLY — allowlist ⊆ switch domain.
    // The other direction was unpinned, and it is the one that matters: adding
    // `case "image/gif"` to mediaExtension leaves EVERY other test in this file
    // green. At that point the only thing stopping a GIF reaching an OOXML
    // package is the allowlist guard in docxEmbedFor/pptxEmbedFor — and NO
    // fixture can observe that guard, because mediaExtension re-decides the same
    // question on the very next line, making its deletion an EQUIVALENT mutant
    // (measured while converting the casts for open-followups §223).
    //
    // ★★ So the divergence is pinned HERE, at its source, once — rather than
    // relying on two unobservable guards at two call sites. A source scan is the
    // only way to read the switch's domain: the function takes a string, so
    // nothing can enumerate what it accepts by calling it.
    const src = readFileSync("src/app/ooxml-media.ts", "utf8");
    const start = src.indexOf("export function mediaExtension");
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 1);
    // Bounded by the NEXT export rather than a brace scan — `contentTypeFor` is
    // mediaExtension's immediate neighbour, and a concrete name cannot drift the
    // way a counted brace can.
    // ★★ THE WINDOW INCLUDES WHATEVER SITS BETWEEN THE TWO FUNCTIONS, INCLUDING
    // `contentTypeFor`'s OWN JSDoc — so writing `case "image/gif"` inside that
    // comment reddens this test on a docs-only edit (measured). It fails in the
    // SAFE direction (a spurious red, never a silent green), and tightening the
    // window to the function's closing brace would reintroduce the brace-counting
    // this deliberately avoids. Noted so the next reader hunting a code change
    // for a red run looks at the comment too.
    const endMarker = after.indexOf("export function contentTypeFor");
    expect(endMarker).toBeGreaterThan(-1);
    const body = after.slice(0, endMarker);
    const cases = [...body.matchAll(/case\s+"([^"]+)"/g)].map((m) => m[1]);
    // Guard against a vacuous scan: a regex that matched nothing would make the
    // set comparison below trivially true against an empty allowlist.
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases)).toEqual(new Set(ASSET_MIME_ALLOWED));
  });

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

describe("emuFromTwips", () => {
  it("converts at 1440 twips per inch", () => {
    expect(EMU_PER_TWIP).toBe(635);
    expect(emuFromTwips(1440)).toBe(EMU_PER_INCH);
    expect(emuFromTwips(0)).toBe(0);
    // The real A4-portrait content width the docx renderer will pass: 11906
    // wide less two 907 margins = 10092 twips = 7.008 inch.
    expect(emuFromTwips(10092)).toBe(6_408_420);
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

  it("rejects a non-integer bound, which Math.round would cross", () => {
    // 1000px at a 100.6 EMU bound rounds to 101 — wider than the box.
    expect(fitExtent({ width: 1000, height: 1000 }, 100.6, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 1000, height: 1000 }, 1_000_000, 100.6)).toBeNull();
  });

  it("rejects an extent that overflowed to NaN from a finite dimension", () => {
    // emuFromPx overflows above ~1.97e302 px: 1.9e302 still yields a clean
    // extent, 2e302 yields NaN. positiveFinite cannot see this — the INPUTS are
    // finite; the overflow happens inside this function.
    expect(fitExtent({ width: 1.9e302, height: 1.9e302 }, 1_000_000, 1_000_000))
      .toEqual({ cxEmu: 1_000_000, cyEmu: 1_000_000 });
    expect(fitExtent({ width: 2e302, height: 2e302 }, 1_000_000, 1_000_000)).toBeNull();
  });

  it("rejects a non-finite or negative dimension", () => {
    expect(fitExtent({ width: Infinity, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 10, height: Infinity }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: NaN, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: -10, height: 10 }, 1_000_000, 1_000_000)).toBeNull();
    expect(fitExtent({ width: 10, height: -10 }, 1_000_000, 1_000_000)).toBeNull();
    // ★★★ BOTH negative is the one shape ONLY `positiveFinite` catches, and it
    // is the reason that guard cannot be dropped now that the output guard
    // rejects NaN. Measured: with the input guard deleted this returns
    // {cxEmu: 1000000, cyEmu: 1000000} — the two negatives cancel (scale is
    // itself negative), so it is not a NaN or a zero the output guard could
    // see, but a plausible-looking extent invented from nonsense input.
    expect(fitExtent({ width: -10, height: -10 }, 1_000_000, 1_000_000)).toBeNull();
    // ★★★ BOTH infinite PROVES NOTHING ABOUT WHICH GUARD REJECTED IT, and an
    // earlier revision of this comment claimed it did — it read "the case the
    // bottom `cxEmu < 1` guard CANNOT catch". That stopped being true when that
    // guard became `!(cxEmu >= 1)`: scale is 0, both dimensions come out NaN,
    // and the negated form rejects NaN too. So this line passes with EITHER
    // guard alone, and neither is evidence for the other.
    // ★★ The assertion that actually pins `positiveFinite` is the both-NEGATIVE
    // pair ABOVE (measured: the output guard lets it through), and the one that
    // pins the output guard is the NaN-from-a-finite-dimension test above that.
    // This line is kept because it is the shape the input guard was written for,
    // not because it discriminates.
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
