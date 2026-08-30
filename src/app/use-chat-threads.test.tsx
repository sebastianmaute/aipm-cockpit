// src/app/use-chat-threads.test.tsx — direct unit coverage for the
// use-chat-threads.ts deps-object hook. Presentational tests elsewhere
// (chat-thread-sidebar.test.tsx, chat-thread-list.test.tsx) pin only "the
// button calls the prop it was given" — this file pins the hook's actual
// persistence/CRUD logic: newThread/selectThread/renameThread/
// requestDeleteThread/retryLoad/ensureThreadForSend and the busy-persist
// effect's existing-thread name reuse.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import { loadThreads, saveThread, deleteThread } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";
import { clearChatThreads, publishChatThreads, readChatThreads } from "./chat-threads-registry";

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
  // `initialProps` is returned so a test can `rerender({ ...initialProps, x })`
  // — rerender needs the WHOLE deps object, and rebuilding it by hand in a test
  // would let the two copies drift.
  return { ...hook, setHistory, setDisplay, confirm, initialProps };
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
  //
  // MUTATION-PROVED, 2026-08-14: reverting requestDeleteThread's
  // `threadsRef.current` / `threadIdRef.current === id` reads back to the
  // stale `threads` / `activeThreadId` closure reads turns EXACTLY THIS ONE
  // test red — `remaining` is then computed from the PRE-concurrent-write
  // `threads` closure, so `setHistory`/`setDisplay` are called with the STALE
  // t2 values. ★ The other requestDeleteThread test ("does not clobber a
  // concurrent rename…") stays GREEN under that mutant, so it is NOT a
  // detector for this; this test is the only one.
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

  // MUTATION-PROVED, 2026-08-14: reverting retryLoad to ALWAYS reload —
  // `if (pendingRetryRef.current.size > 0)` → `if (false)` — would overwrite
  // the live, unsaved conversation with whatever the server still has. It
  // turns 3 tests red, this one among them (the other two are the two
  // Finding-3 retry tests further down).
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

});

describe("useChatThreads — retryLoad re-issues EVERY failed write, not just the most recent (Finding 3)", () => {
  // MUTATION-PROVED, 2026-08-14: giving pendingRetryRef single-slot semantics
  // — a `pendingRetryRef.current.clear()` immediately before runPersist's
  // `.catch` `.set(key, …)` — turns EXACTLY THIS ONE test red: only t2 (the
  // LAST failure) is re-issued, so saveThreadMock stops at 3 calls, not 4,
  // and `retriedIds` is `["t2"]`.
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

});

// ---------------------------------------------------------------------------
// §148: retryLoad's reload branch had NEITHER of the mount-fetch effect's
// `startedOn` guards. The drop path: the initial fetch fails → pendingRetryRef
// is empty (a failed FETCH has no write to replay — see retryLoad's own
// comment) → Retry falls through to a fresh reload. A send begun between the
// click and that reload settling calls ensureThreadForSend, which mints an id
// and writes threadIdRef.current SYNCHRONOUSLY. The resolving reload's
// `loaded` cannot contain that row, so the unguarded `setThreads(loaded)`
// dropped it, `setActiveThreadId` moved the active id, and the threadIdRef
// sync effect then aborted the in-flight send and wiped history/display —
// the user's just-sent message vanished from the UI while its row sat in
// Turso (or, on the .catch side, was never given a chance to save at all).
// ---------------------------------------------------------------------------
describe("useChatThreads — retryLoad's reload vs. a send that started first (§148)", () => {
  it("a successful retry-reload merges under a thread minted mid-flight instead of replacing it", async () => {
    loadThreadsMock.mockRejectedValueOnce(new Error("network down"));
    const { result, setHistory, setDisplay } = renderChatThreads();
    await waitFor(() => expect(result.current.threadsError).toBe(true));
    // The initial failure's own catch branch already reset to the empty
    // state (no mid-flight mint happened during the MOUNT fetch).
    expect(result.current.activeThreadId).toBeNull();

    let resolveRetry!: (threads: ChatThread[]) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveRetry = res;
      }),
    );
    act(() => result.current.retryLoad());
    // ★★★ VACUITY GUARD: confirms retryLoad reached the RELOAD branch (a
    // pending-write retry would never call loadThreads again).
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));

    // A send begins WHILE the retry-reload is in flight — mints a thread and
    // moves threadIdRef.current SYNCHRONOUSLY, exactly as a real send does.
    const sentHistory: ApiMessage[] = [{ role: "user", content: "in-flight" }];
    const sentDisplay: DisplayItem[] = [{ kind: "user", text: "in-flight" }];
    let mintedId: string | null = null;
    act(() => {
      mintedId = result.current.ensureThreadForSend(sentHistory, sentDisplay);
    });
    expect(mintedId).toEqual(expect.any(String));
    // Only writes made AFTER the mint are this test's subject.
    setHistory.mockClear();
    setDisplay.mockClear();

    resolveRetry([thread("t-server")]);
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    // Positive control: the server's own thread is still present (a bail
    // would have dropped it — this isn't merely "nothing got worse").
    expect(result.current.threads.map((th) => th.id).sort()).toEqual(
      [mintedId, "t-server"].sort(),
    );
    // The minted thread survives and stays active.
    expect(result.current.activeThreadId).toBe(mintedId);
    // The in-flight send's conversation is not reset out from under it, and
    // the mid-flight-mint's own send is neither cancelled nor aborted.
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
  });

  it("a FAILED retry-reload also leaves a thread minted mid-flight alone", async () => {
    loadThreadsMock.mockRejectedValueOnce(new Error("network down"));
    const { result, setHistory, setDisplay } = renderChatThreads();
    await waitFor(() => expect(result.current.threadsError).toBe(true));
    expect(result.current.activeThreadId).toBeNull();

    let rejectRetry!: (reason: unknown) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((_res, rej) => {
        rejectRetry = rej;
      }),
    );
    act(() => result.current.retryLoad());
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));

    let mintedId: string | null = null;
    act(() => {
      mintedId = result.current.ensureThreadForSend(
        [{ role: "user", content: "in-flight" }],
        [{ kind: "user", text: "in-flight" }],
      );
    });
    expect(mintedId).toEqual(expect.any(String));
    setHistory.mockClear();
    setDisplay.mockClear();

    rejectRetry(new Error("still down"));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    // Positive control: the minted row is still there — not merely "the list
    // isn't empty for some unrelated reason".
    expect(result.current.threads.map((th) => th.id)).toEqual([mintedId]);
    expect(result.current.activeThreadId).toBe(mintedId);
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §148 (second ordering): the `startedOn` guard above catches a send begun
// AFTER Retry was clicked. It is structurally blind to a send ALREADY IN
// FLIGHT at click time — and the failed mount fetch's own stale branch is what
// produces that state. Trace:
//   1. Turso mount. loadThreads in flight; startedOn = null.
//   2. chat-panel's `chatSeed` mount effect auto-sends. ensureThreadForSend
//      mints M and writes threadIdRef.current = M synchronously; its save
//      succeeds, so pendingRetryRef stays EMPTY.
//   3. The mount fetch REJECTS → resetThreadsAfterFailedLoad(null, M) is
//      stale → early return. M stays in the list and active, history/display
//      keep the user's live message, the banner shows.
//   4. The send is still streaming. Retry → pendingRetryRef is empty (the
//      FETCH failed, not a write), so retryLoad takes the RELOAD branch.
//   5. startedOn = threadIdRef.current = M. The reload resolves with
//      threadIdRef.current STILL M, so the identity test reads CLEAN — the ref
//      moved BEFORE this fetch started, not during it.
//   6. Unguarded, setThreads(() => loaded) drops M, setActiveThreadId adopts
//      loaded[0], setHistory/setDisplay replace the live conversation, and the
//      threadIdRef sync effect (prev M !== loaded[0].id) sets cancelledRef and
//      calls abortRef.current.abort() — the in-flight send dies and the user's
//      typed message is gone.
// The discriminator that closes it is IN-FLIGHT SEND state, read from
// `abortRef` (a ref, so it is fresh at settle time — retryLoad is
// non-memoized, so its closure's `busy` is whatever the clicked render held).
// ---------------------------------------------------------------------------
describe("useChatThreads — retryLoad's reload vs. a send already in flight at click time (§148)", () => {
  /** Drives the six-step ordering above up to "the retry-reload has resolved",
   *  and hands back everything the assertions need. Each `it` runs it fresh —
   *  vitest aborts a block at its first hard failure, so one assertion per
   *  test is the only way all of them are ever evaluated. */
  async function arrangeInFlightSendAcrossRetry() {
    // (1) The mount fetch, held open so the send can start underneath it.
    let rejectMount!: (reason: unknown) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((_res, rej) => {
        rejectMount = rej;
      }),
    );
    const cancelledRef = { current: false };
    const abortRef: { current: AbortController | null } = { current: null };
    const harness = renderChatThreads({ cancelledRef, abortRef });
    const { result, setHistory, setDisplay } = harness;
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    // (2) The auto-send. submitPrompt arms abortRef BEFORE it calls
    // ensureThreadForSend, so this is the real order, not a convenient one.
    const controller = new AbortController();
    abortRef.current = controller;
    let mintedId: string | null = null;
    act(() => {
      mintedId = result.current.ensureThreadForSend(
        [{ role: "user", content: "typed by the user" }],
        [{ kind: "user", text: "typed by the user" }],
      );
    });
    expect(mintedId).toEqual(expect.any(String));

    // (3) The mount fetch fails on the STALE path — it must leave the minted
    // thread, and the live conversation, alone.
    rejectMount(new Error("network down"));
    await waitFor(() => expect(result.current.threadsError).toBe(true));
    expect(result.current.activeThreadId).toBe(mintedId);

    // (4) Retry, with the send still streaming.
    let resolveRetry!: (threads: ChatThread[]) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveRetry = res;
      }),
    );
    act(() => result.current.retryLoad());
    // ★★★ VACUITY GUARD: proves retryLoad reached the RELOAD branch. A pending
    // WRITE retry would re-issue that write and never call loadThreads again,
    // and then every assertion below would pass for the wrong reason.
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));
    // Only writes made after this point are the subject.
    setHistory.mockClear();
    setDisplay.mockClear();

    // (5) The reload resolves with the ref UNMOVED since the click.
    resolveRetry([thread("t-server")]);
    // Settle witness that holds on BOTH the merged and the replaced branch —
    // `.then` clears the banner before it ever consults staleness — so a red
    // here is an assertion failure, never a timeout on the broken code.
    await waitFor(() => expect(result.current.threadsError).toBe(false));

    return { ...harness, mintedId, controller, cancelledRef };
  }

  it("refreshes the thread list from the server (positive control for the absence assertions below)", async () => {
    const { result } = await arrangeInFlightSendAcrossRetry();
    expect(result.current.threads.map((th) => th.id)).toContain("t-server");
  });

  it("keeps the in-flight send's thread in the list", async () => {
    const { result, mintedId } = await arrangeInFlightSendAcrossRetry();
    expect(result.current.threads.map((th) => th.id)).toContain(mintedId);
  });

  it("leaves the in-flight send's thread active", async () => {
    const { result, mintedId } = await arrangeInFlightSendAcrossRetry();
    expect(result.current.activeThreadId).toBe(mintedId);
  });

  it("does not replace the live conversation the user's message is in", async () => {
    const { setHistory, setDisplay } = await arrangeInFlightSendAcrossRetry();
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
  });

  it("does not cancel the in-flight send", async () => {
    const { cancelledRef } = await arrangeInFlightSendAcrossRetry();
    expect(cancelledRef.current).toBe(false);
  });

  it("does not abort the in-flight send's controller", async () => {
    const { controller } = await arrangeInFlightSendAcrossRetry();
    expect(controller.signal.aborted).toBe(false);
  });

  /** Same ordering, but the retry-reload REJECTS. The unguarded catch is the
   *  more destructive of the two settle paths: it resets `threads` to empty
   *  and history/display with it, so the live message goes even though the
   *  server said nothing about the thread holding it. */
  async function arrangeInFlightSendAcrossFailingRetry() {
    let rejectMount!: (reason: unknown) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((_res, rej) => {
        rejectMount = rej;
      }),
    );
    const cancelledRef = { current: false };
    const abortRef: { current: AbortController | null } = { current: null };
    const harness = renderChatThreads({ cancelledRef, abortRef });
    const { result, setHistory, setDisplay } = harness;
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    abortRef.current = controller;
    let mintedId: string | null = null;
    act(() => {
      mintedId = result.current.ensureThreadForSend(
        [{ role: "user", content: "typed by the user" }],
        [{ kind: "user", text: "typed by the user" }],
      );
    });
    rejectMount(new Error("network down"));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    let rejectRetry!: (reason: unknown) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((_res, rej) => {
        rejectRetry = rej;
      }),
    );
    act(() => result.current.retryLoad());
    // ★★★ VACUITY GUARD, as above: proves the RELOAD branch was taken.
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));
    setHistory.mockClear();
    setDisplay.mockClear();
    // ★★★ The banner is ALREADY true here (the mount fetch failed), so a bare
    // `waitFor(threadsError === true)` after the rejection is VACUOUS — it
    // returns on the first poll, before the catch has settled, and every
    // assertion below then reads pre-settle state and passes for free.
    // Measured: three of these four tests SURVIVED a `preserveLive = false`
    // mutant that way. Clear it INSIDE act (so the commit is flushed, not
    // merely scheduled) to make it a real witness, and drain the microtask
    // queue inside act so the settle is deterministic rather than a race with
    // waitFor's own flush.
    act(() => result.current.setThreadsError(false));
    expect(result.current.threadsError).toBe(false);
    await act(async () => {
      rejectRetry(new Error("still down"));
      await Promise.resolve();
    });
    // Branch-independent settle witness: the catch raises the banner before it
    // ever consults staleness.
    expect(result.current.threadsError).toBe(true);

    return { ...harness, mintedId, controller, cancelledRef };
  }

  it("a FAILED retry-reload keeps the in-flight send's thread in the list", async () => {
    const { result, mintedId } = await arrangeInFlightSendAcrossFailingRetry();
    expect(result.current.threads.map((th) => th.id)).toEqual([mintedId]);
  });

  it("a FAILED retry-reload leaves the in-flight send's thread active", async () => {
    const { result, mintedId } = await arrangeInFlightSendAcrossFailingRetry();
    expect(result.current.activeThreadId).toBe(mintedId);
  });

  it("a FAILED retry-reload does not replace the live conversation", async () => {
    const { setHistory, setDisplay } = await arrangeInFlightSendAcrossFailingRetry();
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
  });

  it("a FAILED retry-reload does not abort the in-flight send", async () => {
    const { controller, cancelledRef } = await arrangeInFlightSendAcrossFailingRetry();
    expect(controller.signal.aborted).toBe(false);
    expect(cancelledRef.current).toBe(false);
  });

  it("still adopts the server's newest thread once the send has settled (the guard is not a permanent bail)", async () => {
    let resolveMount!: (threads: ChatThread[]) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveMount = res;
      }),
    );
    const abortRef: { current: AbortController | null } = { current: null };
    const { result } = renderChatThreads({ abortRef });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    resolveMount([]);
    await waitFor(() => expect(result.current.threadsError).toBe(false));

    // No send has ever been in flight, so a reload must behave exactly as it
    // did before this guard: adopt the server's list wholesale.
    loadThreadsMock.mockResolvedValueOnce([thread("t-server")]);
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.activeThreadId).toBe("t-server"));
    expect(result.current.threads.map((th) => th.id)).toEqual(["t-server"]);
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
  //
  // MUTATION-PROVED, 2026-08-14: restoring the old `activeThreadId === null`
  // bail — re-adding `if (activeThreadId === null) return null;` after
  // ensureThreadForSend's tursoMode check — turns this test red (no mint, no
  // insert, no save). Across this file plus chat-panel.test.tsx that one
  // mutant turns 5 tests red; in THIS file it is this test alone.
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

});

// ---------------------------------------------------------------------------
// Round-4 Finding 2: a send that STARTS before the mount fetch resolves. The
// fetch's .then ran unconditionally, so `loaded` — which cannot contain a
// thread minted after the request was issued — replaced `threads`, clobbered
// activeThreadId, wiped history/display, and (via the threadIdRef sync effect
// seeing a change) aborted the in-flight send. The row existed in Turso and
// the user's message vanished from the UI. Reachable in production:
// chat-panel.tsx's `chatSeed` effect auto-sends from a MOUNT effect, in the
// same commit that starts this fetch.
//
// MUTATION-PROVED, 2026-08-14, and the two branches are pinned INDEPENDENTLY
// (measured three ways, not reasoned): replacing BOTH `threadIdRef.current
// !== startedOn` guards in the mount-fetch effect with `false` turns both
// tests below red; mutating only the `.then` guard turns exactly the first
// one red; only the `.catch` guard, exactly the second.
// ---------------------------------------------------------------------------
describe("useChatThreads — mount fetch vs. a send that started first (Finding 2)", () => {
  it("merges the fetched list under the mid-flight-minted thread instead of replacing it", async () => {
    let resolveLoad!: (threads: ChatThread[]) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveLoad = res;
      }),
    );
    const cancelledRef = { current: false };
    const abort = vi.fn();
    const abortRef = { current: { abort } as unknown as AbortController };
    const { result, setHistory, setDisplay } = renderChatThreads({ cancelledRef, abortRef });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    const sentHistory: ApiMessage[] = [{ role: "user", content: "in-flight" }];
    const sentDisplay: DisplayItem[] = [{ kind: "user", text: "in-flight" }];
    let mintedId: string | null = null;
    act(() => {
      mintedId = result.current.ensureThreadForSend(sentHistory, sentDisplay);
    });
    expect(mintedId).toEqual(expect.any(String));
    // Only writes made AFTER the mint are this test's subject.
    setHistory.mockClear();
    setDisplay.mockClear();

    resolveLoad([thread("t-server")]);
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    // The minted row survives and stays active; the fetched list is kept too
    // (a plain bail would have dropped the server's own threads).
    expect(result.current.activeThreadId).toBe(mintedId);
    expect(result.current.threads.map((th) => th.id)).toEqual([mintedId, "t-server"]);
    // The in-flight send's conversation is not reset out from under it, and
    // the send itself is neither cancelled nor aborted.
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
    expect(cancelledRef.current).toBe(false);
    expect(abort).not.toHaveBeenCalled();
  });

  it("a FAILED mount fetch also leaves the mid-flight-minted thread alone (it only raises the banner)", async () => {
    let rejectLoad!: (reason: unknown) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((_res, rej) => {
        rejectLoad = rej;
      }),
    );
    const { result, setHistory, setDisplay } = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));

    let mintedId: string | null = null;
    act(() => {
      mintedId = result.current.ensureThreadForSend(
        [{ role: "user", content: "in-flight" }],
        [{ kind: "user", text: "in-flight" }],
      );
    });
    setHistory.mockClear();
    setDisplay.mockClear();

    rejectLoad(new Error("network down"));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    // The catch branch's reset is the more destructive of the two —
    // setThreads([]) would drop the just-minted row while its save is still
    // on its way to Turso.
    expect(result.current.activeThreadId).toBe(mintedId);
    expect(result.current.threads.map((th) => th.id)).toEqual([mintedId]);
    expect(setHistory).not.toHaveBeenCalled();
    expect(setDisplay).not.toHaveBeenCalled();
  });

});

// ---------------------------------------------------------------------------
// Round-4 Finding 3: both of a thread's writes share one retry key, and the
// entry used to be deleted by whichever write settled LAST-successfully rather
// than by the one that owns it. So a slow ensureThreadForSend save (the user's
// question alone) resolving AFTER the busy-persist save (the full turn) had
// REJECTED deleted the full-turn retry thunk and hid the banner: the server
// kept only the question, the assistant's reply was never persisted, and the
// user was never told.
//
// MUTATION-PROVED, 2026-08-14: neutering runPersist's ownership check —
// `const owns = () => latestSeqRef.current.get(key) === seq;` → `() => true`
// — turns exactly the one test below red.
// ---------------------------------------------------------------------------
describe("useChatThreads — only the latest write for a key may settle it (Finding 3)", () => {
  it("an earlier write resolving after a later one rejected keeps the retry entry and the banner", async () => {
    loadThreadsMock.mockResolvedValue([thread("t1")]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    // Write A on t1 — issued first, resolves LAST, successfully.
    let resolveA!: () => void;
    saveThreadMock.mockReturnValueOnce(
      new Promise<void>((res) => {
        resolveA = res;
      }),
    );
    act(() => result.current.renameThread("t1", "A"));
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));

    // Write B on the SAME thread — issued second, rejects first.
    saveThreadMock.mockRejectedValueOnce(new Error("network down"));
    act(() => result.current.renameThread("t1", "B"));
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    await act(async () => {
      resolveA();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A is superseded: it may not clear B's failure.
    expect(result.current.threadsError).toBe(true);
    // Positive observable — the surviving retry is B's payload, not A's.
    saveThreadMock.mockResolvedValueOnce(undefined);
    act(() => result.current.retryLoad());
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(3));
    expect((saveThreadMock.mock.calls.at(-1)![1] as ChatThread).name).toBe("B");
    await waitFor(() => expect(result.current.threadsError).toBe(false));
  });

});

describe("useChatThreads — registry publication", () => {
  afterEach(() => {
    // Module state survives RTL cleanup and vi.clearAllMocks(), so it would
    // otherwise leak into whatever file the shuffled run schedules next.
    clearChatThreads();
  });

  it("publishes availability false in file mode", async () => {
    // ★ SEED A DIFFERENT VALUE FIRST. `readChatThreads`'s miss-path default for
    //   an empty slot is byte-identical to what file mode publishes, so the
    //   obvious version of this test passes with the effect DELETED (measured —
    //   it was the one of these three that went green on the red run).
    //   Overwriting a stale Turso-shaped value is the only observable that can
    //   tell a real publish from a never-written slot.
    publishChatThreads("p1", {
      threads: [thread("stale")],
      activeThreadId: "stale",
      available: true,
    });
    renderChatThreads({ tursoMode: false, projectId: "p1" });
    await waitFor(() =>
      expect(readChatThreads("p1")).toEqual({
        threads: [],
        activeThreadId: null,
        available: false,
      }),
    );
    expect(loadThreadsMock).not.toHaveBeenCalled();
  });

  it("publishes the live threads and active id in Turso mode", async () => {
    const t1 = thread("t1", { updatedAt: "2026-02-02T00:00:00.000Z" });
    const t2 = thread("t2");
    loadThreadsMock.mockResolvedValue([t1, t2]);
    renderChatThreads({ tursoMode: true, projectId: "p1" });

    await waitFor(() =>
      expect(readChatThreads("p1")).toEqual({
        threads: [t1, t2],
        activeThreadId: "t1",
        available: true,
      }),
    );
    // The slot is keyed — another project must not read this one's threads.
    expect(readChatThreads("p2")).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });

  it("clears the published threads when tursoMode goes false", async () => {
    // ★★★ THE LANDMINE. `panel-chat` is one of only two tabpanels
    //   `workspace-section` mounts unconditionally, so this hook NEVER remounts
    //   on navigation and nothing resets `threads` for you. The fixture loads
    //   REAL threads first precisely so that failing to gate the payload leaves
    //   observably wrong data — a `available: false` publish that still carries
    //   two conversations is the bug this test exists to catch.
    const t1 = thread("t1", { history: [{ role: "user", content: "secret" }] });
    const t2 = thread("t2");
    loadThreadsMock.mockResolvedValue([t1, t2]);
    const { rerender, initialProps } = renderChatThreads({
      tursoMode: true,
      projectId: "p1",
    });
    await waitFor(() => expect(readChatThreads("p1").threads).toEqual([t1, t2]));
    expect(readChatThreads("p1").activeThreadId).toBe("t1");

    rerender({ ...initialProps, tursoMode: false });

    await waitFor(() => expect(readChatThreads("p1").available).toBe(false));
    expect(readChatThreads("p1").threads).toEqual([]);
    expect(readChatThreads("p1").activeThreadId).toBeNull();
  });
  it("never publishes the OLD project's threads under the NEW project's id", async () => {
    // ★★★ THE LEAK. The store's single slot stops a stale KEY being read; it
    //   cannot stop a stale PAYLOAD being written under a fresh key, and
    //   `threads` is NOT reset synchronously when `projectId` changes — the
    //   reset lives in the async settle of the load effect. So in the render
    //   where the id flips p1 -> p2 the publish effect fired with p2's id and
    //   p1's still-populated rows, and the dispatcher could search another
    //   project's conversation text.
    // ★ The second load deliberately NEVER settles: the window this pins is
    //   exactly the one before it does, and a settling fetch would self-heal it.
    const p1Thread = thread("t1", {
      projectId: "p1",
      history: [{ role: "user", content: "P1 SECRET" }],
    });
    loadThreadsMock.mockResolvedValueOnce([p1Thread]);
    loadThreadsMock.mockReturnValueOnce(new Promise<ChatThread[]>(() => {}));
    const { rerender, initialProps } = renderChatThreads({ tursoMode: true, projectId: "p1" });
    await waitFor(() => expect(readChatThreads("p1").threads).toEqual([p1Thread]));

    rerender({ ...initialProps, projectId: "p2" });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));

    // `available` tracks REACHABILITY, not emptiness: a project whose load is
    // still in flight IS searchable, it just has nothing to show yet. (A load
    // that FAILED is the other side of that split — the test below.)
    expect(readChatThreads("p2")).toEqual({
      threads: [],
      activeThreadId: null,
      available: true,
    });
    expect(JSON.stringify(readChatThreads("p2"))).not.toContain("P1 SECRET");
  });

  it("holds on the mid-flight-adoption MERGE branch too, where `prev` is deliberately kept", async () => {
    // ★★ The merge branch is the amplifier: it KEEPS `prev` on purpose (so a
    //   thread minted while the fetch was in flight is not dropped), so the
    //   previous project's rows do not self-heal there — they are merged into
    //   the new project's list and then marked loaded.
    const p1Thread = thread("t1", {
      projectId: "p1",
      history: [{ role: "user", content: "P1 SECRET" }],
    });
    const p2Thread = thread("t-p2", { projectId: "p2" });
    loadThreadsMock.mockResolvedValueOnce([p1Thread]);
    let resolveP2!: (threads: ChatThread[]) => void;
    loadThreadsMock.mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveP2 = res;
      }),
    );
    const { result, rerender, initialProps } = renderChatThreads({
      tursoMode: true,
      projectId: "p1",
    });
    await waitFor(() => expect(result.current.threads).toEqual([p1Thread]));

    rerender({ ...initialProps, projectId: "p2" });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(2));
    // Adopting a thread while p2's fetch is in flight is what routes its settle
    // down the merge branch rather than the replace branch.
    act(() => result.current.newThread());

    resolveP2([p2Thread]);
    await waitFor(() => expect(readChatThreads("p2").threads).toEqual([p2Thread]));
    expect(JSON.stringify(readChatThreads("p2"))).not.toContain("P1 SECRET");
    // The sidebar's own list is scoped too — the leak was never registry-only.
    expect(result.current.threads).toEqual([p2Thread]);
  });

  it("publishes available:true with an EMPTY list for a Turso project that has no threads yet", async () => {
    // ★★★ THE INVARIANT THIS STORE EXISTS FOR. `available` answers "can this
    //   project's chats be searched at all", never "do any exist" — the
    //   engine's coverage field depends on the difference. Every other test
    //   here is either Turso-WITH-threads or file mode, so collapsing the flag
    //   to `tursoMode && threads.length > 0` is invisible without this case.
    loadThreadsMock.mockResolvedValue([]);
    const { result } = renderChatThreads({ tursoMode: true, projectId: "p1" });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.threadsError).toBe(false));

    expect(readChatThreads("p1")).toEqual({
      threads: [],
      activeThreadId: null,
      available: true,
    });
  });
  it("publishes available:false when the Turso load FAILED, not an empty-but-searched list", async () => {
    // ★★★ THIS AND THE TEST ABOVE ARE ONE PAIR — neither pins the split alone.
    //   A failed fetch settles `loadedProjectId` in its .catch() exactly as a
    //   success does, so the PAYLOAD it publishes is byte-identical to the
    //   empty-but-succeeded case above and `available` is the only field left
    //   that can tell "we looked and there is nothing" from "we could not
    //   look". Downstream a true flag becomes `coverage: "turso"`, which
    //   chat-tool-defs.ts tells the model means past conversations WERE
    //   searched — so the assistant asserts a topic was never discussed while
    //   the user is looking at the failure banner.
    // ★ Seed a stale Turso-shaped value first: `readChatThreads`'s miss-path
    //   default for an unwritten slot is byte-identical to what this asserts,
    //   so without the seed it would pass with the publish effect DELETED.
    publishChatThreads("p1", {
      threads: [thread("stale")],
      activeThreadId: "stale",
      available: true,
    });
    loadThreadsMock.mockRejectedValue(new Error("turso down"));
    const { result } = renderChatThreads({ tursoMode: true, projectId: "p1" });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    expect(readChatThreads("p1")).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });
  it("keeps available:true over a populated list when a SAVE failed, not just the load", async () => {
    // ★★★ THIS AND THE FAILED-LOAD TEST ABOVE ARE THE PAIR THAT STOPS A FUTURE
    //   EDITOR COLLAPSING THE TWO FAILURES BACK INTO ONE FLAG. `threadsError`
    //   is raised by a failed SAVE as well as a failed LOAD, and a failed save
    //   leaves the list populated and perfectly readable — so deriving
    //   `available` from it published `false` beside real, searchable threads.
    //   `use-chat-search-bindings.ts` builds the ambient chat pointer from
    //   `published.threads` and never reads `available`, so the prompt then
    //   advertised those conversations and `search_chats` answered
    //   `coverage: "unavailable"` over rows sitting in memory.
    // ★★★ THE SECOND RENAME IS WHAT MAKES THIS KILL THE ONE-TOKEN REVERT.
    //   Measured: reverting ONLY the expression to `tursoMode && !threadsError`
    //   while leaving `loadFailed` in the publish effect's dep array left this
    //   test GREEN — `setThreadsError(true)` alone does not re-run that effect,
    //   so the already-published `available: true` simply survived. Any LATER
    //   change to `threads` or `activeThreadId` DOES re-run it, and the mutant
    //   then publishes `false` over a populated list. So this drives one more
    //   publish before reading the slot; without it only the two-token revert
    //   (expression AND dep) goes red.
    // ★ That second rename SUCCEEDS and the banner still reads true: runPersist
    //   clears it only once the retry map empties, and t1's failed write is
    //   still in it. The re-publish therefore happens with the save failure
    //   still on record, which is the state the mutant gets wrong.
    // ★ The banner assertion is load-bearing in BOTH directions: it proves the
    //   save really did fail (without it a passing `available: true` could just
    //   mean nothing went wrong) AND that this fix did not silently disarm the
    //   sidebar's error affordance.
    const t1 = thread("t1", { projectId: "p1" });
    const t2 = thread("t2", { projectId: "p1" });
    loadThreadsMock.mockResolvedValue([t1, t2]);
    const { result } = renderChatThreads({ tursoMode: true, projectId: "p1" });
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    saveThreadMock.mockRejectedValueOnce(new Error("network down"));
    act(() => result.current.renameThread("t1", "Renamed"));
    await waitFor(() => expect(result.current.threadsError).toBe(true));

    await act(async () => {
      result.current.renameThread("t2", "Renamed too");
    });
    expect(result.current.threadsError).toBe(true);

    const published = readChatThreads("p1");
    expect(published.available).toBe(true);
    expect(published.threads.map((th) => th.id)).toEqual(["t1", "t2"]);
  });

  it("clears the slot on unmount, so a withdrawn AI consent leaves nothing readable", async () => {
    // ★★ Withdrawing consent unmounts this hook (chat-panel renders a consent
    //   screen instead) and nothing else in the app clears the store, so the
    //   last payload stayed readable with `available: true`.
    // ★ The fixture is NON-EMPTY first on purpose: against an empty one,
    //   "cleared" and "never published" are the same observable and this test
    //   would pass with the cleanup deleted.
    const t1 = thread("t1", {
      projectId: "p1",
      history: [{ role: "user", content: "P1 SECRET" }],
    });
    loadThreadsMock.mockResolvedValue([t1]);
    const { unmount } = renderChatThreads({ tursoMode: true, projectId: "p1" });
    await waitFor(() => expect(readChatThreads("p1").threads).toEqual([t1]));

    unmount();

    expect(readChatThreads("p1")).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });

  it("an ordinary re-publish leaves the live value in the slot, never a cleared one", async () => {
    // ★ The cleanup runs BEFORE the next effect body in the same commit, so a
    //   re-render must end with the fresh value published — a cleanup that
    //   outlived its re-publish would silently blank chat search for a panel
    //   that is still mounted.
    const t1 = thread("t1", { projectId: "p1" });
    loadThreadsMock.mockResolvedValue([t1]);
    const { rerender, initialProps } = renderChatThreads({ tursoMode: true, projectId: "p1" });
    await waitFor(() => expect(readChatThreads("p1").threads).toEqual([t1]));

    rerender({ ...initialProps, busy: true });

    expect(readChatThreads("p1")).toEqual({
      threads: [t1],
      activeThreadId: "t1",
      available: true,
    });
  });
});
