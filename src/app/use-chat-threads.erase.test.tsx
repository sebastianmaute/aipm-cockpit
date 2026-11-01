// src/app/use-chat-threads.erase.test.tsx — the hook's erase actions (delete all my chats, delete the
// ticked matches) and the pending renames every delete and expiry drops, against the REAL chat-key
// vault (fake-indexeddb) and a mocked store.
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import { loadThreads, saveThread, deleteThread, deleteOwnerThreads, expireThreads } from "./chat-threads-store";
import { ensureChatIdentity } from "./chat-key-vault";
import { readChatThreads } from "./chat-threads-registry";
import type { ChatThread } from "./chat-threads";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import { PENDING_EDITS_PREFIX, flushPendingEdits, pendingEditScope, resetPendingEditsForTests } from "./pending-edits";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => "saved"),
  deleteThread: vi.fn(async () => undefined),
  deleteOwnerThreads: vi.fn(async () => undefined),
  expireThreads: vi.fn(async () => undefined),
}));

const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
const saveThreadMock = saveThread as unknown as ReturnType<typeof vi.fn>;
const deleteThreadMock = deleteThread as unknown as ReturnType<typeof vi.fn>;
const deleteOwnerThreadsMock = deleteOwnerThreads as unknown as ReturnType<typeof vi.fn>;
const expireThreadsMock = expireThreads as unknown as ReturnType<typeof vi.fn>;

const CFG: TursoConfig = { httpUrl: "https://database-erase.example.invalid", authToken: "token-e" };
const CHAT_ON: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: "recovery-spki", recoveryKeyInvalid: false };
const RECENT = new Date().toISOString();
const OUTBOX_KEY = `${PENDING_EDITS_PREFIX}${pendingEditScope(CFG.httpUrl, "chat:default")}`;

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id, projectId: "default", ownerId: null, name: `Thread ${id}`,
    createdAt: RECENT, updatedAt: RECENT, history: [], display: [], ...over,
  };
}

function renderChatThreads(over: Partial<UseChatThreadsDeps> = {}) {
  const props: UseChatThreadsDeps = {
    tursoMode: true, tursoConfig: CFG, projectId: "default", lang: "en-US", busy: false, history: [], display: [],
    setHistory: vi.fn(), setDisplay: vi.fn(), cancelledRef: { current: false }, abortRef: { current: null },
    confirm: vi.fn(async () => true), chat: CHAT_ON, ...over,
  };
  return { props, ...renderHook((p: UseChatThreadsDeps) => useChatThreads(p), { initialProps: props }) };
}

/** The thread ids with a stored rename in this project's outbox. */
function storedRenameIds(): string[] {
  const raw = window.localStorage.getItem(OUTBOX_KEY);
  return raw ? (JSON.parse(raw) as { id: string }[]).map((e) => e.id).sort() : [];
}

/** Puts a rename draft for each id into localStorage, as a page close would. */
function storeDrafts(result: { current: ReturnType<typeof useChatThreads> }, ids: string[]): void {
  act(() => {
    for (const id of ids) result.current.trackRenameDraft(id, `Draft ${id}`);
  });
  flushPendingEdits(Date.now());
  expect(storedRenameIds()).toEqual([...ids].sort());
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetPendingEditsForTests();
  loadThreadsMock.mockResolvedValue([]);
  saveThreadMock.mockResolvedValue("saved");
  deleteThreadMock.mockResolvedValue(undefined);
  deleteOwnerThreadsMock.mockResolvedValue(undefined);
  expireThreadsMock.mockResolvedValue(undefined);
});

describe("useChatThreads — delete all my chats", () => {
  it("deletes this owner's rows, keeps legacy threads in the list and the registry, and drops their renames", async () => {
    const me = await ensureChatIdentity(CFG.httpUrl);
    const mine = thread("mine", { ownerId: me!.ownerId });
    const legacy = thread("legacy");
    loadThreadsMock.mockResolvedValueOnce([mine, legacy]).mockResolvedValue([legacy]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.erase.ownerId).toBe(me!.ownerId));
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    storeDrafts(result, ["mine", "legacy"]);

    await act(async () => {
      await result.current.erase.deleteAll();
    });

    expect(deleteOwnerThreadsMock).toHaveBeenCalledWith(CFG, me!.ownerId);
    expect(result.current.threads.map((th) => th.id)).toEqual(["legacy"]);
    await waitFor(() => expect(readChatThreads("default").threads.map((th) => th.id)).toEqual(["legacy"]));
    expect(storedRenameIds()).toEqual(["legacy"]);
  });

  it("reports no owner and deletes nothing when this browser has no stored identity", async () => {
    loadThreadsMock.mockResolvedValue([thread("legacy")]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.erase.ownerId).toBeNull();
    await act(async () => {
      await result.current.erase.deleteAll();
    });
    expect(deleteOwnerThreadsMock).not.toHaveBeenCalled();
    expect(result.current.threads).toHaveLength(1);
  });

  it("propagates a failed delete and keeps the list", async () => {
    const me = await ensureChatIdentity(CFG.httpUrl);
    loadThreadsMock.mockResolvedValue([thread("mine", { ownerId: me!.ownerId })]);
    deleteOwnerThreadsMock.mockRejectedValue(new Error("network"));
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.erase.ownerId).toBe(me!.ownerId));
    await act(async () => {
      await expect(result.current.erase.deleteAll()).rejects.toThrow();
    });
    expect(result.current.threads).toHaveLength(1);
  });

  it("is not enabled while chats are not saved", async () => {
    const { result } = renderChatThreads({ chat: { ...CHAT_ON, recoveryKey: null } });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalled());
    expect(result.current.erase.enabled).toBe(false);
  });
});

describe("useChatThreads — delete the ticked chats", () => {
  it("deletes exactly the ticked threads, clears the active one, and drops their renames", async () => {
    loadThreadsMock.mockResolvedValue([thread("a"), thread("b"), thread("c")]);
    const { result, props } = renderChatThreads();
    await waitFor(() => expect(result.current.activeThreadId).toBe("a"));
    storeDrafts(result, ["a", "c"]);

    await act(async () => {
      await result.current.erase.deleteSelected(["a", "b"]);
    });

    expect(deleteThreadMock.mock.calls.map((c) => c[1]).sort()).toEqual(["a", "b"]);
    expect(result.current.threads.map((th) => th.id)).toEqual(["c"]);
    expect(result.current.activeThreadId).toBeNull();
    expect(props.setHistory).toHaveBeenLastCalledWith([]);
    expect(storedRenameIds()).toEqual(["c"]);
  });

  it("keeps a thread whose delete failed, and rejects", async () => {
    loadThreadsMock.mockResolvedValue([thread("a"), thread("b")]);
    deleteThreadMock.mockImplementation(async (_c: unknown, id: string) => {
      if (id === "b") throw new Error("network");
    });
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    await act(async () => {
      await expect(result.current.erase.deleteSelected(["a", "b"])).rejects.toThrow();
    });
    expect(result.current.threads.map((th) => th.id)).toEqual(["b"]);
  });
});

describe("useChatThreads — pending renames of removed threads", () => {
  it("a single delete drops the thread's stored rename", async () => {
    loadThreadsMock.mockResolvedValue([thread("a"), thread("b")]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    storeDrafts(result, ["a", "b"]);
    await act(async () => {
      await result.current.requestDeleteThread("a");
    });
    expect(storedRenameIds()).toEqual(["b"]);
  });

  it("this browser's expiry drops the renames of the threads it expired", async () => {
    loadThreadsMock.mockResolvedValue([thread("old", { updatedAt: "2020-01-01T00:00:00.000Z" }), thread("new")]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    await waitFor(() => expect(expireThreadsMock).toHaveBeenCalledTimes(1));
    storeDrafts(result, ["old", "new"]);
    act(() => {
      result.current.renameThread("new", "Renamed");
    });
    await waitFor(() => expect(expireThreadsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(storedRenameIds()).toEqual(["new"]));
  });
});
