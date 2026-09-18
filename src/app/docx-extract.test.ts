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

  it("does not misroute an uppercase look-alike block to the wrong closer", () => {
    // §558 fix round 3, item 5: forEachTagPair used to hardcode "gi", so
    // <W:TBL matched BLOCK_PAIR's open pattern, but the exact
    // case-SENSITIVE `openMatch[0] === "<w:tbl"` comparison (both in
    // closeName and in extractDocx's own renderer choice) then failed,
    // routing it to the "w:p" closer instead - silently merging the decoy's
    // content forward into whatever the next real </w:p> was ("decoyReal").
    // Restoring case sensitivity ("g") means <W:TBL simply does not match
    // the open pattern at all, exactly like the original regex, so its
    // content is skipped entirely rather than merged.
    const xml = `<w:document><w:body>
      <W:TBL><w:t>decoy</w:t></W:TBL>
      <w:p><w:r><w:t>Real</w:t></w:r></w:p>
    </w:body></w:document>`;
    expect(extractDocx(entries(xml))).toBe("Real");
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

  it("does not blow up on unclosed <w:pStyle opens inside one paragraph", () => {
    // §558 remainder: the paragraph's own heading read was a
    // `<w:pStyle\b[^>]*w:val=...` regex. With no ">" before the paragraph's
    // close, `[^>]*` runs to it from EVERY open and backtracks all the way,
    // so 40k opens measured ~5s against the old read (20k ~1.2s, 80k ~21s —
    // ~4x per doubling). The ceiling is deliberately loose: it fails on the
    // pattern class, not on a machine's speed.
    const xml =
      "<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r>" +
      "<w:pStyle ".repeat(40_000) +
      "</w:p></w:body></w:document>";
    const start = performance.now();
    extractDocx(entries(xml));
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("still reads the heading level whatever the pStyle's attribute order", () => {
    // The linear read must accept every shape the former regex did: w:val
    // before or after other attributes, lower-case "heading", a paired
    // (not self-closing) pStyle, and the first pStyle that names a heading
    // winning over an earlier one that does not.
    const para = (pPr: string, text: string) =>
      `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const xml = `<w:document><w:body>${[
      para(`<w:pStyle w:val="Heading2"/>`, "a"),
      para(`<w:pStyle w:x="1" w:val="Heading3" w:y="2"/>`, "b"),
      para(`<w:pStyle w:val="heading4"></w:pStyle>`, "c"),
      para(`<w:pStyle w:val="Title"/><w:pStyle w:val="Heading5"/>`, "d"),
      para(`<w:pStyle w:val="Heading12"/>`, "e"),
      para(`<w:pStyle w:val="Normal"/>`, "f"),
    ].join("")}</w:body></w:document>`;
    expect(extractDocx(entries(xml))).toBe("## a\n\n### b\n\n#### c\n\n##### d\n\ne\n\nf");
  });
});
