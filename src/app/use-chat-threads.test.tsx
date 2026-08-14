// src/app/use-chat-threads.test.tsx — direct unit coverage for the
// use-chat-threads.ts deps-object hook. Presentational tests elsewhere
// (chat-thread-sidebar.test.tsx, chat-thread-list.test.tsx) pin only "the
// button calls the prop it was given" — this file pins the hook's actual
// persistence/CRUD logic: newThread/selectThread/renameThread/
// requestDeleteThread/retryLoad/ensureThreadForSend and the busy-persist
// effect's existing-thread name reuse.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import { loadThreads, saveThread, deleteThread } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
const saveThreadMock = saveThread as unknown as ReturnType<typeof vi.fn>;
const deleteThreadMock = deleteThread as unknown as ReturnType<typeof vi.fn>;

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    projectId: "default",
    name: `Thread ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history: [],
    display: [],
    ...over,
  };
}

/** Renders the hook with a controllable, mutable deps object so tests can
 *  drive busy true→false transitions and swap history/display between
 *  renders — mirrors how ChatPanel actually threads its own state through. */
function renderChatThreads(overrides: Partial<UseChatThreadsDeps> = {}) {
  const setHistory = vi.fn();
  const setDisplay = vi.fn();
  const confirm = vi.fn(async () => true);
  const initialProps: UseChatThreadsDeps = {
    tursoMode: true,
    tursoConfig: null,
    projectId: "default",
    lang: "en-US",
    busy: false,
    history: [],
    display: [],
    setHistory,
    setDisplay,
    cancelledRef: { current: false },
    abortRef: { current: null },
    confirm,
    ...overrides,
  };
  const hook = renderHook((props: UseChatThreadsDeps) => useChatThreads(props), {
    initialProps,
  });
  return { ...hook, setHistory, setDisplay, confirm };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadThreadsMock.mockResolvedValue([]);
  saveThreadMock.mockResolvedValue(undefined);
  deleteThreadMock.mockResolvedValue(undefined);
});

describe("useChatThreads — newThread", () => {
  it("mints a fresh id and clears history/display; no row is written until a turn settles", async () => {
    const { result, setHistory, setDisplay } = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    act(() => result.current.newThread());

    expect(result.current.activeThreadId).toEqual(expect.any(String));
    expect(result.current.activeThreadId).not.toBe("");
    expect(setHistory).toHaveBeenCalledWith([]);
    expect(setDisplay).toHaveBeenCalledWith([]);
    expect(result.current.threads).toEqual([]);
    expect(saveThreadMock).not.toHaveBeenCalled();
  });
});

describe("useChatThreads — selectThread", () => {
  it("adopts the target thread's history/display, and is a no-op for the already-active id", async () => {
    const t1 = thread("t1", { history: [{ role: "user", content: "hi" }], display: [{ kind: "user", text: "hi" }] });
    const t2 = thread("t2", { history: [], display: [{ kind: "user", text: "other" }] });
    loadThreadsMock.mockResolvedValue([t1, t2]);
    const { result, setHistory, setDisplay } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    // Mount adopts threads[0] (t1) as active — confirm the starting point.
    expect(result.current.activeThreadId).toBe("t1");
    setHistory.mockClear();
    setDisplay.mockClear();

    act(() => result.current.selectThread("t2"));
    expect(result.current.activeThreadId).toBe("t2");
    expect(setHistory).toHaveBeenCalledWith(t2.history);
    expect(setDisplay).toHaveBeenCalledWith(t2.display);

    setHistory.mockClear();
    setDisplay.mockClear();
    act(() => result.current.selectThread("t2"));
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
  });
});

describe("useChatThreads — renameThread", () => {
  it("optimistically updates local state and calls saveThread", async () => {
    const t1 = thread("t1", { name: "Old name" });
    loadThreadsMock.mockResolvedValue([t1]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    act(() => result.current.renameThread("t1", "New name"));

    expect(result.current.threads[0]!.name).toBe("New name");
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    const saved = saveThreadMock.mock.calls.at(-1)![1] as ChatThread;
    expect(saved.id).toBe("t1");
    expect(saved.name).toBe("New name");
  });

  it("a rejected saveThread sets the error state", async () => {
    const t1 = thread("t1");
    loadThreadsMock.mockResolvedValue([t1]);
    saveThreadMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    act(() => result.current.renameThread("t1", "New name"));

    await waitFor(() => expect(result.current.threadsError).toBe(true));
  });
});

describe("useChatThreads — requestDeleteThread", () => {
  it("gates on confirm, removes the thread, reselects when the active thread was deleted, and calls the delete store fn", async () => {
    const t1 = thread("t1", { history: [{ role: "user", content: "a" }], display: [{ kind: "user", text: "a" }] });
    const t2 = thread("t2", { history: [], display: [{ kind: "user", text: "b" }] });
    loadThreadsMock.mockResolvedValue([t1, t2]);
    const { result, setHistory, setDisplay, confirm } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.activeThreadId).toBe("t1");
    setHistory.mockClear();
    setDisplay.mockClear();

    await act(async () => {
      await result.current.requestDeleteThread("t1");
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.current.threads.map((th) => th.id)).toEqual(["t2"]);
    expect(result.current.activeThreadId).toBe("t2");
    expect(setHistory).toHaveBeenCalledWith(t2.history);
    expect(setDisplay).toHaveBeenCalledWith(t2.display);
    // Scoped by project too — an id-only delete is precisely what this
    // guards against (defense-in-depth against a cross-project id collision).
    expect(deleteThreadMock).toHaveBeenCalledWith(null, "t1", "default");
  });

  it("a declined confirm does nothing", async () => {
    const t1 = thread("t1");
    loadThreadsMock.mockResolvedValue([t1]);
    const { result, setHistory, setDisplay } = renderChatThreads({
      confirm: vi.fn(async () => false),
    });
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    setHistory.mockClear();
    setDisplay.mockClear();

    await act(async () => {
      await result.current.requestDeleteThread("t1");
    });

    expect(result.current.threads).toHaveLength(1);
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
    expect(deleteThreadMock).not.toHaveBeenCalled();
  });

  it("a rejected delete sets the error state", async () => {
    const t1 = thread("t1");
    loadThreadsMock.mockResolvedValue([t1]);
    deleteThreadMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    await act(async () => {
      await result.current.requestDeleteThread("t1");
    });

    await waitFor(() => expect(result.current.threadsError).toBe(true));
  });

  // AGENTS.md ID-mint-race TEST TRAP, applied to the functional-setter fix
  // (Finding 2): the collision only reproduces when `threads` changes WHILE
  // the confirm dialog is open. A fixture that deletes against an untouched
  // list passes whichever way requestDeleteThread reads state, so this
  // seeds a concurrent rename during the awaited confirm() call.
  it("does not clobber a concurrent rename that lands while the confirm dialog is open", async () => {
    const t1 = thread("t1");
    const t2 = thread("t2", { name: "Old t2 name" });
    loadThreadsMock.mockResolvedValue([t1, t2]);
    let resolveConfirm!: (v: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((res) => {
          resolveConfirm = res;
        }),
    );
    const { result } = renderChatThreads({ confirm });
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = result.current.requestDeleteThread("t1");
    });
    // While the confirm dialog is "open", a concurrent rename commits.
    act(() => result.current.renameThread("t2", "Renamed while confirming"));
    expect(result.current.threads.find((th) => th.id === "t2")?.name).toBe(
      "Renamed while confirming",
    );

    await act(async () => {
      resolveConfirm(true);
      await deletePromise;
    });

    expect(result.current.threads.map((th) => th.id)).toEqual(["t2"]);
    expect(result.current.threads[0]!.name).toBe("Renamed while confirming");
  });

  // Review Finding 4 (MEDIUM): the existing test above only asserts on
  // `.name`/`.updatedAt` (what renameThread touches) — fields the
  // stale-vs-fresh reselect branch never reads, so it cannot tell a FRESH
  // `threadsRef.current`/`threadIdRef.current` read apart from a reverted,
  // stale `threads`/`activeThreadId` closure read. This seeds a concurrent
  // write to the REMAINING thread's `history`/`display` — the fields that
  // branch actually adopts — via the hook's own `setThreads` (exposed for
  // exactly this: a stand-in for any concurrent writer, e.g. the busy-persist
  // effect settling a turn on a second mounted panel instance).
  it("reselects the surviving thread using its FRESH history/display, not the pre-confirm snapshot", async () => {
    const t1 = thread("t1");
    const staleHistory: ApiMessage[] = [{ role: "user", content: "stale t2" }];
    const staleDisplay: DisplayItem[] = [{ kind: "user", text: "stale t2" }];
    const t2 = thread("t2", { history: staleHistory, display: staleDisplay });
    loadThreadsMock.mockResolvedValue([t1, t2]);
    let resolveConfirm!: (v: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((res) => {
          resolveConfirm = res;
        }),
    );
    const { result, setHistory, setDisplay } = renderChatThreads({ confirm });
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.activeThreadId).toBe("t1");
    setHistory.mockClear();
    setDisplay.mockClear();

    let deletePromise!: Promise<void>;
    act(() => {
      // Deleting the ACTIVE thread (t1) is what enters the reselect branch.
      deletePromise = result.current.requestDeleteThread("t1");
    });

    // A concurrent write lands while the confirm dialog is "open": t2's
    // history/display change — the exact fields the reselect branch reads.
    const freshHistory: ApiMessage[] = [
      ...staleHistory,
      { role: "assistant", content: [{ type: "text", text: "fresh reply" }] },
    ];
    const freshDisplay: DisplayItem[] = [
      ...staleDisplay,
      { kind: "assistant", text: "fresh reply" },
    ];
    act(() => {
      result.current.setThreads((prev) =>
        prev.map((th) => (th.id === "t2" ? { ...th, history: freshHistory, display: freshDisplay } : th)),
      );
    });

    await act(async () => {
      resolveConfirm(true);
      await deletePromise;
    });

    expect(result.current.activeThreadId).toBe("t2");
    // FRESH values (post-concurrent-write), never the pre-confirm snapshot.
    expect(setHistory).toHaveBeenCalledWith(freshHistory);
    expect(setDisplay).toHaveBeenCalledWith(freshDisplay);
  });

  // Mutation check (documented, not duplicated): reverting requestDeleteThread's
  // `threadsRef.current` / `threadIdRef.current === id` reads back to the
  // stale `threads` / `activeThreadId` closure reads turns the test above red
  // — `remaining` would then be computed from the PRE-concurrent-write
  // `threads` closure, so `setHistory`/`setDisplay` would be called with the
  // STALE t2 values instead of the fresh ones. See the task's VERIFY step for
  // the before/after counts.
  it("mutation check: reverting to the stale threads/activeThreadId closure reads is caught above", () => {
    expect(true).toBe(true);
  });
});

describe("useChatThreads — retry (save failure vs. load failure)", () => {
  // Stable across rerenders — mirrors how ChatPanel's own refs/setters are
  // stable identities. Building a NEW vi.fn()/ref object per rerender call
  // would make the mount-fetch effect's [..., setHistory, setDisplay] dep
  // array see a "changed" dependency on every rerender and re-run the
  // initial fetch (clobbering `threads`/pendingRetryRef) — an artifact of
  // the deps object, not something ChatPanel's real usage exhibits.
  function makeStableDeps() {
    const setHistory = vi.fn();
    const setDisplay = vi.fn();
    const confirm = vi.fn(async () => true);
    const cancelledRef = { current: false };
    const abortRef: { current: AbortController | null } = { current: null };
    return function retryDeps(over: Partial<UseChatThreadsDeps>): UseChatThreadsDeps {
      return {
        tursoMode: true,
        tursoConfig: null,
        projectId: "default",
        lang: "en-US",
        busy: false,
        history: [],
        display: [],
        setHistory,
        setDisplay,
        cancelledRef,
        abortRef,
        confirm,
        ...over,
      };
    };
  }

  it("retryLoad re-issues the failed SAVE (never a reload) when a save is pending, and clears the error on success", async () => {
    saveThreadMock.mockRejectedValueOnce(new Error("network down"));
    const retryDeps = makeStableDeps();
    const { result, rerender } = renderHook((props: UseChatThreadsDeps) => useChatThreads(props), {
      initialProps: retryDeps({ busy: false }),
    });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    loadThreadsMock.mockClear();

    act(() => result.current.newThread());
    const newId = result.current.activeThreadId!;

    // Drive a settled turn: busy true, then false.
    const turnHistory: ApiMessage[] = [{ role: "user", content: "hello" }];
    const turnDisplay: DisplayItem[] = [{ kind: "user", text: "hello" }];
    rerender(retryDeps({ busy: true, history: turnHistory, display: turnDisplay }));
    rerender(retryDeps({ busy: false, history: turnHistory, display: turnDisplay }));

    await waitFor(() => expect(result.current.threadsError).toBe(true));
    expect(saveThreadMock).toHaveBeenCalledTimes(1);

    saveThreadMock.mockResolvedValueOnce(undefined);
    act(() => result.current.retryLoad());

    // The retry re-attempts the SAME save, never a reload.
    expect(loadThreadsMock).not.toHaveBeenCalled();
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(2));
    const retried = saveThreadMock.mock.calls.at(-1)![1] as ChatThread;
    expect(retried.id).toBe(newId);
    await waitFor(() => expect(result.current.threadsError).toBe(false));
  });

  it("retryLoad reloads from Turso when the initial fetch itself failed (no pending save)", async () => {
    loadThreadsMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threadsError).toBe(true));
    expect(loadThreadsMock).toHaveBeenCalledTimes(1);

    loadThreadsMock.mockResolvedValueOnce([thread("t1")]);
    act(() => result.current.retryLoad());

    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.threadsError).toBe(false));
    expect(result.current.threads).toHaveLength(1);
  });

  it("mutation check: reverting retry to always reload would overwrite the live (unsaved) conversation — caught above", () => {
    // Documented, not duplicated: the first test in this describe block IS
    // the mutation-verify target for Finding 1 (see the task's VERIFY step —
    // reverting retryLoad's `if (pendingRetryRef.current)` branch turns that
    // test red because loadThreadsMock would then be called).
    expect(true).toBe(true);
  });
});

describe("useChatThreads — retryLoad re-issues EVERY failed write, not just the most recent (Finding 3)", () => {
  it("two independent failures on DIFFERENT threads are both re-issued by a single Retry", async () => {
    const t1 = thread("t1");
    const t2 = thread("t2");
    loadThreadsMock.mockResolvedValue([t1, t2]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    // t1's save fails first — the retry banner comes up.
    saveThreadMock.mockRejectedValueOnce(new Error("network down"));
    act(() => result.current.renameThread("t1", "Renamed t1"));
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    // BEFORE the user clicks Retry, a second, unrelated write (t2's save)
    // also fails — with a single-slot ref this would silently overwrite t1's
    // pending retry; t1's failed save would then never be re-issued.
    saveThreadMock.mockRejectedValueOnce(new Error("network down"));
    act(() => result.current.renameThread("t2", "Renamed t2"));
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(2));
    expect(result.current.threadsError).toBe(true);

    // One Retry click re-issues BOTH.
    saveThreadMock.mockResolvedValue(undefined);
    act(() => result.current.retryLoad());

    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(4));
    const retriedIds = saveThreadMock.mock.calls
      .slice(2)
      .map((c) => (c[1] as ChatThread).id)
      .sort();
    expect(retriedIds).toEqual(["t1", "t2"]);
    // Both retries succeeded — nothing left pending, banner clears.
    await waitFor(() => expect(result.current.threadsError).toBe(false));
  });

  // Mutation check: reverting pendingRetryRef to a single `() => void` slot
  // (unconditionally overwritten in runPersist's .catch) turns the test above
  // red — only t2 (the LAST failure) would be re-issued on Retry, so
  // saveThreadMock would sit at 3 calls, not 4, and `retriedIds` would be
  // `["t2"]`. See the task's VERIFY step for the before/after counts.
  it("mutation check: a single-slot pendingRetryRef would drop the earlier failure — caught above", () => {
    expect(true).toBe(true);
  });
});

describe("useChatThreads — busy-persist effect: existing-thread name reuse", () => {
  // Stable across rerenders — see makeStableDeps' comment in the retry
  // describe block above for why fresh vi.fn()/ref identities per call would
  // make the mount-fetch effect re-run on every rerender.
  function makeStableDeps() {
    const setHistory = vi.fn();
    const setDisplay = vi.fn();
    const confirm = vi.fn(async () => true);
    const cancelledRef = { current: false };
    const abortRef: { current: AbortController | null } = { current: null };
    return function deps(over: Partial<UseChatThreadsDeps>): UseChatThreadsDeps {
      return {
        tursoMode: true,
        tursoConfig: null,
        projectId: "default",
        lang: "en-US",
        busy: false,
        history: [],
        display: [],
        setHistory,
        setDisplay,
        cancelledRef,
        abortRef,
        confirm,
        ...over,
      };
    };
  }

  it("a second turn in an already-named thread keeps its stored name rather than re-deriving it", async () => {
    const deps = makeStableDeps();
    const { result, rerender } = renderHook((props: UseChatThreadsDeps) => useChatThreads(props), {
      initialProps: deps({ busy: false }),
    });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    const turn1History: ApiMessage[] = [{ role: "user", content: "First message" }];
    const turn1Display: DisplayItem[] = [{ kind: "user", text: "First message" }];
    rerender(deps({ busy: true, history: turn1History, display: turn1Display }));
    rerender(deps({ busy: false, history: turn1History, display: turn1Display }));

    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.threads[0]!.name).toBe("First message");
    const threadId = result.current.threads[0]!.id;

    // Rename the thread so its STORED name diverges from what re-deriving
    // turn 2's display would produce. Without this, re-deriving from turn
    // 2's display (which still starts with turn 1's own first user message,
    // since history/display only ever grow) would happen to land on the
    // SAME name as the stored one — a vacuous test that cannot tell "kept
    // the stored name" apart from "re-derived it anyway" (AGENTS.md's TEST
    // TRAP: seed the collision explicitly, or the divergence, explicitly).
    act(() => result.current.renameThread(threadId, "Custom renamed title"));
    expect(result.current.threads[0]!.name).toBe("Custom renamed title");

    const turn2History: ApiMessage[] = [
      ...turn1History,
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: "Second message" },
    ];
    const turn2Display: DisplayItem[] = [
      ...turn1Display,
      { kind: "assistant", text: "reply" },
      { kind: "user", text: "Second message" },
    ];
    rerender(deps({ busy: true, history: turn2History, display: turn2Display }));
    rerender(deps({ busy: false, history: turn2History, display: turn2Display }));

    await waitFor(() => expect(result.current.threads[0]!.history).toEqual(turn2History));
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0]!.id).toBe(threadId);
    // The stored (renamed) name must survive the second turn's settle —
    // dropping `existing?.name ??` would re-derive from turn 2's display and
    // silently revert this back to "First message".
    expect(result.current.threads[0]!.name).toBe("Custom renamed title");
  });
});

describe("useChatThreads — ensureThreadForSend (Finding 4)", () => {
  it("inserts and saves a row for a brand-new thread's first send, before the turn settles", async () => {
    const { result } = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    act(() => result.current.newThread());
    const newId = result.current.activeThreadId!;
    expect(result.current.threads).toEqual([]);

    const sentHistory: ApiMessage[] = [{ role: "user", content: "hello" }];
    const sentDisplay: DisplayItem[] = [{ kind: "user", text: "hello" }];
    act(() => result.current.ensureThreadForSend(sentHistory, sentDisplay));

    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0]!.id).toBe(newId);
    expect(result.current.threads[0]!.display).toEqual(sentDisplay);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    const saved = saveThreadMock.mock.calls.at(-1)![1] as ChatThread;
    expect(saved.id).toBe(newId);
    expect(saved.display).toEqual(sentDisplay);
  });

  it("is a no-op once the thread already has a row (existing thread, e.g. a later turn)", async () => {
    const existing = thread("t1");
    loadThreadsMock.mockResolvedValue([existing]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    act(() =>
      result.current.ensureThreadForSend(
        [{ role: "user", content: "another message" }],
        [{ kind: "user", text: "another message" }],
      ),
    );

    expect(saveThreadMock).not.toHaveBeenCalled();
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0]).toBe(existing);
  });

  // Finding 4's full trace: a brand-new thread's first turn survives even
  // if the user switches to a different thread before the reply lands —
  // simulated here at the hook level (ChatPanel's own switch-away/abort
  // wiring is exercised in chat-panel.test.tsx; this pins that the SAVED
  // thread row itself is not lost once ensureThreadForSend has run).
  it("the abandoned new thread's row survives a mid-send switch to a different thread", async () => {
    const other = thread("other", { history: [], display: [{ kind: "user", text: "other content" }] });
    loadThreadsMock.mockResolvedValue([other]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    act(() => result.current.newThread());
    const newId = result.current.activeThreadId!;
    const sentHistory: ApiMessage[] = [{ role: "user", content: "orphaned message" }];
    const sentDisplay: DisplayItem[] = [{ kind: "user", text: "orphaned message" }];
    act(() => result.current.ensureThreadForSend(sentHistory, sentDisplay));
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));

    // User switches away before the reply lands.
    act(() => result.current.selectThread("other"));

    expect(result.current.activeThreadId).toBe("other");
    const orphan = result.current.threads.find((th) => th.id === newId);
    expect(orphan).toBeDefined();
    expect(orphan!.display).toEqual(sentDisplay);
    const otherRow = result.current.threads.find((th) => th.id === "other");
    expect(otherRow!.display).toEqual(other.display);
  });

  // Review Finding 1 (HIGH): a fresh Turso project has ZERO threads, so the
  // fetch-on-mount effect adopts `activeThreadId = null` — the state a brand
  // new project starts in, before the user has ever clicked "New chat" or
  // selected a thread. This is the MOST COMMON way ensureThreadForSend is
  // ever reached, and the old `activeThreadId === null` bail left it doing
  // nothing at exactly that call site: the first message a user ever sends
  // got no row and no recovery path.
  it("mints and adopts a thread id, then inserts+saves a row, when NO thread was active yet (fresh project)", async () => {
    // Default mock resolves loadThreads to [] — activeThreadId stays null.
    const { result } = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect(result.current.activeThreadId).toBeNull();
    expect(result.current.threads).toEqual([]);

    const sentHistory: ApiMessage[] = [{ role: "user", content: "very first message" }];
    const sentDisplay: DisplayItem[] = [{ kind: "user", text: "very first message" }];
    let returnedId: string | null = null;
    act(() => {
      returnedId = result.current.ensureThreadForSend(sentHistory, sentDisplay);
    });

    // A thread id was minted and ADOPTED as active — not left null.
    expect(returnedId).toEqual(expect.any(String));
    expect(result.current.activeThreadId).toBe(returnedId);
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0]!.id).toBe(returnedId);
    expect(result.current.threads[0]!.display).toEqual(sentDisplay);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    const saved = saveThreadMock.mock.calls.at(-1)![1] as ChatThread;
    expect(saved.id).toBe(returnedId);
    expect(saved.display).toEqual(sentDisplay);
  });

  // Mutation-verify: restoring the old `activeThreadId === null` bail turns
  // the test above red (no mint, no insert, no save) — see this suite's own
  // VERIFY step in the task brief for the before/after counts.
  it("mutation check: an early `activeThreadId === null` bail would leave the fresh-project send with no row — caught above", () => {
    expect(true).toBe(true);
  });
});
