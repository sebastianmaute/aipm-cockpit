import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDesktopVersionRequest } from "./use-desktop-version-request";
import { DESKTOP_VERSION_REQUEST_EVENT } from "./desktop-shell";

function fireRequest(detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(DESKTOP_VERSION_REQUEST_EVENT, { detail }));
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

  it("opens and carries the log path when the desktop shell fires the event", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      fireRequest({ logPath: "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log" });
    });
    expect(result.current.open).toBe(true);
    expect(result.current.logPath).toBe(
      "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log",
    );
  });

  it("ignores a malformed detail rather than throwing, and still opens", () => {
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      fireRequest(undefined);
    });
    expect(result.current.open).toBe(true);
    expect(result.current.logPath).toBeUndefined();

    const { result: result2 } = renderHook(() => useDesktopVersionRequest());
    act(() => {
      fireRequest({ logPath: 12345 });
    });
    expect(result2.current.logPath).toBeUndefined();
  });

  it("onClose closes without erasing the last log path", () => {
    // ★ Sticky on purpose (see the hook's docstring) -- nothing requires the
    // path be re-sent on every open, and the desktop main process always
    // sends one anyway. Mutant this catches: onClose also clearing logPath.
    const { result } = renderHook(() => useDesktopVersionRequest());
    act(() => fireRequest({ logPath: "C:\\logs\\launch.log" }));
    act(() => result.current.onClose());
    expect(result.current.open).toBe(false);
    expect(result.current.logPath).toBe("C:\\logs\\launch.log");
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

  it("a listener from an unmounted instance no longer reacts to the event", () => {
    const { result, unmount } = renderHook(() => useDesktopVersionRequest());
    unmount();
    // No throw, and — since this specific hook instance is gone — nothing
    // left to observe on `result` but a stale, still-closed snapshot.
    expect(() => fireRequest({ logPath: "C:\\logs\\launch.log" })).not.toThrow();
    expect(result.current.open).toBe(false);
  });
});
