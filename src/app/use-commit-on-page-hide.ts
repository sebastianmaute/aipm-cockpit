// src/app/use-commit-on-page-hide.ts — §622: commit a local draft on a real unload.
//
// ★★★ A draft that lives only in component state is LOST on a window close,
//  reload or navigation: none of them runs React cleanup, so an unmount flush
//  never fires, and a blur never happens. `pagehide` is the one signal all
//  three send. Editors whose blur commit is a synchronous state write register
//  it here, including the shared draft hooks `useBlockDraft`,
//  `useInlineCellEdit` and `useCommitDraft` (§622; register §625 lists every
//  editor classified). An editor that commits
//  asynchronously (a fetch, a Promise, a WebCrypto seal) cannot be made safe by
//  this hook: it only STARTS the commit, and nothing guarantees it lands after
//  unload. Register §626 names the three editors that therefore do not register.
// ★★★ WHAT THIS HOOK GUARANTEES ENDS AT THE COMMIT. The draft is COMMITTED and
//  the workspace save it triggers is STARTED on `pagehide`; that save is itself
//  asynchronous on every workspace backend (FS-Access writable, fetch without
//  `keepalive`, IndexedDB transaction). Measured in Chromium on the default
//  backend (IndexedDB) by e2e/pagehide-draft-persist.spec.ts: the save lands
//  when the page outlives the event, and does NOT land on a real reload. So on
//  a real unload the draft is still lost there; that, and every other backend
//  and the packaged desktop app, is §629.
// ★★★ NOT `visibilitychange` → hidden, by OWNER DECISION (§185, 2026-09-27):
//  that signal is also a tab switch or a minimise, which must keep the draft.
// ★★ `flushSync` IS THE ORDERING: the workspace save captures its snapshot per
//  effect run, so the commit must re-render the provider and re-run the save
//  effect INSIDE this event. When the commit changes the workspace, that re-run
//  STARTS its save at once, because debounced-save.ts knows the page is hiding
//  (`pageHiding`).
// ★ A plain bubble listener on purpose. jsdom (unlike Chromium) invokes a
//  bubble listener that a CAPTURE listener adds at the target, so a capture
//  listener would let tests pass through the save's re-armed listener, which
//  the browser never calls, and hide a broken `pageHiding`.
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** Run `commit` synchronously on every `pagehide` while mounted. The latest
 *  `commit` is used, so it may close over render state. */
export function useCommitOnPageHide(commit: () => void): void {
  const commitRef = useRef(commit);
  // ★★ A LAYOUT effect, not a passive one: passive effects may run in a later
  //  task than the commit, and a `pagehide` landing between the two would call
  //  the PREVIOUS render's closure (the narrative's `commitNarrative` closes over
  //  the render-time draft, so the last keystroke would be dropped). Layout
  //  effects run before the browser can dispatch another event.
  useLayoutEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const onPageHide = () => {
      flushSync(() => commitRef.current());
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
