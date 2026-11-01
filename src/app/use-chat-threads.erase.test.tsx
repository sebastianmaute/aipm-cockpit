// src/app/use-chat-threads.erase.test.tsx — the hook's erase actions (delete all my chats, delete the
// ticked matches) and the pending renames every delete and expiry drops, against the REAL chat-key
// vault (fake-indexeddb) and a mocked store.
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import {
  loadThreads, saveThread, deleteThread, deleteOwnerThreads, expireThreads, loadLegacyThreadIds,
} from "./chat-threads-store";
import { ChatEraseControls } from "./chat-erase-dialog";
import { ensureChatIdentity } from "./chat-key-vault";
import { readChatThreads } from "./chat-threads-registry";
import type { ChatThread } from "./chat-threads";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import {
  PENDING_EDITS_PREFIX, flushPendingEdits, pendingEditScope, resetPendingEditsForTests, trackPendingEdit,
} from "./pending-edits";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => "saved"),
  deleteThread: vi.fn(async () => undefined),
  deleteOwnerThreads: vi.fn(async () => undefined),
  expireThreads: vi.fn(async () => undefined),
  loadLegacyThreadIds: vi.fn(async () => []),
}));

const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
const saveThreadMock = saveThread as unknown as ReturnType<typeof vi.fn>;
const deleteThreadMock = deleteThread as unknown as ReturnType<typeof vi.fn>;
const deleteOwnerThreadsMock = deleteOwnerThreads as unknown as ReturnType<typeof vi.fn>;
const expireThreadsMock = expireThreads as unknown as ReturnType<typeof vi.fn>;
const loadLegacyThreadIdsMock = loadLegacyThreadIds as unknown as ReturnType<typeof vi.fn>;

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
  loadLegacyThreadIdsMock.mockResolvedValue([]);
});

describe("useChatThreads — delete all my chats", () => {
  it("deletes this owner's rows, keeps legacy threads in the list and the registry, and drops their renames", async () => {
    const me = await ensureChatIdentity(CFG.httpUrl);
    const mine = thread("mine", { ownerId: me!.ownerId });
    const legacy = thread("legacy");
    loadThreadsMock.mockResolvedValueOnce([mine, legacy]).mockResolvedValue([legacy]);
    loadLegacyThreadIdsMock.mockResolvedValue(["legacy"]);
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

  it("is not enabled while the chat status is unknown", async () => {
    const { result } = renderChatThreads({ chat: null });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalled());
    expect(result.current.erase.enabled).toBe(false);
  });
});

describe("useChatThreads — deletes reach the database while chats are not saved", () => {
  const NOT_SAVED: ChatSettings = { ...CHAT_ON, recoveryKey: null };

  it("a single delete of a legacy thread is sent without a recovery key", async () => {
    loadThreadsMock.mockResolvedValue([thread("legacy"), thread("other")]);
    const { result } = renderChatThreads({ chat: NOT_SAVED });
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.persistence).toBe("no-recovery-key");
    await act(async () => {
      await result.current.requestDeleteThread("legacy");
    });
    await waitFor(() => expect(deleteThreadMock).toHaveBeenCalledTimes(1));
    expect(deleteThreadMock.mock.calls[0].slice(0, 3)).toEqual([CFG, "legacy", "default"]);
    expect(saveThreadMock).not.toHaveBeenCalled();
  });

  it("find-and-delete is offered and deletes legacy threads; delete-all stays disabled without an identity", async () => {
    loadThreadsMock.mockResolvedValue([
      thread("legacy", { history: [{ role: "user", content: "about Erika Muster" }], display: [{ kind: "user", text: "about Erika Muster" }] }),
    ]);
    const { result } = renderChatThreads({ chat: NOT_SAVED });
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.erase.enabled).toBe(true);
    expect(result.current.erase.ownerId).toBeNull();
    render(<ChatEraseControls lang="en-US" threads={result.current.threads} erase={result.current.erase} />);
    expect(screen.getByRole("button", { name: "Delete all my chats" })).toBeDisabled();
    await act(async () => {
      await result.current.erase.deleteSelected(["legacy"]);
    });
    expect(deleteThreadMock.mock.calls.map((c) => c[1])).toEqual(["legacy"]);
    expect(result.current.threads).toEqual([]);
    await act(async () => {
      await result.current.erase.deleteAll();
    });
    expect(deleteOwnerThreadsMock).not.toHaveBeenCalled();
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

/** The ids with a stored rename in `projectId`'s outbox. */
function storedIn(projectId: string): string[] {
  const raw = window.localStorage.getItem(`${PENDING_EDITS_PREFIX}${pendingEditScope(CFG.httpUrl, `chat:${projectId}`)}`);
  return raw ? (JSON.parse(raw) as { id: string }[]).map((e) => e.id).sort() : [];
}

describe("useChatThreads — delete all clears the draft names of every project", () => {
  it("drops a stored draft of another project and a live draft of a project loaded earlier; a legacy draft stays", async () => {
    const me = await ensureChatIdentity(CFG.httpUrl);
    window.localStorage.setItem(
      `${PENDING_EDITS_PREFIX}${pendingEditScope(CFG.httpUrl, "chat:other")}`,
      JSON.stringify([
        { v: 1, kind: "chat-thread-name", id: "other-mine", base: "a", value: "Jane", savedAt: Date.now() },
        { v: 1, kind: "chat-thread-name", id: "other-legacy", base: "a", value: "b", savedAt: Date.now() },
      ]),
    );
    loadThreadsMock.mockImplementation(async (_c: unknown, pid: string) =>
      pid === "earlier" ? [thread("earlier-mine", { projectId: "earlier", ownerId: me!.ownerId })] : [thread("legacy")]);
    loadLegacyThreadIdsMock.mockResolvedValue(["legacy", "other-legacy"]);
    const { result, rerender, props } = renderChatThreads({ projectId: "earlier" });
    await waitFor(() => expect(result.current.threads.map((th) => th.id)).toEqual(["earlier-mine"]));
    act(() => result.current.trackRenameDraft("earlier-mine", "Jane"));
    rerender({ ...props, projectId: "default" });
    await waitFor(() => expect(result.current.threads.map((th) => th.id)).toEqual(["legacy"]));
    act(() => result.current.trackRenameDraft("legacy", "Draft"));

    await act(async () => {
      await result.current.erase.deleteAll();
    });

    expect(storedIn("other")).toEqual(["other-legacy"]);
    flushPendingEdits(Date.now());
    expect(storedIn("earlier")).toEqual([]);
    expect(storedIn("default")).toEqual(["legacy"]);
  });

  it("drops every draft name of the database when the legacy ids cannot be read", async () => {
    const me = await ensureChatIdentity(CFG.httpUrl);
    loadThreadsMock.mockResolvedValue([thread("legacy"), thread("mine", { ownerId: me!.ownerId })]);
    loadLegacyThreadIdsMock.mockRejectedValue(new Error("network"));
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    storeDrafts(result, ["legacy", "mine"]);
    const templates = pendingEditScope(CFG.httpUrl, "templates");
    trackPendingEdit(templates, { kind: "template-name", id: "t", base: "a", value: "b" });
    await act(async () => {
      await result.current.erase.deleteAll().catch(() => undefined);
    });
    flushPendingEdits(Date.now());
    expect(storedRenameIds()).toEqual([]);
    expect(window.localStorage.getItem(`${PENDING_EDITS_PREFIX}${templates}`)).not.toBeNull();
  });
});

describe("useChatThreads — a chat started here is owned once saved", () => {
  it("stamps this browser's owner id on a session-minted thread when its save lands", async () => {
    const { result } = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalled());
    let id: string | null = null;
    act(() => {
      id = result.current.ensureThreadForSend([{ role: "user", content: "hi" }], [{ kind: "user", text: "hi" }]);
    });
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    const owner = (saveThreadMock.mock.calls[0][2] as { ownerId: string }).ownerId;
    await waitFor(() => expect(result.current.threads.find((th) => th.id === id)?.ownerId).toBe(owner));
    await waitFor(() => expect(readChatThreads("default").threads.find((th) => th.id === id)?.ownerId).toBe(owner));
  });

  it("delete-all removes a saved session thread even when the reload fails, and the UI reports the failure", async () => {
    let api: ReturnType<typeof useChatThreads> | null = null;
    function Harness(p: UseChatThreadsDeps) {
      const chatThreads = useChatThreads(p);
      api = chatThreads;
      return <ChatEraseControls lang="en-US" threads={chatThreads.threads} erase={chatThreads.erase} />;
    }
    const props: UseChatThreadsDeps = {
      tursoMode: true, tursoConfig: CFG, projectId: "default", lang: "en-US", busy: false, history: [], display: [],
      setHistory: vi.fn(), setDisplay: vi.fn(), cancelledRef: { current: false }, abortRef: { current: null },
      confirm: vi.fn(async () => true), chat: CHAT_ON,
    };
    loadThreadsMock.mockResolvedValueOnce([]).mockRejectedValue(new Error("network"));
    render(<Harness {...props} />);
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    let id: string | null = null;
    act(() => {
      id = api!.ensureThreadForSend([{ role: "user", content: "about Jane" }], [{ kind: "user", text: "about Jane" }]);
    });
    await waitFor(() => expect(api!.threads.find((th) => th.id === id)?.ownerId).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Delete all my chats" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete my chats" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my chats" }));

    expect(await screen.findByText("Your chats could not be deleted. Please try again.")).toBeInTheDocument();
    expect(deleteOwnerThreadsMock).toHaveBeenCalledTimes(1);
    expect(api!.threads.find((th) => th.id === id)).toBeUndefined();
    expect(api!.activeThreadId).toBeNull();
  });
});
