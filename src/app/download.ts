// Shared browser-download + print-template primitives.
//
// Promoted out of `export.ts` so every caller that hands the user a file
// shares ONE blob-URL lifecycle and ONE print stylesheet, instead of two
// copies that drift apart.

/**
 * Programmatic download. Creates a hidden anchor with `download` attr,
 * clicks it, then revokes the blob URL on the next tick so the browser has
 * already kicked off the file save.
 */
export function triggerDownload(filename: string, blob: Blob): void {
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

/** XML/HTML-escape for inline use in the print template. */
export function htmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape FIRST, then map the export projection's newlines to <br>.
 *
 *  ★★ Both orderings are wrong in a different direction. Substituting first
 *  means htmlEscape then turns the <br> we inserted into a visible "&lt;br&gt;";
 *  skipping the escape to avoid that would let a literal "<br>" in user content
 *  through unescaped. Escape, then substitute — nothing else.
 *
 *  ★★★ `string | number`, NOT `unknown`. This is the ONE consumer of an export
 *  cell that tsc would not name when the cell type widened — `unknown` accepts
 *  a RichCell silently and emits "[object Object]" into an HTML table. The
 *  narrow signature is what makes the widening safe; do not loosen it.
 *
 *  ★ `htmlEscape` below is still `unknown`-typed and is a second hole of the
 *  same shape, but not on this path: every export-cell call site goes through
 *  THIS function, and `htmlEscape`'s own callers pass titles, column names and
 *  lang codes — all `string` by construction. */
export function htmlCellWithBreaks(cell: string | number): string {
  return htmlEscape(cell).replace(/\n/g, "<br>");
}

export const PRINT_STYLES = `
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
    table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 12pt; }
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
    }`;
