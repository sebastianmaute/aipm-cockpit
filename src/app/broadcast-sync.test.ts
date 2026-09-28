import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { createElement, Fragment, useLayoutEffect } from "react";
import {
  getWindowId,
  useBroadcastSync,
  isReportPopoutTab,
  REPORT_POPOUT_TABS,
  type SyncContext,
} from "./broadcast-sync";
import { readPopoutOpenerFromUrl } from "./sync-scope";

/** A main window's context. Nothing bumps the epoch or the load generation unless a test says so. */
function main(scope: string | null, over: Partial<Extract<SyncContext, { role: "main" }>> = {}): SyncContext {
  return { role: "main", scope, getEpoch: () => 0, isLoadedValue: () => false, ...over };
}
function popout(openerId: string | null): SyncContext {
  return { role: "popout", openerId };
}

// Records every postMessage so we can assert what a window broadcasts.
const posted: unknown[] = [];
class FakeBroadcastChannel {
  constructor(public name: string) {}
  postMessage(msg: unknown) { posted.push(msg); }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

/** Delivers every postMessage synchronously to every listener, as one origin's windows would. */
function installBus() {
  const listeners: ((ev: MessageEvent) => void)[] = [];
  class BusChannel {
    constructor(public name: string) {}
    postMessage(msg: unknown) {
      for (const l of [...listeners]) l({ data: msg } as MessageEvent);
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
}

/** Posts a raw message as another window would. */
function postRaw(msg: Record<string, unknown>) {
  new BroadcastChannel("aipm-cockpit:sync").postMessage({ clientId: "other-client", windowId: "other-window", kind: "tasks", scope: null, fromLoad: false, ...msg });
}

/** A main window on `scope` that changes its tasks to `value` after mounting. */
function sendFrom(scope: string | null, value: number[], over: Partial<Extract<SyncContext, { role: "main" }>> = {}) {
  const ctx = main(scope, over);
  const { rerender } = renderHook(
    ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}, ctx),
    { initialProps: { v: [] as number[] } },
  );
  rerender({ v: value });
}

/** A receiver with a STABLE callback and value, like the real `setTasks`/state: a fresh arrow per
 *  render re-subscribes on its own and would hide a listener that judges by a stale context. */
function receiver(initialCtx: SyncContext) {
  const applied: number[][] = [];
  const apply = (v: number[]) => { applied.push(v); };
  const initial: number[] = [];
  const hook = renderHook(
    ({ ctx }: { ctx: SyncContext }) => useBroadcastSync("tasks", initial, apply, ctx),
    { initialProps: { ctx: initialCtx } },
  );
  return { applied, rerender: (ctx: SyncContext) => hook.rerender({ ctx }) };
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
    renderHook(() => useBroadcastSync("tasks", [] as number[], () => {}, main("p")));
    expect(posted).toHaveLength(0);
  });

  it("broadcasts a value change that happens after mount", () => {
    sendFrom("p", [1]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "tasks", value: [1] });
  });

  it("never broadcasts from a pop-out", () => {
    const ctx = popout(getWindowId());
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}, ctx),
      { initialProps: { v: [] as number[] } },
    );
    rerender({ v: [1] });
    expect(posted).toHaveLength(0);
  });

  // FIX 1a: a project switch in the main window broadcasts the new ProjectMeta
  // so popout windows can live-update their read-only project header.
  it("broadcasts the 'project' kind with a ProjectMeta value after mount", () => {
    type Meta = { name: string; code: string };
    type Props = { v: Meta | undefined };
    const next: Meta = { name: "Gemini", code: "GMN" };
    const ctx = main("p");
    const { rerender } = renderHook(
      ({ v }: Props) => useBroadcastSync("project", v, () => {}, ctx),
      { initialProps: { v: undefined } as Props },
    );
    expect(posted).toHaveLength(0);
    rerender({ v: next });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "project", value: next });
  });

  it("tags every outgoing message with the sender's window id, scope and load flag", () => {
    sendFrom("project-a", [1]);
    expect(posted).toEqual([expect.objectContaining({ kind: "tasks", value: [1], scope: "project-a", windowId: getWindowId(), fromLoad: false })]);
  });

  it("still sends from a main window with no scope, so its own pop-outs follow it", () => {
    sendFrom(null, [1]);
    expect(posted).toEqual([expect.objectContaining({ scope: null, value: [1] })]);
  });
});

describe("getWindowId", () => {
  it("is stable and kept in sessionStorage, so a pop-out keeps its opener across the opener's reload", () => {
    const id = getWindowId();
    expect(id).toBeTruthy();
    expect(getWindowId()).toBe(id);
    expect(window.sessionStorage.getItem("aipm-cockpit:sync-window-id")).toBe(id);
  });
});

// §642 — the channel is one per origin, so two MAIN windows on different projects both hear every
// message. Without a project scope, editing tasks in project A replaced project B's task list in
// the other window, and B's autosave then wrote A's tasks into B.
describe("useBroadcastSync main-window scope (§642, §643)", () => {
  beforeEach(() => installBus());

  it("does not apply a message sent for another project", () => {
    const r = receiver(main("project-b"));
    sendFrom("project-a", [1]);
    expect(r.applied).toEqual([]);
  });

  it("still applies a message sent for the same project", () => {
    const r = receiver(main("project-a"));
    sendFrom("project-a", [1]);
    expect(r.applied).toEqual([[1]]);
  });

  it("accepts nothing from other main windows when nothing identifies its data (scope null)", () => {
    const r = receiver(main(null));
    sendFrom(null, [1]);
    postRaw({ scope: null, value: [2] });
    expect(r.applied).toEqual([]);
  });

  it("follows a scope change: after switching project, the old project's messages are dropped", () => {
    const r = receiver(main("project-a"));
    r.rerender(main("project-b"));
    sendFrom("project-a", [1]);
    sendFrom("project-b", [2]);
    expect(r.applied).toEqual([[2]]);
  });

  // Review I1 on §642 — a project op bumps the scope epoch synchronously, then React renders the new
  // project in a LATER task. A message arriving in between reached the listener still subscribed with
  // the old scope, and the setter it queued ran AFTER the op's, so the old project's slice won.
  it("drops every message while an op has bumped the scope epoch and the new project has not committed", () => {
    let epoch = 0;
    const ctx = main("project-a", { getEpoch: () => epoch });
    const r = receiver(ctx);
    epoch = 1; // `applyWorkspaceForOp` bumped; its render has not happened yet
    sendFrom("project-a", [1]);
    expect(r.applied).toEqual([]);
    r.rerender({ ...ctx }); // the op's render commits (a same-key op, e.g. a reload)
    sendFrom("project-a", [2]);
    expect(r.applied).toEqual([[2]]);
  });

  // Review I1 on §642 — after the commit that switches scope, the listener re-subscribes only in a
  // PASSIVE effect. A message delivered before that (modelled by a sibling's layout effect, which runs
  // in the same commit, before any passive effect) must already be judged against the NEW scope.
  it("judges a message delivered between the scope switch's commit and the re-subscribe by the new scope", () => {
    const applied: number[][] = [];
    const apply = (v: number[]) => { applied.push(v); };
    const initial: number[] = [];
    function Receiver({ ctx }: { ctx: SyncContext }) {
      useBroadcastSync("tasks", initial, apply, ctx);
      return null;
    }
    function OldProjectWindow({ scope }: { scope: string }) {
      useLayoutEffect(() => {
        if (scope === "project-b") postRaw({ scope: "project-a", value: [9] });
      }, [scope]);
      return null;
    }
    const tree = (scope: string) =>
      createElement(Fragment, null, createElement(Receiver, { ctx: main(scope) }), createElement(OldProjectWindow, { scope }));
    const { rerender } = render(tree("project-a"));
    rerender(tree("project-b"));
    expect(applied).toEqual([]);
  });
});

// §644 — a window that LOADS a project changes its slices to what it read from storage. Applying
// that in another main window on the same project replaced that window's unsaved edits.
describe("useBroadcastSync load changes (§644)", () => {
  it("marks exactly the values a load applied as fromLoad, and an edit not", () => {
    posted.length = 0;
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as unknown as typeof BroadcastChannel);
    const loaded = [1];
    const ctx = main("p", { isLoadedValue: (v) => v === loaded });
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}, ctx),
      { initialProps: { v: [] as number[] } },
    );
    rerender({ v: loaded });
    rerender({ v: [2] }); // an ordinary edit afterwards
    expect(posted).toEqual([
      expect.objectContaining({ value: [1], fromLoad: true }),
      expect.objectContaining({ value: [2], fromLoad: false }),
    ]);
  });

  // Review I4 on §644 — the first cut judged by "the first commit after the load", so a commit that
  // landed between a load and its render took the load's flag. The flag must follow the VALUE, not
  // the commit order. ★ This pins the hook's contract only. In React a keystroke queued before the
  // load's render is REBASED onto it, so the value that commits is neither the loaded array nor a
  // plain edit, and it goes out as an edit: a known limit, recorded in §644.
  it("classifies by value, not by the order commits land in", () => {
    posted.length = 0;
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel as unknown as typeof BroadcastChannel);
    const loadedSet = new WeakSet<object>();
    const ctx = main("p", { isLoadedValue: (v) => typeof v === "object" && v !== null && loadedSet.has(v) });
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}, ctx),
      { initialProps: { v: [] as number[] } },
    );
    const loaded = [1];
    loadedSet.add(loaded); // the load ran and recorded its value; its render has not committed
    rerender({ v: [9] }); // the keystroke commits first
    rerender({ v: loaded }); // then the load
    expect(posted).toEqual([
      expect.objectContaining({ value: [9], fromLoad: false }),
      expect.objectContaining({ value: [1], fromLoad: true }),
    ]);
  });

  it("a main window on the same project ignores a fromLoad message", () => {
    installBus();
    const r = receiver(main("p"));
    postRaw({ scope: "p", fromLoad: true, value: [1] });
    postRaw({ scope: "p", fromLoad: false, value: [2] });
    expect(r.applied).toEqual([[2]]);
  });

  it("a pop-out applies its opener's fromLoad message, so it follows the opener's load", () => {
    installBus();
    const r = receiver(popout("opener-1"));
    postRaw({ windowId: "opener-1", scope: "p", fromLoad: true, value: [1] });
    expect(r.applied).toEqual([[1]]);
  });
});

// A pop-out mirrors the window that opened it. §642 first gave it a scope of its own, resolved once
// at mount, so it froze on the old project when its opener switched (FIX 1a regressed).
describe("useBroadcastSync pop-outs follow their opener", () => {
  beforeEach(() => installBus());

  it("applies its opener's messages whatever project the opener has open", () => {
    const r = receiver(popout("opener-1"));
    postRaw({ windowId: "opener-1", scope: "project-a", value: [1] });
    postRaw({ windowId: "opener-1", scope: "project-b", value: [2] });
    postRaw({ windowId: "opener-1", scope: null, value: [3] });
    expect(r.applied).toEqual([[1], [2], [3]]);
  });

  it("ignores every other window, even one on the same project", () => {
    const r = receiver(popout("opener-1"));
    postRaw({ windowId: "opener-2", scope: "project-a", value: [1] });
    expect(r.applied).toEqual([]);
  });

  it("accepts nothing without an opener id", () => {
    const r = receiver(popout(null));
    postRaw({ windowId: "opener-1", value: [1] });
    expect(r.applied).toEqual([]);
  });

  it("reads its opener id from the URL", () => {
    window.history.replaceState(null, "", "/?popout=gantt&opener=w-123");
    try {
      expect(readPopoutOpenerFromUrl()).toBe("w-123");
    } finally {
      window.history.replaceState(null, "", "/");
    }
    expect(readPopoutOpenerFromUrl()).toBeNull();
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
      expect.stringMatching(/\?popout=gantt&opener=.+/),
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
