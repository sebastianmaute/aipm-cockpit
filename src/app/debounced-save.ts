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
 *  hydrated/popout/load/suppress gates, so the flush obeys the exact same gating as
 *  the debounced save and never fires when no save is pending.
 *
 *  ★★★ §589 — `shouldFlushOnCleanup` IS A THIRD EXIT, AND IT IS OPTIONAL SO THAT OMITTING IT
 *  LEAVES BEHAVIOUR BYTE-IDENTICAL TO BEFORE IT EXISTED. The cleanup used to clear the timer and
 *  drop the listeners without flushing, which is right for the cleanup React runs on an ORDINARY
 *  dep change: the effect immediately re-schedules against the newer workspace, so flushing there
 *  would write every keystroke and destroy the coalescing this whole module exists for. It is
 *  WRONG for a cleanup caused by the save TARGET changing, because then nothing re-schedules
 *  against the old backend and the pending edit is simply lost.
 *
 *  ★★ The predicate exists because a cleanup cannot work out which of those two it is: React
 *  passes no reason, and this closure holds only the timer, the flush and the two listeners. Only
 *  the caller can answer "did the BACKEND change?", so only the caller may decide — see
 *  use-storage-backend.ts's save effect, which passes `backendRef.current !== backend`.
 *
 *  ★★ All THREE exits — the timer, the hide/unload `flush`, and the cleanup flush — reach the
 *  caller's save through the ONE `save` argument and nothing else. That is why
 *  use-storage-backend.ts's §586 load gate sits inside the `save` it passes (`doSave`): one check
 *  there covers the debounced write, the flush-on-hide AND this. Do NOT add a second gate check
 *  here — it would be a different question asked in the same words.
 *
 *  @param shouldFlushOnCleanup Consulted ONLY on cleanup, and only its strict `true` flushes; an
 *  absent predicate, `undefined` or `false` all cancel as before. */
export function scheduleDebouncedSave(
  save: () => void,
  delayMs: number,
  shouldFlushOnCleanup?: () => boolean,
): () => void {
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
    // ★ §589 — order is not arbitrary: `flush` clears the timer itself and sets `fired`, so the
    //   `clearTimeout` below is a no-op after a flush and the timer can never fire twice. Putting
    //   `clearTimeout` first would work too; putting the flush AFTER the listener removals would
    //   not change behaviour either, but keeping the one line that can still CALL `save` at the
    //   top keeps the reading order "decide, then dismantle".
    if (shouldFlushOnCleanup?.() === true) flush();
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
}
