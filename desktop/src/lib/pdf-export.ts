// §468 — PDF export in the desktop shell. Electron refuses a renderer
// window.print(), and the shell has no preload, so the renderer and main
// talk through two plain values: the window NAME passed to window.open,
// and the document TITLE the page sets once it has rendered. Declared on
// both sides of the boundary (desktop/ cannot import src/app/); the test
// pins the two copies equal. Electron-free so the root typecheck covers it.
export const PDF_EXPORT_FRAME_NAME = "aipm-pdf-export";
export const PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:";

export function isPdfExportFrame(frameName: string): boolean {
  return frameName === PDF_EXPORT_FRAME_NAME;
}

/** The suggested save name from a ready title, or null when the title is not
 *  a ready signal. The page is app content, but the name still reaches a
 *  native save dialog, so path separators and control characters are
 *  removed and the extension is forced to .pdf. */
export function pdfFilenameFromTitle(title: string): string | null {
  if (!title.startsWith(PDF_READY_TITLE_PREFIX)) return null;
  const raw = title.slice(PDF_READY_TITLE_PREFIX.length);
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (clean === "") return null;
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}
