// src/app/doc-data-section.ts
//
// Resolves a document `dataSection` block to a live ExportSection, grounded in
// the real export-sections registry so a rendered section can never drift from
// what the workspace exporter emits.
//
// ★★ DELIBERATELY NEUTRAL — this module must depend ONLY on the section
// registry, settings-types and the Workspace/Lang types. It must NEVER import
// an OOXML builder or the ZIP writer. It is shared by the DOCX and PPTX
// renderers AND by doc-render-html, which backs the IN-APP PREVIEW and the
// print-PDF path; importing it from a format module would drag the OOXML
// builders and the zip writer into the preview's module graph — code that only
// ever runs when someone clicks Download. Keep the dependency arrow pointing
// this way: renderers → here, never here → a renderer.

import { buildExportSections, type ExportSection } from "./export-sections";
import {
  EXPORT_SECTION_KEYS,
  type ExportConfig,
  type ExportSectionKey,
} from "./settings-types";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

/**
 * Resolve one `dataSection` key to a live ExportSection.
 *
 * Builds an ExportConfig with exactly the requested key enabled and defers to
 * `buildExportSections`, so the columns and row projections are the same ones
 * every other export path uses.
 *
 * Returns `null` when there is nothing to show, so a caller can render nothing
 * rather than a stray heading over an empty table.
 *
 * ★★ THE ZERO-ROW CHECK IS LOAD-BEARING, NOT BELT-AND-BRACES — it is reachable
 * TODAY, and only two of the fifteen builders can reach it. Thirteen gate on
 * `items.length > 0` and so cannot return an empty section. But `project` gates
 * on `ws.project` being PRESENT and `status` on its having any KEYS, while
 * `projectSection` skips every blank/undefined/empty-array field and
 * `statusSection` drops every empty line — so a project whose metadata is all
 * blank, or a status object holding only empty strings, yields a real section
 * with ZERO rows. Measured, not reasoned: `project: {}` → rows 0,
 * `status: { ragScope: "" }` → rows 0. A freshly created project before anyone
 * fills in the metadata is exactly that case, so without this check every
 * generated document grows an empty "Project" table.
 */
export function resolveDataSection(
  key: ExportSectionKey,
  ws: Workspace,
  lang: Lang,
): ExportSection | null {
  const cfg = Object.fromEntries(
    EXPORT_SECTION_KEYS.map((k) => [k, k === key]),
  ) as ExportConfig;
  const section = buildExportSections(ws, cfg, lang).find((s) => s.key === key);
  return section && section.rows.length > 0 ? section : null;
}
