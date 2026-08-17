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
//            single big table with the Acme palette applied.
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
import { buildExportSections } from "./export-sections";
import { triggerDownload, PRINT_STYLES, htmlEscape, exportCellHtml } from "./download";
import type { ExportSection } from "./export-sections";
import type { Lang } from "./i18n";

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

function defaultFilename(format: ExportFormat): string {
  const today = new Date().toISOString().slice(0, 10);
  return `aipm-cockpit-tasks-${today}.${EXT[format]}`;
}

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
export function buildPdfHtml(ws: Workspace, cfg: ExportConfig, lang: Lang): string {
  const today = new Date().toISOString().slice(0, 10);
  const sections = buildExportSections(ws, cfg, lang);
  const sectionsHtml = sections.length === 0
    ? `<p style="color:#939598;font-style:italic">No sections to export.</p>`
    : sections.map(renderSectionHtml).join("\n");

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
  <title>AI PM Cockpit — ${htmlEscape(today)}</title>
  <style>${PRINT_STYLES}
  </style>
</head>
<body>
  <header>
    <h1>AI PM Cockpit</h1>
    <div class="subtitle">Exported ${htmlEscape(today)}</div>
  </header>
  ${sectionsHtml}
  <footer>Acme — AI PM Cockpit</footer>
  <script>
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
  </script>
</body>
</html>`;
}

/**
 * Build a print-friendly HTML document and open it in a new tab, then
 * trigger window.print() once it's loaded. We use the Acme palette
 * so the resulting PDF is on-brand even if the user saves at default
 * print settings.
 *
 * Why a new tab vs. an iframe?  Browsers (esp. Chrome / Edge) handle the
 * print dialog more reliably when invoked on a top-level window than on a
 * same-origin frame, and the tab gives the user a fallback (Ctrl+P) if
 * the auto-print didn't fire.
 */
function exportPdf(ws: Workspace, cfg: ExportConfig, lang: Lang): void {
  if (typeof window === "undefined") return;

  const html = buildPdfHtml(ws, cfg, lang);

  // Open a new tab and write the HTML into it. Pop-up blockers may stop
  // this — in which case we fall back to a Blob download of the HTML so
  // the user can at least open it manually and print from there.
  const w = window.open("", "_blank");
  if (!w) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    triggerDownload(defaultFilename("pdf").replace(/\.pdf$/, ".html"), blob);
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
): Promise<void> {
  const cfg = exportConfig ?? defaultExportConfig;
  if (format === "pdf") {
    exportPdf(ws, cfg, lang);
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
      blob = buildPptx(sections, lang);
    }
  }
  triggerDownload(defaultFilename(format), blob);
}
