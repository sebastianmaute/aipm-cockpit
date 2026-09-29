// src/app/use-chat-threads.target.test.tsx — §604. A chat thread write stays in the Turso database
// it started in: a Turso URL/token change keeps `projectId` (so no remount, no project epoch move),
// and every write or load settle that outlives it must still address the ORIGINAL database. Kept
// apart from use-chat-threads.test.tsx, which is already 2600+ lines.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import { loadThreads, saveThread, deleteThread } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";
import type { TursoConfig } from "./turso-config";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { PENDING_EDITS_PREFIX, pendingEditScope, resetPendingEditsForTests } from "./pending-edits";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
const saveThreadMock = saveThread as unknown as ReturnType<typeof vi.fn>;
const deleteThreadMock = deleteThread as unknown as ReturnType<typeof vi.fn>;

const CFG_A: TursoConfig = { httpUrl: "https://database-a.example.invalid", authToken: "token-a" };
const CFG_B: TursoConfig = { httpUrl: "https://database-b.example.invalid", authToken: "token-b" };
const STALE_TARGET_CODE = "storage.chatThreadsStaleTargetDropped";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A load that never settles — database B's own load still being out. */
const neverSettles = () => new Promise<ChatThread[]>(() => undefined);

/** Database B's load never settles; database A answers its FIRST load with `first` and every later
 *  one (a retry) with `later`. */
function loadsByDatabase(first: ChatThread[], later?: Promise<ChatThread[]>, inB?: ChatThread[]): void {
  let loadsInA = 0;
  loadThreadsMock.mockImplementation((cfg: TursoConfig | null) => {
    if (cfg === CFG_B) return inB ? Promise.resolve(inB) : neverSettles();
    loadsInA += 1;
    return loadsInA === 1 || !later ? Promise.resolve(first) : later;
  });
}

/** Lets a settled promise's `.then`/`.catch` chain run inside act. */
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderChatThreads(overrides: Partial<UseChatThreadsDeps> = {}) {
  const initialProps: UseChatThreadsDeps = {
    tursoMode: true,
    tursoConfig: CFG_A,
    projectId: "default",
    lang: "en-US",
    busy: false,
    history: [],
    display: [],
    setHistory: vi.fn(),
    setDisplay: vi.fn(),
    cancelledRef: { current: false },
    abortRef: { current: null },
    confirm: vi.fn(async () => true),
    ...overrides,
  };
  const hook = renderHook((props: UseChatThreadsDeps) => useChatThreads(props), { initialProps });
  return { ...hook, initialProps };
}

const turn = {
  history: [{ role: "user", content: "hi" }] as ApiMessage[],
  display: [{ kind: "user", text: "hi" }] as DisplayItem[],
};
const storageKeyFor = (cfg: TursoConfig) => `${PENDING_EDITS_PREFIX}${pendingEditScope(cfg.httpUrl, "default")}`;
const stored = (cfg: TursoConfig): unknown[] =>
  JSON.parse(window.localStorage.getItem(storageKeyFor(cfg)) ?? "[]") as unknown[];
const pagehide = () => window.dispatchEvent(new Event("pagehide"));
const staleTargetLog = () => readDiagLog().filter((e) => e.code === STALE_TARGET_CODE);

beforeEach(() => {
  vi.clearAllMocks();
  loadThreadsMock.mockResolvedValue([]);
  saveThreadMock.mockResolvedValue(undefined);
  deleteThreadMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  resetPendingEditsForTests();
  clearDiagLog();
});
afterEach(() => {
  resetPendingEditsForTests();
  window.localStorage.clear();
});

describe("useChatThreads — writes stay in the Turso database they started in (§604)", () => {
  it("a send whose Turso config changes mid-turn persists to the database it started in", async () => {
    loadsByDatabase([thread("t1")]);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));

    rerender({ ...initialProps, ...turn, busy: true });
    rerender({ ...initialProps, ...turn, busy: true, tursoConfig: CFG_B });
    saveThreadMock.mockClear();
    rerender({ ...initialProps, ...turn, busy: false, tursoConfig: CFG_B });

    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    const urls = saveThreadMock.mock.calls.map(([cfg]) => (cfg as TursoConfig).httpUrl);
    expect(urls).toEqual([CFG_A.httpUrl]);
    expect((saveThreadMock.mock.calls[0]![1] as ChatThread).history).toEqual(turn.history);
  });

  it("a turn finished after a config change stays out of the new database's thread list", async () => {
    const inB = [thread("tB", { name: "In B" })];
    loadsByDatabase([thread("t1")], undefined, inB);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));

    rerender({ ...initialProps, ...turn, busy: true });
    rerender({ ...initialProps, ...turn, busy: true, tursoConfig: CFG_B });
    await waitFor(() => expect(result.current.threads).toEqual(inB));
    rerender({ ...initialProps, ...turn, busy: false, tursoConfig: CFG_B });

    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    expect((saveThreadMock.mock.calls.at(-1)![0] as TursoConfig).httpUrl).toBe(CFG_A.httpUrl);
    expect(result.current.threads).toEqual(inB);
    expect(result.current.activeThreadId).not.toBe("t1");
  });

  it("a send started after a config change persists to the new database", async () => {
    loadsByDatabase([thread("t1")], undefined, [thread("tB", { name: "In B" })]);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));

    rerender({ ...initialProps, tursoConfig: CFG_B });
    await waitFor(() => expect(result.current.threads.map((th) => th.id)).toEqual(["tB"]));
    rerender({ ...initialProps, ...turn, busy: true, tursoConfig: CFG_B });
    saveThreadMock.mockClear();
    rerender({ ...initialProps, ...turn, busy: false, tursoConfig: CFG_B });

    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    expect((saveThreadMock.mock.calls[0]![0] as TursoConfig).httpUrl).toBe(CFG_B.httpUrl);
  });

  it("a delete confirmed after a config change deletes in the database the dialog was opened in", async () => {
    loadsByDatabase([thread("t1"), thread("t2")]);
    const dialog = deferred<boolean>();
    const confirm = vi.fn(() => dialog.promise);
    const { result, rerender, initialProps } = renderChatThreads({ confirm });
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    let deleting: Promise<void> = Promise.resolve();
    act(() => {
      deleting = result.current.requestDeleteThread("t1");
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    rerender({ ...initialProps, tursoConfig: CFG_B });
    await act(async () => {
      dialog.resolve(true);
      await deleting;
    });

    expect(deleteThreadMock).toHaveBeenCalledTimes(1);
    expect(deleteThreadMock).toHaveBeenCalledWith(CFG_A, "t1", "default");
  });

  it("a turn finished after a config change settles its rename edit under the database it started in", async () => {
    loadsByDatabase([thread("t1", { name: "Old name" })]);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));
    saveThreadMock.mockReturnValueOnce(new Promise<void>(() => undefined));
    act(() => result.current.renameThread("t1", "Renamed"));
    pagehide();
    expect(stored(CFG_A)).toEqual([expect.objectContaining({ id: "t1", value: "Renamed" })]);

    rerender({ ...initialProps, ...turn, busy: true });
    rerender({ ...initialProps, ...turn, busy: true, tursoConfig: CFG_B });
    rerender({ ...initialProps, ...turn, busy: false, tursoConfig: CFG_B });

    // The turn's save carries "Renamed" to database A and lands, so A's edit is settled there.
    await waitFor(() => {
      pagehide();
      expect(stored(CFG_A)).toEqual([]);
    });
    expect(stored(CFG_B)).toEqual([]);
  });
});

describe("useChatThreads — a load retry outliving a Turso target change (§604)", () => {
  it("a load retry issued before a config change is dropped when it settles", async () => {
    const retry = deferred<ChatThread[]>();
    const inB = [thread("tB", { name: "In B" })];
    loadsByDatabase([thread("t1")], retry.promise, inB);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));

    act(() => result.current.retryLoad());
    expect(loadThreadsMock).toHaveBeenLastCalledWith(CFG_A, "default");
    rerender({ ...initialProps, tursoConfig: CFG_B });
    await waitFor(() => expect(result.current.threads).toEqual(inB));
    await settle(() => retry.resolve([thread("t1", { name: "Stale in A" })]));

    expect(result.current.threads).toEqual(inB);
    expect(staleTargetLog()).toHaveLength(1);
    const logged = JSON.stringify(staleTargetLog());
    expect(logged).not.toContain("example.invalid");
    expect(logged).not.toContain("token-");
  });

  it("a failed load retry issued before a config change raises no load-failure banner", async () => {
    const retry = deferred<ChatThread[]>();
    const inB = [thread("tB", { name: "In B" })];
    loadsByDatabase([thread("t1")], retry.promise, inB);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));

    act(() => result.current.retryLoad());
    rerender({ ...initialProps, tursoConfig: CFG_B });
    await waitFor(() => expect(result.current.threads).toEqual(inB));
    await settle(() => retry.reject(new Error("database A unreachable")));

    expect(result.current.threadsError).toBe(false);
    expect(result.current.threads).toEqual(inB);
    expect(result.current.activeThreadId).toBe("tB");
    expect(staleTargetLog()).toHaveLength(1);
  });

  it("a load retry dropped after a config change replays no outbox edit", async () => {
    const retry = deferred<ChatThread[]>();
    loadsByDatabase([thread("t1", { name: "Old name" })], retry.promise);
    const edit = { v: 1, kind: "chat-thread-name", id: "t1", base: "Old name", value: "Replayed", savedAt: Date.now() };
    window.localStorage.setItem(storageKeyFor(CFG_B), JSON.stringify([edit]));
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));

    act(() => result.current.retryLoad());
    rerender({ ...initialProps, tursoConfig: CFG_B });
    saveThreadMock.mockClear();
    await settle(() => retry.resolve([thread("t1", { name: "Old name" })]));

    expect(saveThreadMock).not.toHaveBeenCalled();
    expect(result.current.threads.map((th) => th.name)).toEqual(["Old name"]);
  });

  it("a load retry dropped after a config change leaves the confirmed names alone", async () => {
    const retry = deferred<ChatThread[]>();
    loadsByDatabase([thread("t1", { name: "Old name" })], retry.promise);
    const { result, rerender, initialProps } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("t1"));
    act(() => result.current.renameThread("t1", "Mine"));
    await waitFor(() => {
      pagehide();
      expect(stored(CFG_A)).toEqual([]);
    });

    act(() => result.current.retryLoad());
    rerender({ ...initialProps, tursoConfig: CFG_B });
    await settle(() => retry.resolve([thread("t1", { name: "Old name" })]));
    act(() => result.current.trackRenameDraft("t1", "Draft"));
    pagehide();

    expect(stored(CFG_B)).toEqual([expect.objectContaining({ id: "t1", base: "Mine", value: "Draft" })]);
  });
});
