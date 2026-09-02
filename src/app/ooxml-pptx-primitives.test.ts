// src/app/ooxml-pptx-primitives.test.ts
//
// PresentationML primitives: `pptxPicture` (the shape that puts real image
// bytes on a slide instead of the text placeholder that preceded it), the
// hyperlink half of `pptxTextBox`, and `buildPptxPackage`'s per-slide media and
// link relationships.
//
// ★★ These assertions are SUBSTRING matches, which is the right granularity for
// a fragment that is not a whole part (a `<p:pic>` is spliced into a slide by
// `wrapPptxSlide`, which owns the namespace declarations). But substring
// matching cannot see malformed XML, so anything about WELL-FORMEDNESS —
// notably that the `r:` prefix on `r:embed` is bound — is pinned by reading
// `wrapPptxSlide`, not by this file.
import { describe, expect, it } from "vitest";

import { unzipBytes, partText } from "../test/unzip-bytes";

import {
  type PptxRun,
  buildPptxPackage,
  pptxPicture,
  pptxTextBox,
} from "./ooxml-pptx-primitives";

describe("pptxPicture", () => {
  it("places and sizes the shape and embeds by relationship id", () => {
    const xml = pptxPicture({
      id: 4,
      name: "image1.png",
      descr: "A chart",
      relId: "rId2",
      // ★★ x/y DIFFER from each other and cx/cy DIFFER from each other, and
      // that asymmetry is LOAD-BEARING: it is the only reason a transposed
      // `<a:off>` or `<a:ext>` is observable here. "Tidying" these to equal or
      // round numbers makes both assertions below silently vacuous.
      xEmu: 457200,
      yEmu: 1188720,
      cxEmu: 914400,
      cyEmu: 457200,
    });
    expect(xml).toContain(`r:embed="rId2"`);
    expect(xml).toContain(`<a:off x="457200" y="1188720"/>`);
    expect(xml).toContain(`<a:ext cx="914400" cy="457200"/>`);
    expect(xml).toContain(`noChangeAspect="1"`);
  });

  it("escapes the description", () => {
    const xml = pptxPicture({
      id: 4,
      name: "i.png",
      descr: `a & <b>`,
      relId: "rId2",
      xEmu: 0,
      yEmu: 0,
      cxEmu: 1,
      cyEmu: 1,
    });
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain("<b>");
  });

  // ★★ `descr` lands inside an XML ATTRIBUTE, so a bare double quote closes it
  // early and PowerPoint refuses the package — a failure the &amp;/<b> test
  // above cannot see, because neither character it checks is the one that
  // breaks an attribute. Assert on the attribute VALUE, not on the whole blob:
  // this XML is full of legitimate quotes, so a blob-level `not.toContain('"')`
  // would prove nothing.
  //
  // ★ The length assertion is not incidental. `descr` is emitted exactly ONCE
  // (unlike the docx drawing, which carries it twice), so pinning the count
  // catches a later duplication that escapes only one of the two sites.
  it("escapes a double quote inside the descr attribute", () => {
    const xml = pptxPicture({
      id: 4,
      name: "i.png",
      descr: `say "hi"`,
      relId: "rId2",
      xEmu: 0,
      yEmu: 0,
      cxEmu: 1,
      cyEmu: 1,
    });
    const values = [...xml.matchAll(/descr="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toHaveLength(1);
    for (const value of values) {
      expect(value).toBe("say &quot;hi&quot;");
    }
  });
});

// ★★ The package assertions below read PART BYTES, not substrings of a
// fragment, so they use `unzipBytes` rather than the TextDecoder-per-part
// helper `export-ooxml.test.ts` carries — an image part decoded as UTF-8 turns
// invalid sequences into U+FFFD, which would fail for correct output.
describe("buildPptxPackage media", () => {
  const png = {
    path: "ppt/media/image1.png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    extension: "png" as const,
    relId: "rId2",
  };

  it("gives a media-free deck the same parts as before", async () => {
    const parts = await unzipBytes(buildPptxPackage([{ xml: "<p:sld/>", media: [] }]));
    expect(partText(parts, "ppt/slides/_rels/slide1.xml.rels")).toContain("slideLayout1.xml");
    expect(partText(parts, "[Content_Types].xml")).not.toContain("image/");
  });

  it("writes per-slide rels so slide 2's image is not visible to slide 1", async () => {
    const parts = await unzipBytes(
      buildPptxPackage([
        { xml: "<p:sld/>", media: [] },
        { xml: "<p:sld/>", media: [png] },
      ]),
    );
    expect(partText(parts, "ppt/slides/_rels/slide1.xml.rels")).not.toContain("rId2");
    const rels2 = partText(parts, "ppt/slides/_rels/slide2.xml.rels");
    expect(rels2).toContain(`Id="rId2"`);
    expect(rels2).toContain(`Target="../media/image1.png"`);
    // rId1 stays the layout on every slide.
    expect(rels2).toContain("slideLayout1.xml");
  });

  it("writes the bytes verbatim and declares the extension once", async () => {
    const parts = await unzipBytes(buildPptxPackage([{ xml: "<p:sld/>", media: [png] }]));
    expect(Array.from(parts.get("ppt/media/image1.png")!)).toEqual(Array.from(png.data));
    const types = partText(parts, "[Content_Types].xml");
    expect(types.match(/<Default Extension="png"/g)).toHaveLength(1);
  });

  it("refuses rId1, which is the slide layout on every slide", () => {
    expect(() =>
      buildPptxPackage([{ xml: "<p:sld/>", media: [{ ...png, relId: "rId1" }] }]),
    ).toThrow(/rId1/);
  });

  it("leaves the media-free package byte-for-byte what it was", async () => {
    // ★★ NOT THE ONLY PIN ANY MORE, and the difference matters when this goes
    // red. This test pins the sorted PART-KEY set, one `slide1.xml.rels` part
    // as exact bytes, and the absence of any `ppt/media/` entry — it never
    // reads `[Content_Types].xml`, which is how it SURVIVED the mutant that
    // opened open-followups §216. `ooxml-package-manifest.test.ts` closed that:
    // it digests every part of this deck IN ZIP ORDER against
    // `docs/baselines/ooxml-parts.json`, so a content change, an addition, a
    // removal or a REORDER all go red naming the part. `export-ooxml.test.ts`
    // still sees none of it (part PRESENCE and slide-XML SUBSTRINGS only), and
    // there is still no .pptx golden fixture — the manifest replaced that idea
    // deliberately.
    //
    // ★★★ THE EXPECTATIONS ARE FROZEN LITERALS, NOT A SECOND CALL. The obvious
    // form of this test — build the same deck twice and diff the two — is
    // VACUOUS: `media` is a REQUIRED field, so there is no second spelling of
    // "no media" to compare against, and diffing a deterministic function with
    // itself passes with the whole feature deleted, doubled, or emitting
    // garbage. Only a literal written out by hand can fail.
    const parts = await unzipBytes(buildPptxPackage([{ xml: "<p:sld/>", media: [] }]));
    expect([...parts.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/_rels/presentation.xml.rels",
      "ppt/presentation.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/slides/slide1.xml",
      "ppt/theme/theme1.xml",
    ]);
    // The part this task rewrites, pinned as exact bytes — newlines included.
    //
    // ★★ BYTE-EXACT OVER XML BUILT FROM A TEMPLATE LITERAL IS PORTABLE, even
    // though this source file is CRLF in a Windows worktree and LF in the
    // committed blob (`core.autocrlf=true`, and `.gitattributes` names this
    // file in none of its rules).
    //
    // ★★ CORRECTED SUPPORTING FACT, same conclusion: that parenthesis used to
    // read ".gitattributes pins only *.md and two named files — not
    // `src/app/*.ts`", and BOTH halves were wrong. It names THREE files, and one
    // of them IS a `src/app/*.ts` — `operating-guide-builtin.generated.ts`,
    // pinned `text eol=lf`; the other two are the golden fixtures, pinned
    // `-text`. The conclusion is untouched because none of the three is this
    // file, and the portability below rests on the ECMAScript cooked-value rule
    // rather than on any git setting. Run `cat .gitattributes` and count rather
    // than trusting either wording. ECMAScript normalises
    // <CR><LF> to <LF> in a template literal's COOKED value, so the source's
    // line endings never reach the string: the source is CRLF, the string is
    // LF, on every platform.
    //
    // ★★ MEASURED THROUGH THIS EXACT PATH, not reasoned from the spec and not
    // from a standalone node probe — a temporary spec calling this builder
    // under vitest reported EMITTED_CR=0 EMITTED_LF=3 for this very part while
    // the source file held 659 CR bytes. An earlier revision of this comment
    // claimed the opposite ("the same code emits CRLF locally and LF in CI")
    // and normalised \r\n away here, which silently weakened the assertion:
    // a real line-ending change in the emitted XML would have passed.
    expect(partText(parts, "ppt/slides/_rels/slide1.xml.rels")).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    );
    // And no image machinery leaks into an image-free deck.
    expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
  });
});

// ★★ THE PPTX HYPERLINK IS THE MIRROR OF THE DOCX ONE AND DIFFERS FROM IT IN
// BOTH DIRECTIONS, which is why these are pinned here and not assumed from
// `ooxml-docx-primitives`:
//   · `<a:hlinkClick>` carries NO local `xmlns:r`, where `<w:hyperlink>` must —
//     `wrapPptxSlide` binds the prefix on `<p:sld>` and `w:document` does not.
//   · A link relationship id is scoped to ONE SLIDE, so two slides may both
//     mint `rId2` for different targets. Numbering them deck-wide would pass a
//     test that only ever built one slide.
describe("pptxTextBox hyperlinks", () => {
  const box = (runs: readonly PptxRun[]): string =>
    pptxTextBox({
      id: 3,
      name: "Body",
      lang: "en-US",
      xEmu: 457200,
      yEmu: 1188720,
      cxEmu: 8229600,
      cyEmu: 3474720,
      paragraphs: [{ runs }],
    });

  it("emits a:hlinkClick inside a:rPr for a linked run", () => {
    const xml = box([{ text: "the spec", hyperlinkRelId: "rId2" }]);
    expect(xml).toContain(`<a:hlinkClick r:id="rId2"/>`);
    // …inside the properties element, not loose in the run.
    expect(xml).toContain(`<a:hlinkClick r:id="rId2"/></a:rPr>`);
  });

  it("needs no local xmlns:r — p:sld already binds it", () => {
    const xml = box([{ text: "x", hyperlinkRelId: "rId2" }]);
    // ★ Both halves, or this is vacuous: an emitter that dropped the element
    // entirely would satisfy the `not` alone.
    expect(xml).toContain("<a:hlinkClick");
    expect(xml).not.toContain("xmlns:r=");
  });

  it("places a:hlinkClick LAST, where CT_TextCharacterProperties sequences it", () => {
    // ★★★ The sequence is `… highlight · uLn · uFill · latin · ea · cs · sym ·
    // hlinkClick · …`, so the link comes after BOTH children this module
    // already emits. A run carrying all three is the only fixture that can
    // observe the order — one with a single child passes whatever the order is.
    const xml = box([
      { text: "x", hyperlinkRelId: "rId2", highlightRgb: "00FF00", monospace: true },
    ]);
    expect(xml).toContain(
      `<a:highlight><a:srgbClr val="00FF00"/></a:highlight>` +
        `<a:latin typeface="Consolas"/>` +
        `<a:hlinkClick r:id="rId2"/>`,
    );
  });

  it("adds nothing at all to an unlinked run", () => {
    expect(box([{ text: "plain" }])).not.toContain("hlink");
  });
});

describe("buildPptxPackage links", () => {
  const png = {
    path: "ppt/media/image1.png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    extension: "png" as const,
    relId: "rId2",
  };

  it("writes each slide's link rels into that slide's own rels part", async () => {
    // ★★★ BOTH SLIDES REUSE rId2 ON PURPOSE. Slide relationship ids restart at
    // rId2 on every slide (rId1 is that slide's layout), so this is the real
    // shape — a fixture numbering them rId2/rId3 deck-wide would pass while
    // pinning the WRONG rule, and the deck-wide mutant would survive it.
    const parts = await unzipBytes(
      buildPptxPackage([
        { xml: "<p:sp/>", media: [], links: [{ relId: "rId2", target: "https://a.example/one" }] },
        { xml: "<p:sp/>", media: [], links: [{ relId: "rId2", target: "https://b.example/two" }] },
      ]),
    );
    const rels1 = partText(parts, "ppt/slides/_rels/slide1.xml.rels");
    const rels2 = partText(parts, "ppt/slides/_rels/slide2.xml.rels");
    expect(rels1).toContain("https://a.example/one");
    expect(rels2).toContain("https://b.example/two");
    expect(rels1).not.toContain("https://b.example/two");
    expect(rels2).not.toContain("https://a.example/one");
  });

  it("marks the relationship External and adds no part for it", async () => {
    const parts = await unzipBytes(
      buildPptxPackage([
        { xml: "<p:sp/>", media: [], links: [{ relId: "rId2", target: "https://x.example/" }] },
      ]),
    );
    expect(partText(parts, "ppt/slides/_rels/slide1.xml.rels")).toContain(
      `Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://x.example/" TargetMode="External"`,
    );
    // A link has NO part and NO content-type Default — that is what
    // TargetMode="External" licenses, and it is why a link-bearing deck still
    // holds exactly the eleven parts of a media-free one.
    expect([...parts.keys()]).toHaveLength(11);
    expect(partText(parts, "[Content_Types].xml")).not.toContain("hyperlink");
  });

  it("xml-escapes the target", async () => {
    const parts = await unzipBytes(
      buildPptxPackage([
        {
          xml: "<p:sp/>",
          media: [],
          links: [{ relId: "rId2", target: "https://e.example/?a=1&b=2" }],
        },
      ]),
    );
    const rels = partText(parts, "ppt/slides/_rels/slide1.xml.rels");
    expect(rels).toContain("a=1&amp;b=2");
    expect(rels).not.toContain("a=1&b=2");
  });

  it("throws when a slide's link id collides with that slide's media id", () => {
    expect(() =>
      buildPptxPackage([
        {
          xml: "<p:sp/>",
          media: [png],
          links: [{ relId: "rId2", target: "https://a.example/" }],
        },
      ]),
    ).toThrow(/duplicate relationship id/i);
  });

  it("refuses rId1 for a link, which is the slide layout on every slide", () => {
    expect(() =>
      buildPptxPackage([
        { xml: "<p:sp/>", media: [], links: [{ relId: "rId1", target: "https://a.example/" }] },
      ]),
    ).toThrow(/rId1/);
  });

  it("lets two SLIDES reuse one id — the scope is the slide, not the deck", () => {
    // ★ The mirror of the collision test above: the same id in two different
    // rels parts is correct, so a guard written deck-wide would throw here.
    expect(() =>
      buildPptxPackage([
        { xml: "<p:sp/>", media: [png], links: [] },
        { xml: "<p:sp/>", media: [], links: [{ relId: "rId2", target: "https://a.example/" }] },
      ]),
    ).not.toThrow();
  });

  it("adds no external relationship to a link-free slide", async () => {
    // ★ The additive contract at this level. `links` omitted entirely, which is
    // the shape every pre-existing caller has.
    const parts = await unzipBytes(buildPptxPackage([{ xml: "<p:sld/>", media: [] }]));
    const rels = partText(parts, "ppt/slides/_rels/slide1.xml.rels");
    expect(rels).not.toContain(`TargetMode="External"`);
    expect(rels).not.toContain("hyperlink");
  });
});
