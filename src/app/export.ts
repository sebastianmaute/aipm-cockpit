// Public export API.
//
// We support six formats:
//   • csv  — reuses the CSV serializer that already ships with the storage
//            layer, so the file you get out of "Export" is byte-identical
//            to what the Local CSV backend writes.
//   • md   — same idea, reuses `tasksToMarkdown`.
//   • pdf  — opens a new browser tab with a print-styled HTML view of the
//            tasks and immediately invokes window.print(). The user picks
//            "Save as PDF" from the browser's print dialog. We don't
//            generate a binary PDF — no Adobe / pdf-lib dependency.
//   • docx — Office Open XML word-processing document; tasks rendered as a
//            single big table with the brand palette applied.
//   • xlsx — Office Open XML spreadsheet; tasks as a frozen-header,
//            auto-filtered, alternating-row table.
//   • pptx — Office Open XML presentation; one title slide + one slide per
//            task (capped at 100 to keep the file small).
//
// All formats download via a hidden <a download> click and clean up the
// blob URL on next tick.

import { type Workspace, workspaceToCsv, workspaceToMarkdown } from "./storage";
import type { ExportConfig } from "./settings-types";
import { defaultExportConfig } from "./settings-types";
import { DEFAULT_EXPORT_FOOTER } from "./export-footer";
import { buildExportSections } from "./export-sections";
import { triggerDownload, PRINT_STYLES, htmlEscape, exportCellHtml } from "./download";
import type { ExportSection } from "./export-sections";
import type { Lang } from "./i18n";
import { nonceOpenTag, pdfReadyTitleMarkup, pdfWindowName, withScriptNonce } from "./pdf-export-protocol";
import { readCspNonce } from "./csp-nonce";
import { filenameStem } from "./filename-stem";

export type ExportFormat = "csv" | "md" | "pdf" | "docx" | "xlsx" | "pptx";

const EXT: Record<ExportFormat, string> = {
  csv: "csv",
  md: "md",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

const MIME: Record<Exclude<ExportFormat, "pdf">, string> = {
  csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** The downloaded file's name. `today` is passed in so the function is pure.
 *
 *  ★ §468 packaged-app check — a whole-project export (the File/top-bar export,
 *  whose workspace carries `project`) is named after the project, slugged by
 *  the same `filenameStem` rule a document's filename uses: the old fixed
 *  `aipm-cockpit-tasks-<date>` named a whole-project PDF after just one of its
 *  sections. An export without a project name (the Open Points export
 *  menu passes no `project`) keeps that old name unchanged. All six formats
 *  share this, so one export's PDF and DOCX never disagree about their name. */
export function exportFilename(format: ExportFormat, today: string, projectName?: string): string {
  // A name that slugs to nothing ("???") keeps the tasks name rather than
  // producing "aipm-cockpit-project--<date>" or "…-project-project-…".
  const stem = filenameStem(projectName ?? "", "");
  return stem === ""
    ? `aipm-cockpit-tasks-${today}.${EXT[format]}`
    : `aipm-cockpit-project-${stem}-${today}.${EXT[format]}`;
}

function defaultFilename(format: ExportFormat, ws: Workspace): string {
  return exportFilename(format, new Date().toISOString().slice(0, 10), ws.project?.name);
}

/** The browser-tab auto-print harness, byte-identical to what `buildPdfHtml`
 *  used to inline directly. Extracted so `exportPdf` can swap it out for no
 *  script at all in the desktop shell (§468), where a renderer-initiated
 *  `window.print()` is refused — see `pdf-export-protocol.ts`. */
const EXPORT_AUTO_PRINT_SCRIPT = `  <script>
    // Wait one paint so the browser has rendered the table before
    // opening the print dialog; otherwise some browsers print blank.
    window.addEventListener("load", () => {
      setTimeout(() => {
        // Best-effort: focus + print can throw if the popup was blocked or
        // closed before this fires. Nothing to recover — the user can print
        // manually — so the failure is intentionally swallowed.
        try { window.focus(); window.print(); } catch (e) {}
      }, 80);
    });
  </script>`;

// --- PDF via browser print -----------------------------------------------

/** Render one ExportSection as an HTML heading + table block.
 *
 *  ★★ Cells go through `exportCellHtml`, which is the ONLY thing deciding
 *  markup-vs-escaped-text. A rich column (§141(b)) emits sanitized markup so a
 *  heading, list or alignment survives into the printed PDF; every other column
 *  is escaped exactly as before. Do not reach past it to `htmlCellWithBreaks` —
 *  that is the flat path, and calling it on a RichCell emits "[object Object]".
 *  The `td`-scoped rules in PRINT_STYLES are what keep the markup inside a row. */
function renderSectionHtml(section: ExportSection): string {
  const headerCells = section.columns
    .map((col) => `<th>${htmlEscape(col)}</th>`)
    .join("");
  const bodyRows = section.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${exportCellHtml(cell)}</td>`).join("")}</tr>`
    )
    .join("\n      ");
  return `
  <h2 style="margin-top:16pt;margin-bottom:6pt;color:#004159;font-size:16pt;font-weight:600">${htmlEscape(section.title)}</h2>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>`;
}

/**
 * Pure helper: build the full print-HTML string for a workspace.
 * Exported so it can be unit-tested without touching window.print().
 *
 * Sections are controlled by `cfg` (same ExportConfig used for CSV/DOCX).
 * Each enabled, non-empty section becomes an <h2> + <table> block.
 */
export function buildPdfHtml(
  ws: Workspace,
  cfg: ExportConfig,
  lang: Lang,
  footer: string = DEFAULT_EXPORT_FOOTER,
  /** The `<script>` block preceding `</body>` — the auto-print harness in a
   *  browser, or empty in the desktop shell (§468 review round 2: the
   *  readiness signal there is `titleTag`, a static `<title>`, not a script —
   *  see `pdf-export-protocol.ts`'s `pdfReadyTitleMarkup`). Defaults to the
   *  auto-print harness so every pre-existing caller (tests included) keeps
   *  today's byte-identical output without being touched. */
  closingScript: string = EXPORT_AUTO_PRINT_SCRIPT,
  /** Overrides the whole `<title>` element. `document.title` resolves to the
   *  FIRST `<title>` in tree order, so the desktop shell's readiness signal
   *  must REPLACE this rather than appending a second one after it — see
   *  `pdfReadyTitleMarkup`'s doc comment. Undefined (every pre-existing
   *  caller) keeps the normal computed title, byte-identical to before this
   *  parameter existed. */
  titleTag?: string,
  /** The page's CSP nonce, put on the `<style>` element here at the source
   *  (§468 packaged-app check — see `nonceOpenTag`). Undefined (every
   *  pre-existing caller) keeps the bare `<style>`, byte-identical. */
  styleNonce?: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const sections = buildExportSections(ws, cfg, lang);
  const sectionsHtml = sections.length === 0
    ? `<p style="color:#939598;font-style:italic">No sections to export.</p>`
    : sections.map(renderSectionHtml).join("\n");
  const title = titleTag ?? `<title>AI PM Cockpit — ${htmlEscape(today)}</title>`;

  // ★★ lang comes from the ARGUMENT, never a hardcoded "en". Every member of
  // Lang ("en-US" | "en-GB" | "de") is already a valid BCP-47 tag. A German
  // document declaring lang="en" is a WCAG 3.1.1 (Language of Page) failure and
  // makes a screen reader read it with an English voice; it also mislabels the
  // language metadata of the printed PDF. Same rule, same wording, as
  // `renderDocumentHtml` in doc-render-html.ts — keep the two paths in step.
  return `<!DOCTYPE html>
<html lang="${htmlEscape(lang)}">
<head>
  <meta charset="utf-8"/>
  ${title}
  ${nonceOpenTag("style", styleNonce)}${PRINT_STYLES}
  </style>
</head>
<body>
  <header>
    <h1>AI PM Cockpit</h1>
    <div class="subtitle">Exported ${htmlEscape(today)}</div>
  </header>
  ${sectionsHtml}
  <footer>${htmlEscape(footer)}</footer>
${closingScript}
</body>
</html>`;
}

/**
 * Build a print-friendly HTML document and open it in a new tab, then
 * trigger window.print() once it's loaded. We use the brand palette
 * so the resulting PDF is on-brand even if the user saves at default
 * print settings.
 *
 * Why a new tab vs. an iframe?  Browsers (esp. Chrome / Edge) handle the
 * print dialog more reliably when invoked on a top-level window than on a
 * same-origin frame, and the tab gives the user a fallback (Ctrl+P) if
 * the auto-print didn't fire.
 */
function exportPdf(ws: Workspace, cfg: ExportConfig, lang: Lang, footer: string): void {
  if (typeof window === "undefined") return;

  // ★ §468 — in the desktop shell, Electron refuses the renderer's own
  // `window.print()` (see pdf-export-protocol.ts and desktop/src/lib/
  // pdf-export.ts). There the tab opens under a NAMED frame, carries NO
  // script at all — an inline one would be blocked by the packaged app's
  // nonce-only CSP anyway — and instead signals "rendered" via a static
  // `<title>` element (`pdfReadyTitleMarkup`, replacing rather than
  // appending after the normal title). main.ts watches the named frame,
  // prints it to a real PDF and shows a save dialog. In a browser, name is
  // `_blank` and the script is the auto-print harness, identical to before
  // this fix except for the page's CSP nonce on its opening tag (below).
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const name = pdfWindowName(ua);
  const isDesktop = name !== "_blank";
  const script = isDesktop ? "" : EXPORT_AUTO_PRINT_SCRIPT;
  const titleTag = isDesktop ? pdfReadyTitleMarkup(defaultFilename("pdf", ws)) : undefined;
  // ★★★ §468 packaged-app check — the tab inherits this page's nonce-only
  // production CSP, so its <style> and auto-print <script> carry the page's
  // nonce or neither applies (see `nonceOpenTag`). Only the tab gets it: the
  // popup-blocked fallback below is a FILE, and the live nonce has no business
  // on disk, so that one is built without it (byte-identical to before).
  const nonce = readCspNonce();
  const html = buildPdfHtml(ws, cfg, lang, footer, withScriptNonce(script, nonce), titleTag, nonce);

  // Open a new tab and write the HTML into it. Pop-up blockers may stop
  // this — in which case we fall back to a Blob download of the HTML so
  // the user can at least open it manually and print from there.
  const w = window.open("", name);
  if (!w) {
    const fallbackHtml = buildPdfHtml(ws, cfg, lang, footer, script, titleTag);
    const blob = new Blob([fallbackHtml], { type: "text/html;charset=utf-8" });
    triggerDownload(defaultFilename("pdf", ws).replace(/\.pdf$/, ".html"), blob);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// --- Public entry point --------------------------------------------------

/**
 * Export the workspace in the requested format.
 *
 * For all formats except `"pdf"`, this triggers a browser download via a
 * hidden anchor. For `"pdf"`, this opens a print-styled HTML in a new tab
 * and immediately invokes `window.print()` — the user finalizes the export
 * by choosing "Save as PDF" in the browser's native print dialog.
 *
 * Which sections appear is controlled by `exportConfig` (defaults to
 * `defaultExportConfig` which enables tasks + RAID). Sections that are
 * enabled in the config but whose workspace array is empty are omitted.
 *
 * For DOCX/XLSX/PPTX the section list is computed once via
 * `buildExportSections` and passed to all three builders so there is no
 * duplication of the projection logic.
 */
export async function exportWorkspace(
  ws: Workspace,
  format: ExportFormat,
  exportConfig?: ExportConfig,
  lang: Lang = "en-US",
  /** Footer line of the PDF/print export (`exportFooterText(settings.branding)`). */
  footer: string = DEFAULT_EXPORT_FOOTER,
): Promise<void> {
  const cfg = exportConfig ?? defaultExportConfig;
  if (format === "pdf") {
    exportPdf(ws, cfg, lang, footer);
    return;
  }

  let blob: Blob;
  if (format === "csv") {
    blob = new Blob([workspaceToCsv(ws, cfg)], { type: MIME.csv });
  } else if (format === "md") {
    blob = new Blob([workspaceToMarkdown(ws, cfg)], { type: MIME.md });
  } else {
    // OOXML builders live in a separate module. Loaded on demand so it stays
    // out of the initial bundle. The dynamic import is cached after the first
    // call, so repeat clicks have no re-fetch cost.
    //
    // Sections are computed once here and shared across all three builders.
    const { buildDocx, buildPptx, buildXlsx } = await import("./export-ooxml");
    const sections = buildExportSections(ws, cfg, lang);
    if (format === "docx") {
      blob = buildDocx(sections);
    } else if (format === "xlsx") {
      blob = buildXlsx(sections);
    } else {
      blob = buildPptx(sections, lang, footer);
    }
  }
  triggerDownload(defaultFilename(format, ws), blob);
}
