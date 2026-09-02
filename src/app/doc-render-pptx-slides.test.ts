// src/app/doc-render-pptx-slides.test.ts — the slide-building half of the PPTX
// renderer, exercised directly rather than through `renderDocumentPptx`.
//
// ★ `createDeckMedia`'s `mint` is the site that decodes stored base64, and it
// is reachable from here without assembling a whole deck — which keeps these
// assertions about the decision (mint or decline) rather than about zip bytes
// `doc-render-pptx.test.ts` already covers.
import { describe, expect, it } from "vitest";
import {
  createDeckMedia,
  pptxRun,
  type ImageLine,
  type RenderCtx,
} from "./doc-render-pptx-slides";
import { createLinkSink } from "./ooxml-links";
import { base64ToBytes } from "./document-asset-upload";
import type { DocumentAsset } from "./document-asset";
import type { ExportAssets } from "./document-export-assets";
import type { TextRun } from "./rich-text-runs";
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

// ─── The link field's KEY, which no XML assertion can see ────────────────────
//
// ★★ `TextRun.href`'s docblock states the rule — ABSENT on an unlinked run,
// never own-and-undefined, "the two compare differently under `toEqual` and
// serialise differently" — and `rich-text-runs.test.ts` pins it there with
// `Object.hasOwn`. `hyperlinkRelId` is the field `href` resolves INTO, so it
// owes the same shape, and `pptxTextBox` renders both spellings to identical
// bytes: a slide-XML assertion is structurally blind to this.
describe("pptxRun — hyperlinkRelId key presence", () => {
  const run = (over: Partial<TextRun> = {}): TextRun => ({ text: "x", marks: [], ...over });

  it("omits hyperlinkRelId entirely on an unlinked run", () => {
    const built = pptxRun(run(), "p", createLinkSink(2));
    expect(Object.hasOwn(built, "hyperlinkRelId")).toBe(false);
    // ★ The paired positive: `toEqual` treats an own-and-undefined key as
    //   equal to an absent one, so it CANNOT stand in for the check above —
    //   it is here to prove the run is otherwise intact, not to pin the key.
    expect(built.text).toBe("x");
  });

  it("omits it with no sink at all, the pre-existing caller's shape", () => {
    expect(Object.hasOwn(pptxRun(run({ href: "https://a/x" }), "p", undefined), "hyperlinkRelId"))
      .toBe(false);
  });

  it("sets it as an own key carrying the sink's id on a linked run", () => {
    const sink = createLinkSink(2);
    const built = pptxRun(run({ href: "https://a/x" }), "p", sink);
    expect(Object.hasOwn(built, "hyperlinkRelId")).toBe(true);
    expect(built.hyperlinkRelId).toBe("rId2");
    expect(sink.rels()).toEqual([{ relId: "rId2", target: "https://a/x" }]);
  });
});

// ─── The link's VISUAL cue, which the theme cannot supply in one slot ────────
//
// ★★★ A slide package carries no character-style part, so the DOCX remedy for
// §336 (a `Hyperlink` style declaring colour AND underline) has no counterpart
// here: a linked run names no fill and the THEME paints it `<a:hlink>` =
// COLOR_DARK_BLUE. Measured 2026-09-02, after a cold review refuted an earlier
// wording here that called that "a real cue in the meta and field slots": it is
// a cue in META_SLOT alone (939598, 3.68:1). It is NO cue in the row TITLE,
// whose own text is COLOR_DARK_BLUE — the same six digits — and effectively
// none in FIELD_SLOT or in this renderer's own body slides, which declare no
// colour and so resolve to COLOR_TEXT (1A1A1A) at 1.58:1. These pin the
// underline that makes those links visible at all, rather than trusting
// PowerPoint's implicit hyperlink formatting, which nothing here can observe.
describe("pptxRun — a linked run is underlined regardless of its marks", () => {
  const run = (over: Partial<TextRun> = {}): TextRun => ({ text: "x", marks: [], ...over });

  it("underlines a linked run that carries no underline mark", () => {
    expect(pptxRun(run({ href: "https://a/x" }), "p", createLinkSink(2)).underline).toBe(true);
  });

  it("leaves an UNLINKED run's underline driven by its mark alone", () => {
    // ★ The additive half. Without this the assertion above passes just as
    //   well against a mutant that underlines every run in every deck.
    expect(pptxRun(run(), "p", createLinkSink(2)).underline).toBe(false);
    expect(pptxRun(run({ marks: ["underline"] }), "p", createLinkSink(2)).underline).toBe(true);
  });

  it("does not underline a run whose href minted no id because there is no sink", () => {
    // ★ The cue follows the RELATIONSHIP, not the href: a sinkless caller
    //   emits no `<a:hlinkClick>`, so an underline there would promise a link
    //   the slide does not contain.
    expect(pptxRun(run({ href: "https://a/x" }), "p", undefined).underline).toBe(false);
  });
});
