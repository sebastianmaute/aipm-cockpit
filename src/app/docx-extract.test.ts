import { describe, expect, it } from "vitest";
import { extractDocx } from "./docx-extract";
import { expectLinearScaling } from "../test/scaling";

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

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on repetitive unclosed markup", { timeout: 120_000 }, () => {
    // Unclosed table opens. The regression is the former lazy
    // `<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>` pair regex, which
    // rescans to end of input from every open; the cursor walk stays linear.
    // Historical, measured before 2026-09-19 against that regex at the old
    // fixed size: ~1.5s at 40k reps, ~24.4s at 120k reps (an earlier comment
    // that quoted char counts instead of reps was unreproducible).
    // Measured 2026-09-19 (ratio large / small, limit 8): 3.8–3.9 green,
    // 16.8 with that lazy regex restored in extractDocx.
    expectLinearScaling({
      label: "unclosed <w:tbl opens",
      // Untimed: the fixture INCLUDING its TextEncoder step and entries Map.
      build: (n) =>
        entries(
          '<?xml version="1.0"?><w:document><w:body>' +
            "<w:tbl ".repeat(n) +
            "<w:p><w:r><w:t>end</w:t></w:r></w:p></w:body></w:document>",
        ),
      run: extractDocx,
      // No open finds its </w:tbl>, so no table renders; the fixed-size
      // paragraph after them proves the walk went on past the soup.
      check: (out) => expect(out).toBe("end"),
      n: 30_000,
    });
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on unclosed <w:pStyle opens inside one paragraph", { timeout: 120_000 }, () => {
    // §558 remainder: the paragraph's own heading read was a
    // `<w:pStyle\b[^>]*w:val=...` regex. With no ">" before the paragraph's
    // close, `[^>]*` runs to it from EVERY open and backtracks all the way —
    // ~4x per doubling of the open count (measured before 2026-09-19).
    // Measured 2026-09-19 (ratio large / small, limit 8): 4.8–5.3 green,
    // 17.2 with that regex restored in headingDigit.
    expectLinearScaling({
      label: "unclosed <w:pStyle opens",
      // Untimed: the fixture INCLUDING its TextEncoder step and entries Map.
      build: (n) =>
        entries(
          "<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r>" +
            "<w:pStyle ".repeat(n) +
            "</w:p></w:body></w:document>",
        ),
      run: extractDocx,
      // The paragraph's one run survives the unclosed opens, with no heading.
      check: (out) => expect(out).toBe("x"),
      n: 10_000,
    });
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
