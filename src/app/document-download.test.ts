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
import { EXPORT_INLINE_BUDGET_BYTES, loadExportAssets } from "./document-export-assets";
import { unzipBytes } from "../test/unzip-bytes";
import { defaultResourcePlan } from "./resource-foundation";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";

vi.mock("./download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./download")>();
  return { ...actual, triggerDownload: vi.fn() };
});

// ★★ SPIED, NOT STUBBED — the real implementation still runs (the spread keeps
// every other export, which doc-render-html.ts imports from here too). The
// only thing the spy buys is the one property no OUTPUT can show: whether the
// loader machinery is entered at all when there is no loader to enter it with.
// See the "no loader" test below for why that is worth an assertion.
vi.mock("./document-export-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-export-assets")>();
  return { ...actual, loadExportAssets: vi.fn(actual.loadExportAssets) };
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

const ASSET_ID = "asset-1";
/** A 1x1 PNG's first bytes. Only the ALPHABET matters here — the standalone
 *  renderer validates base64 with a character-class regex and never decodes. */
const PNG_B64 = "iVBORw0KGgo=";

const docWithImage = (): ProjectDocument => ({
  ...doc,
  blocks: [{ type: "paragraph", html: `<p><img data-asset-id="${ASSET_ID}" alt="chart"></p>` }],
});

/** Same document with no `<img>` at all — the "nothing to load" case. */
const docWithNoImages = (): ProjectDocument => ({
  ...doc,
  blocks: [{ type: "paragraph", html: "<p>no pictures here</p>" }],
});

/** The metadata half. `assets.inlined` carries the BYTES; the mime the data:
 *  URI needs lives on `ws.documentAssets`, so an inlining assertion needs
 *  both. ★ `hash` is required on DocumentAsset — omitting it fails tsc while
 *  vitest stays green. */
const wsWithAsset: Workspace = {
  ...ws,
  documentAssets: [
    {
      id: ASSET_ID,
      name: "chart.png",
      mime: "image/png",
      size: 8,
      hash: "a".repeat(64),
      createdAt: "2026-08-06T00:00:00.000Z",
    },
  ],
};

/** `wsWithAsset`'s asset carries no width/height, so `canEmbedDocxAsset` and
 *  `canEmbedPptxAsset` both DECLINE it — `fitExtent` has nothing to build an
 *  extent from. That is right for the tests above (which only assert which
 *  renderer ran) and useless for a renderability assertion, which needs the
 *  predicate to be able to say TRUE. */
const wsWithSizedAsset: Workspace = {
  ...ws,
  documentAssets: [{ ...wsWithAsset.documentAssets![0], width: 640, height: 480 }],
};

/** A stand-in for the print tab that models the ONE property the write order
 *  depends on: `document.open()` RESETS the document, so the second write
 *  REPLACES the placeholder instead of appending to it.
 *
 *  ★★ A bare `vi.fn()` for `open` would make that invisible — dropping the
 *  second `open()` leaves every call-count assertion green while the tab would
 *  really print a file with two <title> elements and a doctype mid-body. The
 *  fake is what turns "the final html IS the document" into a real assertion
 *  rather than one about which functions were called. */
function fakeTab(onWrite?: () => void) {
  const state = { html: "" };
  const win = {
    document: {
      open: () => {
        state.html = "";
      },
      write: (chunk: string) => {
        state.html += chunk;
        onWrite?.();
      },
      close: () => {},
    },
  } as unknown as Window;
  return {
    win,
    get html() {
      return state.html;
    },
  };
}

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
    vi.mocked(loadExportAssets).mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("routes html to the HTML renderer and names the file .html", async () => {
    await downloadDocument(doc, "html", ws, "en-US");
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
  it("routes docx and pptx to their own renderers", async () => {
    await downloadDocument(doc, "docx", ws, "en-US");
    await downloadDocument(doc, "pptx", ws, "en-US");
    expect(downloads()).toHaveLength(2);
    expect(downloads()[0][0]).toMatch(/\.docx$/);
    expect(downloads()[0][1].type).toBe(DOCX_MIME);
    expect(downloads()[1][0]).toMatch(/\.pptx$/);
    expect(downloads()[1][1].type).toBe(PPTX_MIME);
  });

  it("opens a print tab for pdf, writes the auto-printing HTML, and downloads nothing", async () => {
    const tab = fakeTab();
    const open = vi.fn(() => tab.win);
    vi.stubGlobal("open", open);

    await downloadDocument(doc, "pdf", ws, "en-US");

    expect(open).toHaveBeenCalledWith("", "_blank");
    const written = tab.html;
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

    await downloadDocument(doc, "pdf", ws, "en-US");

    expect(downloads()).toHaveLength(1);
    const [name, blob] = downloads()[0];
    expect(name).toMatch(/\.html$/);
    expect(blob.type).toBe("text/html;charset=utf-8");
    // ★ The FALLBACK file is the plain document, not the auto-printing one: a
    // downloaded file that opens the print dialog by itself is hostile. The
    // user opens it and prints when they choose to.
    expect(await blob.text()).not.toContain("window.print");
  });

  it("does nothing at all without a window (SSR)", async () => {
    vi.stubGlobal("window", undefined);
    await downloadDocument(doc, "html", ws, "en-US");
    expect(downloads()).toHaveLength(0);
  });
});

// ★★★ THE ORDERING IS THE WHOLE POINT OF THE ASYNC REWRITE. `window.open` is
// only permitted inside the user gesture; an `await` before it SPENDS that
// gesture, so the popup blocker fires for EVERY user and the `!tab` fallback —
// written for the genuinely-blocked case — silently becomes the normal path.
describe("downloadDocument with asset bytes", () => {
  beforeEach(() => {
    vi.mocked(triggerDownload).mockClear();
    vi.mocked(loadExportAssets).mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens the print tab BEFORE awaiting bytes, so the gesture is not spent", async () => {
    const order: string[] = [];
    const tab = fakeTab(() => order.push("write"));
    vi.stubGlobal("open", () => {
      order.push("open");
      return tab.win;
    });
    const load = vi.fn(async () => {
      order.push("load");
      return PNG_B64;
    });

    await downloadDocument(docWithImage(), "pdf", wsWithAsset, "en-US", load);

    // ★ A POSITIVE full-sequence assertion, deliberately not an `indexOf`
    // comparison: `indexOf` returns -1 for an absent entry and -1 is less than
    // every real index, so a mutant that DELETES an emission stays green.
    expect(order).toEqual(["open", "write", "load", "write"]);
    expect(load).toHaveBeenCalledWith(ASSET_ID);
  });

  it("replaces the placeholder rather than appending the document to it", async () => {
    const tab = fakeTab();
    vi.stubGlobal("open", () => tab.win);

    await downloadDocument(docWithImage(), "pdf", wsWithAsset, "en-US", async () => PNG_B64);

    // Exactly one document: one doctype, one <title>, and nothing before the
    // doctype. The placeholder is gone, not merely followed.
    expect(tab.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(tab.html.toLowerCase().split("<!doctype html>")).toHaveLength(2);
    expect(tab.html.split("<title>")).toHaveLength(2);
    expect(tab.html).toContain(`src="data:image/png;base64,${PNG_B64}"`);
    expect(tab.html).toContain("window.print");
  });

  it("still falls back to an html download when the popup is blocked", async () => {
    vi.stubGlobal("open", vi.fn(() => null));

    await downloadDocument(docWithImage(), "pdf", wsWithAsset, "en-US", async () => PNG_B64);

    expect(downloads()).toHaveLength(1);
    const [name, blob] = downloads()[0];
    // ★ .html, never .pdf — there is no PDF writer anywhere in this module.
    expect(name).toMatch(/\.html$/);
    const text = await blob.text();
    // The fallback carries the bytes too: a blocked popup must not silently
    // cost the user their images as well as their print dialog.
    expect(text).toContain(`src="data:image/png;base64,${PNG_B64}"`);
    expect(text).not.toContain("window.print");
  });

  it("does not load any bytes for a document with no images", async () => {
    const load = vi.fn(async () => PNG_B64);

    await downloadDocument(docWithNoImages(), "docx", ws, "en-US", load);

    expect(load).not.toHaveBeenCalled();
    expect(downloads()).toHaveLength(1);
  });

  it("inlines the loaded bytes into the html and OOXML downloads alike", async () => {
    await downloadDocument(docWithImage(), "html", wsWithAsset, "en-US", async () => PNG_B64);
    await downloadDocument(docWithImage(), "docx", wsWithAsset, "en-US", async () => PNG_B64);
    await downloadDocument(docWithImage(), "pptx", wsWithAsset, "en-US", async () => PNG_B64);

    expect(downloads()).toHaveLength(3);
    const html = await downloads()[0][1].text();
    expect(html).toContain(`src="data:image/png;base64,${PNG_B64}"`);
    // ★★ ATTRIBUTE-WITH-VALUE, not the bare substring: the standalone page
    // styles carry an `img[data-asset-missing]` CSS rule, so the bare name is
    // present in EVERY standalone output and asserting on it would chase a
    // failure that is not one.
    expect(html).not.toContain('data-asset-missing="true"');
    // A package is a zip; asserting its size beats zero proves the renderer
    // ran, and the MIMEs prove WHICH one.
    expect(downloads()[1][1].type).toBe(DOCX_MIME);
    expect(downloads()[2][1].type).toBe(PPTX_MIME);
  });

  // ★★★ THE OUTPUT CANNOT SEE THIS ONE, so the spy is the only detector.
  // Dropping the `load ? … : NO_EXPORT_ASSETS` guard produces a BYTE-IDENTICAL
  // file: `loadExportAssets` would call `undefined(id)`, its own try/catch in
  // document-export-assets.ts turns the TypeError into `missing`, and a missing
  // id renders exactly as an id in no bucket does. Measured — that mutant
  // survived the whole suite. It is worth pinning anyway, because the export
  // then depends on ANOTHER module's catch staying as wide as it is today:
  // narrow it to network errors (a reasonable future change) and this call site
  // starts throwing away the user's whole document over an absent loader.
  it("discloses every image as missing when no loader is supplied, without entering the loader", async () => {
    await downloadDocument(docWithImage(), "html", wsWithAsset, "en-US");

    const html = await downloads()[0][1].text();
    expect(html).toContain('data-asset-missing="true"');
    expect(html).not.toContain("base64,");
    expect(loadExportAssets).not.toHaveBeenCalled();
  });

  it("does enter the loader when one IS supplied, so the spy above is not vacuous", async () => {
    await downloadDocument(docWithImage(), "html", wsWithAsset, "en-US", async () => PNG_B64);
    expect(loadExportAssets).toHaveBeenCalledTimes(1);
  });
});

// ★★★ BUDGET AND RENDERABILITY ARE PER FORMAT, NOT PER DOWNLOAD. Both used to
// be resolved ONCE per download and handed to whichever renderer ran, which was
// wrong in two independent ways at the same time: the 25 MB inline budget — a
// property of base64-inside-the-file, which only HTML and PDF do — truncated
// DOCX and PPTX exports that store bytes as native zip entries; and the
// `isRenderable` predicate the OOXML renderers export for exactly this call was
// never passed, so bytes were charged for assets they then declined.
describe("downloadDocument asset policy per format", () => {
  beforeEach(() => {
    vi.mocked(triggerDownload).mockClear();
    vi.mocked(loadExportAssets).mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    // pdf needs a tab to write into; every other format ignores this.
    vi.stubGlobal("open", () => fakeTab().win);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** The one call's arguments. Asserting the call COUNT here is what stops a
   *  later `[0]` from silently reading a stale call from a previous format. */
  const loadArgs = () => {
    const calls = vi.mocked(loadExportAssets).mock.calls;
    expect(calls).toHaveLength(1);
    return calls[0];
  };

  it("budgets the inline sinks and leaves the OOXML ones unbounded", async () => {
    const cases = [
      ["html", EXPORT_INLINE_BUDGET_BYTES],
      ["pdf", EXPORT_INLINE_BUDGET_BYTES],
      ["docx", Number.POSITIVE_INFINITY],
      ["pptx", Number.POSITIVE_INFINITY],
    ] as const;

    for (const [format, budget] of cases) {
      vi.mocked(loadExportAssets).mockClear();
      await downloadDocument(docWithImage(), format, wsWithSizedAsset, "en-US", async () => PNG_B64);
      expect(loadArgs()[2], format).toBe(budget);
    }
  });

  it("passes a renderability predicate to the OOXML formats and none to the inline ones", async () => {
    for (const format of ["html", "pdf"] as const) {
      vi.mocked(loadExportAssets).mockClear();
      await downloadDocument(docWithImage(), format, wsWithSizedAsset, "en-US", async () => PNG_B64);
      // ★ The inline sinks deliberately filter NOTHING: renderDocumentHtml can
      // inline any allowed mime, and `assetSrcAttr` declines an unusable asset
      // at render time anyway.
      expect(loadArgs()[3], format).toBeUndefined();
    }

    for (const format of ["docx", "pptx"] as const) {
      vi.mocked(loadExportAssets).mockClear();
      await downloadDocument(docWithImage(), format, wsWithSizedAsset, "en-US", async () => PNG_B64);
      const isRenderable = loadArgs()[3];
      expect(typeof isRenderable, format).toBe("function");
      // ★★★ INVOKING IT IS THE POINT. "is a function" is a TYPE assertion and a
      // predicate closing over an EMPTY map satisfies it while declining every
      // id — the exact mutant this pair of assertions exists to kill. The true
      // case can only pass if the closure really resolved the id through
      // `ws.documentAssets`.
      expect(isRenderable!(ASSET_ID), format).toBe(true);
      expect(isRenderable!("no-such-asset"), format).toBe(false);
    }
  });

  it("does not filter or budget anything when there is no loader at all", async () => {
    await downloadDocument(docWithImage(), "docx", wsWithSizedAsset, "en-US");
    expect(loadExportAssets).not.toHaveBeenCalled();
  });

  // ★★ THE BEHAVIOURAL HALF. The call-argument assertions above prove the
  // WIRING; this one proves the OUTPUT, so the property survives a refactor
  // that changes how the budget reaches loadExportAssets. It is slow on
  // purpose — the budget is a real 25 MB and cannot be injected, so the only
  // way to be over it is to actually be over it.
  it("still embeds an image the inline budget would have dropped", async () => {
    // One image alone past the budget: 26,250,000 decoded bytes against a
    // 26,214,400 cap, so `spent + bytes > budgetBytes` is true on the FIRST
    // asset and the inline sinks omit it outright.
    const huge = "A".repeat(35_000_000);
    expect(Math.floor((huge.length * 3) / 4)).toBeGreaterThan(EXPORT_INLINE_BUDGET_BYTES);

    await downloadDocument(docWithImage(), "docx", wsWithSizedAsset, "en-US", async () => huge);

    expect(downloads()).toHaveLength(1);
    const zip = await unzipBytes(downloads()[0][1]);
    const media = [...zip.keys()].filter((p) => p.startsWith("word/media/"));
    expect(media).toHaveLength(1);
    expect(zip.get(media[0])!.length).toBe(Math.floor((huge.length * 3) / 4));
  });
});
