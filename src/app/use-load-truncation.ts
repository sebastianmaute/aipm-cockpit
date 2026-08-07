"use client";
import type React from "react";
import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { logDiag } from "./diagnostics";
import type { StorageBackend, Workspace } from "./storage";

/** What a backend reports about the load it just served — the optional
 *  `StorageBackend.lastLoadTruncation` (`workspace.ts`), published by every
 *  backend and guarded by `backend-truncation-registry.test.ts`. */
export type LoadTruncation = { entries: number; blocks: number } | undefined;

type ShowToast = (kind: "info" | "error" | "success", text: string) => void;

/**
 * The TWO choke points the storage layer routes every load and every
 * best-effort flush through.
 *
 * ★★★ THEY EXIST BECAUSE PER-CALL-SITE PATCHING IS WHAT BROKE THIS. The first
 * cut of the guard reported truncation at ONE of six `backend.load()` call
 * sites and checked `mayCommitAfterTruncation` at ONE of seven write sites, so
 * a project switch both failed to warn AND committed the loss the banner was
 * meant to prevent. Anything that loads or flushes goes through here; nothing
 * in `use-storage-file-ops.ts` / `use-storage-turso-ops.ts` holds a backend it
 * could write to directly (`backend` is deliberately NOT on either deps
 * object). Adding a new load/flush path means adding a call here, not a new
 * conditional at the call site.
 */
export interface TruncationOps {
  /** Record the outcome of a just-finished load. Call after EVERY
   *  `backend.load()` whose workspace is APPLIED to render scope — including
   *  clean ones, because this both raises AND lowers the flag. */
  reportFor: (backend: Pick<StorageBackend, "lastLoadTruncation">) => void;
  /** Best-effort flush of the live workspace to the ACTIVE backend, SKIPPED
   *  while a truncated load is unresolved. Skipping is the safe outcome: the
   *  source still holds the documents that were not loaded, and a flush is by
   *  definition not the user asking to overwrite them. Does not throw for that
   *  reason (a skip is not a failure); a real save error still propagates to
   *  the caller's own handler. */
  flushCurrent: () => Promise<void>;
  /** Write `ws` to `backend` on behalf of an EXPLICIT user action ("store the
   *  project here", "convert to that format"). Returns FALSE when it refused,
   *  so the caller can skip its own success toast and config repoint.
   *
   *  ★★★ IT REFUSES LOUDLY WHERE `flushCurrent` SKIPS SILENTLY, and the split is
   *  the whole design. A pre-switch flush is housekeeping the user never asked
   *  for, so a silent skip costs them nothing they can see. These two are a
   *  CLICK: staying silent would leave a picked file or a converted store that
   *  the user believes holds their project and does not, and `onRequestStorageSwitch`
   *  then repoints the app AT that short copy — the original becomes the
   *  abandoned one. So the refusal re-toasts the truncation counts and the
   *  caller must not report success. */
  guardedWrite: (backend: Pick<StorageBackend, "save">, ws: Workspace) => Promise<boolean>;
}

export interface LoadTruncationGuard {
  /** True while a truncated load is unresolved. Drives the persistent banner —
   *  see the lockout note on `allowTruncatedSave`. */
  loadWasTruncated: boolean;
  /** Lower the flag so saving resumes and the truncated set may be committed.
   *  ★★★ THIS IS THE ONLY WAY OUT AND IT MUST STAY REACHABLE FROM THE UI. The
   *  user CANNOT get under the cap by editing: the excess entries were never
   *  loaded, so the rows that would have to go are precisely the ones that are
   *  not there. Without a visible escape the sticky flag below is a permanent
   *  save lockout — a worse defect than the one §102 is about. */
  allowTruncatedSave: () => void;
  /** True when a save may proceed. */
  mayCommitAfterTruncation: () => boolean;
  /** The choke points — see `TruncationOps`. */
  truncationOps: TruncationOps;
}

/**
 * The §102 guard: an over-cap load truncates the documents array, and the next
 * AUTOMATIC save commits that loss permanently across all six write paths — the
 * excess documents are still in the source file, and writing the truncated set
 * over it destroys them.
 *
 * ★★ STICKY, unlike the `suppressNextSaveRef` it sits beside in
 * `use-storage-backend.ts`. That ref is one-shot and is set by EVERY load, so
 * it structurally cannot protect against this: the truncating load already sets
 * it, it clears on the first debounce cycle, and the loss lands on the NEXT
 * save. This flag stays raised until the user decides.
 *
 * ★★★ WHAT THE STRINGS MAY NOT SAY. Both counts are UPPER BOUNDS, never
 * undercounts, and neither means "the cap cut this much off":
 *   • `entries` counts RAW ARRAY ENTRIES past the cap, not validated documents
 *     (counting real documents would mean sanitizing the whole tail, which is
 *     the denial-of-service the cap exists to refuse).
 *   • `blocks` is `raw.blocks.length - sanitized.blocks.length`, and
 *     `sanitizeDocument` both caps blocks AND drops invalid ones — so a version
 *     with malformed blocks reports them as truncation with nothing capped.
 * So the copy says "could not be opened" (accurate for both causes) and never
 * "were cut off by the limit"; and it says "entries"/"blocks", never
 * "documents".
 *
 * Lives in its own module because `use-storage-backend.ts` sits AT the
 * 800-line ratchet.
 */
export function useLoadTruncation(
  langRef: React.MutableRefObject<Lang>,
  showToast: ShowToast,
  /** Writes the LIVE workspace to the ACTIVE backend. Bound by the caller (it
   *  owns both) and re-supplied every render, so `flushCurrent` can never write
   *  a stale workspace or hit a superseded backend. */
  saveCurrentWorkspace: () => Promise<void>,
): LoadTruncationGuard {
  const [loadWasTruncated, setLoadWasTruncated] = useState(false);
  // ★★★ DEFENSIVE-ONLY, AND DO NOT DESCRIBE IT AS "THE ONE-SHOT BYPASS" — that
  // wording claims it is what re-opens saving, and it is not. What re-opens
  // saving is the STATE going false: `loadWasTruncated` is a dep of the save
  // effect (`use-storage-backend.ts`), so lowering it re-runs the effect with
  // the guard already down, and the handler closures the ops hooks hold are
  // rebuilt on that same render. Measured 2026-08-07 by mutation: replacing the
  // whole of `mayCommitAfterTruncation` with `return !loadWasTruncated` left all
  // 110 tests across the three suites GREEN, so nothing observes this ref today.
  // It is kept for the one shape a test cannot easily stage — a flush reached
  // from a closure captured BEFORE the click, which would otherwise skip a write
  // the user just authorised. Delete it only with that case in hand.
  const allowTruncatedSaveRef = useRef(false);
  /** The counts last reported, so an explicit-action refusal can restate WHY it
   *  refused. Not derivable from the backend at refusal time: the write target
   *  may be a different backend that never served a load (storage conversion). */
  const lastTruncationRef = useRef<{ entries: number; blocks: number } | null>(null);

  const allowTruncatedSave = () => {
    allowTruncatedSaveRef.current = true;
    lastTruncationRef.current = null;
    setLoadWasTruncated(false);
  };

  /** The user-facing sentence for a truncation. ★ Entries dominate when both are
   *  present: losing whole documents is the larger loss and the one the user can
   *  act on. The banner carries the generic message either way. */
  const truncationText = (entries: number, blocks: number): string =>
    entries > 0
      ? t(langRef.current, "documentsTruncatedWarning", entries)
      : t(langRef.current, "documentsTruncatedBlocksWarning", blocks);

  const reportLoadTruncation = (truncation: LoadTruncation) => {
    const entries = truncation?.entries ?? 0;
    const blocks = truncation?.blocks ?? 0;
    if (entries <= 0 && blocks <= 0) {
      // ★★ A CLEAN LOAD LOWERS THE FLAG. It is scoped to the workspace that is
      // loaded RIGHT NOW, and the applied one is fine — leaving it raised
      // blocks saves on a healthy project while the banner asserts ITS
      // documents could not be opened, which is simply false. That is the same
      // invariant every backend already holds for `lastLoadTruncation`
      // (`browser-backend.ts` resets it before any early return, because a
      // stale value is worse than zero); the consumer used to break it.
      // React bails on a no-op `false` → `false`, so the common case costs no
      // render.
      lastTruncationRef.current = null;
      setLoadWasTruncated(false);
      return;
    }
    logDiag("error", "workspace.documentsTruncated", { entries, blocks });
    lastTruncationRef.current = { entries, blocks };
    showToast("error", truncationText(entries, blocks));
    setLoadWasTruncated(true);
  };

  // ★★ Deliberately does NOT touch the caller's L3/B baselines
  // (`prevCollectionCountRef` / `prevRecordCountRef`).
  // ★★★ NOT for the reason an earlier revision gave. It said the last-PERSISTED
  // baseline is still the right comparison point; that premise is false. The
  // truncating load sets `suppressNextSaveRef`, and that branch
  // (`use-storage-backend.ts`, above the guard) syncs BOTH refs and returns
  // before this function is ever consulted — so the baselines in force here are
  // already the post-load IN-MEMORY ones. The conclusion survives the correction
  // on different grounds: a refusal persisted nothing, so re-baselining would
  // silently disarm the mass-deletion guard for the eventual "save anyway",
  // which is the exact moment the data is most at risk.
  const mayCommitAfterTruncation = (): boolean => {
    if (loadWasTruncated && !allowTruncatedSaveRef.current) return false;
    allowTruncatedSaveRef.current = false;
    return true;
  };

  const truncationOps: TruncationOps = {
    reportFor: (backend) => reportLoadTruncation(backend.lastLoadTruncation),
    flushCurrent: async () => {
      if (!mayCommitAfterTruncation()) {
        // Leave a forensic trail: the skip is invisible at the call site (every
        // flush is best-effort and swallows its own errors), so without this a
        // "my project switch did not save" report has nothing to read.
        logDiag("warn", "storage.flushSkippedAfterTruncation", {});
        return;
      }
      await saveCurrentWorkspace();
    },
    guardedWrite: async (backend, ws) => {
      if (!mayCommitAfterTruncation()) {
        const last = lastTruncationRef.current;
        logDiag("warn", "storage.writeRefusedAfterTruncation", { ...(last ?? {}) });
        // Say it out loud. The caller returns on `false`, so no success toast
        // and no config repoint follow — the user is not left believing a store
        // they just chose holds a project it does not.
        if (last) showToast("error", truncationText(last.entries, last.blocks));
        return false;
      }
      await backend.save(ws);
      return true;
    },
  };

  return { loadWasTruncated, allowTruncatedSave, mayCommitAfterTruncation, truncationOps };
}
