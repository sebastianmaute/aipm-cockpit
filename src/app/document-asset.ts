// The DocumentAsset METADATA record. Bytes live in the `document_asset_data`
// side table (document-assets-schema.ts) and never in the workspace.
//
// ★★ MIME-GENERIC BY CONTRACT. This module admits any mime and treats width and
// height as optional, so the same table, store, dedup and delete serve a later
// attachment slice with no migration. FORMAT POLICY IS THE UPLOAD PIPELINE'S
// JOB (document-asset-upload.ts) — narrowing it here would move a user-facing
// rule into the storage layer, where a stored row could no longer be read back
// after the policy changed.

export interface DocumentAsset {
  /** Referenced from block HTML as `<img data-asset-id="…">`. */
  id: string;
  /** User-editable display name. Rename edits this and nothing else — every
   *  reference is by id and stays correct. */
  name: string;
  mime: string;
  /** Stored byte length, POST-downscale. */
  size: number;
  /** Post-downscale pixel dimensions. Absent for non-raster assets. The OOXML
   *  writers size in EMU from these and cannot backfill without decoding. */
  width?: number;
  height?: number;
  /** SHA-256 over the stored bytes. Drives dedup and refcount-aware delete. */
  hash: string;
  createdAt: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Finite positive number, or undefined. Accepts the strings the CSV and
 *  Markdown decode paths hand over. */
function dim(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Byte count. Floors at 0 rather than dropping the row: a bad size is a
 *  cosmetic defect in a disclosure total, not a reason to lose the asset. */
function bytes(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sanitizeDocumentAsset(input: unknown): DocumentAsset | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const id = str(o.id).trim();
  if (!id) return null;
  const width = dim(o.width);
  const height = dim(o.height);
  return {
    id,
    name: str(o.name),
    mime: str(o.mime),
    size: bytes(o.size),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    hash: str(o.hash),
    createdAt: str(o.createdAt),
  };
}
