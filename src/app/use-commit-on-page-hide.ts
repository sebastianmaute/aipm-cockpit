// src/app/use-commit-on-page-hide.ts — §622: commit a local draft on a real unload.
//
// ★★★ A draft that lives only in component state is LOST on a window close,
//  reload or navigation: none of them runs React cleanup, so an unmount flush
//  never fires, and a blur never happens. `pagehide` is the one signal all
//  three send. Every editor that holds a draft until blur registers its commit
//  here (§622, and the dashboard narrative).
// ★★★ NOT `visibilitychange` → hidden, by OWNER DECISION (§185, 2026-09-27):
//  that signal is also a tab switch or a minimise, which must keep the draft.
// ★★ `flushSync` IS THE ORDERING: the workspace save captures its snapshot per
//  effect run, so the commit must re-render the provider and re-run the save
//  effect INSIDE this event. That re-run is written at once because
//  debounced-save.ts knows the page is hiding (`pageHiding`).
// ★ A plain bubble listener on purpose. jsdom (unlike Chromium) invokes a
//  bubble listener that a CAPTURE listener adds at the target, so a capture
//  listener would let tests pass through the save's re-armed listener, which
//  the browser never calls, and hide a broken `pageHiding`.
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** Run `commit` synchronously on every `pagehide` while mounted. The latest
 *  `commit` is used, so it may close over render state. */
export function useCommitOnPageHide(commit: () => void): void {
  const commitRef = useRef(commit);
  useEffect(() => {
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
