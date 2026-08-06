// src/app/document-download.test.ts
//
// This module is wiring, so the tests pin the wiring: which renderer each
// format reaches (proved by the blob's MIME, which only that renderer sets),
// what the file is called, and the two branches of the PDF path — print tab
// vs popup-blocked fallback.
//
// ★ triggerDownload is mocked at the MODULE boundary rather than by patching
// HTMLAnchorElement.prototype.click, so the assertions can see the BLOB, not
// just the filename. importOriginal is required: doc-render-html.ts imports
// htmlEscape/htmlCellWithBreaks/PRINT_STYLES from this same module, and a bare
// factory would blank them and break the renderer under test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  downloadDocument,
  documentFilename,
  withAutoPrint,
  MAX_FILENAME_STEM,
} from "./document-download";
import { triggerDownload } from "./download";
import { defaultResourcePlan } from "./resource-foundation";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";

vi.mock("./download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./download")>();
  return { ...actual, triggerDownload: vi.fn() };
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const ws: Workspace = {
  tasks: [],
  raid: [],
  absences: [],
  shifts: [],
  resources: [],
  roles: [],
  disciplines: [],
  grades: [],
  plan: defaultResourcePlan("2026-01-01"),
};

const doc: ProjectDocument = {
  id: 1,
  title: "Q1 Status / Review",
  blocks: [
    { type: "heading", level: 1, text: "Overview" },
    { type: "bullets", items: ["one", "two"] },
  ],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

/** U+0001, built explicitly. A literal control character here would be
 *  invisible in source, and if an editor pass stripped it the fixture would
 *  degrade to "ab\tc" — which slugifies to the same expected "ab-c", so the
 *  drop-controls assertion would go vacuous while staying green. */
const CTRL = String.fromCharCode(1);

const named = (title: string): ProjectDocument => ({ ...doc, title });

/** The mock's calls, typed. */
const downloads = () => vi.mocked(triggerDownload).mock.calls;

describe("documentFilename", () => {
  it("slugifies the title and appends the date and extension", () => {
    expect(documentFilename(doc, "docx", "2026-08-06")).toBe("q1-status-review-2026-08-06.docx");
  });

  it("falls back to a generic stem when the title slugifies to nothing", () => {
    expect(documentFilename(named("///"), "html", "2026-08-06")).toBe("document-2026-08-06.html");
  });

  // ★★ A filename is a FILE-SYSTEM boundary. Every character Windows reserves
  // (< > : " / \ | ? *) plus every path separator and every whitespace run
  // collapses to a single "-", so a title can never introduce a directory
  // component, escape the download folder, or produce a name Explorer refuses.
  it("strips every path separator and Windows-reserved character", () => {
    expect(documentFilename(named('..\\..\\etc: "x" <y>|z?'), "html", "2026-08-06")).toBe(
      "etc-x-y-z-2026-08-06.html",
    );
  });

  it("drops control characters rather than turning them into separators", () => {
    // A tab or newline is whitespace and becomes a separator; a C0 control is
    // invisible, so a "-" standing in for it would be noise in the name.
    expect(documentFilename(named(`a${CTRL}b\tc`), "html", "2026-08-06")).toBe(
      "ab-c-2026-08-06.html",
    );
  });

  // ★★ DELIBERATE, and a deviation from the plan's `[^a-z0-9]+` slug: German
  // is a first-class language here, and that slug silently ASCII-mangles it —
  // "Änderung" becomes "nderung". The repo already bans ASCII substitutions in
  // German strings (the i18n-encoding test rejects fuer/druecken); a filename
  // is no place to reintroduce them. Non-ASCII LETTERS survive; only
  // file-system-hostile characters are removed.
  it("preserves non-ASCII letters instead of stripping them to ASCII", () => {
    expect(documentFilename(named("Änderung Q1 Überblick"), "docx", "2026-08-06")).toBe(
      "änderung-q1-überblick-2026-08-06.docx",
    );
  });

  // ★ MAX_TITLE_CHARS is 200, so an uncapped stem yields a ~211-character
  // name. Most file systems cap a path COMPONENT at 255 bytes, and a non-ASCII
  // title costs 2 bytes per character there — plus browsers append " (1)" on a
  // name collision. Cap the stem instead of finding out at write time.
  it("caps the stem and never leaves a trailing separator at the cut", () => {
    const name = documentFilename(named("word ".repeat(60)), "pptx", "2026-08-06");
    const stem = name.replace("-2026-08-06.pptx", "");
    expect(stem.length).toBeLessThanOrEqual(MAX_FILENAME_STEM);
    expect(stem.endsWith("-")).toBe(false);
    expect(name.endsWith("-2026-08-06.pptx")).toBe(true);
  });

  it("never leaves a leading dot, so the file cannot land as a dotfile", () => {
    expect(documentFilename(named(".env"), "html", "2026-08-06")).toBe("env-2026-08-06.html");
  });
});

describe("withAutoPrint", () => {
  it("injects the print script INSIDE the document, before </body>", () => {
    const out = withAutoPrint("<html><body><p>x</p></body></html>");
    expect(out).toContain("window.print");
    expect(out.indexOf("window.print")).toBeLessThan(out.indexOf("</body>"));
  });

  // ★ Without this branch a renderer change that dropped </body> would make
  // auto-print silently stop firing — the failure would look like a browser
  // quirk, not a bug.
  it("appends the script when there is no </body> to inject before", () => {
    expect(withAutoPrint("<p>fragment</p>")).toContain("window.print");
  });
});

describe("downloadDocument", () => {
  beforeEach(() => {
    vi.mocked(triggerDownload).mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("routes html to the HTML renderer and names the file .html", async () => {
    downloadDocument(doc, "html", ws, "en-US");
    expect(downloads()).toHaveLength(1);
    const [name, blob] = downloads()[0];
    expect(name).toMatch(/^q1-status-review-\d{4}-\d{2}-\d{2}\.html$/);
    expect(blob.type).toBe("text/html;charset=utf-8");
    const text = await blob.text();
    // ★ FULL-document mode, never "preview": the preview mode is a FRAGMENT
    // that renders no <h1> and no <title>, so a downloaded or printed file
    // built from it would arrive with no heading at all.
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("<h1>Q1 Status / Review</h1>");
    expect(text).toContain("Overview");
    // A plain .html download must never hijack the printer when opened.
    expect(text).not.toContain("window.print");
  });

  // The MIME is set by the package builder inside each renderer, so asserting
  // it proves the right renderer ran — a filename alone would not.
  it("routes docx and pptx to their own renderers", () => {
    downloadDocument(doc, "docx", ws, "en-US");
    downloadDocument(doc, "pptx", ws, "en-US");
    expect(downloads()).toHaveLength(2);
    expect(downloads()[0][0]).toMatch(/\.docx$/);
    expect(downloads()[0][1].type).toBe(DOCX_MIME);
    expect(downloads()[1][0]).toMatch(/\.pptx$/);
    expect(downloads()[1][1].type).toBe(PPTX_MIME);
  });

  it("opens a print tab for pdf, writes the auto-printing HTML, and downloads nothing", () => {
    const write = vi.fn();
    const open = vi.fn(() => ({ document: { open: vi.fn(), write, close: vi.fn() } }));
    vi.stubGlobal("open", open);

    downloadDocument(doc, "pdf", ws, "en-US");

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0][0] as string;
    // Full document, not the preview fragment — a printed PDF with no heading
    // is the failure mode if this ever slips to "preview".
    expect(written).toContain("<!DOCTYPE html>");
    expect(written).toContain("<h1>Q1 Status / Review</h1>");
    expect(written).toContain("window.print");
    // ★ There is no PDF writer and no PDF dependency — "PDF" is print-to-PDF.
    // Nothing may be downloaded here, least of all a .pdf blob.
    expect(downloads()).toHaveLength(0);
  });

  it("falls back to a plain .html download when the popup is blocked", async () => {
    vi.stubGlobal("open", vi.fn(() => null));

    downloadDocument(doc, "pdf", ws, "en-US");

    expect(downloads()).toHaveLength(1);
    const [name, blob] = downloads()[0];
    expect(name).toMatch(/\.html$/);
    expect(blob.type).toBe("text/html;charset=utf-8");
    // ★ The FALLBACK file is the plain document, not the auto-printing one: a
    // downloaded file that opens the print dialog by itself is hostile. The
    // user opens it and prints when they choose to.
    expect(await blob.text()).not.toContain("window.print");
  });

  it("does nothing at all without a window (SSR)", () => {
    vi.stubGlobal("window", undefined);
    downloadDocument(doc, "html", ws, "en-US");
    expect(downloads()).toHaveLength(0);
  });
});
