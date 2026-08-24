// src/app/ooxml-pptx-primitives.test.ts
//
// PresentationML primitives. Today this covers `pptxPicture` only — the shape
// that puts real image bytes on a slide instead of the text placeholder that
// preceded it.
//
// ★★ These assertions are SUBSTRING matches, which is the right granularity for
// a fragment that is not a whole part (a `<p:pic>` is spliced into a slide by
// `wrapPptxSlide`, which owns the namespace declarations). But substring
// matching cannot see malformed XML, so anything about WELL-FORMEDNESS —
// notably that the `r:` prefix on `r:embed` is bound — is pinned by reading
// `wrapPptxSlide`, not by this file.
import { describe, expect, it } from "vitest";

import { unzipBytes, partText } from "../test/unzip-bytes";

import { buildPptxPackage, pptxPicture } from "./ooxml-pptx-primitives";

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
