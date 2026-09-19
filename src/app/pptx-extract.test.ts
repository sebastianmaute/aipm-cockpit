import { describe, expect, it } from "vitest";
import { extractPptx } from "./pptx-extract";
import { expectLinearScaling } from "../test/scaling";

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

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on repetitive unclosed markup", { timeout: 120_000 }, () => {
    // Unclosed <a:p opens inside one slide - same shape as
    // docx-extract.test.ts's fixture. The regression is the former
    // `<a:p\b[\s\S]*?<\/a:p>` lazy pair regex, which rescans to end of input
    // from every open.
    // Measured 2026-09-19 (ratio large / small, limit 8): 3.9–4.1 green,
    // 16.7 with that lazy regex restored in extractPptx.
    expectLinearScaling({
      label: "unclosed <a:p opens",
      build: (n) =>
        new Map<string, Uint8Array>([
          [
            "ppt/slides/slide1.xml",
            enc("<p:sld><p:cSld><p:spTree>" + "<a:p ".repeat(n) + "</p:spTree></p:cSld></p:sld>"),
          ],
        ]),
      run: extractPptx,
      // The slide is read, and no open finds its </a:p>, so it has no bullets.
      check: (out) => expect(out).toBe("## Slide 1"),
      n: 30_000,
    });
  });
});
