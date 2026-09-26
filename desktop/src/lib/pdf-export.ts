// §468 — PDF export in the desktop shell. Electron refuses a renderer
// window.print(), and the shell has no preload, so the renderer and main
// talk through two plain values: the window NAME passed to window.open, and
// the document TITLE the page carries once it has rendered.
//
// ★★★ §468 review round 2 -- the title itself is a STATIC `<title>` element
// the renderer writes into the document (`pdfReadyTitleMarkup`,
// src/app/pdf-export-protocol.ts), never a script. The export tab is
// `document.write`n into an `about:blank` child, which inherits the app's
// production CSP (a nonce-only `script-src`, src/proxy.ts); an inline
// `<script>` there has no nonce and is blocked outright, so the original
// script-based signal this module's `pdfFilenameFromTitle` was built for
// very likely never fired in the packaged app. A `<title>` element needs no
// script permission at all -- it fires `page-title-updated` purely from
// parsing, before any script (blocked or not) would even run.
//
// Declared on both sides of the desktop/src-app import boundary (desktop/
// cannot import src/app/); the test pins the two copies equal. Electron-free
// so the root typecheck covers it.
export const PDF_EXPORT_FRAME_NAME = "aipm-pdf-export";
export const PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:";

export function isPdfExportFrame(frameName: string): boolean {
  return frameName === PDF_EXPORT_FRAME_NAME;
}

// §468 review Minor B -- main.ts closes the hidden export window if this much
// time passes with no ready title (a crashed or hung renderer, or a JS error
// before the renderer's own `load` handler runs). Without a bound, a stuck
// first export never fires `did-create-window` again for a SECOND one opened
// through the same named `window.open` target, silently swallowing it. Also
// reused (round 2) as the budget for polling `document.readyState` once a
// ready title HAS arrived -- see main.ts. Generous either way: a last-resort
// backstop for a renderer that never finishes, not a normal-path budget.
export const PDF_EXPORT_TIMEOUT_MS = 60_000;

// §468 review round 2 -- how often main.ts polls `document.readyState`
// (via `executeJavaScript`, unaffected by the page's CSP) after the ready
// title arrives but before printing: the title sits early in `<head>`, so it
// can be parsed well before the rest of the document has laid out.
export const PDF_EXPORT_READY_POLL_INTERVAL_MS = 100;

// §468 review round 2 -- the pure "is the page ready to print" predicate main.ts
// polls `document.readyState` against. Exported/pure/tested per review rather
// than an inline `=== "complete"` in main.ts, which is outside the blocking
// typecheck and untestable.
export function isDocumentReadyState(readyState: string): boolean {
  return readyState === "complete";
}

// §468 review round 2 -- the sanitized save name always carries a forced
// `.pdf` extension (see `pdfFilenameFromTitle`); this is its inverse, used to
// give the PDF a clean metadata title (via `executeJavaScript`, again
// CSP-independent) rather than printing with the ready-signal text itself as
// the document title.
export function pdfMetadataTitleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

// §468 review Minor A -- Windows reserves these ten names as a device stem,
// REGARDLESS of extension ("CON", "con.txt" and "NUL.PDF" are all unusable),
// so the test is against the stem alone, case-insensitively.
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// The longest STEM (before the forced ".pdf") a suggested save name may
// carry. Both real producers already cap under this: each runs its title
// through `filenameStem`'s `MAX_FILENAME_STEM` (80) cap (src/app/filename-
// stem.ts), and export.ts's `exportFilename` adds at most a 21-character
// "aipm-cockpit-project-" prefix and an 11-character "-YYYY-MM-DD" suffix
// (112 at most) -- this is defense in depth against a renderer that could set
// an arbitrary `document.title`, not a limit either producer is expected to
// hit.
export const PDF_FILENAME_MAX_STEM_LENGTH = 120;

/** The suggested save name from a ready title, or null when the title is not
 *  a ready signal or sanitizes down to nothing. The page is app content, but
 *  the name still reaches a native save dialog, so:
 *   - path separators (only the last segment survives -- this structurally
 *     defeats `../` traversal rather than string-matching `..`),
 *   - control characters,
 *   - the Windows-reserved punctuation `: * ? " < > |`, and
 *   - trailing dots/spaces (Windows silently strips these on write; stripping
 *     them here keeps the sanitized name in sync with what Windows would
 *     actually create)
 *  are all removed; a Windows-reserved device stem is prefixed with `_`; the
 *  stem is capped to `PDF_FILENAME_MAX_STEM_LENGTH`; and the extension is
 *  forced to `.pdf`. */
export function pdfFilenameFromTitle(title: string): string | null {
  if (!title.startsWith(PDF_READY_TITLE_PREFIX)) return null;
  const raw = title.slice(PDF_READY_TITLE_PREFIX.length);
  const base = raw.split(/[\\/]/).pop() ?? "";
  let clean = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[:*?"<>|]/g, "")
    .trim()
    .replace(/[.\s]+$/, "");
  if (clean === "") return null;

  const dotIndex = clean.indexOf(".");
  const stem = dotIndex === -1 ? clean : clean.slice(0, dotIndex);
  if (RESERVED_DEVICE_NAMES.test(stem)) clean = `_${clean}`;

  const withExt = clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
  const nameStem = withExt.slice(0, -".pdf".length);
  if (nameStem.length <= PDF_FILENAME_MAX_STEM_LENGTH) return withExt;

  const cappedStem = nameStem.slice(0, PDF_FILENAME_MAX_STEM_LENGTH).replace(/[.\s]+$/, "");
  return cappedStem === "" ? null : `${cappedStem}.pdf`;
}

// ★★★ §468 packaged-app check -- WHY THE FIRST PACKAGED PDF LOOKED UNSTYLED.
// The export tab is `document.write`n into an `about:blank` child, which
// inherits the app's production CSP -- and that CSP's `style-src-elem` is
// nonce-only (src/proxy.ts), exactly like its `script-src`. The tab's own
// `<style>` block (PRINT_STYLES, plus DOCUMENT_PAGE_STYLES for a document)
// carried no nonce, so the packaged app never applied it, and every visual
// defect the user saw followed from that one fact: the default serif font,
// `printToPDF`'s default Letter portrait page (the `@page { size: A4
// landscape }` rule never applied), tables sized to their content and clipped
// at the right edge, and rows many lines tall because the clipped, off-page
// columns (description, note log) wrapped narrow. Inline `style=""`
// attributes still applied (`style-src-attr 'unsafe-inline'`), which is why
// the h2 headings looked styled. `next dev` allows 'unsafe-inline' styles, so
// none of this reproduces against a dev server.
//
// The renderer now writes that `<style>` WITH the page's nonce
// (`pdf-export-protocol.ts`'s `nonceOpenTag`/`withStyleNonce`), so it normally
// applies on its own. Main STILL re-applies the same text through
// `webContents.insertCSS`, which the page's CSP does not govern, and that is
// deliberate belt-and-braces: the renderer can only nonce the tag when
// `readCspNonce` finds a non-empty nonce at export time, and a `<style>` that
// was blocked for any reason is still parsed -- its text is readable, it is
// just never applied. Re-applying rules that already apply changes nothing
// (identical rules, identical cascade position relative to each other). One
// source of truth either way: no copy of the stylesheet lives on this side of
// the desktop/src-app boundary.
export const PDF_COLLECT_STYLES_SCRIPT =
  'Array.from(document.querySelectorAll("style"), (s) => s.textContent || "").join("\\n")';

// The readable floor for fit-to-width. PRINT_STYLES sets table text at 9pt, so
// 0.6 prints it at 5.4pt -- about the smallest size still legible on paper
// (small-print territory); below that, shrinking stops trading width for
// readability and just produces an unreadable page. Tables wider than the
// floor can fit are wrapped instead (see PDF_WRAP_CSS), never clipped.
export const PDF_MIN_SCALE = 0.6;

// Marks a table that is still wider than the page at PDF_MIN_SCALE.
export const PDF_WRAP_ATTR = "data-pdf-wrap";

// Lets a marked table's cells break inside a word, so the table's minimum
// width drops to what the page can hold. ONLY marked tables: `anywhere` also
// changes how auto table layout shares width out, so applying it to a table
// that already fits would needlessly squeeze its short columns.
// ★ Only TABLES are wrapped. Non-table content wider than the page at the
// floor (a long unbroken URL in a paragraph, a wide `<pre>`) still scales to
// the floor and can still clip; both producers put every wide value in a
// table, so this is not reached today -- `preparePdfPrint` reports it via
// `unwrappedOverflow` so main can log it rather than let it pass silently.
export const PDF_WRAP_CSS = `table[${PDF_WRAP_ATTR}] th, table[${PDF_WRAP_ATTR}] td { overflow-wrap: anywhere; }`;

const PX_PER_IN = 96;
const IN_PER_UNIT: Readonly<Record<string, number>> = {
  in: 1,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
  px: 1 / PX_PER_IN,
};

/** The named sizes the stylesheets may ask for, as printToPDF spells them. */
export type PdfPageSize = "A3" | "A4" | "A5" | "Letter" | "Legal";

// Portrait [width, height] in inches.
const PAGE_SIZES_IN: Readonly<Record<string, readonly [PdfPageSize, number, number]>> = {
  a3: ["A3", 297 / 25.4, 420 / 25.4],
  a4: ["A4", 210 / 25.4, 297 / 25.4],
  a5: ["A5", 148 / 25.4, 210 / 25.4],
  letter: ["Letter", 8.5, 11],
  legal: ["Legal", 8.5, 14],
};

/** printToPDF's margin shape: inches. */
export interface PdfMarginsIn {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PdfPage {
  pageSize: PdfPageSize;
  landscape: boolean;
  margins: PdfMarginsIn;
  /** The width content is laid out in at 100%, in CSS px. */
  printableWidthPx: number;
}

// Chromium's default print margin.
const FALLBACK_MARGIN_IN = 0.4;
const FALLBACK_MARGINS: PdfMarginsIn = {
  top: FALLBACK_MARGIN_IN,
  right: FALLBACK_MARGIN_IN,
  bottom: FALLBACK_MARGIN_IN,
  left: FALLBACK_MARGIN_IN,
};

// No readable `@page` rule: Letter portrait (printToPDF's own default page)
// with Chromium's default margins -- narrower than A4, so an unknown page errs
// towards scaling down rather than towards clipping.
const FALLBACK_PAGE: PdfPage = {
  pageSize: "Letter",
  landscape: false,
  margins: FALLBACK_MARGINS,
  printableWidthPx: (8.5 - 2 * FALLBACK_MARGIN_IN) * PX_PER_IN,
};

function lengthIn(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(in|cm|mm|px)$/i.exec(token);
  if (!m) return null;
  const perUnit = IN_PER_UNIT[m[2].toLowerCase()];
  return perUnit === undefined ? null : Number(m[1]) * perUnit;
}

/** A `margin` shorthand value (1-4 lengths) as the four sides, in inches. */
function marginsIn(value: string): PdfMarginsIn | null {
  const parts = value.trim().split(/\s+/).map(lengthIn);
  if (parts.length === 0 || parts.length > 4) return null;
  const lengths: number[] = [];
  for (const p of parts) {
    if (p === null) return null;
    lengths.push(p);
  }
  const [top, right = top, bottom = top, left = right] = lengths;
  return { top, right, bottom, left };
}

/** The page the stylesheet asks for: named size, orientation, margins, and
 *  the resulting printable width in CSS px.
 *
 *  Reads `size` and `margin` from the LAST `@page` rule declaring each -- the
 *  cascade's answer, which is what makes a document (PRINT_STYLES' landscape
 *  rule, then DOCUMENT_PAGE_STYLES' portrait one) come out portrait. Only
 *  named sizes are understood; anything else falls back to FALLBACK_PAGE.
 *
 *  ★ Main passes this page to printToPDF EXPLICITLY (`pdfPrintOptions`) rather
 *  than trusting `preferCSSPageSize` to honour an `@page` rule, so the page
 *  that is printed and the width the scale was computed for come from ONE
 *  parse and cannot disagree. */
export function pdfPageFromCss(css: string): PdfPage {
  let size: string | null = null;
  let margin: string | null = null;
  for (const rule of css.matchAll(/@page\s*\{([^}]*)\}/g)) {
    const body = rule[1];
    const s = /(?:^|;)\s*size\s*:\s*([^;]+)/.exec(body);
    const m = /(?:^|;)\s*margin\s*:\s*([^;]+)/.exec(body);
    if (s) size = s[1].trim().toLowerCase();
    if (m) margin = m[1].trim();
  }
  if (size === null) return FALLBACK_PAGE;
  const [name, orientation = "portrait"] = size.split(/\s+/);
  const page = PAGE_SIZES_IN[name];
  if (!page || (orientation !== "portrait" && orientation !== "landscape")) return FALLBACK_PAGE;
  const margins = margin === null ? FALLBACK_MARGINS : marginsIn(margin);
  if (margins === null) return FALLBACK_PAGE;
  const landscape = orientation === "landscape";
  const [pageSize, portraitWidthIn, portraitHeightIn] = page;
  const widthIn = landscape ? portraitHeightIn : portraitWidthIn;
  return {
    pageSize,
    landscape,
    margins,
    printableWidthPx: (widthIn - margins.left - margins.right) * PX_PER_IN,
  };
}

/** Lays the body out at `layoutWidthPx` (the page's printable width), reads
 *  the widest thing on it -- the body's own overflow or any table -- and puts
 *  the body back. Run through `executeJavaScript`, which the page's CSP does
 *  not govern. The hidden export window's own viewport width is irrelevant:
 *  the body is pinned to the page width for the measurement.
 *  ★ Pinning `body`'s width is exact only while the body has no horizontal
 *  margin -- PRINT_STYLES sets `body { margin: 0 }`. A future body margin
 *  would make the fit optimistic by that margin. */
export function pdfMeasureScript(layoutWidthPx: number): string {
  return `(() => {
  const b = document.body;
  if (!b) return 0;
  const prev = b.style.width;
  b.style.width = "${layoutWidthPx}px";
  const widest = Math.max(b.scrollWidth, ...Array.from(document.querySelectorAll("table"), (t) => t.getBoundingClientRect().width));
  b.style.width = prev;
  return widest;
})()`;
}

/** Marks (PDF_WRAP_ATTR) every table wider than `layoutWidthPx` when the body
 *  is laid out at that width, and returns how many it marked. */
export function pdfMarkWideTablesScript(layoutWidthPx: number): string {
  return `(() => {
  const b = document.body;
  if (!b) return 0;
  const prev = b.style.width;
  b.style.width = "${layoutWidthPx}px";
  const wide = Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > ${layoutWidthPx});
  for (const t of wide) t.setAttribute("${PDF_WRAP_ATTR}", "");
  b.style.width = prev;
  return wide.length;
})()`;
}

export interface PdfFit {
  contentWidthPx: number;
  printableWidthPx: number;
}

/** True when even PDF_MIN_SCALE cannot fit the content, so the widest tables
 *  have to wrap. */
export function pdfNeedsWrap({ contentWidthPx, printableWidthPx }: PdfFit): boolean {
  return contentWidthPx > printableWidthPx / PDF_MIN_SCALE;
}

/** The fit-to-width scale: 1 when the content fits, otherwise the scale that
 *  fits it -- rounded DOWN to a hundredth so it never overshoots -- clamped to
 *  PDF_MIN_SCALE. */
export function pdfFitScale({ contentWidthPx, printableWidthPx }: PdfFit): number {
  const fit = contentWidthPx > printableWidthPx ? Math.floor((printableWidthPx / contentWidthPx) * 100) / 100 : 1;
  return Math.min(1, Math.max(PDF_MIN_SCALE, fit));
}

export interface PdfPrintOptions {
  printBackground: true;
  pageSize: PdfPageSize;
  landscape: boolean;
  margins: PdfMarginsIn;
  scale: number;
}

/** printToPDF options for `page` at the scale that fits `contentWidthPx`. */
export function pdfPrintOptions(page: PdfPage, contentWidthPx: number): PdfPrintOptions {
  return {
    printBackground: true,
    pageSize: page.pageSize,
    landscape: page.landscape,
    margins: { ...page.margins },
    scale: pdfFitScale({ contentWidthPx, printableWidthPx: page.printableWidthPx }),
  };
}

/** The two webContents calls the preparation needs -- an interface rather
 *  than Electron's type so this module stays Electron-free and testable. */
export interface PdfPrintTarget {
  executeJavaScript(code: string): Promise<unknown>;
  insertCSS(css: string): Promise<unknown>;
}

export interface PdfPrintPlan {
  options: PdfPrintOptions;
  /** True when the content needed wrapping but no TABLE was wide enough to
   *  mark -- i.e. something that is not a table overflows. See PDF_WRAP_CSS. */
  unwrappedOverflow: boolean;
}

/** Re-applies the page's own stylesheet, measures the content against the
 *  page that stylesheet asks for, wraps any table the scale floor cannot fit,
 *  and returns the printToPDF options.
 *
 *  ★★ ORDER IS LOAD-BEARING: insertCSS BEFORE measuring. Measured unstyled,
 *  the tasks table in the repro measured about 3300px wide instead of 3129px, so the scale
 *  is computed for the wrong layout. An unreadable measurement counts as
 *  "fits": the page then prints exactly as its stylesheet lays it out. */
export async function preparePdfPrint(target: PdfPrintTarget): Promise<PdfPrintPlan> {
  const collected = await target.executeJavaScript(PDF_COLLECT_STYLES_SCRIPT);
  const css = typeof collected === "string" ? collected : "";
  if (css.trim() !== "") await target.insertCSS(css);

  const page = pdfPageFromCss(css);
  const measured = await target.executeJavaScript(pdfMeasureScript(page.printableWidthPx));
  const contentWidthPx =
    typeof measured === "number" && Number.isFinite(measured) ? measured : page.printableWidthPx;

  let unwrappedOverflow = false;
  if (pdfNeedsWrap({ contentWidthPx, printableWidthPx: page.printableWidthPx })) {
    const marked = await target.executeJavaScript(
      pdfMarkWideTablesScript(Math.floor(page.printableWidthPx / PDF_MIN_SCALE)),
    );
    await target.insertCSS(PDF_WRAP_CSS);
    unwrappedOverflow = marked === 0;
  }
  return { options: pdfPrintOptions(page, contentWidthPx), unwrappedOverflow };
}
