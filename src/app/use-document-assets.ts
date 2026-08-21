"use client";

// src/app/use-document-assets.ts — upload/rename/remove glue for document
// images, over the pure `document-asset-upload.ts` pipeline and the Turso
// `document-assets-store.ts` byte store.
//
// ★★★ THE WRITE-ORDER DECISION LIVES HERE AND NOWHERE ELSE: `upload` commits
// the METADATA row (`setAssets`) BEFORE writing the BYTES (`saveAssetData`).
// Inverting that would leave, on a failed byte write, an invisible byte row
// nobody references — an orphan that would need a reclaim/GC action to ever
// find again. Metadata-first instead degrades a failed upload to the DANGLING
// case: a real row in the library, visibly marked (`AssetLibrary`'s
// `data-dangling-marker`), repairable by re-uploading over the same id. The
// metadata row is deliberately left in place on a byte-write failure — no
// rollback — because that row IS the recovery path.
//
// ★★ `busyId` is set only around the byte write (~1.8s measured for a 5MB
// image) — the visible-latency step, not the whole call. `AssetLibrary`
// disables that row's controls while it is set.
//
// ★ Owns its own state (busyId/error/lastId/danglingIds) rather than being a
// stateless deps-object hook (the use-storage-file-ops.ts Phase-3 shape) —
// this hook is closer in shape to use-comm-templates.ts: a self-contained
// async CRUD surface over one Turso-backed store, with real logic and real
// tests, so it is NOT in vitest.config.ts's coverage.exclude.

import { useCallback, useEffect, useState } from "react";
import type { DocumentAsset } from "./document-asset";
import {
  checkUploadCandidate, processUpload, hashBytes, findDuplicate,
  bytesToBase64, type ImageEncoder, type UploadRejection, type PixelSize, type EncodedImage,
} from "./document-asset-upload";
import { saveAssetData, deleteAssetData, loadAssetDataIds } from "./document-assets-store";
import type { TursoConfig } from "./turso-config";

export type UploadError = UploadRejection | "storageWrite";

export interface UseDocumentAssetsDeps {
  config: TursoConfig | null;
  assets: readonly DocumentAsset[];
  setAssets: (next: readonly DocumentAsset[]) => void;
  projectId: string;
}

export interface UseDocumentAssetsResult {
  upload: (file: File) => Promise<void>;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  /** Ids whose metadata exists but whose bytes do not, per the last diff
   *  against the byte store. */
  danglingIds: ReadonlySet<string>;
  /** Id currently mid byte-write; that row's controls disable. */
  busyId: string | null;
  error: UploadError | null;
  /** The id `upload` most recently produced or matched via dedup — lets the
   *  modal mounting insert the right asset without a second round trip. */
  lastId: string | null;
}

/** The one browser-only step, injected so document-asset-upload.ts's
 *  arithmetic stays testable in jsdom (which has no canvas). Production calls
 *  this; tests never reach it because the fixtures used here never trigger a
 *  downscale (target size == source size for a small header-only image). */
const encodeViaCanvas: ImageEncoder = async (
  bytes: Uint8Array, mime: string, size: PixelSize,
): Promise<EncodedImage> => {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const outBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas encode failed"))), mime);
  });
  return { bytes: new Uint8Array(await outBlob.arrayBuffer()), mime };
};

/** Reference-free set equality. Load-bearing, not cosmetic — see the effect
 *  below: without this bail-out, setting a freshly-constructed (but
 *  content-equal) Set every run pairs with any caller whose `assets` array is
 *  a fresh reference each render (a literal built inline, e.g.) to form an
 *  infinite render loop — the effect depends on `assets`, the state update it
 *  produces triggers a re-render, and a re-render with a new `assets`
 *  reference reruns the effect. Reproduced directly: a test passing
 *  `assets: []` inline hung until this guard was added. */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function useDocumentAssets(deps: UseDocumentAssetsDeps): UseDocumentAssetsResult {
  const { config, assets, setAssets, projectId } = deps;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [danglingIds, setDanglingIds] = useState<ReadonlySet<string>>(new Set());

  // ★★★ `react-hooks/set-state-in-effect` is BANNED and fatal. The diff runs
  // in the effect's ASYNC CONTINUATION, never synchronously in the effect
  // body — mirrors use-comm-templates.ts's load effect. `cancelled` guards
  // against the result landing after unmount or after a newer run started.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      try {
        const presentIds = await loadAssetDataIds(config, projectId);
        if (cancelled) return;
        const present = new Set(presentIds);
        const next = new Set<string>();
        for (const a of assets) {
          if (!present.has(a.id)) next.add(a.id);
        }
        setDanglingIds((prev) => (setsEqual(prev, next) ? prev : next));
      } catch {
        // Best-effort disclosure only — leave the last-known set in place.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, projectId, assets]);

  const upload = useCallback(async (file: File) => {
    setError(null);

    const candidate = checkUploadCandidate(file);
    if (!candidate.ok) {
      setError(candidate.reason);
      return;
    }

    const raw = new Uint8Array(await file.arrayBuffer());
    const processed = await processUpload(raw, file.type, encodeViaCanvas);
    if (!processed.ok) {
      setError(processed.reason);
      return;
    }

    const hash = await hashBytes(processed.image.bytes);
    const duplicate = findDuplicate(assets, hash);
    if (duplicate) {
      // Reuse — no metadata write, no byte write.
      setLastId(duplicate.id);
      return;
    }

    const id = crypto.randomUUID();
    const asset: DocumentAsset = {
      id,
      name: file.name,
      mime: processed.image.mime,
      size: processed.image.bytes.length,
      width: processed.size.width,
      height: processed.size.height,
      hash,
      createdAt: new Date().toISOString(),
    };

    // METADATA FIRST — see the file header. Do not reorder this against the
    // byte write below without re-running the mutation check that pins it
    // (use-document-assets.test.ts, "commits the metadata row BEFORE writing
    // the bytes").
    setAssets([...assets, asset]);
    setLastId(id);

    setBusyId(id);
    try {
      await saveAssetData(config, { id, projectId, data: bytesToBase64(processed.image.bytes) });
    } catch {
      // The metadata row stays — that IS the dangling case: visible,
      // self-describing, repaired by re-uploading over the same id.
      setError("storageWrite");
    } finally {
      setBusyId(null);
    }
  }, [assets, setAssets, config, projectId]);

  const rename = useCallback((id: string, name: string) => {
    const idx = assets.findIndex((a) => a.id === id);
    if (idx < 0) return;
    setAssets(assets.map((a) => (a.id === id ? { ...a, name } : a)));
  }, [assets, setAssets]);

  const remove = useCallback((id: string) => {
    setAssets(assets.filter((a) => a.id !== id));
    // Best-effort byte cleanup. A leftover byte row with no metadata
    // referencing it is inert and never surfaced — unlike a metadata row
    // with no bytes (the dangling case), this direction has no user-visible
    // consequence, so a failure here is not reported as an upload error.
    void deleteAssetData(config, id, projectId).catch(() => {});
  }, [assets, setAssets, config, projectId]);

  return { upload, remove, rename, danglingIds, busyId, error, lastId };
}
