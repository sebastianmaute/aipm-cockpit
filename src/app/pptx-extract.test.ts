import { describe, expect, it } from "vitest";
import { extractPptx } from "./pptx-extract";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("extractPptx", () => {
  it("renders one section per slide in numeric order with bullet paragraphs", () => {
    const slide1 = `<p:sld><p:cSld><p:spTree>
      <a:p><a:r><a:t>Title</a:t></a:r></a:p>
      <a:p><a:r><a:t>Bullet</a:t></a:r><a:r><a:t xml:space="preserve"> one</a:t></a:r></a:p>
    </p:spTree></p:cSld></p:sld>`;
    const slide2 = `<p:sld><p:cSld><p:spTree>
      <a:p><a:r><a:t>Second</a:t></a:r></a:p>
    </p:spTree></p:cSld></p:sld>`;
    const entries = new Map<string, Uint8Array>([
      ["ppt/slides/slide2.xml", enc(slide2)],
      ["ppt/slides/slide1.xml", enc(slide1)],
    ]);
    expect(extractPptx(entries)).toBe(
      "## Slide 1\n- Title\n- Bullet one\n\n## Slide 2\n- Second",
    );
  });

  it("returns empty string when there are no slides", () => {
    expect(extractPptx(new Map())).toBe("");
  });

  it("does not blow up on repetitive unclosed markup", () => {
    // 120k unclosed <a:p opens inside one slide - same shape as
    // docx-extract.test.ts's fixture, sized up from its 40k: at 40k the
    // former `<a:p\b[\s\S]*?<\/a:p>` lazy pair regex measured well under a
    // second here (a wrapper containing real ">" characters keeps the
    // blowup slower than office-xml's no-">"-anywhere case), so 40k would
    // not reliably fail this test on a loaded machine. 120k measured
    // ~11s old vs <5ms new, a >1000x margin. The ceiling is deliberately
    // loose - it fails on the pattern class, not on a machine's speed.
    const slide =
      "<p:sld><p:cSld><p:spTree>" + "<a:p ".repeat(120_000) + "</p:spTree></p:cSld></p:sld>";
    const entries = new Map<string, Uint8Array>([["ppt/slides/slide1.xml", enc(slide)]]);
    const start = performance.now();
    extractPptx(entries);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
