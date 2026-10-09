// src/app/use-storage-banner-reshow.ts
//
// task-manager's re-show of the three saving-paused banners: each render-time
// reconcile clears a banner's dismissal when a NEW cause arrives — a new
// incomplete load (truncation, decode failure or malformed quotes), a new
// refused destructive save, a new §586/§587 load pause. Extracted from
// task-manager.tsx (§491); move-only.
//
// ★ The three `*BannerDismissed` flags stay owned by task-manager. Their setters
// are also called by `onRevealSavingPaused`, which task-manager hands INTO
// `useStorageBackend` — the hook whose outputs are this hook's inputs — so a
// hook called after it cannot own them. The setters arrive as deps; calling
// them here is still a render-phase update of task-manager's own state, which
// is what the code did inline. Nothing here is memoized, and nothing was.
"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { useStorageBackend } from "./use-storage-backend";

type StorageBackendApi = ReturnType<typeof useStorageBackend>;

export type StorageBannerReshowDeps = Pick<
  StorageBackendApi,
  "truncation" | "decodeFailureNonce" | "malformedQuotesNonce" | "destructiveRefusal" | "loadPause"
> & {
  setTruncationBannerDismissed: Dispatch<SetStateAction<boolean>>;
  setDestructiveBannerDismissed: Dispatch<SetStateAction<boolean>>;
  setLoadPauseBannerDismissed: Dispatch<SetStateAction<boolean>>;
};

export function useStorageBannerReshow(deps: StorageBannerReshowDeps): void {
  const {
    truncation, decodeFailureNonce, malformedQuotesNonce, destructiveRefusal, loadPause,
    setTruncationBannerDismissed, setDestructiveBannerDismissed, setLoadPauseBannerDismissed,
  } = deps;

  // ★★ Render-time reconcile, NOT an effect (`set-state-in-effect` is banned): a NEW
  // incomplete load re-shows the banner after a dismiss (the ONLY "Save anyway" surface).
  // ★ Keyed on the counts OBJECT — the boolean never lowers between two truncated loads.
  // ★★★ AND ON THE DECODE NONCE, because the guard has TWO causes and the object
  // covers only one: on the decode path `truncation` is `null` throughout, so a
  // key made of it alone never moves and project #2's banner arrives ALREADY
  // DISMISSED with saving paused and nothing on screen saying so. The nonce and
  // not `decodeFailureCount`: a count compares equal when two projects fail the
  // same NUMBER of slices, which reads as fixed while the defect survives.
  const [truncationSeen, setTruncationSeen] = useState<typeof truncation>(null);
  // ★ Seeded with the guard's OWN starting value, not with the live one. The
  // guard mounts in this same render (task-manager calls `useStorageBackend`,
  // which owns it, just before this hook), so 0 is what it really is here — and seeding from the live value is the
  // remount-swallow shape, where a fresh mount sees `value === seed` and drops a
  // pending report.
  const [decodeNonceSeen, setDecodeNonceSeen] = useState(0);
  // ★★★ AND ON THE MALFORMED NONCE, for the THIRD cause and by the identical
  // argument: on the import path `truncation` is null and `decodeFailureNonce`
  // never moves, so a key made of those two alone cannot see a malformed-only
  // load at all — project #2's banner arrives already dismissed with saving
  // paused. The comment above records this exact defect being fixed once for the
  // decode cause; adding a third cause to `loadWasIncomplete` without extending
  // this key reintroduced it.
  const [malformedNonceSeen, setMalformedNonceSeen] = useState(0);
  if (
    truncation !== truncationSeen ||
    decodeFailureNonce !== decodeNonceSeen ||
    malformedQuotesNonce !== malformedNonceSeen
  ) {
    setTruncationSeen(truncation);
    setDecodeNonceSeen(decodeFailureNonce);
    setMalformedNonceSeen(malformedQuotesNonce);
    setTruncationBannerDismissed(false);
  }

  // ★★ Render-time reconcile for the destructive-save refusal banner, keyed on the refusal OBJECT. Why
  // the object key, the reset to null and the null seed: docs/AGENTS/storage.md, "The destructive-refusal banner's dismissal".
  const [destructiveRefusalSeen, setDestructiveRefusalSeen] = useState<typeof destructiveRefusal>(null);
  if (destructiveRefusal !== destructiveRefusalSeen) {
    setDestructiveRefusalSeen(destructiveRefusal);
    setDestructiveBannerDismissed(false);
  }
  // ★ Same render-time reconcile for the §586/§587 LOAD pause: a NEW pause (or a new reason) re-shows
  // a banner dismissed for an earlier one. Seeded null for the remount-swallow reason above.
  const [loadPauseSeen, setLoadPauseSeen] = useState<typeof loadPause>(null);
  if (loadPause !== loadPauseSeen) {
    setLoadPauseSeen(loadPause);
    setLoadPauseBannerDismissed(false);
  }
}
