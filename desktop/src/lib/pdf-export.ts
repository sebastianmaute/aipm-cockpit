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
//
// ★ ONLY the head stylesheet -- the first `<style>` in `<head>`, the same
// element `withStyleNonce` (pdf-export-protocol.ts) grants the nonce to, and
// for the same reason: every producer emits its stylesheet there, before any
// content, so a later `<style>` could only have come from content. insertCSS
// bypasses the page's CSP, so re-applying EVERY `<style>` would grant content
// what the renderer deliberately withholds.
export const PDF_COLLECT_STYLES_SCRIPT =
  '(() => { const s = document.querySelector("head > style"); return s ? s.textContent || "" : ""; })()';

// The readable floor for shrinking a wide table. PRINT_STYLES sets table text
// at 9pt, so 0.6 prints it at 5.4pt -- about the smallest size still legible
// on paper (small-print territory); below that, shrinking stops trading width
// for readability and just produces an unreadable table. A table wider than
// the floor can fit is wrapped instead (see PDF_WRAP_CSS), never clipped.
export const PDF_MIN_SCALE = 0.6;

// Marks a table that is still wider than the page at PDF_MIN_SCALE.
export const PDF_WRAP_ATTR = "data-pdf-wrap";

// Marks a cell of a wrapped table whose value is atomic -- a date, a number,
// a short id -- and must stay on one line (see isAtomicCellValue).
export const PDF_NOWRAP_ATTR = "data-pdf-nowrap";

// What counts as an atomic cell value: at most 12 characters, and a date
// (2026-06-01), a number (42, -3.5, 1,200, 80%), a #-id (#12) or a key-style id
// (LOP-101). Deliberately VALUE SHAPES, not "any short token": nowrap raises a
// column's minimum width, and a blanket short-token rule across 30 columns
// could push the table back over the page. The page-side script builds its
// RegExp from this same source string, so the two cannot disagree.
export const PDF_ATOMIC_VALUE_SOURCE =
  "^(?=.{1,12}$)(?:\\d{4}-\\d{2}-\\d{2}|[-+]?\\d[\\d.,]*%?|#\\d+|[A-Z][A-Z0-9]*-\\d+)$";

/** True when a cell's trimmed text is a date, number or id shape that must not
 *  break across lines. */
export function isAtomicCellValue(text: string): boolean {
  return new RegExp(PDF_ATOMIC_VALUE_SOURCE).test(text.trim());
}

// Lets a marked table's cells break inside a word, so the table's minimum
// width drops to what the page can hold -- except atomic values, which keep
// their line. ONLY marked tables: `anywhere` also changes how auto table layout
// shares width out, so applying it to a table that already fits would
// needlessly squeeze its short columns.
export const PDF_WRAP_CSS =
  `table[${PDF_WRAP_ATTR}] th, table[${PDF_WRAP_ATTR}] td { overflow-wrap: anywhere; }\n` +
  `table[${PDF_WRAP_ATTR}] td[${PDF_NOWRAP_ATTR}] { overflow-wrap: normal; white-space: nowrap; }`;

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

// ★ The measurements below run in SCREEN media, while the page prints in PRINT
// media. That is exact only while no `@media print` rule changes a width:
// PRINT_STYLES' print block holds only `thead { display: table-header-group }`
// and `tr { page-break-inside: avoid }`, neither of which moves a column.
//
// ★ Pinning `body`'s width to the printable width is exact only while the body
// has no horizontal margin -- PRINT_STYLES sets `body { margin: 0 }`. A future
// body margin would make every fit optimistic by that margin.

/** Lays the body out at the page's printable width and returns every table's
 *  rendered width, in document order, putting the body back afterwards. Run
 *  through `executeJavaScript`, which the page's CSP does not govern; the
 *  hidden window's own viewport width is irrelevant. */
export function pdfTableWidthsScript(printableWidthPx: number): string {
  return `(() => {
  const b = document.body;
  if (!b) return [];
  const prev = b.style.width;
  b.style.width = "${printableWidthPx}px";
  const widths = Array.from(document.querySelectorAll("table"), (t) => t.getBoundingClientRect().width);
  b.style.width = prev;
  return widths;
})()`;
}

export interface PdfTableFit {
  /** CSS `zoom` for the table: 1 when it fits, down to PDF_MIN_SCALE. */
  zoom: number;
  /** Still too wide at PDF_MIN_SCALE: let its cells break (PDF_WRAP_CSS). */
  wrap: boolean;
}

/** How one table of `widthPx` fits a page `printableWidthPx` wide.
 *
 *  ★ PER TABLE, never per page: printing the whole page smaller would shrink a
 *  document's prose along with its one wide register table. The zoom is the
 *  fit rounded DOWN to a hundredth (so it never overshoots), clamped to
 *  PDF_MIN_SCALE; a table the floor cannot fit is wrapped at the floor. */
export function pdfTableFit(widthPx: number, printableWidthPx: number): PdfTableFit {
  if (!(widthPx > printableWidthPx)) return { zoom: 1, wrap: false };
  const fit = Math.floor((printableWidthPx / widthPx) * 100) / 100;
  return {
    zoom: Math.max(PDF_MIN_SCALE, fit),
    wrap: widthPx > printableWidthPx / PDF_MIN_SCALE,
  };
}

/** Applies `fits` to the document's tables by index: sets each one's CSS
 *  `zoom` (a CSSOM write, which `style-src` does not govern), marks the ones
 *  to wrap, and marks their atomic cells to keep their line. Returns how many
 *  tables it changed. */
export function pdfApplyTableFitsScript(fits: readonly PdfTableFit[]): string {
  return `((fits, atomic) => {
  const re = new RegExp(atomic);
  const tables = Array.from(document.querySelectorAll("table"));
  let changed = 0;
  fits.forEach((fit, i) => {
    const t = tables[i];
    if (!t || (fit.zoom === 1 && !fit.wrap)) return;
    changed++;
    if (fit.zoom !== 1) t.style.zoom = String(fit.zoom);
    if (!fit.wrap) return;
    t.setAttribute("${PDF_WRAP_ATTR}", "");
    for (const c of t.querySelectorAll("td")) {
      if (re.test((c.textContent || "").trim())) c.setAttribute("${PDF_NOWRAP_ATTR}", "");
    }
  });
  return changed;
})(${JSON.stringify(fits)}, ${JSON.stringify(PDF_ATOMIC_VALUE_SOURCE)})`;
}

/** The widest thing on the page -- the body's own overflow or any table, at
 *  its rendered (zoomed) width -- with the body laid out at the printable
 *  width. Used AFTER fitting, to detect anything the fit could not bring in. */
export function pdfWidestScript(printableWidthPx: number): string {
  return `(() => {
  const b = document.body;
  if (!b) return 0;
  const prev = b.style.width;
  b.style.width = "${printableWidthPx}px";
  const widest = Math.max(b.scrollWidth, ...Array.from(document.querySelectorAll("table"), (t) => t.getBoundingClientRect().width));
  b.style.width = prev;
  return widest;
})()`;
}

export interface PdfPrintOptions {
  printBackground: true;
  pageSize: PdfPageSize;
  landscape: boolean;
  margins: PdfMarginsIn;
}

/** printToPDF options for `page`, always at 100% -- fitting is per table (see
 *  pdfTableFit), so prose never shrinks. */
export function pdfPrintOptions(page: PdfPage): PdfPrintOptions {
  return {
    printBackground: true,
    pageSize: page.pageSize,
    landscape: page.landscape,
    margins: { ...page.margins },
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
  /** True when something is still wider than the page after every table was
   *  fitted -- non-table content, or a table not even wrapping could bring in. */
  stillOverflows: boolean;
}

// Sub-pixel rounding in getBoundingClientRect: a table exactly the printable
// width can measure a fraction over it.
const OVERFLOW_TOLERANCE_PX = 1;

/** Re-applies the page's head stylesheet, reads the page it asks for, fits
 *  each wide table (zoom, then wrap), and returns the printToPDF options.
 *
 *  ★★ ORDER IS LOAD-BEARING: insertCSS BEFORE measuring (measured unstyled,
 *  the tasks table in the repro was about 3300px instead of 3129px), and the
 *  wrap CSS BEFORE the final overflow check. Unreadable widths count as
 *  "fits": the page then prints exactly as its stylesheet lays it out. */
export async function preparePdfPrint(target: PdfPrintTarget): Promise<PdfPrintPlan> {
  const collected = await target.executeJavaScript(PDF_COLLECT_STYLES_SCRIPT);
  const css = typeof collected === "string" ? collected : "";
  if (css.trim() !== "") await target.insertCSS(css);

  const page = pdfPageFromCss(css);
  const measured = await target.executeJavaScript(pdfTableWidthsScript(page.printableWidthPx));
  const widths = Array.isArray(measured) ? measured : [];
  const fits = widths.map((w) =>
    typeof w === "number" && Number.isFinite(w) ? pdfTableFit(w, page.printableWidthPx) : { zoom: 1, wrap: false },
  );

  if (fits.some((f) => f.zoom !== 1 || f.wrap)) {
    await target.executeJavaScript(pdfApplyTableFitsScript(fits));
    if (fits.some((f) => f.wrap)) await target.insertCSS(PDF_WRAP_CSS);
  }
  const widest = await target.executeJavaScript(pdfWidestScript(page.printableWidthPx));
  const stillOverflows = typeof widest === "number" && widest > page.printableWidthPx + OVERFLOW_TOLERANCE_PX;
  return { options: pdfPrintOptions(page), stillOverflows };
}
