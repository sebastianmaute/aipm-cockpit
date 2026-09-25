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
// carry. Both real producers already cap well under this (export.ts's
// `defaultFilename` is a short fixed pattern; document-download.ts's
// `documentFilename` runs the title through `slugifyTitle`'s own
// `MAX_FILENAME_STEM` cap) -- this is defense in depth against a renderer
// that could set an arbitrary `document.title`, not a limit either producer
// is expected to hit.
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
