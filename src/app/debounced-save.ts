// src/app/debounced-save.ts
//
// The save effect's debounce + flush-on-hide lifecycle, extracted from
// use-storage-backend.ts so it can be tested without mounting the hook — and to
// keep that file under the 800-line ratchet (docs/open-followups.md §229).
//
// ★ Browser-only (it touches `document`/`window`) but React-free: no hooks, no
//   refs. The caller supplies the already-bound save and owns everything else.

/** The workspace save debounce, in ms. Long enough to coalesce a burst of edits
 *  (typing, a bulk op) into one write, short enough that the flush-on-hide
 *  window below stays small. */
export const SAVE_DEBOUNCE_MS = 500;

/** Debounce `save` by `delayMs`, flushing early if the page is hidden or
 *  unloaded. Returns the cleanup to run when the effect re-runs or unmounts.
 *
 *  ★ `fired` guards against double-firing: once either the debounce timer or a
 *  flush has started the save, later triggers are no-ops. (If the timer already
 *  fired and that save is still in flight, skipping the flush is the simple,
 *  acceptable choice — the in-flight save carries this effect run's workspace
 *  snapshot anyway.)
 *
 *  ★★ Flush-on-hide exists because a pending debounced save would be silently
 *  lost if the user hides or closes the tab within the debounce window.
 *  `visibilitychange` → "hidden" is the primary signal; `pagehide` is the backup
 *  for actual unload/navigation (chosen over `beforeunload`, which is unreliable
 *  with the back/forward cache and is not used elsewhere in this codebase).
 *
 *  ★ The caller must only call this on effect runs that already passed its
 *  hydrated/popout/suppress gates, so the flush obeys the exact same gating as
 *  the debounced save and never fires when no save is pending. */
export function scheduleDebouncedSave(save: () => void, delayMs: number): () => void {
  let fired = false;
  const timer = setTimeout(() => { fired = true; save(); }, delayMs);
  const flush = () => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    save();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
}
