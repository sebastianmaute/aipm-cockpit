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
  PDF_COLLECT_STYLES_SCRIPT,
  PDF_MIN_SCALE,
  PDF_WRAP_ATTR,
  PDF_WRAP_CSS,
  type PdfPrintTarget,
  pdfFitScale,
  pdfMarkWideTablesScript,
  pdfMeasureScript,
  pdfNeedsWrap,
  pdfPageFromCss,
  pdfPrintOptions,
  preparePdfPrint,
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

// §468 packaged-app check -- the export tab inherits the app's nonce-only
// `style-src-elem`, so in the packaged app its own `<style>` block did not
// apply: the PDF printed unstyled (serif, no table width, Letter portrait,
// clipped columns). Main re-applies that CSS through `insertCSS`, prints the
// page the CSS asks for EXPLICITLY, and fits the widest table to its width.
describe("pdf print preparation (§468 packaged-app check)", () => {
  const LANDSCAPE_CSS = "@page { size: A4 landscape; margin: 10mm 8mm; }\n table { width: 100%; }";
  const MM = 1 / 25.4;
  // A4 landscape, 8mm left + right: (297 - 16)mm at 96px/in.
  const LANDSCAPE_PRINTABLE = (281 / 25.4) * 96;

  it("reads the page off the last @page rule, the way the cascade does", () => {
    const landscape = pdfPageFromCss(LANDSCAPE_CSS);
    expect(landscape.pageSize).toBe("A4");
    expect(landscape.landscape).toBe(true);
    expect(landscape.margins.top).toBeCloseTo(10 * MM, 9);
    expect(landscape.margins.bottom).toBeCloseTo(10 * MM, 9);
    expect(landscape.margins.left).toBeCloseTo(8 * MM, 9);
    expect(landscape.margins.right).toBeCloseTo(8 * MM, 9);
    expect(landscape.printableWidthPx).toBeCloseTo(LANDSCAPE_PRINTABLE, 5);
    // PRINT_STYLES then DOCUMENT_PAGE_STYLES: a document prints portrait.
    const doc = pdfPageFromCss(`${LANDSCAPE_CSS}\n@page { size: A4 portrait; margin: 18mm 16mm; }`);
    expect(doc.landscape).toBe(false);
    expect(doc.printableWidthPx).toBeCloseTo((178 / 25.4) * 96, 5);
    expect(pdfPageFromCss("@page { size: A4; margin: 10mm; }").printableWidthPx).toBeCloseTo((190 / 25.4) * 96, 5);
    const letter = pdfPageFromCss("@page { size: letter landscape; margin: 0.5in; }");
    expect(letter.pageSize).toBe("Letter");
    expect(letter.printableWidthPx).toBeCloseTo(10 * 96, 5);
    // Four-value shorthand: top right bottom left.
    const four = pdfPageFromCss("@page { size: A4; margin: 1in 2in 3in 4in; }").margins;
    expect(four).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  it("falls back to the NARROWEST sensible page when there is no readable @page rule", () => {
    // Letter portrait, Chromium's default 0.4in margins -- narrower than A4,
    // so an unknown page errs towards scaling down, never towards clipping.
    for (const css of ["", "@page { size: 20cm 10cm; }", "@page { size: A4; margin: auto; }"]) {
      const page = pdfPageFromCss(css);
      expect(page.pageSize).toBe("Letter");
      expect(page.landscape).toBe(false);
      expect(page.printableWidthPx).toBeCloseTo(7.7 * 96, 5);
    }
  });

  // ★ Reads the .ts SOURCE, not the emitted strings, because this package
  // cannot import src/app (see the desktop/src-app boundary note at the top of
  // pdf-export.ts). A future comment containing an `@page {` rule in either
  // file would change what this sees.
  it("matches the real stylesheets the two producers emit", () => {
    const download = readFileSync(join(__dirname, "../../../src/app/download.ts"), "utf8");
    const docHtml = readFileSync(join(__dirname, "../../../src/app/doc-render-html.ts"), "utf8");
    const exportPage = pdfPageFromCss(download);
    expect(exportPage).toMatchObject({ pageSize: "A4", landscape: true });
    expect(exportPage.printableWidthPx).toBeCloseTo(LANDSCAPE_PRINTABLE, 5);
    // A document emits PRINT_STYLES and THEN its own portrait rule.
    const docPage = pdfPageFromCss(`${download}\n${docHtml}`);
    expect(docPage).toMatchObject({ pageSize: "A4", landscape: false });
    expect(docPage.printableWidthPx).toBeCloseTo((178 / 25.4) * 96, 5);
  });

  it("prints at 100% when the content already fits", () => {
    expect(pdfFitScale({ contentWidthPx: 900, printableWidthPx: 1000 })).toBe(1);
    expect(pdfFitScale({ contentWidthPx: 1000, printableWidthPx: 1000 })).toBe(1);
  });

  it("scales a too-wide page down to fit, rounding DOWN so it never overshoots", () => {
    // 1000/1500 = 0.6666... -> 0.66, not 0.67 (0.67 * 1500 = 1005 > 1000).
    expect(pdfFitScale({ contentWidthPx: 1500, printableWidthPx: 1000 })).toBe(0.66);
    expect(pdfFitScale({ contentWidthPx: 1250, printableWidthPx: 1000 })).toBe(0.8);
  });

  it("never scales below the readable floor", () => {
    expect(PDF_MIN_SCALE).toBe(0.6);
    expect(pdfFitScale({ contentWidthPx: 3129, printableWidthPx: 1062 })).toBe(PDF_MIN_SCALE);
  });

  it("passes the page EXPLICITLY, from the same parse the scale used", () => {
    const page = pdfPageFromCss(LANDSCAPE_CSS);
    expect(pdfPrintOptions(page, 1500)).toEqual({
      printBackground: true,
      pageSize: "A4",
      landscape: true,
      margins: page.margins,
      scale: Math.floor((LANDSCAPE_PRINTABLE / 1500) * 100) / 100,
    });
  });

  it("wraps tables only when the floor alone cannot fit them", () => {
    expect(pdfNeedsWrap({ contentWidthPx: 1500, printableWidthPx: 1000 })).toBe(false);
    expect(pdfNeedsWrap({ contentWidthPx: 1000 / PDF_MIN_SCALE, printableWidthPx: 1000 })).toBe(false);
    expect(pdfNeedsWrap({ contentWidthPx: 1000 / PDF_MIN_SCALE + 1, printableWidthPx: 1000 })).toBe(true);
  });

  // ONE ordered log of every call, so a mutant that measures before
  // re-applying the CSS (or marks after inserting the wrap CSS) is visible.
  function fakeTarget(opts: { css: unknown; width: unknown; marked?: unknown }) {
    const calls: string[] = [];
    const target: PdfPrintTarget = {
      executeJavaScript: async (code: string) => {
        if (code === PDF_COLLECT_STYLES_SCRIPT) {
          calls.push("js:collect");
          return opts.css;
        }
        if (code.includes(PDF_WRAP_ATTR)) {
          calls.push(`js:${code}`);
          return opts.marked ?? 1;
        }
        calls.push(`js:${code}`);
        return opts.width;
      },
      insertCSS: async (css: string) => {
        calls.push(`css:${css}`);
        return "key";
      },
    };
    return { target, calls };
  }

  it("re-applies the page's own stylesheet BEFORE measuring it", async () => {
    const { target, calls } = fakeTarget({ css: LANDSCAPE_CSS, width: 900 });
    const plan = await preparePdfPrint(target);
    expect(calls).toEqual([
      "js:collect",
      `css:${LANDSCAPE_CSS}`,
      `js:${pdfMeasureScript(pdfPageFromCss(LANDSCAPE_CSS).printableWidthPx)}`,
    ]);
    expect(plan.options.scale).toBe(1);
    expect(plan.options).toMatchObject({ pageSize: "A4", landscape: true });
    expect(plan.unwrappedOverflow).toBe(false);
  });

  it("scales a moderately wide export without touching its tables", async () => {
    const { target, calls } = fakeTarget({ css: LANDSCAPE_CSS, width: 1500 });
    const plan = await preparePdfPrint(target);
    expect(calls).toHaveLength(3);
    expect(plan.options.scale).toBe(Math.floor((LANDSCAPE_PRINTABLE / 1500) * 100) / 100);
  });

  it("marks the tables still too wide at the floor, THEN inserts the wrap CSS", async () => {
    const { target, calls } = fakeTarget({ css: LANDSCAPE_CSS, width: 3129 });
    const plan = await preparePdfPrint(target);
    expect(calls).toEqual([
      "js:collect",
      `css:${LANDSCAPE_CSS}`,
      `js:${pdfMeasureScript(pdfPageFromCss(LANDSCAPE_CSS).printableWidthPx)}`,
      `js:${pdfMarkWideTablesScript(Math.floor(pdfPageFromCss(LANDSCAPE_CSS).printableWidthPx / PDF_MIN_SCALE))}`,
      `css:${PDF_WRAP_CSS}`,
    ]);
    expect(plan.options.scale).toBe(PDF_MIN_SCALE);
    expect(plan.unwrappedOverflow).toBe(false);
  });

  it("reports overflow no table accounts for", async () => {
    const { target } = fakeTarget({ css: LANDSCAPE_CSS, width: 3129, marked: 0 });
    expect((await preparePdfPrint(target)).unwrappedOverflow).toBe(true);
  });

  it("inserts nothing for a page with no stylesheet, and treats an unreadable width as fitting", async () => {
    const { target, calls } = fakeTarget({ css: "", width: undefined });
    const plan = await preparePdfPrint(target);
    expect(calls.filter((c) => c.startsWith("css:"))).toEqual([]);
    expect(plan.options.scale).toBe(1);
    expect(plan.options.pageSize).toBe("Letter");
  });

  it("the wrap CSS only reaches tables main has marked", () => {
    const selectors = PDF_WRAP_CSS.slice(0, PDF_WRAP_CSS.indexOf("{")).split(",").map((x) => x.trim());
    expect(selectors.length).toBeGreaterThan(1);
    for (const selector of selectors) expect(selector.startsWith(`table[${PDF_WRAP_ATTR}]`)).toBe(true);
  });
});
