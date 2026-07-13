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
});
