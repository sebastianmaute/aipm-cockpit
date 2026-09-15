"use client";

// Listens for the desktop shell's Help -> Version menu event and opens the
// app's own Version modal with the log path the main process reported.
//
// ★ MOUNTED ONCE, AT THE TASK-MANAGER ROOT, not inside ModernShell or the
// classic tree. TaskManagerInner is a SINGLE component instance regardless of
// isPopout / settings.layout -- it merely picks which JSX tree to RETURN -- so
// calling this hook unconditionally there, and rendering its VersionInfoModal
// from `modalsBlock` (included in the classic tree, the popout tree, AND the
// modern tree), covers all three without threading a prop through
// ModernShell/Sidebar or duplicating the listener per layout.
//
// ★★ A SEPARATE VersionInfoModal INSTANCE, deliberately not a lift of
// modern-shell.tsx's own `versionOpen` state. That state is ALREADY not
// singular: settings-view.tsx's footer button owns its own independent
// `showVersion` boolean and its own <VersionInfoModal> today, coexisting with
// modern-shell's. `Modal` renders nothing at all while `open` is false (see
// modal.tsx's early `if (!open) return null`), so a third independently-owned
// instance costs nothing when closed and follows the pattern the other two
// already established, rather than threading `versionOpen`/`onShowVersion`
// down through ModernShell (which the classic tree and popout do not even
// have a slot for).
//
// ★ react-hooks/set-state-in-effect is fatal, but it targets state set
// SYNCHRONOUSLY in an effect's own body. Setting state from an event-listener
// CALLBACK that the effect merely registers is a different shape and is fine
// -- the same shape task-manager.tsx's own
// "aipm-cockpit-settings-write-failed" / "aipm-cockpit-secret-unreadable"
// window listeners already use.
import { useEffect, useState } from "react";
import { DESKTOP_VERSION_REQUEST_EVENT } from "./desktop-shell";

export interface DesktopVersionRequestState {
  open: boolean;
  /** The launch-log path from the most recent request, if the event carried
   *  one. Sticky across a close/reopen within the same page load -- there is
   *  no reason to blank it, and the desktop main process always sends it. */
  logPath: string | undefined;
  onClose: () => void;
}

export function useDesktopVersionRequest(): DesktopVersionRequestState {
  const [open, setOpen] = useState(false);
  const [logPath, setLogPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    function onVersionRequest(e: Event): void {
      // `detail` crosses a CustomEvent boundary, so it arrives UNTYPED --
      // narrow it defensively rather than trusting the main process's shape.
      const detail = (e as CustomEvent<unknown>).detail;
      const path =
        typeof detail === "object" && detail !== null && "logPath" in detail
          ? (detail as { logPath?: unknown }).logPath
          : undefined;
      setLogPath(typeof path === "string" ? path : undefined);
      setOpen(true);
    }
    window.addEventListener(DESKTOP_VERSION_REQUEST_EVENT, onVersionRequest);
    return () => window.removeEventListener(DESKTOP_VERSION_REQUEST_EVENT, onVersionRequest);
  }, []);

  return { open, logPath, onClose: () => setOpen(false) };
}
