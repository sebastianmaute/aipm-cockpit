import { describe, expect, it } from "vitest";
import { extractDocx } from "./docx-extract";

function entries(documentXml: string): Map<string, Uint8Array> {
  return new Map([["word/document.xml", new TextEncoder().encode(documentXml)]]);
}

describe("extractDocx", () => {
  it("renders headings and paragraphs in order", () => {
    const xml = `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Plan</w:t></w:r></w:p>
      <w:p><w:r><w:t>Line one</w:t></w:r><w:r><w:t xml:space="preserve"> continued</w:t></w:r></w:p>
    </w:body></w:document>`;
    expect(extractDocx(entries(xml))).toBe("# Project Plan\n\nLine one continued");
  });

  it("renders a table as a Markdown table with a header row", () => {
    const xml = `<w:document><w:body><w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>ID</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>R1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`;
    expect(extractDocx(entries(xml))).toBe(
      "| ID | Owner |\n| --- | --- |\n| R1 | Ada |",
    );
  });

  it("escapes pipe characters inside table cells", () => {
    const xml = `<w:document><w:body><w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`;
    expect(extractDocx(entries(xml))).toContain("a\\|b");
  });

  it("returns empty string when document.xml is missing", () => {
    expect(extractDocx(new Map())).toBe("");
  });

  it("does not blow up on repetitive unclosed markup", async () => {
    // 120k unclosed table opens - 840,063 chars for THIS fixture as
    // committed (`node -e` and print `xml.length` to re-check; don't trust
    // a number here without doing that). Raised from 40k: at 40k (280,063
    // chars) the old lazy `[\s\S]*?` pair regex measured ~1.5s here, only
    // 1.5x over the 1000ms ceiling - too thin a margin on a loaded machine.
    // An earlier revision of this comment conflated repetition count with
    // char count ("142ms at 40k chars, 1861ms at 160k") and both numbers
    // were unreproducible against the actual committed fixture, which
    // measured ~1.5s at 40k reps, not 142ms. At 120k reps the old regex
    // measured ~24.4s; the cursor walk stays linear. The ceiling is
    // deliberately loose - it fails on the pattern class, not on a
    // machine's speed.
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      "<w:tbl ".repeat(120_000) +
      "</w:body></w:document>";
    const entries = new Map([["word/document.xml", new TextEncoder().encode(xml)]]);
    const start = performance.now();
    extractDocx(entries);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
