// §468 — renderer half of the desktop PDF protocol; the main-process half is
// desktop/src/lib/pdf-export.ts, whose test pins these two literals equal.
import { isDesktopShellUserAgent } from "./desktop-shell";

export const PDF_EXPORT_FRAME_NAME = "aipm-pdf-export";
export const PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:";

/** window.open target: the named frame main renders to PDF, or _blank. */
export function pdfWindowName(userAgent: string): string {
  return isDesktopShellUserAgent(userAgent) ? PDF_EXPORT_FRAME_NAME : "_blank";
}

/** Injected in place of the auto-print script in the desktop shell: signals
 *  "rendered" by setting the title, one tick after load (the same wait the
 *  print script uses so layout has happened). The filename is JSON-encoded
 *  and "<" escaped so it cannot close the script element. */
export function pdfReadyScript(filename: string): string {
  const literal = JSON.stringify(PDF_READY_TITLE_PREFIX + filename).replace(/</g, "\\u003c");
  return `<script>
  window.addEventListener("load", function () {
    setTimeout(function () { document.title = ${literal}; }, 80);
  });
</script>`;
}
