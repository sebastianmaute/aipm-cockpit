// src/app/doc-render-html.ts — blocks → HTML. The CANONICAL renderer: it backs
// the in-app preview, the .html download and the print-PDF path.
//
// ★★ This module is deliberately DOM-BOUND — the exact opposite of
// document-model.ts, which is DOM-FREE by contract. The sanitizer below binds
// `window`, so this file must never be pulled into
// scripts/generate-sample-workspace.ts's import graph. Keep it a render sink.
//
// ★★ The paragraph sink re-sanitizes. document-rich-fields.ts already cleans
// paragraph HTML at the whole-object load boundaries (jsonToWorkspace + the
// IndexedDB load), but the CSV/MD/Turso decoders hand-build entities and never
// call a sanitizer, and document-model.ts is DOM-free and cannot — so on those
// three backends THIS is the only layer that holds against stored markup.
//
// ★★★ sanitizeTemplateHtml, never sanitizeNoteHtml. Neither allow-list contains
// h3/div/table, so both DELETE those tags; what differs is the TEXT inside them.
// sanitizeNoteHtml sets KEEP_CONTENT:false and deletes the words along with the
// tag — right for the lean note editor, catastrophic here, because a document is
// authored by a model that legitimately emits headings and tables and its prose
// would vanish. sanitizeTemplateHtml keeps DOMPurify's default and unwraps the
// tag, so the words survive. (It lives in ./sanitize-html — NOT ./note-log.)

import type { DocBlock, ProjectDocument } from "./document-model";
import { buildExportSections, type ExportSection } from "./export-sections";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { htmlEscape, htmlCellWithBreaks, PRINT_STYLES } from "./download";
import { defaultExportConfig, EXPORT_SECTION_KEYS, type ExportSectionKey } from "./settings-types";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocHtmlMode = "preview" | "standalone";

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

/** Resolve one dataSection key against the live workspace. Returns null when
 *  the section is empty — an empty section renders as nothing, not as a bare
 *  header with no rows under it. */
function resolveSection(key: ExportSectionKey, ws: Workspace, lang: Lang): ExportSection | null {
  const cfg = { ...defaultExportConfig };
  for (const k of EXPORT_SECTION_KEYS) cfg[k] = k === key;
  const found = buildExportSections(ws, cfg, lang).find((s) => s.key === key);
  return found && found.rows.length > 0 ? found : null;
}

function renderBlock(block: DocBlock, ws: Workspace, lang: Lang): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${htmlEscape(block.text)}</h${block.level}>`;

    // The ONE unescaped path: already-sanitized HTML, re-sanitized here.
    case "paragraph":
      return sanitizeTemplateHtml(block.html);

    case "bullets": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((i) => `<li>${htmlEscape(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }

    case "table":
      return tableHtml(block.columns, block.rows, block.caption);

    case "dataSection": {
      const section = resolveSection(block.key, ws, lang);
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
  <style>${PRINT_STYLES}
    .page-break { break-after: page; page-break-after: always; height: 0; }
  </style>
</head>
<body>
  <header><h1>${htmlEscape(doc.title)}</h1></header>
  ${body}
  <footer>Acme — AI PM Cockpit</footer>
</body>
</html>`;
}
