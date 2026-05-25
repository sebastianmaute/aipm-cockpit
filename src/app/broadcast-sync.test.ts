import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBroadcastSync } from "./broadcast-sync";

// Records every postMessage so we can assert what a window broadcasts.
const posted: unknown[] = [];
class FakeBroadcastChannel {
  constructor(public name: string) {}
  postMessage(msg: unknown) { posted.push(msg); }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

describe("useBroadcastSync", () => {
  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as unknown as typeof BroadcastChannel);
  });

  // Regression: a freshly-mounted window (e.g. a pop-out) must NOT broadcast
  // its initial/empty value. Doing so let a pop-out clobber the main window's
  // workspace with empty state, which the main window then persisted — wiping
  // the local file. Only real post-mount changes may broadcast.
  it("does NOT broadcast the initial value on mount", () => {
    renderHook(() => useBroadcastSync("tasks", [] as number[], () => {}));
    expect(posted).toHaveLength(0);
  });

  it("broadcasts a value change that happens after mount", () => {
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}),
      { initialProps: { v: [] as number[] } },
    );
    expect(posted).toHaveLength(0);
    rerender({ v: [1] });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "tasks", value: [1] });
  });
});

describe("openPopoutWindow", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls window.open and stores ref when reuseWindow=false", async () => {
    const mockFocus = vi.fn();
    const mockWin = { focus: mockFocus, closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false);

    expect(mockOpen).toHaveBeenCalledOnce();
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("?popout=gantt"),
      "lop-popout-gantt",
      "popup=yes,width=1200,height=800",
    );
    mockOpen.mockRestore();
  });

  it("focuses existing open window without calling window.open when reuseWindow=true", async () => {
    const mockFocus = vi.fn();
    const mockWin = { focus: mockFocus, closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false); // establishes the ref

    openPopoutWindow("reports", true); // reuse: should focus, not open
    expect(mockOpen).toHaveBeenCalledOnce(); // still exactly 1 call
    expect(mockFocus).toHaveBeenCalledOnce();
    mockOpen.mockRestore();
  });

  it("opens a new window when reuseWindow=true but stored ref is closed", async () => {
    const closedWin = { focus: vi.fn(), closed: true } as unknown as Window;
    const freshWin = { focus: vi.fn(), closed: false } as unknown as Window;
    const mockOpen = vi
      .spyOn(window, "open")
      .mockReturnValueOnce(closedWin)
      .mockReturnValueOnce(freshWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false); // ref = closedWin

    openPopoutWindow("reports", true); // ref closed → opens new
    expect(mockOpen).toHaveBeenCalledTimes(2);
    mockOpen.mockRestore();
  });

  it("always calls window.open with reuseWindow=false (multi-window mode unchanged)", async () => {
    const mockWin = { focus: vi.fn(), closed: false } as unknown as Window;
    const mockOpen = vi.spyOn(window, "open").mockReturnValue(mockWin);

    const { openPopoutWindow } = await import("./broadcast-sync");
    openPopoutWindow("gantt", false);
    openPopoutWindow("reports", false);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    mockOpen.mockRestore();
  });
});
