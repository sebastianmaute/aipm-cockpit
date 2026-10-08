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
import type { StorageKind } from "./workspace";
import type { PortfolioMode } from "./portfolio-mode";

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

/** The ONE key a single-tenant Turso backend writes asset bytes under (§207).
 *  That layout's METADATA table has no `project_id` column — the database IS
 *  the project — so its bytes must not be split by whichever file-registry
 *  project happens to be current. Under THIS key alone a read and the id list
 *  reach every partition (`assetDataSelect`, `assetDataIdsSelect`): before
 *  §207 those bytes were written under the registry id or
 *  `ASSET_PARTITION_FALLBACK`, and that is how they stay readable with nothing
 *  re-keyed. A delete stays strict, so a legacy row is left behind as an orphan
 *  (no metadata points at it) rather than risking another project's bytes. */
export const SINGLE_TENANT_ASSET_PARTITION = "single-tenant";

/** The byte-store key for the backend in scope (§207). Turso storage in TURSO
 *  portfolio mode with a project selected keys on that tenant project, strictly
 *  — what the project hard-delete sweep removes. Turso storage otherwise takes
 *  the single-tenant key, including a tenant id left stored from an earlier
 *  Turso-portfolio session while the portfolio is now in FILE mode: `createBackend`
 *  builds a tenant backend from that id, but its bytes were written under the
 *  file registry's id until §207, and only the single-tenant key reads those.
 *  Any other storage keeps the key it always had, because its metadata rides
 *  each registry project's own file. */
export function assetPartitionKey(args: {
  storageKind: StorageKind;
  tursoProjectId: string | null;
  portfolioMode: PortfolioMode;
  registryProjectId: string | null;
}): string {
  const { storageKind, tursoProjectId, portfolioMode, registryProjectId } = args;
  if (storageKind === "turso") {
    return portfolioMode === "turso" && tursoProjectId ? tursoProjectId : SINGLE_TENANT_ASSET_PARTITION;
  }
  return portfolioMode === "turso"
    ? (tursoProjectId || ASSET_PARTITION_FALLBACK)
    : (registryProjectId || ASSET_PARTITION_FALLBACK);
}

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
   *  ★★ The key follows the BACKEND LAYOUT (`assetPartitionKey`, §207): in
   *  single-tenant Turso the METADATA table `document_assets` has NO
   *  `project_id` column, so metadata is GLOBAL to the database, and its bytes
   *  are written under `SINGLE_TENANT_ASSET_PARTITION` rather than the file
   *  registry's current id. Before §207 they were not, so a registry switch
   *  read every asset under another key and showed it dangling. */
  projectId: string;
  /** base64, no data: prefix. */
  data: string;
}

export const DOCUMENT_ASSET_DATA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS document_asset_data (id TEXT, project_id TEXT, data TEXT, PRIMARY KEY (id, project_id))`,
];

/** One asset's bytes, under `projectId`. ★★ Under `SINGLE_TENANT_ASSET_PARTITION`
 *  ONLY, any partition is read, preferring the key's own row (§207): that is the
 *  migration for bytes an older build wrote under the registry id. Every other
 *  key, a tenant project's above all, reads its own partition and nothing else.
 *  ★ The cross-partition read is NOT harmless in general, which is why it is
 *  confined: an exported workspace imported into another project shares its
 *  asset ids, so a tenant read across partitions would show project A's bytes
 *  in project B, healthy-looking, until A deleted them (review of §207). */
export const assetDataSelect = (id: string, projectId: string): SqlStmt[] =>
  projectId === SINGLE_TENANT_ASSET_PARTITION
    ? [{
        sql: `SELECT id, project_id, data FROM document_asset_data WHERE id = ? ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END LIMIT 1`,
        args: [txt(id), txt(projectId)],
      }]
    : [{
        sql: `SELECT id, project_id, data FROM document_asset_data WHERE id = ? AND project_id = ?`,
        args: [txt(id), txt(projectId)],
      }];

/** Ids only — the library lists names and sizes from the METADATA slice, so it
 *  must never pull bytes to render. The same reach as `assetDataSelect`: every
 *  partition (each id once) under the single-tenant key, the key's own otherwise. */
export const assetDataIdsSelect = (projectId: string): SqlStmt[] =>
  projectId === SINGLE_TENANT_ASSET_PARTITION
    ? [{ sql: `SELECT DISTINCT id, '' AS project_id, '' AS data FROM document_asset_data` }]
    : [{ sql: `SELECT id, project_id, '' AS data FROM document_asset_data WHERE project_id = ?`, args: [txt(projectId)] }];

export function assetDataUpsert(row: AssetDataRow): SqlStmt[] {
  return [{
    sql: `INSERT OR REPLACE INTO document_asset_data (id, project_id, data) VALUES (?, ?, ?)`,
    args: [txt(row.id), txt(row.projectId), txt(row.data)],
  }];
}

/** A delete stays inside `projectId`'s partition, whatever the key. Under the
 *  single-tenant key a legacy copy under the registry id is left behind as an
 *  orphan: clearing every partition would also remove another project's bytes
 *  for an id two projects share (an imported workspace) — review of §207. */
export const assetDataDelete = (id: string, projectId: string): SqlStmt[] => [{
  sql: `DELETE FROM document_asset_data WHERE id = ? AND project_id = ?`,
  args: [txt(id), txt(projectId)],
}];

export function rowsToAssetData(res: PipelineResultLike | undefined): AssetDataRow[] {
  return rowObjects(res).map((r) => ({
    id: r.id ?? "",
    projectId: r.project_id ?? "",
    data: r.data ?? "",
  }));
}
