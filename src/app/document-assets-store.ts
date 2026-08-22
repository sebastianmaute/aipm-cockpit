// src/app/document-assets-store.ts — async CRUD for document asset BYTES over
// the shared Turso pipeline. Every call prepends DOCUMENT_ASSET_DATA_DDL
// (CREATE TABLE IF NOT EXISTS), mirroring comm-templates-store.ts, so a
// database that has never held an asset heals itself on first use.
//
// ★★ ONE ASSET PER REQUEST. The 32 MiB ceiling measured on 2026-08-21 was for a
// SINGLE statement; batching several images into one pipeline is unmeasured.
import { runTursoPipeline } from "./turso-pipeline";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataIdsSelect, assetDataUpsert,
  assetDataDelete, assetDataDeleteAllForProject, rowsToAssetData, type AssetDataRow,
} from "./document-assets-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => DOCUMENT_ASSET_DATA_DDL.map((sql) => ({ sql }));

/** base64 bytes, or null when no row exists — the dangling case the preview
 *  renders with a missing-asset marker. A present-but-EMPTY row returns "",
 *  distinct from the absent case (rowObjects coerces a missing cell to "",
 *  never undefined, so only an absent ROW yields the null branch here). */
export async function loadAssetData(
  config: TursoConfig | null, id: string, projectId: string,
): Promise<string | null> {
  const results = await runTursoPipeline(config, [...ddl(), ...assetDataSelect(id, projectId)]);
  const rows = rowsToAssetData(results[DOCUMENT_ASSET_DATA_DDL.length]);
  return rows[0]?.data ?? null;
}

/** Ids present in the byte table. The library diffs this against the metadata
 *  slice to mark rows dangling without pulling a single image. */
export async function loadAssetDataIds(
  config: TursoConfig | null, projectId: string,
): Promise<string[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...assetDataIdsSelect(projectId)]);
  return rowsToAssetData(results[DOCUMENT_ASSET_DATA_DDL.length]).map((r) => r.id);
}

export async function saveAssetData(config: TursoConfig | null, row: AssetDataRow): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...assetDataUpsert(row)]);
}

export async function deleteAssetData(
  config: TursoConfig | null, id: string, projectId: string,
): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...assetDataDelete(id, projectId)]);
}

/** Project deletion must clean the side table explicitly — the workspace save
 *  never touches it, so nothing else ever will. */
export async function deleteAllAssetDataForProject(
  config: TursoConfig | null, projectId: string,
): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...assetDataDeleteAllForProject(projectId)]);
}
