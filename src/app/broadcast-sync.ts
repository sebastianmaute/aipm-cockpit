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

import { useEffect, useRef } from "react";

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
  enabled: boolean = true,
): void {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const clientIdRef = useRef<string>("");
  // The last value we either sent or received. Reference-equal check on the
  // next render lets us skip echoing back a value that was just applied
  // from an incoming message.
  const lastSeenRef = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
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
  }, [kind, enabled, applyIncoming]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [kind, value, enabled]);
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
] as const;
export type PopoutTab = (typeof POPOUT_TABS)[number];

export function readPopoutTabFromUrl(): PopoutTab | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("popout");
  if (!param) return null;
  return (POPOUT_TABS as readonly string[]).includes(param)
    ? (param as PopoutTab)
    : null;
}

export function openPopoutWindow(tab: PopoutTab): void {
  if (typeof window === "undefined") return;
  const url = `${window.location.pathname}?popout=${encodeURIComponent(tab)}`;
  // `popup=yes` is what lets us hint a window-style window in modern
  // Chromium / Firefox; size hints are advisory. Returns null if the
  // browser blocked the popup (rare since this is a direct user gesture).
  window.open(url, `lop-popout-${tab}`, "popup=yes,width=1200,height=800");
}
