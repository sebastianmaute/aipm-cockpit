"use client";
import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { logDiag } from "./diagnostics";

/** What a backend reports about the load it just served — the optional
 *  `StorageBackend.lastLoadTruncation` (`workspace.ts`), published by every
 *  backend and guarded by `backend-truncation-registry.test.ts`. */
export type LoadTruncation = { entries: number; blocks: number } | undefined;

type ShowToast = (kind: "info" | "error" | "success", text: string) => void;

export interface LoadTruncationGuard {
  /** True while a truncated load is unresolved. Drives the persistent banner —
   *  see the lockout note on `allowTruncatedSave`. */
  loadWasTruncated: boolean;
  /** Arm a one-shot bypass so the NEXT save may commit a truncated load, and
   *  lower the flag.
   *  ★★★ THIS IS THE ONLY WAY OUT AND IT MUST STAY REACHABLE FROM THE UI. The
   *  user CANNOT get under the cap by editing: the excess entries were never
   *  loaded, so the rows that would have to go are precisely the ones that are
   *  not there. Without a visible escape the sticky flag below is a permanent
   *  save lockout — a worse defect than the one §100 is about. */
  allowTruncatedSave: () => void;
  /** Record the outcome of a just-finished load: diagnose + toast + raise the
   *  flag when the backend reported truncation. A no-op otherwise. */
  reportLoadTruncation: (truncation: LoadTruncation, lang: Lang, showToast: ShowToast) => void;
  /** True when a save may proceed. Consumes the one-shot bypass when it does. */
  mayCommitAfterTruncation: () => boolean;
}

/**
 * The §100 guard: an over-cap load truncates the documents array, and the next
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
export function useLoadTruncation(): LoadTruncationGuard {
  const [loadWasTruncated, setLoadWasTruncated] = useState(false);
  const allowTruncatedSaveRef = useRef(false);

  const allowTruncatedSave = () => {
    allowTruncatedSaveRef.current = true;
    setLoadWasTruncated(false);
  };

  const reportLoadTruncation = (truncation: LoadTruncation, lang: Lang, showToast: ShowToast) => {
    const entries = truncation?.entries ?? 0;
    const blocks = truncation?.blocks ?? 0;
    if (entries <= 0 && blocks <= 0) return;
    logDiag("error", "workspace.documentsTruncated", { entries, blocks });
    // ★ Entries dominate when both are present: losing whole documents is the
    // larger loss and the one the user can act on. The banner carries the
    // generic message either way.
    showToast(
      "error",
      entries > 0
        ? t(lang, "documentsTruncatedWarning", entries)
        : t(lang, "documentsTruncatedBlocksWarning", blocks),
    );
    setLoadWasTruncated(true);
  };

  // ★★ Deliberately does NOT touch the caller's L3/B baselines
  // (`prevCollectionCountRef` / `prevRecordCountRef`). This is a REFUSAL, not an
  // apply: nothing was persisted, so the last-persisted baseline is still the
  // right comparison point. Re-baselining here would silently disarm the
  // mass-deletion guard for the eventual "save anyway" — the exact moment the
  // data is most at risk. (The suppress-after-load branch beside it DOES sync
  // them, correctly: a load genuinely changes what "current" is.)
  const mayCommitAfterTruncation = (): boolean => {
    if (loadWasTruncated && !allowTruncatedSaveRef.current) return false;
    allowTruncatedSaveRef.current = false; // consume the one-shot bypass
    return true;
  };

  return { loadWasTruncated, allowTruncatedSave, reportLoadTruncation, mayCommitAfterTruncation };
}
