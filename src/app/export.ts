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
import type { RaidItem, Task } from "./types";
import type { ExportConfig } from "./settings-types";
import { defaultExportConfig } from "./settings-types";

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
  return `lop-tasks-${today}.${EXT[format]}`;
}

/**
 * Programmatic download. Creates a hidden anchor with `download` attr,
 * clicks it, then revokes the blob URL on the next tick so the browser has
 * already kicked off the file save.
 */
function triggerDownload(filename: string, blob: Blob): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

// --- PDF via browser print -----------------------------------------------

/** XML/HTML-escape for inline use in the print template. */
function htmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
function exportPdf(tasks: Task[], raid: readonly RaidItem[] = []): void {
  if (typeof window === "undefined") return;

  const today = new Date().toISOString().slice(0, 10);
  const total = tasks.length;
  const raidTotal = raid.length;

  const rows = tasks
    .map((t) => {
      const status = t.completedDate
        ? `<span style="color:#84BD00">✓ ${htmlEscape(t.completedDate)}</span>`
        : "Open";
      const labels = (t.labels ?? []).join(", ");
      return `<tr>
        <td class="mono">${htmlEscape(t.id)}</td>
        <td>${htmlEscape(t.taskName)}</td>
        <td>${htmlEscape(t.assignee)}</td>
        <td>${htmlEscape(t.dueDate)}</td>
        <td>${status}</td>
        <td>${htmlEscape(t.priority)}</td>
        <td>${htmlEscape(t.group ?? "")}</td>
        <td>${htmlEscape(labels)}</td>
        <td>${htmlEscape(t.blockers ?? "")}</td>
        <td>${htmlEscape(t.notes ?? "")}</td>
      </tr>`;
    })
    .join("");

  // RAID section — only emitted when there's content, so the PDF stays a
  // single-section "tasks list" for users who don't use the RAID log.
  const CATEGORY_LABEL: Record<string, string> = {
    R: "Risk",
    A: "Assumption",
    I: "Issue",
    D: "Dependency",
  };
  const raidRowsHtml = raid
    .map((r) => {
      let severity = htmlEscape(r.severity ?? "");
      if (r.category === "R" && r.probability && r.impact) {
        severity = `${severity} (${r.probability}×${r.impact})`;
      }
      const linked = r.linkedTaskIds.map((id) => `#${id}`).join(", ");
      const causedBy = r.causedByRaidIds.map((id) => `#${id}`).join(", ");
      return `<tr>
        <td class="mono">${htmlEscape(r.id)}</td>
        <td>${htmlEscape(CATEGORY_LABEL[r.category] ?? r.category)}</td>
        <td>${htmlEscape(r.title)}</td>
        <td>${severity}</td>
        <td>${htmlEscape(r.status)}</td>
        <td>${htmlEscape(r.owner ?? "")}</td>
        <td>${htmlEscape(r.targetDate ?? "")}</td>
        <td>${htmlEscape(linked)}</td>
        <td class="mono">${htmlEscape(causedBy)}</td>
        <td>${htmlEscape(r.mitigation ?? r.description ?? "")}</td>
      </tr>`;
    })
    .join("");

  const raidSection =
    raidTotal === 0
      ? ""
      : `
  <h2 style="margin-top:16pt;margin-bottom:6pt;color:#004159;font-size:16pt;font-weight:600">RAID Log</h2>
  <div class="subtitle" style="margin-bottom:8pt">${raidTotal} item${raidTotal === 1 ? "" : "s"} · Risks, Assumptions, Issues, Dependencies</div>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Cat</th>
        <th>Title</th>
        <th>Severity</th>
        <th>Status</th>
        <th>Owner</th>
        <th>Target</th>
        <th>Linked</th>
        <th>Caused by</th>
        <th>Mitigation / Notes</th>
      </tr>
    </thead>
    <tbody>
      ${raidRowsHtml}
    </tbody>
  </table>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>List of Open Points — ${htmlEscape(today)}</title>
  <style>
    /* Print-tuned styles — Acme palette. */
    @page { size: A4 landscape; margin: 10mm 8mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Titillium Web", -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      color: #1a1a1a;
      margin: 0;
    }
    header {
      border-bottom: 4px solid #004159;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    h1 { margin: 0; color: #004159; font-size: 22pt; font-weight: 600; }
    .subtitle { color: #939598; font-size: 10pt; font-style: italic; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    thead th {
      background: #004159; color: #ffffff;
      padding: 6px 6px; text-align: left;
      font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.02em;
    }
    tbody td { padding: 5px 6px; vertical-align: top; border-bottom: 1px solid #E3E6E6; }
    tbody tr:nth-child(even) td { background: #fbfbfb; }
    td.mono { font-family: ui-monospace, Menlo, Consolas, monospace; color: #636362; }
    footer {
      margin-top: 18px;
      color: #939598;
      font-size: 9pt;
      font-style: italic;
      border-top: 1px solid #E3E6E6;
      padding-top: 6px;
    }
    @media print {
      thead { display: table-header-group; } /* repeat header on each page */
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>List of Open Points</h1>
    <div class="subtitle">${total} task${total === 1 ? "" : "s"} · Exported ${htmlEscape(today)}</div>
  </header>
  ${total === 0 ? `<p style="color:#939598;font-style:italic">No tasks to export.</p>` : `
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Task</th>
        <th>Assignee</th>
        <th>Due</th>
        <th>Status</th>
        <th>Priority</th>
        <th>Group</th>
        <th>Labels</th>
        <th>Blockers</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`}
  ${raidSection}
  <footer>Acme — List of Open Points Tracker</footer>
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
 * Export the workspace (tasks + RAID items) in the requested format.
 *
 * For all formats except `"pdf"`, this triggers a browser download via a
 * hidden anchor. For `"pdf"`, this opens a print-styled HTML in a new tab
 * and immediately invokes `window.print()` — the user finalizes the export
 * by choosing "Save as PDF" in the browser's native print dialog.
 *
 * Empty workspaces are still exportable; you get a file with just the
 * header row (CSV/XLSX), an empty table (DOCX), the title slide (PPTX), or
 * a "No tasks to export." page (PDF/MD).
 *
 * RAID items appear as:
 *   • CSV/MD — a second `# RAID` / `# RAID Log` section in the same file
 *     (round-trips through the storage layer).
 *   • PDF — a "RAID Log" table after the tasks table.
 *   • DOCX — a "RAID Log" heading + table after the tasks table.
 *   • XLSX — a second worksheet named "RAID Log".
 *   • PPTX — a section-divider slide + one slide per item (capped at 50).
 *
 * When the workspace has no RAID items, the output is byte-equivalent to
 * the pre-RAID tasks-only export.
 */
export async function exportWorkspace(
  ws: Workspace,
  format: ExportFormat,
  exportConfig?: ExportConfig,
): Promise<void> {
  const cfg = exportConfig ?? defaultExportConfig;
  if (format === "pdf") {
    exportPdf(ws.tasks, ws.raid);
    return;
  }

  let blob: Blob;
  if (format === "csv") {
    blob = new Blob([workspaceToCsv(ws, cfg)], { type: MIME.csv });
  } else if (format === "md") {
    blob = new Blob([workspaceToMarkdown(ws, cfg)], { type: MIME.md });
  } else {
    // OOXML builders live in a separate ~45 KB module. Loaded on demand so it
    // stays out of the initial bundle and the live heap until the user
    // actually picks docx/xlsx/pptx. The dynamic import is cached after the
    // first call, so repeat clicks have no re-fetch cost.
    const { buildDocx, buildPptx, buildXlsx } = await import("./export-ooxml");
    if (format === "docx") {
      blob = buildDocx(ws.tasks, ws.raid);
    } else if (format === "xlsx") {
      blob = buildXlsx(ws.tasks, ws.raid);
    } else {
      blob = buildPptx(ws.tasks, ws.raid);
    }
  }
  triggerDownload(defaultFilename(format), blob);
}
