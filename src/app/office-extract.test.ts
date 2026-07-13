import { describe, expect, it } from "vitest";
import { officeKindOf, extractOfficeMarkdown, MAX_EXTRACT_CHARS } from "./office-extract";
import { buildZip } from "./zip";

describe("officeKindOf", () => {
  it("maps the four OOXML MIME types", () => {
    expect(
      officeKindOf(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("docx");
    expect(
      officeKindOf(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "a.xlsx",
      ),
    ).toBe("xlsx");
    expect(officeKindOf("application/vnd.ms-excel.sheet.macroEnabled.12", "a.xlsm")).toBe("xlsx");
    expect(
      officeKindOf(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "a.pptx",
      ),
    ).toBe("pptx");
  });

  it("falls back to the file extension (incl. xlsm → xlsx)", () => {
    expect(officeKindOf("application/octet-stream", "report.docx")).toBe("docx");
    expect(officeKindOf("", "book.xlsm")).toBe("xlsx");
    expect(officeKindOf("", "deck.pptx")).toBe("pptx");
  });

  it("returns null for non-office types", () => {
    expect(officeKindOf("application/pdf", "a.pdf")).toBeNull();
    expect(officeKindOf("text/plain", "a.txt")).toBeNull();
  });
});

describe("extractOfficeMarkdown", () => {
  async function docxZip(documentXml: string): Promise<Uint8Array> {
    const blob = buildZip([
      { path: "word/document.xml", data: new TextEncoder().encode(documentXml) },
    ]);
    return new Uint8Array(await blob.arrayBuffer());
  }

  it("unzips and extracts a docx to Markdown", async () => {
    const zip = await docxZip(
      `<w:document><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>`,
    );
    expect(await extractOfficeMarkdown(zip, "docx")).toBe("Hello world");
  });

  it("returns a placeholder for an empty document", async () => {
    const zip = await docxZip(`<w:document><w:body/></w:document>`);
    expect(await extractOfficeMarkdown(zip, "docx")).toContain("no extractable text");
  });

  it("truncates output beyond the character cap", async () => {
    const big = "x".repeat(MAX_EXTRACT_CHARS + 100);
    const zip = await docxZip(`<w:document><w:body><w:p><w:r><w:t>${big}</w:t></w:r></w:p></w:body></w:document>`);
    const out = await extractOfficeMarkdown(zip, "docx");
    expect(out.length).toBeLessThan(MAX_EXTRACT_CHARS + 100);
    expect(out).toContain("truncated");
  });

  it("rejects on non-zip bytes", async () => {
    await expect(
      extractOfficeMarkdown(new TextEncoder().encode("nope"), "docx"),
    ).rejects.toThrow();
  });
});
