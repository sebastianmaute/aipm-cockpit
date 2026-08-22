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

import { pptxPicture } from "./ooxml-pptx-primitives";

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
