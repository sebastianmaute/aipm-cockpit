// Shared browser-download + print-template primitives.
//
// Promoted out of `export.ts` so every caller that hands the user a file
// shares ONE blob-URL lifecycle and ONE print stylesheet, instead of two
// copies that drift apart.
//
// ★★ THIS MODULE IS DOM-BOUND, and since §141(b) it is DOMPurify-bound too.
// `sanitizeRichHtml` binds `window` at module eval, so importing it here means
// `download.ts` can no longer be evaluated under bare node. That was already
// true of every consumer — `export.ts`, `doc-render-html.ts` and
// `document-download.ts` all reach a DOMPurify sanitizer or DOMParser through
// their own imports — so this adds no new constraint. It DOES add one for a
// future consumer: nothing in `scripts/` may import this module. Contrast
// `rich-text-plain.ts`, which is DOM-FREE BY CONTRACT because the entity
// sanitizers run under bare node in the sample generator.

import { type ExportCell, isRichCell } from "./export-sections";
import { sanitizeRichHtml } from "./sanitize-html";
import { descriptionHtml } from "./rich-text-plain";
import { RENDER_SINK } from "./html-start";

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

/** One export cell as table-cell HTML — the ONE place HTML/PDF decides between
 *  markup and escaped text (§141(b)).
 *
 *  ★★ The rich branch is the ONE unescaped path here, and it re-sanitizes at
 *  the SINK — idempotent, and the same defense-in-depth `RichTextView` and the
 *  comm-send preview already apply. A stored value is sanitizer-clean in
 *  principle; "in principle" is not what a sink relies on. The six write paths
 *  that produce these fields are not all allow-listed (the codec load paths are
 *  DOM-free and cannot be — §28), so a hostile value CAN reach storage.
 *
 *  ★★★ `descriptionHtml` FIRST, then `sanitizeRichHtml`. A legacy plain-text
 *  value is not markup, and handing it to the sanitizer raw drops its line
 *  breaks (§118) — DOMPurify has no reason to invent a <br> for a bare "\n".
 *  `descriptionHtml` upgrades it into <p>/<br> instead, both of which
 *  `sanitizeRichHtml` keeps, so the re-sanitize stays a real guard rather than
 *  a no-op. Swapping the two silently flattens every legacy value in the app.
 *
 *  ★★★ The sink is RENDER, not "rich". A DERIVED sink's classifier is built
 *  from the tag list its sanitizer allows, and the rule is never to recognise
 *  LESS than the sink KEEPS: `sanitizeRichHtml` runs at DOMPurify's default
 *  KEEP_CONTENT, so it UNWRAPS an unlisted tag and keeps its words — the HTML
 *  sink therefore keeps every tag's TEXT, and a narrower classifier would
 *  escape the whole value permanently. Same composition as the DOCX/PPTX
 *  renderers and `renderBlock`'s paragraph case; see html-start.ts.
 *
 *  ★ The NON-rich branch is unchanged and still escapes: `htmlCellWithBreaks`
 *  is typed `string | number`, so `isRichCell` is what makes this call sound. */
export function exportCellHtml(cell: ExportCell): string {
  return isRichCell(cell)
    ? sanitizeRichHtml(descriptionHtml(cell.html, RENDER_SINK))
    : htmlCellWithBreaks(cell);
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
    /* Rich entity fields render as MARKUP in a table cell since §141(b), so a
       cell can now hold headings, lists, quotes and alignment. Every rule here
       is scoped to a DESCENDANT of a td and therefore matches nothing in a
       column that is not rich — those cells are bare text nodes.
       ★★ These are NOT cosmetic. A plain legacy value is upgraded to <p>text</p>
       on its way through descriptionHtml, and the UA default margin on p is 1em
       top AND bottom — without the "td p" rule a plain export's rows grow ~2 lines
       each. The rules keep a plain export looking as it did, they do not restyle it.
       ★ h1-h4 are flattened to the cell's own size: a 22pt h1 inside a 9pt table
       row is what "blows the row apart" means, and heading LEVEL still reads from
       the weight plus the outline the DOCX/PPTX paths carry.
       ★ No colour, no shadow, no gradient — the palette stays the header/footer
       block above. The palette-sweep test does NOT scan this string. */
    td h1, td h2, td h3, td h4 { font-size: 1em; font-weight: 600; margin: 0 0 2pt; }
    td p { margin: 0 0 2pt; }
    td p:last-child { margin-bottom: 0; }
    td ul, td ol { margin: 0 0 2pt; padding-left: 14pt; }
    td li { margin: 0; }
    td blockquote { margin: 0 0 2pt 8pt; font-style: italic; }
    td pre { margin: 0; font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
    td hr { margin: 2pt 0; border: 0; border-top: 1px solid #E3E6E6; }
    td [data-align="left"] { text-align: left; }
    td [data-align="center"] { text-align: center; }
    td [data-align="right"] { text-align: right; }
    td [data-align="justify"] { text-align: justify; }
    /* Task markers. Mirrors DOCUMENT_PAGE_STYLES in doc-render-html.ts — the
       attributes survive sanitizeRichHtml (GUARDED_DATA_ATTR), so without these
       a checklist would print as an ordinary bullet list and LOSE the ticks. */
    td ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    td li[data-type="taskItem"] { display: flex; gap: 4pt; }
    td li[data-type="taskItem"]::before { content: "\\2610"; }
    td li[data-type="taskItem"][data-checked="true"]::before { content: "\\2611"; }
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
