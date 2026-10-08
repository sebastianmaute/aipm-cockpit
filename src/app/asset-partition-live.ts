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
import { assetPartitionKey } from "./document-assets-schema";
import { loadCurrentTursoProjectId, loadPortfolioMode } from "./portfolio-mode";
import { loadRegistry } from "./projects-registry";
import type { StorageKind } from "./workspace";

export function liveAssetPartitionKey(storageKind: StorageKind): string {
  return assetPartitionKey({
    storageKind,
    tursoProjectId: loadCurrentTursoProjectId(),
    portfolioMode: loadPortfolioMode(),
    registryProjectId: loadRegistry().currentProjectId,
  });
}
