// src/app/document-asset-markdown.ts
//
// documentAssets' Markdown table ENCODER, split out of markdown-codecs-core.ts
// so that file stays under the file-size ratchet (it sat at 795/800 lines
// before this extraction). Mirrors the calendarEvents row-table shape; see
// markdown-codecs-core.ts's workspaceToMarkdown for the storage-only gate
// this is emitted behind (documentAssets is deliberately not an
// ExportSectionKey — see the identical deviation note in
// csv-codecs-config.ts). The decode side (markdownToDocumentAssets,
// DOCUMENT_ASSETS_MD_ALIASES) stays in markdown-codecs-decode.ts, which has
// headroom this file's sibling does not.
//
// Imports mdEscape back from markdown-codecs-core.ts (exported there for
// this reason) rather than duplicating it — that makes this a two-way file
// dependency (core also imports documentAssetsToMarkdown from here), but
// both sides are plain function declarations never invoked at module-eval
// time, so the cycle is inert at load order.

import type { DocumentAsset } from "./document-asset";
import { documentAssetFieldToString } from "./csv-codecs";
import { DOCUMENT_ASSETS_MD_COLUMNS } from "./markdown-columns";
import { mdEscape } from "./markdown-codecs-core";

// Row-table shape, same as calendarEventsToMarkdown (markdown-codecs-core.ts)
// — NOT the fenced-json blob shape documentsToMarkdown/
// documentVersionsToMarkdown/activityLogToMarkdown use (those hold a whole
// document/version/entry list per blob; asset metadata is one row per asset,
// matching calendarEvents). Reuses documentAssetFieldToString
// (csv-codecs-core.ts, via the ./csv-codecs barrel) rather than re-deriving
// cell values, so CSV and Markdown cannot drift on what a column contains.
// Bytes never appear here — only metadata.
export function documentAssetsToMarkdown(assets: readonly DocumentAsset[]): string {
  const header = `| ${DOCUMENT_ASSETS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${DOCUMENT_ASSETS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["## Document Assets", "", header, sep];
  for (const a of assets) {
    const row = DOCUMENT_ASSETS_MD_COLUMNS.map((c) =>
      mdEscape(documentAssetFieldToString(a, c.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}
