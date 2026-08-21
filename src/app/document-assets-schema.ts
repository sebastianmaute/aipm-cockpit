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

export interface AssetDataRow {
  id: string;
  /** "" in single-tenant mode. Part of the composite key either way, so one
   *  code path serves both layouts. */
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
