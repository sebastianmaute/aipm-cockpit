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
 *  project happens to be current. Under THIS key a read and the id list reach
 *  one SCOPE: the key itself plus the `legacyKeys` the caller passes — the keys
 *  a pre-§207 build wrote this database's bytes under: the registry id of
 *  whichever project was current (a FILE project's id — production stores no
 *  other kind of registry entry) and `ASSET_PARTITION_FALLBACK`
 *  (`singleTenantLegacyAssetKeys` in asset-partition-live.ts lists them). That
 *  is how old bytes stay readable with nothing re-keyed. A DELETE writes a
 *  tombstone row under `ASSET_DELETED_PARTITION`, which hides the id from the
 *  scoped read and list, and leaves the legacy rows alone: a file project in the
 *  registry may share them, and its copy must keep working (owner decision,
 *  2026-10-08). ★★ The scope DELIBERATELY takes in every registry project's
 *  partition, so a file project that shares an id shows its bytes here too, and
 *  they vanish if that project deletes its copy; the tombstone protects that
 *  project from this one's deletes, not the reverse. The scope is this browser's
 *  registry: a project removed from it, or another device's registry, leaves
 *  its pre-§207 images unreachable here (bytes kept). Tenant keys reach nothing
 *  but their own partition. */
export const SINGLE_TENANT_ASSET_PARTITION = "single-tenant";

/** The partition a single-tenant DELETE writes its tombstone under (§207): a row
 *  `(id, ASSET_DELETED_PARTITION, "")` means "deleted here", and the scoped read
 *  and list skip the id however many legacy copies remain. A KEY, not a marker
 *  VALUE in the data column, so neither check has to load any image's bytes (the
 *  id list runs on every library change). Saving bytes for the id again under the
 *  single-tenant key clears it. No registry or tenant id has this shape. */
export const ASSET_DELETED_PARTITION = "single-tenant:deleted";

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

/** `?, ?, …` for `n` bound values. */
const placeholders = (n: number): string => Array.from({ length: n }, () => "?").join(", ");
/** The single-tenant scope's keys: the key first, then each legacy key once. */
const scopeKeys = (projectId: string, legacyKeys: readonly string[]): string[] =>
  [projectId, ...legacyKeys.filter((k, i) => k !== projectId && legacyKeys.indexOf(k) === i)];

/** One asset's bytes, under `projectId`. ★★ Under `SINGLE_TENANT_ASSET_PARTITION`
 *  the read reaches the single-tenant SCOPE (the key plus `legacyKeys`, see
 *  `SINGLE_TENANT_ASSET_PARTITION`), preferring the key's own row, and finds
 *  nothing for an id that key has tombstoned (§207). Every other key, a tenant
 *  project's above all, reads its own partition only: an imported workspace
 *  shares asset ids with its source project, so a wider read would show project
 *  A's bytes in project B, healthy-looking, until A deleted them.
 *  ★ `legacyKeys` is REQUIRED, never defaulted: the store resolves it
 *  (`legacyKeysFor`), and a caller that skipped it would silently lose every
 *  pre-§207 image. Pass `[]` for any other key. */
export const assetDataSelect = (id: string, projectId: string, legacyKeys: readonly string[]): SqlStmt[] => {
  if (projectId !== SINGLE_TENANT_ASSET_PARTITION) {
    return [{
      sql: `SELECT id, project_id, data FROM document_asset_data WHERE id = ? AND project_id = ?`,
      args: [txt(id), txt(projectId)],
    }];
  }
  const scope = scopeKeys(projectId, legacyKeys);
  return [{
    sql: `SELECT id, project_id, data FROM document_asset_data WHERE id = ? AND project_id IN (${placeholders(scope.length)}) AND NOT EXISTS (SELECT 1 FROM document_asset_data WHERE id = ? AND project_id = ?) ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END LIMIT 1`,
    args: [txt(id), ...scope.map(txt), txt(id), txt(ASSET_DELETED_PARTITION), txt(projectId)],
  }];
};

/** Ids only — the library lists names and sizes from the METADATA slice, so it
 *  must never pull bytes to render. The same reach as `assetDataSelect`: the
 *  single-tenant scope (each id once, a tombstoned id never) under that key, the
 *  key's own partition otherwise. `legacyKeys` is required, as there. */
export const assetDataIdsSelect = (projectId: string, legacyKeys: readonly string[]): SqlStmt[] => {
  if (projectId !== SINGLE_TENANT_ASSET_PARTITION) {
    return [{ sql: `SELECT id, project_id, '' AS data FROM document_asset_data WHERE project_id = ?`, args: [txt(projectId)] }];
  }
  const scope = scopeKeys(projectId, legacyKeys);
  return [{
    sql: `SELECT DISTINCT id, '' AS project_id, '' AS data FROM document_asset_data WHERE project_id IN (${placeholders(scope.length)}) AND id NOT IN (SELECT id FROM document_asset_data WHERE project_id = ?)`,
    args: [...scope.map(txt), txt(ASSET_DELETED_PARTITION)],
  }];
};

/** Writes an asset's bytes. Under `SINGLE_TENANT_ASSET_PARTITION` it also clears a
 *  tombstone for the id, AFTER the write (a failure between the two leaves the
 *  bytes stored and still hidden, never a deleted image shown). */
export function assetDataUpsert(row: AssetDataRow): SqlStmt[] {
  const write: SqlStmt = {
    sql: `INSERT OR REPLACE INTO document_asset_data (id, project_id, data) VALUES (?, ?, ?)`,
    args: [txt(row.id), txt(row.projectId), txt(row.data)],
  };
  return row.projectId === SINGLE_TENANT_ASSET_PARTITION
    ? [write, { sql: `DELETE FROM document_asset_data WHERE id = ? AND project_id = ?`, args: [txt(row.id), txt(ASSET_DELETED_PARTITION)] }]
    : [write];
}

/** Under `SINGLE_TENANT_ASSET_PARTITION` a delete writes the tombstone FIRST, then
 *  removes the key's own row: a failure between the two leaves the image hidden
 *  with its bytes still stored, never shown again from a legacy copy. The legacy
 *  rows stay — a file project may still use them (owner decision 2026-10-08).
 *  Any other key deletes its own row. */
export const assetDataDelete = (id: string, projectId: string): SqlStmt[] => {
  const own: SqlStmt = { sql: `DELETE FROM document_asset_data WHERE id = ? AND project_id = ?`, args: [txt(id), txt(projectId)] };
  return projectId === SINGLE_TENANT_ASSET_PARTITION
    ? [{ sql: `INSERT OR REPLACE INTO document_asset_data (id, project_id, data) VALUES (?, ?, '')`, args: [txt(id), txt(ASSET_DELETED_PARTITION)] }, own]
    : [own];
};

export function rowsToAssetData(res: PipelineResultLike | undefined): AssetDataRow[] {
  return rowObjects(res).map((r) => ({
    id: r.id ?? "",
    projectId: r.project_id ?? "",
    data: r.data ?? "",
  }));
}
