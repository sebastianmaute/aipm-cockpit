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
// ★★★ sanitizeDocumentHtml, never sanitizeNoteHtml. Neither allow-list contains
// h3/div/table, so both DELETE those tags; what differs is the TEXT inside them.
// sanitizeNoteHtml sets KEEP_CONTENT:false and deletes the words along with the
// tag — right for the lean note editor, catastrophic here, because a document is
// authored by a model that legitimately emits headings and tables and its prose
// would vanish. sanitizeDocumentHtml keeps DOMPurify's default and unwraps the
// tag, so the words survive. (It lives in ./sanitize-html — NOT ./note-log.)
//
// ★★ Nor sanitizeTemplateHtml, which this sink used until the documents list
// existed: that one is SHARED with comm templates, meeting reports and the six
// rich entity fields, so a document's marks could only be admitted by widening
// what every one of those consumers may store. sanitizeDocumentHtml is the same
// list plus the document-only tags, kept separate for exactly that reason —
// route a NEW documents sink here, and never widen the template list instead.
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
import { htmlEscape, htmlCellWithBreaks, PRINT_STYLES } from "./download";
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
    .page-break { break-after: page; page-break-after: always; height: 0; }`;

/** ONE table renderer for both the `table` block and a resolved dataSection.
 *
 *  ★ Kept shared rather than written twice: two near-identical thead/tbody
 *  builders in one file is exactly the shape the BLOCKING jscpd duplication
 *  gate flags, and it is also how the two drift apart on a later escaping fix.
 *
 *  ★★ Every cell goes through htmlCellWithBreaks, which escapes FIRST and then
 *  maps "\n" to <br>. Do not reorder: substituting first turns our own <br>
 *  into a visible "&lt;br&gt;", and dropping the escape to avoid that lets a
 *  literal "<br>" in user content through as real markup. */
function tableHtml(
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  caption?: string,
): string {
  const cap = caption ? `<caption>${htmlEscape(caption)}</caption>` : "";
  const head = columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${htmlCellWithBreaks(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>${cap}<thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

function renderBlock(block: DocBlock, ws: Workspace, lang: Lang): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${htmlEscape(block.text)}</h${block.level}>`;

    // The ONE unescaped path: already-sanitized HTML, re-sanitized here.
    case "paragraph":
      return sanitizeDocumentHtml(block.html);

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
