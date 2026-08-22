// src/app/document-assets-schema.ts
//
// DDL and statement builders for `document_asset_data` — the base64 bytes
// behind each DocumentAsset.
//
// ★★★ THIS TABLE IS DELIBERATELY OUTSIDE TABLE_NAMES. The workspace save emits
// a per-table DELETE plus a full re-INSERT for every table it owns, so listing
// this one would wipe the whole image library on every workspace save. The
// metadata rides ENTITY_SPECS (turso-schema.ts, table "document_assets"); only
// the bytes live here, and they are written one row at a time by the async
// store this schema feeds (document-assets-store.ts, Task 9). A guard test in
// turso-schema.test.ts pins the exclusion.
//
// ★★ Bytes are base64 TEXT because SqlArg.value is string-only even for
// integers — every other side-table schema in this file family (comm-templates,
// chat-threads, ...) makes the same choice via the shared txt()/int() builders.

import { rowObjects, txt, type PipelineResultLike, type SqlStmt } from "./turso-schema";

/** The partition key used when the caller has no project id to give — a Turso
 *  portfolio with nothing selected yet, or a file registry with no current
 *  entry. Named here, beside the column whose meaning it carries, so no call
 *  site has to spell the literal.
 *
 *  ★★★ NO COUNT IS QUOTED, AND THE PREVIOUS ONE ROTTED THE ONLY WAY IT COULD:
 *  it said "the two call sites that need it" while FOUR sites needed it and
 *  two of them still held a bare `"default"` — one of those on the READ side
 *  and spelled with `??`, so an empty-string project id wrote under this key
 *  and read back under "". Enumerate instead, both spellings in one sweep:
 *    grep -rn 'ASSET_PARTITION_FALLBACK\|"default"' src/app/documents-asset-section.tsx \
 *      src/app/workspace-panels.tsx src/app/documents-panel.tsx \
 *      src/app/document-edit-mode.tsx src/app/document-preview.tsx
 *  Hits inside comments are prose; a bare `"default"` in CODE is a site that
 *  can drift. There are none left: every one of the five now names this
 *  constant. `document-preview.tsx`'s defaulted prop was the last, and it was
 *  harmless only because `document-edit-mode.tsx` happened to hand it an
 *  already-normalised value — the same "safe because of a distant invariant"
 *  shape as the drift this constant exists to prevent, which is why it was
 *  closed rather than left resting on that.
 *
 *  ★★ FOLD "" IN WITH `||`, NEVER `??`. `??` keeps "" as a real key, which is
 *  the one value AssetDataRow.projectId promises never to see; the write seam
 *  (documents-asset-section.tsx), the producer (workspace-panels.tsx) and the
 *  read seam (document-edit-mode.tsx) all use `||` for that reason.
 *
 *  ★★★ IT IS A REAL KEY, NOT A SENTINEL FOR "unpartitioned". Bytes written
 *  under it are found again by any later session in the SAME state, because
 *  every input to the key is deterministic — that is the property that makes
 *  it safe, and the one Safe Mode broke (workspace-panels.tsx's gate, which
 *  disables the feature rather than letting the key MOVE under a workspace
 *  whose metadata did not move). A no-project Turso portfolio is not a broken
 *  state: `createBackend` (storage.ts) falls back to the SINGLE-TENANT
 *  `TursoBackend` when `tursoProjectId` is null, so a real workspace with real
 *  documents is on screen and its bytes belong somewhere. Refusing there would
 *  disable images for a configuration that otherwise works.
 *
 *  ★★ NEVER "" — see AssetDataRow.projectId. An empty key is normalised to
 *  this one at the seam (documents-asset-section.tsx) so a caller that follows
 *  the old, never-implemented docstring cannot open a second partition. */
export const ASSET_PARTITION_FALLBACK = "default";

export interface AssetDataRow {
  id: string;
  /** The caller's project scope, verbatim — part of the composite key in BOTH
   *  Turso layouts. `ASSET_PARTITION_FALLBACK` stands in when the caller has
   *  no project id; it is never "".
   *
   *  ★★★ AN EARLIER VERSION OF THIS DOCSTRING SAID `""` IN SINGLE-TENANT MODE
   *  AND NO CALL SITE EVER IMPLEMENTED IT. The store passes the caller's value
   *  straight through and the only production chain (DocumentsTabPanel →
   *  `assetPane.projectId` → the section's fallback) yields the portfolio /
   *  registry id or `ASSET_PARTITION_FALLBACK` — never the sentinel. The
   *  docstring was corrected to the code rather than the reverse: every byte
   *  already stored is keyed the way the code does it, so adopting the
   *  sentinel now would orphan the whole existing library behind a migration
   *  this table has no version marker to drive.
   *
   *  ★★ KNOWN LIMITATION — the two halves are not guaranteed to agree, and
   *  this key cannot close that on its own. In single-tenant Turso the
   *  METADATA table `document_assets` is an ENTITY_SPECS row with NO
   *  `project_id` column, so metadata is GLOBAL to the database, while this
   *  table's PK is `(id, project_id)` unconditionally. One global metadata set
   *  can therefore face several byte partitions: a file-portfolio user on
   *  single-tenant Turso storage who switches registry project keeps the same
   *  metadata rows but reads bytes under a different key, and every asset
   *  reads as dangling until they switch back. Nothing is LOST — the bytes
   *  stay under the key that wrote them, and re-selecting the original project
   *  restores them. Closing it properly means keying on the BACKEND LAYOUT
   *  (tenant → the tenant project id; single-tenant → one fixed key), which is
   *  a decision only the layer that builds the backend can make; it is not
   *  expressible in this module. */
  projectId: string;
  /** base64, no data: prefix. */
  data: string;
}

export const DOCUMENT_ASSET_DATA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS document_asset_data (id TEXT, project_id TEXT, data TEXT, PRIMARY KEY (id, project_id))`,
];

export const assetDataSelect = (id: string, projectId: string): SqlStmt[] => [{
  sql: `SELECT id, project_id, data FROM document_asset_data WHERE id = ? AND project_id = ?`,
  args: [txt(id), txt(projectId)],
}];

/** Ids only — the library lists names and sizes from the METADATA slice, so it
 *  must never pull bytes to render. */
export const assetDataIdsSelect = (projectId: string): SqlStmt[] => [{
  sql: `SELECT id, project_id, '' AS data FROM document_asset_data WHERE project_id = ?`,
  args: [txt(projectId)],
}];

export function assetDataUpsert(row: AssetDataRow): SqlStmt[] {
  return [{
    sql: `INSERT OR REPLACE INTO document_asset_data (id, project_id, data) VALUES (?, ?, ?)`,
    args: [txt(row.id), txt(row.projectId), txt(row.data)],
  }];
}

export const assetDataDelete = (id: string, projectId: string): SqlStmt[] => [{
  sql: `DELETE FROM document_asset_data WHERE id = ? AND project_id = ?`,
  args: [txt(id), txt(projectId)],
}];

/** Every row of a project, for the project-deletion cleanup path. */
export const assetDataDeleteAllForProject = (projectId: string): SqlStmt[] => [{
  sql: `DELETE FROM document_asset_data WHERE project_id = ?`,
  args: [txt(projectId)],
}];

export function rowsToAssetData(res: PipelineResultLike | undefined): AssetDataRow[] {
  return rowObjects(res).map((r) => ({
    id: r.id ?? "",
    projectId: r.project_id ?? "",
    data: r.data ?? "",
  }));
}
