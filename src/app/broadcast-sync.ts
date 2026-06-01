// Cross-window state sync over BroadcastChannel. Used so an app instance
// opened via the popout button (`?popout=<tab>`) sees task / RAID / absence
// / shift / activity-log mutations from the main window in real time, and
// vice versa.
//
// Design:
// - One channel per origin (`lop-app:sync`). Each instance generates a
//   `clientId` at first message and tags every outgoing message with it,
//   so we can ignore our own echoes on read.
// - Each state slice is identified by a `kind` (`"tasks"`, `"raid"`, ...).
// - Incoming messages are applied via the caller-supplied `applyIncoming`
//   setter. We stash the deserialized value in a ref BEFORE calling it so
//   the broadcast useEffect that fires from the resulting re-render can
//   bail out on reference equality instead of re-broadcasting.
// - When `canSend` is false, this instance receives but never broadcasts —
//   used by popout/mirror windows to stay in sync without pushing state back.

import { useEffect, useRef } from "react";
import type { AppView } from "./nav-config";

const CHANNEL_NAME = "lop-app:sync";

type SyncMessage<T> = {
  clientId: string;
  kind: string;
  value: T;
};

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function useBroadcastSync<T>(
  kind: string,
  value: T,
  applyIncoming: (next: T) => void,
  canSend: boolean = true,
): void {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const clientIdRef = useRef<string>("");
  // The last value we either sent or received. Reference-equal check on the
  // next render lets us skip echoing back a value that was just applied
  // from an incoming message.
  //
  // Initialised to the MOUNT value (not undefined) so the broadcast effect
  // skips the very first run: a freshly-mounted window — especially a pop-out,
  // which boots with empty workspace state — must never broadcast its initial
  // value. Doing so let a pop-out push empty arrays to the main window, which
  // applied them and (as sole writer) persisted the empty workspace, wiping
  // the local file. Only genuine post-mount changes are broadcast.
  const lastSeenRef = useRef<T | undefined>(value);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return;

    if (!clientIdRef.current) clientIdRef.current = newClientId();
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    const onMessage = (ev: MessageEvent<SyncMessage<T>>) => {
      const msg = ev.data;
      if (!msg || msg.clientId === clientIdRef.current || msg.kind !== kind) {
        return;
      }
      lastSeenRef.current = msg.value;
      applyIncoming(msg.value);
    };
    channel.addEventListener("message", onMessage);

    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [kind, applyIncoming]);

  useEffect(() => {
    if (!canSend) return;
    const channel = channelRef.current;
    if (!channel) return;
    // Skip echoing a value that arrived from another window. The incoming
    // handler set lastSeenRef to that exact reference before calling the
    // setter, so reference equality is enough.
    if (Object.is(lastSeenRef.current, value)) return;
    lastSeenRef.current = value;
    const msg: SyncMessage<T> = {
      clientId: clientIdRef.current,
      kind,
      value,
    };
    channel.postMessage(msg);
  }, [kind, value, canSend]);
}

// Tab keys mirror `TopTab` in task-manager.tsx. Kept in sync manually
// because exporting `TopTab` from task-manager.tsx would create a circular
// dep (task-manager.tsx imports this module).
export const POPOUT_TABS = [
  "chat",
  "reports",
  "gantt",
  "raid",
  "resources",
  "activity",
  "resource-report",
  "raid-report",
  "address-book",
  "budget",
  "budget-report",
] as const;
export type PopoutTab = (typeof POPOUT_TABS)[number];

/** Subset of POPOUT_TABS that are read-only "report" surfaces. Used by the
 *  task-manager shell to skip the read-only-mirror banner in popouts where
 *  the banner would be redundant (reports are read-only by their nature). */
export const REPORT_POPOUT_TABS: readonly PopoutTab[] = [
  "resource-report",
  "reports",
  "raid-report",
  "budget-report",
] as const;

/** True for the three report-style popout tabs; false for editing popouts
 *  and `null`. Accepts any AppView (the runtime `.includes` check is safe for
 *  the wider union). */
export function isReportPopoutTab(tab: AppView | null): boolean {
  if (tab === null) return false;
  return (REPORT_POPOUT_TABS as readonly string[]).includes(tab);
}

// Single-slot ref. reuseWindow mode focuses this regardless of which tab opened it.
let _popoutWindowRef: Window | null = null;

export function readPopoutTabFromUrl(): PopoutTab | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("popout");
  if (!param) return null;
  return (POPOUT_TABS as readonly string[]).includes(param)
    ? (param as PopoutTab)
    : null;
}

/**
 * Opens a popout window for the given tab.
 *
 * When `reuseWindow` is true the call focuses an already-open popout window
 * instead of opening a new one. This is a single-slot model: whichever tab
 * was first popped out owns the slot, and subsequent reuse calls focus that
 * same window regardless of which `tab` is requested.
 */
export function openPopoutWindow(tab: PopoutTab, reuseWindow = false): void {
  if (typeof window === "undefined") return;
  if (reuseWindow && _popoutWindowRef && !_popoutWindowRef.closed) {
    _popoutWindowRef.focus();
    return;
  }
  const url = `${window.location.pathname}?popout=${encodeURIComponent(tab)}`;
  const win = window.open(url, `lop-popout-${tab}`, "popup=yes,width=1200,height=800");
  if (win) _popoutWindowRef = win;
}
