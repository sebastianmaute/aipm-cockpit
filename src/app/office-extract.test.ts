import { describe, expect, it } from "vitest";
import {
  officeKindOf,
  extractOfficeMarkdown,
  looksLikeEncryptedOfficeFile,
  MAX_EXTRACT_CHARS,
} from "./office-extract";
import { buildZip } from "./zip";
import { buildCfbf } from "./__fixtures__/cfbf-writer";

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

describe("looksLikeEncryptedOfficeFile", () => {
  /** ★ The fixture writer places every stream in the regular FAT rather than
   *  the mini stream, so a stream must be LARGER than the 4096-byte mini
   *  cutoff its header declares or `cfbf.ts` looks for it on the mini path and
   *  reads nothing back. A 42-byte payload here reads as a zero-length stream
   *  and this whole suite would pass for the wrong reason — measured, not
   *  assumed (see the writer's own header comment). */
  const stream = (fill: number) => new Uint8Array(4608).fill(fill);

  it("is true for the MS-OFFCRYPTO shape: a compound file with an EncryptedPackage stream", () => {
    const encrypted = buildCfbf([
      { name: "EncryptionInfo", data: stream(1) },
      { name: "EncryptedPackage", data: stream(2) },
    ]);
    expect(looksLikeEncryptedOfficeFile(encrypted)).toBe(true);
  });

  it("is false for an ordinary .docx, which is a zip and not a compound file", async () => {
    const blob = buildZip([
      {
        path: "word/document.xml",
        data: new TextEncoder().encode(`<w:document><w:body/></w:document>`),
      },
    ]);
    const zip = new Uint8Array(await blob.arrayBuffer());
    expect(looksLikeEncryptedOfficeFile(zip)).toBe(false);
  });

  it("is false for a compound file WITHOUT that stream — a legacy .doc is not encrypted", () => {
    // ★★ THE ASSERTION THAT KEEPS "encrypted" AND "read-failed" APART at the
    //  container level. A legacy binary .doc/.xls renamed to .docx is a
    //  compound file too; widening the test to "is a compound file" would tell
    //  its owner to remove a password that was never set.
    const legacy = buildCfbf([{ name: "WordDocument", data: stream(3) }]);
    expect(looksLikeEncryptedOfficeFile(legacy)).toBe(false);
  });

  it("is false for a nested EncryptedPackage — only the root storage counts", () => {
    const nested = buildCfbf([
      { name: "Decoy", children: [{ name: "EncryptedPackage", data: stream(4) }] },
    ]);
    expect(looksLikeEncryptedOfficeFile(nested)).toBe(false);
  });

  it("is false for short and non-compound bytes without throwing", () => {
    expect(looksLikeEncryptedOfficeFile(new TextEncoder().encode("nope"))).toBe(false);
    expect(looksLikeEncryptedOfficeFile(new Uint8Array(0))).toBe(false);
  });
});
