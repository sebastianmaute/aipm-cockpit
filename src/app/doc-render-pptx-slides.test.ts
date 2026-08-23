// src/app/doc-render-pptx-slides.test.ts — the slide-building half of the PPTX
// renderer, exercised directly rather than through `renderDocumentPptx`.
//
// ★ `createDeckMedia`'s `mint` is the site that decodes stored base64, and it
// is reachable from here without assembling a whole deck — which keeps these
// assertions about the decision (mint or decline) rather than about zip bytes
// `doc-render-pptx.test.ts` already covers.
import { describe, expect, it } from "vitest";
import { createDeckMedia, type ImageLine, type RenderCtx } from "./doc-render-pptx-slides";
import { base64ToBytes } from "./document-asset-upload";
import type { DocumentAsset } from "./document-asset";
import type { ExportAssets } from "./document-export-assets";
import { emptyWorkspace } from "./workspace";

describe("createDeckMedia — a malformed byte row is declined, never thrown", () => {
  /** An 8-byte PNG header — short enough to byte-compare in an assertion. */
  const PNG_B64 = "iVBORw0KGgo=";

  const asset = (over: Partial<DocumentAsset> = {}): DocumentAsset => ({
    id: "a1",
    name: "chart.png",
    mime: "image/png",
    size: 8,
    width: 480,
    height: 240,
    hash: "h",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  const imageLine = (id: string): ImageLine => ({ kind: "image", id, cxEmu: 1000, cyEmu: 500 });

  const ctxWith = (inlined: Record<string, string>, ...list: DocumentAsset[]): RenderCtx => {
    const metas = list.length > 0 ? list : [asset()];
    const assets: ExportAssets = { inlined, omitted: new Set(), missing: new Set() };
    return {
      ws: emptyWorkspace(),
      lang: "en-US",
      byId: new Map(metas.map((a) => [a.id, a])),
      assets,
    };
  };

  it("mints a part for a well-formed row", () => {
    // ★★ ANTI-VACUITY FOR EVERY DECLINE BELOW. Without this, a `mint` that
    //  returned null unconditionally would pass all of them.
    const { mint, parts } = createDeckMedia(ctxWith({ a1: PNG_B64 }))();
    const part = mint(imageLine("a1"));
    expect(part).not.toBeNull();
    expect(part!.path).toBe("ppt/media/image1.png");
    expect(Array.from(part!.data)).toEqual(Array.from(base64ToBytes(PNG_B64)));
    expect(parts).toHaveLength(1);
  });

  // ★★★ EACH CASE IS A DIFFERENT atob FAILURE MODE, and one of them alone is
  //  not enough. "a!b" is a CHARSET fault ("Invalid character"); "abcde" is a
  //  LENGTH fault ("not correctly encoded") whose every character IS in the
  //  base64 alphabet. A guard written as an alphabet regex — the shape
  //  `doc-render-html.ts` correctly uses for its own NON-decoding sink — lets
  //  the second one through to the decode, so a suite testing only "a!b" would
  //  report this closed while the export still dies on a length fault.
  it.each([
    ["a charset fault", "a!b"],
    ["a length fault whose characters are all in the alphabet", "abcde"],
  ])("declines a row with %s instead of throwing", (_label, bad) => {
    const { mint, parts } = createDeckMedia(ctxWith({ a1: bad }))();
    // ★★ The assertion is that a DECISION came back, not merely that nothing
    //  threw: `expect(() => mint(...)).not.toThrow()` would also pass against a
    //  mint that returned a part holding garbage bytes.
    expect(mint(imageLine("a1"))).toBeNull();
    expect(parts).toHaveLength(0);
  });

  it("leaves the DECK-WIDE part numbering gap-free when a row is declined", () => {
    // ★★★ THE REASON THE DECODE HAPPENS BEFORE `partCount += 1`. Part paths are
    //  deck-wide: a decline that had already claimed image1 would push the next
    //  good image to image2 while `parts` still held one entry, and two slides
    //  minting around a gap is the silent wrong-image bug `createDeckMedia`'s
    //  own docstring warns about. Assert the SURVIVOR's path, not just its
    //  existence — `toHaveLength(1)` passes either way.
    const media = createDeckMedia(ctxWith(
      { a1: "a!b", a2: PNG_B64 },
      asset(),
      asset({ id: "a2", name: "good.png" }),
    ))();
    expect(media.mint(imageLine("a1"))).toBeNull();
    const good = media.mint(imageLine("a2"));
    expect(good).not.toBeNull();
    expect(good!.path).toBe("ppt/media/image1.png");
    expect(good!.relId).toBe("rId2");
    expect(media.parts).toHaveLength(1);
  });
});
