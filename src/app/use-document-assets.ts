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
// `data-dangling-marker`). The metadata row is deliberately left in place on a
// byte-write failure — no rollback — because that row is what makes the
// failure visible at all.
//
// ★★★ THE DANGLING ROW IS REPAIRED BY RE-UPLOADING THE SAME IMAGE, AND THAT
// ONLY BECAME TRUE IN THIS RELEASE (§212, candidate (a) — CLOSED). Three
// earlier notes in this file asserted the repair while the dedup short-circuit
// in `upload` made it unreachable: the dangling row carries the hash of exactly
// those bytes, so `findDuplicate` matched it and returned before any byte write
// was attempted. `upload` now consults `danglingRef` alongside the hash — a
// HEALTHY duplicate still short-circuits, a DANGLING one falls through to the
// byte write REUSING its id. Pinned by use-document-assets.test.tsx's "dangling
// retry (§212)" block; do not narrow that guard back to the hash alone.
//
// ★★★ REUSING THE ID IS NOT ENOUGH TO MAKE A PLACED IMAGE RENDER AGAIN, AND
// THREE PLACES CLAIMED IT WAS. `document-preview.tsx` resolves every
// `<img data-asset-id>` to a blob URL in an effect keyed on
// `[html, documentAssets, tursoConfig, projectId, ...]`, and a repair writes NO
// metadata — so `documentAssets` keeps its identity, `html` is unchanged, that
// effect never re-runs, and the placed image keeps the `data-asset-missing`
// marker it was stamped with. The library row went healthy while the picture in
// the document stayed broken, on the SAME pane. `notifyAssetRepaired` (see
// `document-asset-repairs.ts` for why a module store and not a prop) is what
// closes that, and `attachAssetImages` now CLEARS the stale marker when a
// resolve succeeds — without that the image gets its `src` back and keeps the
// dashed red `img[data-asset-missing]` frame `globals.css` draws around it.
//
// ★★ `busyId` is set only around the byte write (~1.8s measured for a 5MB
// image) — the visible-latency step, not the whole call. `AssetLibrary`
// disables that row's controls while it is set.
//
// ★ Owns its own state (busyId/error/danglingIds) rather than being a
// stateless deps-object hook (the use-storage-file-ops.ts Phase-3 shape) —
// this hook is closer in shape to use-comm-templates.ts: a self-contained
// async CRUD surface over one Turso-backed store, with real logic and real
// tests, so it is NOT in vitest.config.ts's coverage.exclude.
//
// ★★★ EVERY METADATA WRITE IS FUNCTIONAL, AND THE DEDUP READ GOES THROUGH
// `assetsRef`, NEVER THE RENDER-SCOPE `assets`. Three call sites fan N
// concurrent uploads out of ONE render (`asset-library.tsx`'s drop handler and
// documents-asset-section.tsx's paste + drop), so every one of them shares a
// single closure. A `setAssets([...assets, asset])` therefore has all N
// writers computing from the SAME base array and the last write wins — N-1
// metadata rows are lost AFTER their bytes were already written, which is
// exactly the orphan state the METADATA-FIRST ordering above exists to
// prevent. This is the repo's documented "N saves in one tick" landmine
// (AGENTS.md, per-entity CRUD hooks: "Every save handler is a FUNCTIONAL
// setter"). `commitAssets` below is the single write path and it is the only
// thing that may call `setAssets`.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DocumentAsset } from "./document-asset";
import {
  checkUploadCandidate, processUpload, hashBytes, findDuplicate,
  bytesToBase64, type ImageEncoder, type UploadRejection, type PixelSize, type EncodedImage,
} from "./document-asset-upload";
import { saveAssetData, deleteAssetData, loadAssetDataIds } from "./document-assets-store";
import { notifyAssetRepaired } from "./document-asset-repairs";
import type { TursoConfig } from "./turso-config";

export type UploadError = UploadRejection | "storageWrite";

export interface UseDocumentAssetsDeps {
  config: TursoConfig | null;
  assets: readonly DocumentAsset[];
  /** ★★ The FULL `SetStateAction` form, matching what `workspace-context.tsx`
   *  actually supplies (`setDocumentAssets`). Narrowing this to
   *  `(next: readonly DocumentAsset[]) => void` compiles — a value-only setter
   *  is assignable to it — but it discards the functional form and with it the
   *  only way concurrent writers can compose. See the header. */
  setAssets: Dispatch<SetStateAction<readonly DocumentAsset[] | undefined>>;
  projectId: string;
  /** ★★ Arms the one-shot destructive-save bypass (see `use-storage-backend.ts`)
   *  on `remove`. `documentAssets` counts toward `workspaceRecordCount`, so
   *  removing several inside one save-debounce window is a mass deletion by
   *  Layer B's arithmetic.
   *  ★★★ THE WINDOW IS NARROWER THAN THIS COMMENT USED TO CLAIM. It said an
   *  "ordinary click-per-second burst coalesces into one save", which the
   *  constant contradicts: `SAVE_DEBOUNCE_MS` is 500 and the debounce is
   *  TRAILING, so a click at t=0 fires its save at t=500, BEFORE a click at
   *  t=1000 arrives — one-per-second clicks each get their own save and each
   *  advances the committed baseline. Coalescing needs changes CLOSER TOGETHER
   *  than 500ms. The arming still earns its place: a genuinely fast burst does
   *  coalesce, and the AI `delete_document` route (`use-document-tools.ts`)
   *  coalesces unambiguously: `chat-panel.tsx` runs every tool_use block of one
   *  response in a single loop with no model round-trip between, and each block
   *  is a local mutation.
   *  ★ Say that as the LOOP SHAPE, not "one tick" — each block is `await`ed, so
   *  consecutive blocks are separated by microtask turns rather than sharing a
   *  React batch. "Closer together than 500ms" is all the argument needs, and
   *  it holds by orders of magnitude.
   *  Optional: the pane renders in contexts (tests, popouts) that supply no
   *  bypass at all. */
  allowDestructiveSave?: () => void;
}

export interface UseDocumentAssetsResult {
  /** ★★ Resolves to the asset the caller should use: the newly minted row, the
   *  EXISTING row on a dedup hit, or `null` when the upload was rejected. The
   *  paste/drop insert path reads this directly rather than waiting for a
   *  state round trip — a re-render cannot be relied on to fire at all (a
   *  dedup hit re-commits an unchanged id, which React bails out of), and the
   *  returned row also carries the `name` an insert needs, which a freshly
   *  captured `assets` closure would not yet hold. */
  upload: (file: File) => Promise<DocumentAsset | null>;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  /** Ids whose metadata exists but whose bytes do not, per the last diff
   *  against the byte store. */
  danglingIds: ReadonlySet<string>;
  /** Id currently mid byte-write; that row's controls disable. */
  busyId: string | null;
  error: UploadError | null;
}

/** The one browser-only step, injected so document-asset-upload.ts's
 *  arithmetic stays testable in jsdom (which has no canvas). Production calls
 *  this; the `upload` fixtures never reach it, because they never trigger a
 *  downscale (target size == source size for a small header-only image).
 *
 *  ★ EXPORTED FOR ITS OWN TEST ONLY — nothing else imports it. jsdom has no
 *  canvas, so the only way to pin the mime rule below is to call this directly
 *  against stubbed `createImageBitmap`/`getContext`/`toBlob`; reaching it
 *  through `upload` would need a fixture big enough to downscale AND a working
 *  canvas. */
export const encodeViaCanvas: ImageEncoder = async (
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
  // ★★ REPORT THE MIME THE BLOB ACTUALLY IS, never the one we asked for.
  // `canvas.toBlob` falls back to image/png SILENTLY for a type it cannot
  // encode, and the fallback is still allow-listed downstream — so returning
  // the requested `mime` stores a row that misdescribes its own bytes and the
  // export sink emits a `data:` URI with the wrong media type. `|| mime` only
  // covers the spec-legal empty-string case.
  return { bytes: new Uint8Array(await outBlob.arrayBuffer()), mime: outBlob.type || mime };
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
  const { config, assets, setAssets, projectId, allowDestructiveSave } = deps;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [danglingIds, setDanglingIds] = useState<ReadonlySet<string>>(new Set());

  // ★★★ A MIRROR OF THE COMMITTED LIST, for the async continuations below.
  // `upload` awaits three times before it decides anything, so the
  // render-scope `assets` it closed over is already history by the time the
  // hash lands — that staleness is what makes two identical files dropped
  // together BOTH mint an id. Synced from the prop after each commit (an
  // effect, not a render-body write, so nothing here reads or writes a ref
  // during render) AND written straight through by `commitAssets`, which is
  // what lets a second upload later in the SAME tick see the first one's row
  // before React has re-rendered.
  const assetsRef = useRef<readonly DocumentAsset[]>(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  /** The ONLY writer of `setAssets`. Applies `fn` functionally so N concurrent
   *  writers compose instead of clobbering, and mirrors the same result
   *  locally for the in-tick reads above.
   *
   *  ★★ `fn` MUST BE PURE — it runs once against the mirror, once in the state
   *  updater, and React double-invokes the updater under StrictMode
   *  (`src/app/strictmode.meta.test.tsx`). Never put a setState, a mint, or
   *  any other effect inside one. */
  const commitAssets = useCallback(
    (fn: (prev: readonly DocumentAsset[]) => readonly DocumentAsset[]) => {
      assetsRef.current = fn(assetsRef.current);
      setAssets((prev) => fn(prev ?? []));
    },
    [setAssets],
  );

  // ★★ A MIRROR OF `danglingIds`, for the same reason `assetsRef` mirrors the
  // list: `upload` awaits three times before it consults the set, so the
  // render-scope value it closed over is already history. Taking `danglingIds`
  // into `upload`'s dep list instead would mint a NEW `upload` on every diff
  // while the fan-out call sites still hold the one they captured — trading a
  // stale read for a stale callback.
  const danglingRef = useRef<ReadonlySet<string>>(danglingIds);
  useEffect(() => {
    danglingRef.current = danglingIds;
  }, [danglingIds]);

  /** The only writer of `setDanglingIds` outside the diff effect below, and the
   *  same shape as `commitAssets`: `fn` MUST BE PURE — it runs once against the
   *  mirror and once in the state updater, which React double-invokes under
   *  StrictMode. Returning `prev` unchanged is what keeps a no-op clear from
   *  re-rendering. */
  const commitDangling = useCallback(
    (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => {
      danglingRef.current = fn(danglingRef.current);
      setDanglingIds(fn);
    },
    [],
  );

  // ★★★ §213 — WHY A BARE "ids this session wrote" SET IS NOT ENOUGH, AND THE
  // REGISTER'S OWN CANDIDATE WAS ONE. `upload` commits metadata BEFORE the
  // bytes, so the `assets` change arms the diff below while `saveAssetData` is
  // still in flight. If the save resolves first and the load second, the diff
  // REPLACES the whole set and discards the clear — and nothing re-runs it,
  // because none of its deps changed again. Suppressing every id this session
  // wrote closes that and opens a worse hole: the id stays suppressed for the
  // rest of the session, so a byte row that later vanishes (§207 desync,
  // another tab, a failed remove) would read HEALTHY forever — a false "fine"
  // in place of a false "broken", which is the worse direction because the user
  // is given no signal at all. Keying on a monotonic epoch makes the
  // suppression SELF-EVICTING: it holds only for a diff whose snapshot predates
  // the write, which is precisely the race and nothing else.
  const writtenRef = useRef<Map<string, number>>(new Map());
  const epochRef = useRef(0);

  // ★★★ `react-hooks/set-state-in-effect` is BANNED and fatal. The diff runs
  // in the effect's ASYNC CONTINUATION, never synchronously in the effect
  // body — mirrors use-comm-templates.ts's load effect. `cancelled` guards
  // against the result landing after unmount or after a newer run started.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      // ★ CAPTURED BEFORE THE AWAIT. After it, a write that raced this diff has
      // already bumped the epoch and every comparison below would be inert.
      const startEpoch = epochRef.current;
      try {
        const presentIds = await loadAssetDataIds(config, projectId);
        if (cancelled) return;
        const present = new Set(presentIds);
        const next = new Set<string>();
        for (const a of assets) {
          if (present.has(a.id)) continue;
          // Bytes written AFTER this diff's snapshot began cannot appear in its
          // result, so their absence here is not evidence of anything.
          const wroteAt = writtenRef.current.get(a.id);
          if (wroteAt !== undefined && wroteAt > startEpoch) continue;
          next.add(a.id);
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

  const upload = useCallback(async (file: File): Promise<DocumentAsset | null> => {
    setError(null);

    const candidate = checkUploadCandidate(file);
    if (!candidate.ok) {
      setError(candidate.reason);
      return null;
    }

    const raw = new Uint8Array(await file.arrayBuffer());
    const processed = await processUpload(raw, file.type, encodeViaCanvas);
    if (!processed.ok) {
      setError(processed.reason);
      return null;
    }

    const hash = await hashBytes(processed.image.bytes);
    // ★ `assetsRef.current`, NOT `assets` — see the ref's own note. Reading the
    // closure here is what makes two identical files pasted at once mint two
    // rows for one image.
    const duplicate = findDuplicate(assetsRef.current, hash);
    // ★★★ THE DANGLING CONDITION IS LOAD-BEARING (§212). `findDuplicate` matches
    // on hash alone, and a dangling row carries the hash of exactly the bytes
    // whose write failed — so on the hash alone this branch swallowed the retry
    // of every asset it was supposed to make repairable. A HEALTHY duplicate
    // still returns here with no metadata write and no byte write; a DANGLING
    // one falls through to the byte write below.
    if (duplicate && !danglingRef.current.has(duplicate.id)) {
      return duplicate;
    }

    // The dangling duplicate IS the retry target. Its metadata row already
    // exists, so nothing may be appended, and its id must not change: a fresh
    // id would repair the library while orphaning every `<img data-asset-id>`
    // already placed in a document.
    const retryOf = duplicate;
    const asset: DocumentAsset = retryOf ?? {
      id: crypto.randomUUID(),
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
    if (!retryOf) commitAssets((prev) => [...prev, asset]);

    setBusyId(asset.id);
    try {
      await saveAssetData(config, { id: asset.id, projectId, data: bytesToBase64(processed.image.bytes) });
      // §213 — record the write against a monotonic epoch. Any diff whose
      // snapshot began earlier cannot have observed these bytes, so it must not
      // conclude this id is dangling. Recorded only on SUCCESS: a failed write
      // IS the dangling case and must stay visible.
      epochRef.current += 1;
      writtenRef.current.set(asset.id, epochRef.current);
      // ★★★ CLEAR THE ID EXPLICITLY — NOTHING ELSE WILL. The diff effect that
      // builds `danglingIds` is keyed on `assets`, and a repair writes NO
      // metadata, so a successful retry leaves that effect dormant and the row
      // marked dangling for bytes that now exist. (A set-state in an effect
      // BODY is a fatal lint error here; this is an async continuation of a
      // callback, which is fine.)
      // ★★ READ BEFORE THE CLEAR — `commitDangling` writes the mirror through,
      // so asking afterwards always answers "no". This is the ONE condition
      // that means "bytes changed but metadata did not": every other successful
      // write appends or rewrites a row, which every consumer already watches.
      const wasDangling = danglingRef.current.has(asset.id);
      commitDangling((prev) => {
        if (!prev.has(asset.id)) return prev;
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
      // ★★★ THE ONLY THING THAT MAKES AN ALREADY-PLACED IMAGE RENDER AGAIN —
      // see the file header. Deliberately NOT fired for a first-time upload:
      // that commits metadata, which re-runs the preview's resolve effect on
      // its own, and firing here too would revoke and re-mint every blob URL in
      // the document a second time for nothing.
      if (wasDangling) notifyAssetRepaired();
    } catch {
      // The metadata row stays — that IS the dangling case: visible,
      // self-describing, and repairable by re-uploading the same image, which
      // now lands back on this same id (see the dedup branch above).
      setError("storageWrite");
    } finally {
      setBusyId(null);
    }
    // ★ Returned even after a failed byte write, deliberately: the row exists
    // and the library marks it dangling. Returning null instead would silently
    // drop a paste/drop insert while the row it refers to is sitting right
    // there in the library. ★ On a retry this is the EXISTING row, id and all,
    // so a caller re-inserting it points at the placement it already had.
    return asset;
  }, [commitAssets, commitDangling, config, projectId]);

  const rename = useCallback((id: string, name: string) => {
    if (!assetsRef.current.some((a) => a.id === id)) return;
    commitAssets((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
  }, [commitAssets]);

  // ★★ A MIRROR, for the SAME reason `use-bulk-operations.ts` keeps one:
  // `remove` is handed to `AssetLibrary` as `onDelete`, so an unstable entry in
  // its dep list re-mints it on every render of the whole tree. The ref keeps
  // the dep list stable while the call below still reads the LIVE callback.
  // Synced in an effect, never during render.
  // ★★ THE ORIGINAL REASON NO LONGER HOLDS, and the mirror is kept anyway.
  // This said the producer "re-creates this arrow every render"; 0.264.1 made
  // `allowDestructiveSave` a `useCallback(…, [])` in `use-storage-backend.ts`,
  // so it is now identity-stable at that one producer. Reproduce:
  //   grep -n "const allowDestructiveSave" src/app/use-storage-backend.ts
  // The prop is OPTIONAL and typed as a bare callback, so nothing stops a
  // second caller passing an unstable one — the mirror is now defence against
  // that rather than against a known-unstable producer. Do not read the
  // stability as a licence to inline the callback into the dep list.
  const allowDestructiveSaveRef = useRef(allowDestructiveSave);
  useEffect(() => {
    allowDestructiveSaveRef.current = allowDestructiveSave;
  }, [allowDestructiveSave]);

  const remove = useCallback((id: string) => {
    // ★★ Arm the one-shot destructive-save bypass. documentAssets now counts
    //    toward workspaceRecordCount, so removing several in one debounce
    //    window is a mass deletion by Layer B's arithmetic — and this IS the
    //    explicit user action the bypass exists for (the caller confirms each
    //    delete before reaching here).
    allowDestructiveSaveRef.current?.();
    commitAssets((prev) => prev.filter((a) => a.id !== id));
    // Best-effort byte cleanup. A leftover byte row with no metadata
    // referencing it is inert and never surfaced — unlike a metadata row
    // with no bytes (the dangling case), this direction has no user-visible
    // consequence, so a failure here is not reported as an upload error.
    void deleteAssetData(config, id, projectId).catch(() => {});
  }, [commitAssets, config, projectId]);

  return { upload, remove, rename, danglingIds, busyId, error };
}
