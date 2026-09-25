// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDF_EXPORT_FRAME_NAME, PDF_READY_TITLE_PREFIX, isPdfExportFrame, pdfFilenameFromTitle } from "./pdf-export";

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
});
