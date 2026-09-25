// §468 — renderer half of the desktop PDF protocol; the main-process half is
// desktop/src/lib/pdf-export.ts, whose test pins these two literals equal.
import { isDesktopShellUserAgent } from "./desktop-shell";
import { htmlEscape } from "./download";

export const PDF_EXPORT_FRAME_NAME = "aipm-pdf-export";
export const PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:";

/** window.open target: the named frame main renders to PDF, or _blank. */
export function pdfWindowName(userAgent: string): string {
  return isDesktopShellUserAgent(userAgent) ? PDF_EXPORT_FRAME_NAME : "_blank";
}

/** The desktop shell's readiness signal: a STATIC `<title>` element, not a
 *  script.
 *
 *  ★★★ §468 review round 2 — the export tab is `document.write`n into an
 *  `about:blank` child, which INHERITS the app's production CSP (a
 *  nonce-only `script-src 'nonce-X' 'strict-dynamic'`, `src/proxy.ts`). An
 *  inline `<script>` written there has no nonce to give it and is blocked
 *  outright, so the original script-based signal (this function's previous
 *  body) very likely never fired in the packaged app — CSP is a browser/
 *  Chromium enforcement independent of who wrote the markup, `document.write`
 *  included. A `<title>` element needs no script permission at all: it is
 *  parsed like any other markup, and `document.title`/`page-title-updated`
 *  both follow purely from parsing, before any script (blocked or not) would
 *  even run.
 *
 *  ★ The caller must REPLACE the page's own `<title>` with this markup,
 *  never append a second one after it — `document.title` resolves to the
 *  FIRST `<title>` element in tree order, so a second one later in the
 *  document is parsed into the DOM but never observed by
 *  `page-title-updated`. `replaceHtmlTitle` below does that replacement for
 *  a caller that only has the rendered HTML as a string. */
export function pdfReadyTitleMarkup(filename: string): string {
  return `<title>${htmlEscape(PDF_READY_TITLE_PREFIX + filename)}</title>`;
}

/** Replace the FIRST `<title>...</title>` in `html` with `titleTag` — see
 *  `pdfReadyTitleMarkup`'s doc comment for why replacing (not appending) is
 *  required. Used by `document-download.ts`'s pdf branch to swap in the
 *  desktop shell's readiness signal without perturbing `renderDocumentHtml`
 *  itself, which every other format (html/docx/pptx) also calls unmodified. */
export function replaceHtmlTitle(html: string, titleTag: string): string {
  return html.replace(/<title>[\s\S]*?<\/title>/, titleTag);
}
