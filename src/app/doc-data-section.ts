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
 * Returns `null` when the register is empty — the registry's own builders
 * return null for an empty entity, and a fresh project would otherwise grow a
 * stray heading and an empty table in every generated document.
 */
export function resolveDataSection(
  key: ExportSectionKey,
  ws: Workspace,
  lang: Lang,
): ExportSection | null {
  const cfg = Object.fromEntries(
    EXPORT_SECTION_KEYS.map((k) => [k, k === key]),
  ) as ExportConfig;
  return buildExportSections(ws, cfg, lang).find((s) => s.key === key) ?? null;
}
