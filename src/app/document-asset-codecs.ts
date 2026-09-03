// src/app/document-asset-codecs.ts
//
// CSV codec for DocumentAsset metadata rows. Extracted from csv-codecs-core.ts
// when that file crossed the 800-line file-size ratchet. Re-exported via the
// ./csv-codecs barrel (`export * from "./document-asset-codecs"`), so every
// existing `from "./csv-codecs"` import of these names keeps working
// unchanged; a caller that imports from "./csv-codecs-core" directly must be
// updated to import from here (or the barrel) instead — see turso-schema.ts /
// csv-codecs-config.ts / csv-codecs-decode.ts.

import { csvCellEscape } from "./csv-codecs-core";
import { sanitizeDocumentAsset, type DocumentAsset } from "./document-asset";

// Columns persisted for DocumentAsset metadata rows in CSV. Order matches the
// header row emitted by the encoder; the decoder reads by column name so
// reordering files by hand still works. Bytes live in the side table, never
// in this row — see document-asset.ts.
export const DOCUMENT_ASSETS_CSV_COLUMNS = [
  "id", "name", "mime", "size", "width", "height", "hash", "createdAt",
] as const satisfies readonly (keyof DocumentAsset)[];

// The default branch already renders `undefined` as "" — spelled out here only
// because an absent width/height is the COMMON case for a non-raster asset, and
// a codec that emitted the string "undefined" would round-trip it back as a
// dimension of NaN.
export function documentAssetFieldToString(a: DocumentAsset, col: string): string {
  const v = (a as unknown as Record<string, unknown>)[col];
  return v == null ? "" : String(v);
}

export function buildDocumentAssetFromObj(obj: Record<string, string>): DocumentAsset | null {
  return sanitizeDocumentAsset(obj);
}

export function documentAssetsToCsv(assets: readonly DocumentAsset[], neutralize = false): string {
  const lines: string[] = [DOCUMENT_ASSETS_CSV_COLUMNS.join(",")];
  for (const a of assets) {
    lines.push(
      DOCUMENT_ASSETS_CSV_COLUMNS.map((c) =>
        csvCellEscape(documentAssetFieldToString(a, c), neutralize),
      ).join(","),
    );
  }
  return lines.join("\r\n");
}
