// Cross-window state sync over BroadcastChannel. A MAIN window broadcasts its
// slice changes (tasks, RAID, absences, ...); other main windows on the same
// project and the pop-outs it opened (`?popout=<tab>`) apply them. Pop-outs are
// receive-only mirrors: they never broadcast and never save.
//
// Design:
// - One channel per origin (`aipm-cockpit:sync`), shared by EVERY window of the
//   origin. Each hook instance tags its messages with a `clientId` so it can
//   ignore its own echoes, and each main window with a `windowId` that survives a
//   reload of that tab (sessionStorage).
// - Each state slice is identified by a `kind` (`"tasks"`, `"raid"`, ...).
// - Incoming messages are applied via the caller-supplied `applyIncoming`
//   setter. We stash the deserialized value in a ref BEFORE calling it so
//   the broadcast useEffect that fires from the resulting re-render can
//   bail out on reference equality instead of re-broadcasting.
// - WHO ACCEPTS WHAT is decided by the receiver's `SyncContext`:
//   - A POP-OUT accepts a message only from the window that opened it (its
//     `opener` URL parameter), whatever project that window has open, so it
//     follows its opener through a project switch.
//   - ★★ A MAIN window (§642) accepts a message only when the sender's `scope`
//     equals its own non-null scope (`syncScopeKey`, §643). Unscoped, an edit in
//     project A replaced project B's slice in another window, and B's autosave then
//     wrote A's data into B. A `null` scope (nothing identifies the data) accepts
//     nothing from other main windows.
//     ★★ It judges by the window's CURRENT scope, read from refs a layout effect
//     updates at every commit, never by the scope its listener captured: the
//     listener re-subscribes only in a passive effect, after the commit that
//     switched project. And it drops EVERY message while `getEpoch()` differs from
//     the epoch at the last commit: a project op bumps the scope epoch synchronously
//     and React renders the new project in a later task, and a setter queued in
//     between would run after the op's and put the old project's slice back
//     (review I1 on §642). A message dropped in that window is LOST, not deferred.
//   - ★★ A MAIN window also drops a message marked `fromLoad` (§644): a slice that
//     changed because the sender LOADED its project is what that sender read from
//     storage, and applying it would replace this window's unsaved edits to the same
//     project. Pop-outs still apply it, since they must follow their opener.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { AppView } from "./nav-config";

const CHANNEL_NAME = "aipm-cockpit:sync";
const WINDOW_ID_KEY = "aipm-cockpit:sync-window-id";

/** How a window takes part in tab sync. Built once per window by `useStorageBackend`. */
export type SyncContext =
  | {
      role: "main";
      /** `syncScopeKey` of the data this window edits; `null` when nothing identifies it. */
      scope: string | null;
      /** The §548 scope epoch reader (`getScopeEpoch`). */
      getEpoch: () => number;
      /** Bumped by every load apply; a commit that saw a bump sends its changes as `fromLoad`. */
      getLoadGeneration: () => number;
    }
  | {
      role: "popout";
      /** The opener's `windowId`, from the `opener` URL parameter; `null` accepts nothing. */
      openerId: string | null;
    };

type SyncMessage<T> = {
  clientId: string;
  windowId: string;
  kind: string;
  scope: string | null;
  fromLoad: boolean;
  value: T;
};

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

let _windowId: string | null = null;

/** This main window's id: stable across a reload of the tab (sessionStorage), so a pop-out keeps
 *  following its opener after the opener reloads. Falls back to a per-page id when sessionStorage
 *  is unavailable. ★ A DUPLICATED tab starts with a copy of sessionStorage and so shares the id; a
 *  pop-out of either then mirrors both, read-only (§643's closing note). */
export function getWindowId(): string {
  if (_windowId) return _windowId;
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(WINDOW_ID_KEY);
    if (!id) {
      id = newClientId();
      window.sessionStorage.setItem(WINDOW_ID_KEY, id);
    }
  } catch {
    id = newClientId();
  }
  _windowId = id;
  return id;
}

export function useBroadcastSync<T>(
  kind: string,
  value: T,
  applyIncoming: (next: T) => void,
  sync: SyncContext,
): void {
  const syncRef = useRef(sync);
  const committedEpochRef = useRef(sync.role === "main" ? sync.getEpoch() : 0);
  const committedLoadGenRef = useRef(sync.role === "main" ? sync.getLoadGeneration() : 0);
  const commitIsLoadRef = useRef(false);
  // No deps: every commit records the context it rendered under, the epoch, and whether a load
  // was applied since the previous commit.
  useLayoutEffect(() => {
    syncRef.current = sync;
    if (sync.role !== "main") return;
    committedEpochRef.current = sync.getEpoch();
    const gen = sync.getLoadGeneration();
    commitIsLoadRef.current = gen !== committedLoadGenRef.current;
    committedLoadGenRef.current = gen;
  });
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
      if (!msg || msg.clientId === clientIdRef.current || msg.kind !== kind) return;
      const ctx = syncRef.current;
      if (ctx.role === "popout") {
        if (ctx.openerId === null || msg.windowId !== ctx.openerId) return;
      } else {
        if (msg.fromLoad) return;
        if (ctx.scope === null || msg.scope !== ctx.scope) return;
        if (ctx.getEpoch() !== committedEpochRef.current) return;
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

  const isMain = sync.role === "main";
  const scope = sync.role === "main" ? sync.scope : null;
  useEffect(() => {
    if (!isMain) return;
    const channel = channelRef.current;
    if (!channel) return;
    // Skip echoing a value that arrived from another window. The incoming
    // handler set lastSeenRef to that exact reference before calling the
    // setter, so reference equality is enough.
    if (Object.is(lastSeenRef.current, value)) return;
    lastSeenRef.current = value;
    const msg: SyncMessage<T> = {
      clientId: clientIdRef.current,
      windowId: getWindowId(),
      kind,
      scope,
      fromLoad: commitIsLoadRef.current,
      value,
    };
    channel.postMessage(msg);
  }, [kind, value, isMain, scope]);
}

// Popout-capable subset of the `AppView` union in nav-config.ts. Kept in
// sync manually: AppView also contains main-window-only views ("open-points",
// "settings") that must never be offered as popout targets.
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
  const url = `${window.location.pathname}?popout=${encodeURIComponent(tab)}&opener=${encodeURIComponent(getWindowId())}`;
  const win = window.open(url, `aipm-cockpit-popout-${tab}`, "popup=yes,width=1200,height=800");
  if (win) _popoutWindowRef = win;
}
