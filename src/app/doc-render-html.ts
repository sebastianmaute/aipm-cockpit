// src/app/doc-render-html.ts — blocks → HTML. The CANONICAL renderer: it backs
// the in-app preview, the .html download and the print-PDF path.
//
// ★★ This module is deliberately DOM-BOUND — the exact opposite of
// document-model.ts, which is DOM-FREE by contract. The sanitizer below binds
// `window`, so this file must never be pulled into
// scripts/generate-sample-workspace.ts's import graph. Keep it a render sink.
//
// ★★★ THE PARAGRAPH SINK RE-SANITIZES, AND IT IS THE LAYER THAT ACTUALLY HOLDS.
// Deliberately stated as a ROLE, not as a list of which backends are currently
// unprotected: that list has already been wrong once (it named Turso, which has
// always sanitized — see `turso-schema.ts`), and it changes whenever a decoder
// is fixed, so any enumeration here rots into a false claim.
//
// The rule that does not rot: load-boundary sanitizing is defence in DEPTH, and
// this sink is the load-bearing layer. `paragraph.html` reaches
// `dangerouslySetInnerHTML`, and the value may come from ANY backend, an
// import, a second tab, or a model — so this call must never be removed on the
// grounds that "the decoders already sanitize". Sanitizing is idempotent, so
// the redundancy costs nothing; assuming it is redundant costs stored XSS the
// moment one path stops sanitizing or a new one arrives without it.
//
// ★ If you are here to ADD sanitizing to a decoder that lacks it: do it, and do
// not weaken this sink in exchange. Compose it at the caller as
// `sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)`.
//
// ★★★ sanitizeDocumentHtml, and the reason USED to be a KEEP_CONTENT difference
// against `sanitizeNoteHtml` — an 8-tag sanitizer at KEEP_CONTENT:false that
// deleted the words along with an unlisted tag. It is retired; both remaining
// sanitizers keep DOMPurify's default and unwrap, so a `<div>`/`<table>` a model
// emits loses its markup and keeps its prose either way. What still argues for
// this one specifically is `img` (plus `data-asset-id` and the ALLOW_DATA_ATTR:
// false / ADD_URI_SAFE_ATTR pair it forces) — the one thing on
// DOCUMENT_ALLOWED_TAGS that is not on RICH_ALLOWED_TAGS. Do NOT "simplify" this
// to sanitizeRichHtml: `img` is a void element, so it does not unwrap to text — it
// vanishes outright, and a later slice's image markup would be silently dropped at
// this boundary. (It lives in ./sanitize-html — NOT ./note-log.)
//
// ★★ Nor the retired sanitizeTemplateHtml, which this sink used until the
// documents list existed: that one was SHARED with comm templates, meeting reports
// and the six rich entity fields, so a document's marks could only be admitted by
// widening what every one of those consumers may store. That widening has since
// happened deliberately — DOCUMENT_ALLOWED_TAGS now SPREADS RICH_ALLOWED_TAGS, so
// the two lists differ by `img` alone and cannot disagree about a heading or a
// blockquote again. The separate sanitizer is kept for the `img` reason above —
// route a NEW documents sink here, and never widen RICH_ALLOWED_TAGS to admit
// something only documents need (that array reaches every other rich surface,
// including how already-stored HTML renders).
//
// ★★ dataSection resolution is IMPORTED from ./doc-data-section, not written
// here and not taken from ./doc-render-docx. This module backs the in-app
// preview panel and the print path, so pulling the resolver out of the DOCX
// renderer would drag the OOXML builders and the ZIP writer into a graph that
// loads before anyone has clicked Download. doc-data-section imports only
// export-sections, settings-types, workspace and i18n.

import type { DocBlock, ProjectDocument } from "./document-model";
import { resolveDataSection } from "./doc-data-section";
import { sanitizeDocumentHtml } from "./sanitize-html";
import { descriptionHtml } from "./rich-text-plain";
import { RENDER_SINK } from "./html-start";
import { htmlEscape, exportCellHtml, PRINT_STYLES } from "./download";
import type { ExportCell } from "./export-sections";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocHtmlMode = "preview" | "standalone";

/** Standalone-only page styles, emitted AFTER PRINT_STYLES.
 *
 *  ★★★ THE ORDER IS LOAD-BEARING. `@page` declarations cascade like any others,
 *  so for the same page context the LAST `size` wins. PRINT_STYLES is SHARED
 *  with export.ts's workspace export, which legitimately wants A4 **landscape**
 *  for its wide tables; a prose document wants portrait, so it is overridden
 *  here rather than by editing the shared constant (which would silently
 *  re-orient every workspace export). Interpolate this BEFORE PRINT_STYLES and
 *  the document quietly prints landscape again — no test of mere string
 *  presence would notice, which is why the suite asserts relative POSITION.
 *
 *  ★ Margins widen from the export's 10mm/8mm: prose set to the full A4 width
 *  reads badly. No colours here — the palette stays entirely PRINT_STYLES'. */
const DOCUMENT_PAGE_STYLES = `
    @page { size: A4 portrait; margin: 18mm 16mm; }
    .page-break { break-after: page; page-break-after: always; height: 0; }
    [data-align="left"] { text-align: left; }
    [data-align="center"] { text-align: center; }
    [data-align="right"] { text-align: right; }
    [data-align="justify"] { text-align: justify; }
    ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    li[data-type="taskItem"] { display: flex; gap: 0.5rem; }
    li[data-type="taskItem"]::before { content: "\\2610"; }
    li[data-type="taskItem"][data-checked="true"]::before { content: "\\2611"; }`;

/** ONE table renderer for both the `table` block and a resolved dataSection.
 *
 *  ★ Kept shared rather than written twice: two near-identical thead/tbody
 *  builders in one file is exactly the shape the BLOCKING jscpd duplication
 *  gate flags, and it is also how the two drift apart on a later escaping fix.
 *
 *  ★★ Every cell goes through `exportCellHtml`, which for a NON-rich cell is
 *  htmlCellWithBreaks — escape FIRST, then map "\n" to <br>. Do not reorder:
 *  substituting first turns our own <br> into a visible "&lt;br&gt;", and
 *  dropping the escape to avoid that lets a literal "<br>" in user content
 *  through as real markup.
 *
 *  ★★ THE TWO CALLERS DIFFER IN CELL TYPE, which is why `rows` is `ExportCell`
 *  and not the `string | number` it was. A `table` BLOCK comes from the document
 *  model and can only ever hold `string | number`; a `dataSection` is resolved
 *  through the real `buildExportSections`, so since §141(b) its rich columns
 *  arrive as `RichCell` and must render as markup — a document embedding the
 *  RAID register gets the same fidelity as the register's own export. The
 *  widening is safe in the other direction because `string | number` is a
 *  member of `ExportCell`, so the block path is byte-identical. */
function tableHtml(
  columns: readonly string[],
  rows: readonly (readonly ExportCell[])[],
  caption?: string,
): string {
  const cap = caption ? `<caption>${htmlEscape(caption)}</caption>` : "";
  const head = columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${exportCellHtml(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>${cap}<thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

function renderBlock(block: DocBlock, ws: Workspace, lang: Lang): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${htmlEscape(block.text)}</h${block.level}>`;

    // ★★ ONE OF TWO UNESCAPED PATHS IN THIS FILE, not the only one — this line
    // said "The ONE unescaped path" and `document-preview.tsx` leans on that
    // sentence to justify running no second pass of its own. The other is
    // `tableHtml` → `exportCellHtml`, whose RICH branch emits markup too. It is
    // guarded, by a DIFFERENT sanitizer in a DIFFERENT file: `sanitizeRichHtml`
    // in `download.ts`, not `sanitizeDocumentHtml` here. So there is no hole —
    // but a reader auditing "is every unescaped sink sanitized?" from the old
    // wording would stop one sink short. Both must stay sanitized.
    //
    // Already-sanitized HTML, re-sanitized here.
    // ★★ Upgraded FIRST. A legacy plain-text value is not markup, and handing
    // it to the sanitizer raw dropped its line breaks (§118); descriptionHtml
    // escapes it into <p>/<br> instead — both of which sanitizeDocumentHtml
    // keeps, so the re-sanitize stays a real guard rather than a no-op.
    // ★★★ The sink is "render", NOT "document": sanitizeDocumentHtml runs at
    // DOMPurify's KEEP_CONTENT default, so it UNWRAPS an unlisted tag and keeps
    // its words — a classifier derived from its allow-list is therefore
    // narrower than the sink and escapes the whole value instead. Same
    // composition as the DOCX/PPTX renderers; see html-start.ts.
    case "paragraph":
      return sanitizeDocumentHtml(descriptionHtml(block.html, RENDER_SINK));

    case "bullets": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((i) => `<li>${htmlEscape(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }

    case "table":
      return tableHtml(block.columns, block.rows, block.caption);

    case "dataSection": {
      // ★ null means the register is EMPTY, which is the normal state of a
      // fresh project — render nothing at all. Emitting the <h2> and an empty
      // table would make a new project sprout a stray "RAID" heading over
      // nothing.
      const section = resolveDataSection(block.key, ws, lang);
      if (!section) return "";
      return `<h2>${htmlEscape(section.title)}</h2>${tableHtml(section.columns, section.rows)}`;
    }

    case "pageBreak":
      // Emitted in both modes; only the standalone document carries the rule
      // that gives it meaning, so in a preview fragment it is an inert marker
      // the host page may style itself.
      return `<div class="page-break"></div>`;
  }
}

export function renderDocumentHtml(
  doc: ProjectDocument,
  ws: Workspace,
  lang: Lang,
  mode: DocHtmlMode,
): string {
  const body = doc.blocks
    .map((b) => renderBlock(b, ws, lang))
    .filter((s) => s !== "")
    .join("\n");

  if (mode === "preview") return body;

  // ★★ lang comes from the ARGUMENT, never a hardcoded "en". Every member of
  // Lang ("en-US" | "en-GB" | "de") is already a valid BCP-47 tag. A German
  // document declaring lang="en" is a WCAG 3.1.1 (Language of Page) failure and
  // makes a screen reader read it with an English voice; it also mislabels the
  // language metadata of the printed PDF.
  return `<!DOCTYPE html>
<html lang="${htmlEscape(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${htmlEscape(doc.title)}</title>
  <style>${PRINT_STYLES}${DOCUMENT_PAGE_STYLES}
  </style>
</head>
<body>
  <header><h1>${htmlEscape(doc.title)}</h1></header>
  ${body}
  <footer>Acme — AI PM Cockpit</footer>
</body>
</html>`;
}
