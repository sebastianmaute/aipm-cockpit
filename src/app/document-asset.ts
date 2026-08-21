// The DocumentAsset METADATA record. Bytes live in the `document_asset_data`
// side table (document-assets-schema.ts) and never in the workspace.
//
// ★★ MIME-GENERIC BY CONTRACT. This module admits any mime and treats width and
// height as optional, so the same table, store, dedup and delete serve a later
// attachment slice with no migration. FORMAT POLICY IS THE UPLOAD PIPELINE'S
// JOB (document-asset-upload.ts) — narrowing it here would move a user-facing
// rule into the storage layer, where a stored row could no longer be read back
// after the policy changed.
//
// The sanitizer NEVER throws: every load path (JSON import, CSV/MD decode,
// Turso row, IndexedDB) runs untrusted data through it and expects null for an
// unrecoverable record rather than an exception — same contract as
// sanitizeCalendarEvent (calendar-event.ts). All coercion of untrusted input
// routes through sanitizeText/toNumber (./sanitize) rather than `String()`/
// `Number()` directly: a JSON object whose `toString`/`valueOf` own-key is a
// non-function throws on the bare coercion (see toNumber's own docstring).

import { sanitizeText, toNumber } from "./sanitize";

const ASSET_ID_MAX = 128; // a minted id
const ASSET_NAME_MAX = 256; // a filename
const ASSET_MIME_MAX = 128; // a MIME type string
const ASSET_HASH_MAX = 128; // SHA-256 hex is 64; double for headroom
const ASSET_CREATED_AT_MAX = 64; // an ISO-8601 timestamp

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

/** Finite positive number, or undefined. Accepts the strings the CSV and
 *  Markdown decode paths hand over. */
function dim(v: unknown): number | undefined {
  const n = toNumber(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Byte count. Floors at 0 rather than dropping the row: a bad size is a
 *  cosmetic defect in a disclosure total, not a reason to lose the asset. */
function bytes(v: unknown): number {
  const n = toNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sanitizeDocumentAsset(input: unknown): DocumentAsset | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const id = sanitizeText(o.id, ASSET_ID_MAX);
  if (!id) return null;
  const width = dim(o.width);
  const height = dim(o.height);
  return {
    id,
    name: sanitizeText(o.name, ASSET_NAME_MAX),
    mime: sanitizeText(o.mime, ASSET_MIME_MAX),
    size: bytes(o.size),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    hash: sanitizeText(o.hash, ASSET_HASH_MAX),
    createdAt: sanitizeText(o.createdAt, ASSET_CREATED_AT_MAX),
  };
}
