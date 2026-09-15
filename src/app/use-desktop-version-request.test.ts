import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDesktopVersionRequest } from "./use-desktop-version-request";
import { DESKTOP_VERSION_REQUEST_EVENT } from "./desktop-shell";

/** Mirrors what versionRequestScript() actually dispatches: `cancelable:
 *  true` (so `defaultPrevented` below is observable at all) and a `detail`
 *  of `{ logPath, open }`. Returns the event so a test can inspect
 *  `defaultPrevented` after dispatch. */
function fireRequest(detail?: { logPath?: unknown; open?: boolean }): CustomEvent {
  const ev = new CustomEvent(DESKTOP_VERSION_REQUEST_EVENT, { cancelable: true, detail });
  window.dispatchEvent(ev);
  return ev;
}

describe("useDesktopVersionRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts closed with no log path", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    expect(result.current.open).toBe(false);
    expect(result.current.logPath).toBeUndefined();
  });

  it("opens and carries the log path when the desktop shell sends open: true", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      fireRequest({ logPath: "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log", open: true });
    });
    expect(result.current.open).toBe(true);
    expect(result.current.logPath).toBe(
      "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log",
    );
  });

  // ★★★ FIX ROUND 1 (M3 log-path consistency): the priming ping main.ts sends
  // once per page load (did-finish-load, `open: false`) must NOT pop the
  // modal, but must still be remembered so the log-path row is already
  // correct the first time the modal opens from ANY trigger.
  it("a priming request (open: false) remembers the log path without opening", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      fireRequest({ logPath: "C:\\logs\\launch.log", open: false });
    });
    expect(result.current.open).toBe(false);
    expect(result.current.logPath).toBe("C:\\logs\\launch.log");
  });

  // ★★★ FIX ROUND 1 (M3): the sidebar version line and the Settings footer
  // no longer own their own modal/state -- they call this. Threaded to them
  // as `onOpenVersion` (task-manager.tsx); this hook-level test pins the
  // primitive itself: a plain state flip, not an event dispatch (app code
  // must never dispatch the desktop event -- that channel belongs to main).
  it("openVersion() opens the modal directly, without touching logPath or dispatching anything", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      result.current.openVersion();
    });
    expect(result.current.open).toBe(true);
    expect(result.current.logPath).toBeUndefined();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("a malformed or path-less detail does not throw, does not open, and does not touch logPath", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      fireRequest(undefined);
    });
    expect(result.current.open).toBe(false);
    expect(result.current.logPath).toBeUndefined();

    act(() => {
      fireRequest({ logPath: 12345 as unknown as string, open: true });
    });
    // `open: true` still opens even though logPath was not a string --
    // the two fields are independent.
    expect(result.current.open).toBe(true);
    expect(result.current.logPath).toBeUndefined();
  });

  it("a later malformed request does not blank an already-remembered log path", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => fireRequest({ logPath: "C:\\logs\\launch.log", open: false }));
    expect(result.current.logPath).toBe("C:\\logs\\launch.log");
    act(() => fireRequest({ open: true })); // no logPath this time
    expect(result.current.open).toBe(true);
    expect(result.current.logPath).toBe("C:\\logs\\launch.log");
  });

  it("onClose closes without erasing the last log path", () => {
    // ★ Sticky on purpose (see the hook's docstring) -- nothing requires the
    // path be re-sent on every open, and the desktop main process always
    // sends one anyway. Mutant this catches: onClose also clearing logPath.
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => fireRequest({ logPath: "C:\\logs\\launch.log", open: true }));
    act(() => result.current.onClose());
    expect(result.current.open).toBe(false);
    expect(result.current.logPath).toBe("C:\\logs\\launch.log");
  });

  // ★★★ FIX ROUND 1 (M4): main reads the dispatched event's return value
  // (`!window.dispatchEvent(ev)`, see menu-model.ts) to tell whether a real
  // listener handled the request; the listener signals that by calling
  // preventDefault(), which requires the event to be `cancelable`. This is
  // the hook-side half of M4's fix (the pure-builder half is
  // menu-model.test.ts's "M4 fix" describe block).
  it("the listener calls preventDefault(), for both an open request and a priming ping", () => {
    renderHook(() => useDesktopVersionRequest());
    const openEv = fireRequest({ logPath: "x", open: true });
    expect(openEv.defaultPrevented).toBe(true);
    const primeEv = fireRequest({ logPath: "x", open: false });
    expect(primeEv.defaultPrevented).toBe(true);
  });

  it("does NOT call preventDefault when no listener is mounted (nothing to catch it, but proves the assertion above is meaningful)", () => {
    // Vacuity guard for the test above: with no hook instance mounted at all,
    // a `cancelable` event dispatched into the void is never prevented.
    const ev = fireRequest({ logPath: "x", open: true });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("adds exactly one listener for the shared event name and removes it on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useDesktopVersionRequest());

    const added = addSpy.mock.calls.filter(([name]) => name === DESKTOP_VERSION_REQUEST_EVENT);
    expect(added).toHaveLength(1);
    const handler = added[0][1];

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(DESKTOP_VERSION_REQUEST_EVENT, handler);
  });

  // ★★★ FIX ROUND 1 (M2): the previous "a listener from an unmounted instance
  // no longer reacts" test was REMOVED here. It compared `result.current`
  // (a frozen snapshot taken before `unmount()`) after unmounting, so `open`
  // read `false` whether or not the listener was actually removed -- it could
  // not go red no matter what the cleanup did. The spy test immediately
  // above is the real pin (asserts `removeEventListener` was called with the
  // SAME handler reference `addEventListener` received), and it is what
  // Task 2's own mutation check (deleting the cleanup `return`) actually
  // caught; see review-2-report.md M2 and task-2-report.md's "Fix round 1"
  // section for the mutation re-run confirming it here.
});
