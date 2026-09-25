// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PDF_EXPORT_FRAME_NAME,
  PDF_EXPORT_READY_POLL_INTERVAL_MS,
  PDF_EXPORT_TIMEOUT_MS,
  PDF_FILENAME_MAX_STEM_LENGTH,
  PDF_READY_TITLE_PREFIX,
  isDocumentReadyState,
  isPdfExportFrame,
  pdfFilenameFromTitle,
  pdfMetadataTitleFromFilename,
} from "./pdf-export";

describe("pdf-export protocol (§468)", () => {
  it("recognises only its own frame name", () => {
    expect(isPdfExportFrame("aipm-pdf-export")).toBe(true);
    expect(isPdfExportFrame("_blank")).toBe(false);
    expect(isPdfExportFrame("")).toBe(false);
  });
  it("reads the filename from a ready title and rejects anything else", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:Apollo.pdf")).toBe("Apollo.pdf");
    expect(pdfFilenameFromTitle("Apollo")).toBeNull();
    expect(pdfFilenameFromTitle("aipm-pdf-ready:")).toBeNull();
  });
  it("strips path separators and control characters from the suggested name", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:../../x/evil.pdf")).toBe("evil.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:a\u0000b.pdf")).toBe("ab.pdf");
  });
  it("forces a .pdf extension", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:report.html")).toBe("report.html.pdf");
  });
  it("matches the renderer's copy of both constants", () => {
    const src = readFileSync(join(__dirname, "../../../src/app/pdf-export-protocol.ts"), "utf8");
    expect(src).toContain(`"${PDF_EXPORT_FRAME_NAME}"`);
    expect(src).toContain(`"${PDF_READY_TITLE_PREFIX}"`);
  });

  // §468 review Minor A -- a bare `:` produces a defaultPath Windows reads as
  // a drive-relative path or an NTFS alternate stream ("a:b.pdf"); the other
  // six are Windows' remaining reserved filename characters.
  it("strips every Windows-reserved punctuation character", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:a:b.pdf")).toBe("ab.pdf");
    expect(pdfFilenameFromTitle('aipm-pdf-ready:a*b?c"d<e>f|g.pdf')).toBe("abcdefg.pdf");
  });

  it("prefixes a Windows-reserved device stem, with or without an extension, case-insensitively", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:CON.pdf")).toBe("_CON.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:con")).toBe("_con.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:Nul.txt")).toBe("_Nul.txt.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:COM3")).toBe("_COM3.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:LPT9.pdf")).toBe("_LPT9.pdf");
    // ★ Not reserved: COM0/LPT0 don't exist as device names, and "console" is
    // a different, longer word that merely starts with "con".
    expect(pdfFilenameFromTitle("aipm-pdf-ready:COM0")).toBe("COM0.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:console")).toBe("console.pdf");
  });

  it("strips trailing dots and spaces rather than carrying them into the extension", () => {
    // ★ Before this fix, ".." became the malformed "...pdf".
    expect(pdfFilenameFromTitle("aipm-pdf-ready:evil..")).toBe("evil.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:evil . ")).toBe("evil.pdf");
    // Entirely dots/spaces sanitizes to nothing -- same fallback as any other
    // name that sanitizes to empty.
    expect(pdfFilenameFromTitle("aipm-pdf-ready:..")).toBeNull();
  });

  it("caps the stem length rather than producing an arbitrarily long save name", () => {
    const long = "x".repeat(PDF_FILENAME_MAX_STEM_LENGTH + 50);
    const result = pdfFilenameFromTitle(`aipm-pdf-ready:${long}.pdf`);
    expect(result).toBe(`${"x".repeat(PDF_FILENAME_MAX_STEM_LENGTH)}.pdf`);
    expect(result?.length).toBe(PDF_FILENAME_MAX_STEM_LENGTH + ".pdf".length);
  });

  it("times out generously but not forever, so a stuck export cannot block a later one indefinitely", () => {
    expect(PDF_EXPORT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(PDF_EXPORT_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  // §468 review round 2 -- the readiness predicate main.ts polls
  // `document.readyState` against once a ready title has arrived.
  it("treats only 'complete' as ready to print", () => {
    expect(isDocumentReadyState("complete")).toBe(true);
    expect(isDocumentReadyState("interactive")).toBe(false);
    expect(isDocumentReadyState("loading")).toBe(false);
    expect(isDocumentReadyState("")).toBe(false);
  });

  it("polls generously often, not so tightly it busy-loops main", () => {
    expect(PDF_EXPORT_READY_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10);
    expect(PDF_EXPORT_READY_POLL_INTERVAL_MS).toBeLessThanOrEqual(1_000);
  });

  it("strips the forced .pdf extension to give the PDF a clean metadata title", () => {
    expect(pdfMetadataTitleFromFilename("Apollo.pdf")).toBe("Apollo");
    expect(pdfMetadataTitleFromFilename("_CON.pdf")).toBe("_CON");
    // ★ Case-insensitive, matching pdfFilenameFromTitle's own case-preserving
    // extension check (`clean.toLowerCase().endsWith(".pdf")`), which can
    // leave an uppercase ".PDF" in place.
    expect(pdfMetadataTitleFromFilename("Report.PDF")).toBe("Report");
  });
});
