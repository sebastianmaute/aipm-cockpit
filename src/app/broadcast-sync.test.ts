import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBroadcastSync, isReportPopoutTab, REPORT_POPOUT_TABS } from "./broadcast-sync";

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

  it("does NOT broadcast a post-mount change when canSend is false", () => {
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) =>
        useBroadcastSync("tasks", v, () => {}, /* canSend */ false),
      { initialProps: { v: [] as number[] } },
    );
    rerender({ v: [1] });
    expect(posted).toHaveLength(0);
  });

  it("still broadcasts post-mount changes when canSend defaults to true", () => {
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}),
      { initialProps: { v: [] as number[] } },
    );
    rerender({ v: [2] });
    expect(posted).toHaveLength(1);
  });

  // FIX 1a: a project switch in the main window broadcasts the new ProjectMeta
  // so popout windows can live-update their read-only project header.
  it("broadcasts the 'project' kind with a ProjectMeta value after mount", () => {
    type Meta = { name: string; code: string };
    type Props = { v: Meta | undefined };
    const next: Meta = { name: "Gemini", code: "GMN" };
    const { rerender } = renderHook(
      ({ v }: Props) => useBroadcastSync("project", v, () => {}),
      { initialProps: { v: undefined } as Props },
    );
    expect(posted).toHaveLength(0);
    rerender({ v: next });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "project", value: next });
  });
});

// FIX 1a apply path: an incoming "project" message is applied via the setter.
// Uses a shared in-memory bus so a postMessage from one instance is delivered
// to another instance's message listener (the real cross-window behaviour).
describe("useBroadcastSync apply path", () => {
  it("applies an incoming 'project' ProjectMeta to a receiving (canSend=false) instance", () => {
    type Meta = { name: string; code: string };
    const listeners: ((ev: MessageEvent) => void)[] = [];
    class BusChannel {
      constructor(public name: string) {}
      postMessage(msg: unknown) {
        for (const l of listeners) l({ data: msg } as MessageEvent);
      }
      addEventListener(_type: string, cb: (ev: MessageEvent) => void) {
        listeners.push(cb);
      }
      removeEventListener(_type: string, cb: (ev: MessageEvent) => void) {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      }
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", BusChannel as unknown as typeof BroadcastChannel);

    const next: Meta = { name: "Gemini", code: "GMN" };
    const applied: (Meta | undefined)[] = [];

    // Receiver: a popout-style instance (canSend=false) that records applies.
    renderHook(() =>
      useBroadcastSync<Meta | undefined>(
        "project",
        undefined,
        (v) => applied.push(v),
        /* canSend */ false,
      ),
    );
    // Sender: the main window broadcasts a project change.
    type Props = { v: Meta | undefined };
    const { rerender } = renderHook(
      ({ v }: Props) => useBroadcastSync<Meta | undefined>("project", v, () => {}),
      { initialProps: { v: undefined } as Props },
    );
    rerender({ v: next });

    expect(applied).toContainEqual(next);
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
      "aipm-cockpit-popout-gantt",
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

describe("isReportPopoutTab", () => {
  it("returns true for the report-style popout tabs", () => {
    expect(isReportPopoutTab("reports")).toBe(true);
    expect(isReportPopoutTab("raid-report")).toBe(true);
  });

  it("returns false for editing popout tabs", () => {
    expect(isReportPopoutTab("raid")).toBe(false);
    expect(isReportPopoutTab("gantt")).toBe(false);
    expect(isReportPopoutTab("resources")).toBe(false);
    expect(isReportPopoutTab("activity")).toBe(false);
    expect(isReportPopoutTab("chat")).toBe(false);
    expect(isReportPopoutTab("budget")).toBe(false);
    expect(isReportPopoutTab("directory")).toBe(false);
  });

  it("returns false for null (no popout)", () => {
    expect(isReportPopoutTab(null)).toBe(false);
  });

  it("REPORT_POPOUT_TABS contains exactly the report tabs", () => {
    expect(REPORT_POPOUT_TABS).toEqual(["resource-report", "reports", "raid-report", "budget-report"]);
  });
});
