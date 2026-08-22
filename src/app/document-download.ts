// src/app/document-download.ts — the ONE place a project document becomes
// bytes the user receives. Every format the Documents panel offers routes
// through here, so the filename rules and the print behaviour live in a single
// spot rather than once per button.
//
// ★★ THERE IS NO PDF WRITER AND NO PDF DEPENDENCY. "PDF" means: render the
// standalone HTML, open it in a tab, and let the browser's own print dialog
// produce the file via "Save as PDF" — the same mechanism export.ts's
// exportPdf has used all along. A .pdf blob is never created, so nothing here
// may ever hand triggerDownload one.

import type { ProjectDocument } from "./document-model";
import { renderDocumentHtml } from "./doc-render-html";
import { renderDocumentDocx } from "./doc-render-docx";
import { renderDocumentPptx } from "./doc-render-pptx";
import { loadExportAssets, NO_EXPORT_ASSETS } from "./document-export-assets";
import type { AssetByteLoader } from "./document-asset-images";
import { triggerDownload } from "./download";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocFormat = "html" | "docx" | "pptx" | "pdf";

const HTML_MIME = "text/html;charset=utf-8";

/** Longest slug we put in front of the `-YYYY-MM-DD.ext` suffix.
 *
 *  ★ MAX_TITLE_CHARS is 200, so an uncapped stem produces a ~211-character
 *  name. File systems generally cap a path COMPONENT at 255 BYTES — and a
 *  non-ASCII title costs two bytes per character there — while browsers append
 *  " (1)", " (2)" on a name collision. Capping is cheaper than discovering the
 *  limit at write time. */
export const MAX_FILENAME_STEM = 80;

/** C0 controls, DEL and C1 — expressed as the complement of the printable
 *  ranges. Every bound is an ESCAPE, not the character itself: a literal one
 *  would trip eslint's no-control-regex, and an invisible byte in source is
 *  exactly what a stray editor pass silently mangles. */
const NON_PRINTABLE = /[^\u0020-\u007E\u00A0-\uFFFF]/g;

/** Path separators, the characters Windows reserves, and any whitespace run.
 *  Collapsing these is what stops a title from introducing a directory
 *  component or a name Explorer refuses to create. */
const FS_UNSAFE = /[<>:"/\\|?*\s]+/g;

/** Title → filename stem.
 *
 *  ★★ Non-ASCII LETTERS ARE KEPT ON PURPOSE. The obvious slug — lowercase then
 *  `[^a-z0-9]+` → "-" — silently ASCII-mangles German: "Änderung" becomes
 *  "nderung", "Übersicht" becomes "bersicht". German is a first-class language
 *  in this app and the i18n-encoding test already bans ASCII substitutions in
 *  German strings; a filename is no place to reintroduce them. Only characters
 *  a FILE SYSTEM objects to are removed. */
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    // ★★ ORDER IS LOAD-BEARING. Tab, newline and CR are BOTH control
    // characters and whitespace. Dropping non-printables first fuses the words
    // either side of a pasted line break ("Q1\tStatus" → "q1status"); mapping
    // whitespace to a separator first keeps them apart, and only the truly
    // invisible controls are then dropped. Caught by test, not by review.
    .replace(FS_UNSAFE, "-")
    .replace(NON_PRINTABLE, "")
    .replace(/-{2,}/g, "-")
    // Leading dots would make a dotfile; leading/trailing dashes are noise.
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  // Trim again after the cut: slicing mid-word can leave a dangling separator.
  return slug.slice(0, MAX_FILENAME_STEM).replace(/-+$/, "") || "document";
}

/** `<slug>-<today>.<ext>`. `today` is passed in rather than read from a clock,
 *  so the function is pure and its tests cannot drift with the date. */
export function documentFilename(
  doc: ProjectDocument,
  format: DocFormat,
  today: string,
): string {
  return `${slugifyTitle(doc.title)}-${today}.${format}`;
}

/** The auto-print harness, injected only into the tab we open ourselves.
 *
 *  ★ It waits for `load` and then one more tick: some browsers print a blank
 *  page if the dialog opens before the document has been laid out. focus() and
 *  print() can throw if the tab was closed first — there is nothing to recover,
 *  the user can still press Ctrl+P, so the throw is deliberately swallowed. */
const AUTO_PRINT_SCRIPT = `<script>
  window.addEventListener("load", function () {
    setTimeout(function () {
      try { window.focus(); window.print(); } catch (e) {}
    }, 80);
  });
</script>`;

const BODY_CLOSE = "</body>";

/** Add the auto-print harness to a rendered document.
 *
 *  ★★ This lives HERE, not in renderDocumentHtml behind an `autoPrint` flag.
 *  Auto-printing is a property of the tab we open, not of the document, and
 *  keeping it out of the renderer makes it STRUCTURALLY impossible for the
 *  plain `.html` download to carry it — with a flag, that guarantee would rest
 *  on every future caller remembering to leave the flag off.
 *
 *  ★ The no-`</body>` branch is not paranoia: a silent no-op here would look
 *  like a browser quirk ("sometimes the print dialog doesn't open"), which is
 *  the most expensive kind of bug to chase. */
export function withAutoPrint(html: string): string {
  return html.includes(BODY_CLOSE)
    ? // Function replacement, not a string: `$&` and `` $` `` are special in a
      // replacement string, so a future edit to the script that introduced a
      // "$" would corrupt the output in a way that is very hard to see.
      html.replace(BODY_CLOSE, () => `${AUTO_PRINT_SCRIPT}${BODY_CLOSE}`)
    : html + AUTO_PRINT_SCRIPT;
}

/** Shown in the print tab while the bytes load. Deliberately minimal and
 *  unstyled: it is replaced within a tick or two, and anything richer would
 *  flash. */
const PREPARING_HTML = "<!doctype html><title></title>";

/**
 * Hand the user `doc` as a file.
 *
 * `html`/`docx`/`pptx` download directly. `pdf` opens a print tab instead —
 * see the module header. When a popup blocker stops that tab, the user gets
 * the plain HTML as a download rather than nothing at all; without that branch
 * the button appears dead for everyone running a strict blocker.
 */
export async function downloadDocument(
  doc: ProjectDocument,
  format: DocFormat,
  ws: Workspace,
  lang: Lang,
  /** Resolves one asset id to base64. Omitted (no Turso config, Safe Mode)
   *  means every image is disclosed as missing rather than the export
   *  failing. */
  load?: AssetByteLoader,
): Promise<void> {
  if (typeof window === "undefined") return;
  const today = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    // ★★★ OPEN FIRST, BEFORE ANY `await`. `window.open` is only permitted
    // inside the user gesture, and awaiting the bytes SPENDS that gesture — so
    // the popup blocker fires for EVERY user and the fallback below silently
    // stops meaning "blocked" and becomes the normal path. The tab is a
    // top-level one rather than an iframe: browsers drive the print dialog
    // more reliably from one, and it leaves the user Ctrl+P if auto-print
    // misfires.
    const tab = window.open("", "_blank");
    if (!tab) {
      const assets = load ? await loadExportAssets(doc, load) : NO_EXPORT_ASSETS;
      // ★ The fallback file is the PLAIN document. A downloaded file that
      // opens the print dialog by itself when double-clicked is hostile; the
      // user prints it when they decide to.
      triggerDownload(
        documentFilename(doc, "html", today),
        new Blob([renderDocumentHtml(doc, ws, lang, "standalone", assets)], { type: HTML_MIME }),
      );
      return;
    }
    tab.document.open();
    tab.document.write(PREPARING_HTML);
    const assets = load ? await loadExportAssets(doc, load) : NO_EXPORT_ASSETS;
    const html = renderDocumentHtml(doc, ws, lang, "standalone", assets);
    // ★★ A SECOND open() RESETS the document. Without it the real document is
    // APPENDED to the placeholder, so the tab prints a file with two <title>
    // elements and a stray doctype in the middle of the body.
    tab.document.open();
    tab.document.write(withAutoPrint(html));
    tab.document.close();
    return;
  }

  const assets = load ? await loadExportAssets(doc, load) : NO_EXPORT_ASSETS;
  const blob =
    format === "html"
      ? new Blob([renderDocumentHtml(doc, ws, lang, "standalone", assets)], { type: HTML_MIME })
      : format === "docx"
        ? renderDocumentDocx(doc, ws, lang, assets)
        : renderDocumentPptx(doc, ws, lang, assets);

  triggerDownload(documentFilename(doc, format, today), blob);
}
