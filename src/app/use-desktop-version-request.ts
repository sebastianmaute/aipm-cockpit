"use client";

// Owns the app's ONE Version modal and the desktop shell's route into it.
//
// ★★★ FIX ROUND 1 (M3): THIS HOOK'S <VersionInfoModal> IS NOW THE ONLY ONE
// IN THE WHOLE APP. Task 2 shipped a THIRD independently-owned instance
// beside modern-shell.tsx's `versionOpen` and settings-view.tsx's
// `showVersion`, reasoning that a closed `Modal` renders nothing so a third
// one "costs nothing" -- true when closed, but a desktop request arriving
// while a sidebar- or Settings-opened modal was already open stacked a
// SECOND live modal on top of it (review-2-report.md M3). Both of those
// components' own state and `<VersionInfoModal>` were removed; they now call
// this hook's `openVersion` (threaded down as an `onOpenVersion` prop from
// task-manager.tsx) instead of owning anything. Opening while already open
// is a plain `setOpen(true)` no-op, and a second modal simply cannot exist
// by construction -- there is exactly one render site left
// (task-manager.tsx's `modalsBlock`).
//
// ★ MOUNTED ONCE, AT THE TASK-MANAGER ROOT, not inside ModernShell or the
// classic tree. TaskManagerInner is a SINGLE component instance regardless of
// isPopout / settings.layout -- it merely picks which JSX tree to RETURN -- so
// calling this hook unconditionally there, and rendering its VersionInfoModal
// from `modalsBlock` (included in the classic tree, the popout tree, AND the
// modern tree), covers all three without threading a prop through
// ModernShell/Sidebar or duplicating the listener per layout.
//
// ★★ FIX ROUND 1 (M4): THE LISTENER SIGNALS "HANDLED" VIA `preventDefault()`.
// main.ts's `versionRequestScript` builds a `cancelable: true` CustomEvent and
// its injected script's completion value is `!window.dispatchEvent(ev)` --
// `dispatchEvent` returns `false` only when something called
// `preventDefault()`, so main can tell a real page (this listener exists) from
// a focused window with nobody listening (the PDF/export popup -- M-2,
// final-review-report.md: an "external-link window" no longer exists at
// HEAD; the one other non-app in-app page, the MSAL sign-in popup, is now
// never scripted at all, see I-1 in desktop/src/main.ts) and retry on the
// main window instead of failing silently. Called UNCONDITIONALLY whenever
// this listener runs at all --
// including the `open: false` priming ping below -- because "handled" means
// "a TaskManager page received this", independent of whether it also opened
// the modal.
//
// ★★ FIX ROUND 1 (M3 log-path consistency): THE DESKTOP MAIN PROCESS SENDS
// TWO KINDS OF REQUEST, DISTINGUISHED BY `detail.open`. Once per page load
// (`did-finish-load`, both the main window and every popout -- see the
// `web-contents-created` listener in main.ts) it sends `{ logPath, open:
// false }`: a priming ping that lets this hook remember the log path without
// popping the modal open on every launch. The Help → Version menu click sends
// `{ logPath, open: true }`. Either way `logPath` is remembered (once a valid
// string has arrived, a later malformed/missing one does NOT blank it), so
// the log-path row shows correctly however the sidebar-/Settings-opened
// modal was reached, not only when the menu route itself supplied it.
//
// ★ react-hooks/set-state-in-effect is fatal, but it targets state set
// SYNCHRONOUSLY in an effect's own body. Setting state from an event-listener
// CALLBACK that the effect merely registers is a different shape and is fine
// -- the same shape task-manager.tsx's own
// "aipm-cockpit-settings-write-failed" / "aipm-cockpit-secret-unreadable"
// window listeners already use.
import { useCallback, useEffect, useState } from "react";
import { DESKTOP_VERSION_REQUEST_EVENT } from "./desktop-shell";

export interface DesktopVersionRequestState {
  open: boolean;
  /** The launch-log path from the most recently REMEMBERED request (see the
   *  module docstring: a priming ping counts too). Sticky across close/
   *  reopen and across which trigger opened the modal -- there is no reason
   *  to blank it, and an app-side `openVersion()` call carries none of its
   *  own. */
  logPath: string | undefined;
  /** Opens the SAME modal from ANY React trigger (sidebar version line,
   *  Settings footer) -- a plain state flip, NOT a dispatch of the desktop
   *  DOM event (that belongs to the main process alone; app code dispatching
   *  it would be pretending to be main, for a channel main does not read
   *  anyway). */
  openVersion: () => void;
  onClose: () => void;
}

function readDetail(e: Event): { logPath: string | undefined; open: boolean } {
  // `detail` crosses a CustomEvent boundary, so it arrives UNTYPED -- narrow
  // it defensively rather than trusting the main process's shape.
  const detail = (e as CustomEvent<unknown>).detail;
  const record =
    typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : {};
  return {
    logPath: typeof record.logPath === "string" ? record.logPath : undefined,
    open: record.open === true,
  };
}

export function useDesktopVersionRequest(): DesktopVersionRequestState {
  const [open, setOpen] = useState(false);
  const [logPath, setLogPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    function onVersionRequest(e: Event): void {
      const { logPath: path, open: shouldOpen } = readDetail(e);
      // Only a VALID string overwrites the remembered path -- a malformed or
      // path-less request (there isn't one from main today, but nothing
      // guarantees that forever) must not blank an already-known value.
      if (path !== undefined) setLogPath(path);
      // Tell main this request reached a real listener, whichever kind it
      // was -- see the module docstring (M4).
      e.preventDefault();
      if (shouldOpen) setOpen(true);
    }
    window.addEventListener(DESKTOP_VERSION_REQUEST_EVENT, onVersionRequest);
    return () => window.removeEventListener(DESKTOP_VERSION_REQUEST_EVENT, onVersionRequest);
  }, []);

  const openVersion = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  return { open, logPath, openVersion, onClose };
}
