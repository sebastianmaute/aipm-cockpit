// src/app/asset-partition-live.ts — the asset byte-store key for the project on
// screen, read from the live portfolio and registry state (§207).
//
// ONE reader for every surface that reads or writes image bytes (the Documents
// pane and, through it, the history modal and edit mode; the chat card's
// document download). Two surfaces deriving the key apart is how the chat card
// once read under the registry id while the pane wrote under the single-tenant
// key, so its download lost every image the pane's kept.
//
// Synchronous localStorage reads, safe in render; the layout decision itself is
// the pure `assetPartitionKey` in document-assets-schema.ts.
//
// ★★ NOT TRUSTWORTHY UNDER SAFE MODE (`?safe=1`): `loadPortfolioMode` and
// `loadCurrentTursoProjectId` force degraded values there while `loadRegistry`
// does not, so the key can name a partition the workspace on screen never wrote.
// Every caller must refuse byte access in Safe Mode alongside it: the Documents
// pane forces its Turso config to null, the chat card gets an empty key (no loader).
import { ASSET_PARTITION_FALLBACK, assetPartitionKey } from "./document-assets-schema";
import { loadCurrentTursoProjectId, loadPortfolioMode } from "./portfolio-mode";
import { loadRegistry } from "./projects-registry";
import type { StorageKind } from "./workspace";

/** The keys a pre-§207 build wrote a SINGLE-TENANT database's image bytes under:
 *  the registry id of whichever Turso-storage project was current, or
 *  `ASSET_PARTITION_FALLBACK` with none. Together with the single-tenant key they
 *  are the scope that key reads, lists and deletes (document-assets-schema.ts).
 *  A registry project on any OTHER storage is left out: its bytes ride the same
 *  integration database, but its metadata is its own file's, not this one's. */
export function singleTenantLegacyAssetKeys(): string[] {
  const ids = loadRegistry().projects.filter((p) => p.storageConfig.kind === "turso").map((p) => p.id);
  return [ASSET_PARTITION_FALLBACK, ...ids.filter((id) => id !== ASSET_PARTITION_FALLBACK)];
}

export function liveAssetPartitionKey(storageKind: StorageKind): string {
  return assetPartitionKey({
    storageKind,
    tursoProjectId: loadCurrentTursoProjectId(),
    portfolioMode: loadPortfolioMode(),
    registryProjectId: loadRegistry().currentProjectId,
  });
}
