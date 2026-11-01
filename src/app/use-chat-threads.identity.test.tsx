// src/app/use-chat-threads.identity.test.tsx — the hook saves a thread only encrypted, as this
// browser's owner: whose threads it lists and publishes, when it saves at all (`persistence`), the
// identity per database, expiry, and a save the server says changed no row. Kept apart from
// use-chat-threads.test.tsx, which is already 2600+ lines.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import { loadThreads, saveThread, deleteThread, expireThreads } from "./chat-threads-store";
import { ensureChatIdentity, readChatIdentity } from "./chat-key-vault";
import type { ChatThread } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import { clearChatThreads, readChatThreads } from "./chat-threads-registry";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { PENDING_EDITS_PREFIX, flushPendingEdits, pendingEditScope, resetPendingEditsForTests } from "./pending-edits";

const h = vi.hoisted(() => ({
  vault: new Map<string, { ownerId: string; chatKey: Uint8Array }>(),
  locked: new Set<string>(),
  available: { value: true },
  minted: { value: 0 },
  /** Storing a NEW identity fails (the vault stays empty). */
  failStore: { value: false },
}));

vi.mock("./chat-key-vault", () => ({
  chatVaultAvailable: () => h.available.value,
  readChatIdentity: vi.fn(async (url: string) => {
    if (!h.available.value || h.locked.has(url)) return { kind: "unavailable" };
    const identity = h.vault.get(url);
    return identity ? { kind: "found", identity } : { kind: "absent" };
  }),
  getChatIdentity: vi.fn(async (url: string) =>
    (!h.available.value || h.locked.has(url) ? null : h.vault.get(url) ?? null)),
  ensureChatIdentity: vi.fn(async (url: string) => {
    if (!h.available.value || h.locked.has(url)) return null;
    let identity = h.vault.get(url);
    if (!identity && h.failStore.value) return null;
    if (!identity) {
      h.minted.value += 1;
      identity = { ownerId: `owner-${h.minted.value}`, chatKey: new Uint8Array(32) };
      h.vault.set(url, identity);
    }
    return identity;
  }),
  storedChatOwnerId: (url: string) => h.vault.get(url)?.ownerId ?? null,
  startNewChatIdentity: vi.fn(async (url: string) => {
    h.minted.value += 1;
    const identity = { ownerId: `owner-${h.minted.value}`, chatKey: new Uint8Array(32) };
    h.vault.set(url, identity);
    h.locked.delete(url);
    return identity;
  }),
}));

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => "saved"),
  deleteThread: vi.fn(async () => undefined),
  expireThreads: vi.fn(async () => undefined),
}));

const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
const saveThreadMock = saveThread as unknown as ReturnType<typeof vi.fn>;
const deleteThreadMock = deleteThread as unknown as ReturnType<typeof vi.fn>;
const expireThreadsMock = expireThreads as unknown as ReturnType<typeof vi.fn>;
const ensureMock = ensureChatIdentity as unknown as ReturnType<typeof vi.fn>;
const readMock = readChatIdentity as unknown as ReturnType<typeof vi.fn>;

const CFG_A: TursoConfig = { httpUrl: "https://database-a.example.invalid", authToken: "token-a" };
const CFG_B: TursoConfig = { httpUrl: "https://database-b.example.invalid", authToken: "token-b" };
const RECOVERY = "recovery-spki-b64";
const CHAT_ON: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: RECOVERY, recoveryKeyInvalid: false };
const NOW = new Date("2026-11-01T12:00:00.000Z");

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    projectId: "default",
    ownerId: null,
    name: `Thread ${id}`,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    history: [],
    display: [],
    ...over,
  };
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
    chat: CHAT_ON,
    ...overrides,
  };
  const hook = renderHook((props: UseChatThreadsDeps) => useChatThreads(props), { initialProps });
  return { ...hook, initialProps };
}

const turn = {
  history: [{ role: "user", content: "hi" }] as ApiMessage[],
  display: [{ kind: "user", text: "hi" }] as DisplayItem[],
};

/** Starts and settles one turn on the active thread (ensureThreadForSend, then busy true → false). */
async function sendTurn(hook: ReturnType<typeof renderChatThreads>): Promise<void> {
  act(() => {
    hook.result.current.ensureThreadForSend(turn.history, turn.display);
  });
  hook.rerender({ ...hook.initialProps, busy: true, ...turn });
  hook.rerender({ ...hook.initialProps, busy: false, ...turn });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.vault.clear();
  h.locked.clear();
  h.available.value = true;
  h.minted.value = 0;
  h.failStore.value = false;
  loadThreadsMock.mockResolvedValue([]);
  saveThreadMock.mockResolvedValue("saved");
  deleteThreadMock.mockResolvedValue(undefined);
  expireThreadsMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  clearDiagLog();
  clearChatThreads();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useChatThreads — whose threads are shown", () => {
  it("never lists or publishes a colleague's owned thread, keeps own and legacy ones", async () => {
    h.vault.set(CFG_A.httpUrl, { ownerId: "me", chatKey: new Uint8Array(32) });
    loadThreadsMock.mockResolvedValue([
      thread("mine", { ownerId: "me" }),
      thread("legacy"),
      thread("theirs", { ownerId: "colleague", display: [{ kind: "user", text: "secret plan" }] }),
    ]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.threads.map((th) => th.id)).toEqual(["mine", "legacy"]);
    const published = readChatThreads("default");
    expect(published.available).toBe(true);
    expect(published.threads.map((th) => th.id)).toEqual(["mine", "legacy"]);
    expect(JSON.stringify(published)).not.toContain("secret plan");
  });

  it("loads with this browser's identity, and without one never creates it on load", async () => {
    const { result } = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect(loadThreadsMock).toHaveBeenCalledWith(CFG_A, "default", null);
    expect(readMock).toHaveBeenCalledWith(CFG_A.httpUrl);
    expect(ensureMock).not.toHaveBeenCalled();
    expect(h.vault.size).toBe(0);
    expect(result.current.persistence).toBe("on");
  });
});

describe("useChatThreads — persistence", () => {
  it("status unknown (chat null): nothing saved, deleted or expired, and says so", async () => {
    loadThreadsMock.mockResolvedValue([thread("t1")]);
    const hook = renderChatThreads({ chat: null });
    await waitFor(() => expect(hook.result.current.threads).toHaveLength(1));
    expect(hook.result.current.persistence).toBe("status-unknown");
    act(() => hook.result.current.renameThread("t1", "Renamed"));
    await sendTurn(hook);
    await act(async () => {
      await hook.result.current.requestDeleteThread("t1");
    });
    expect(saveThreadMock).not.toHaveBeenCalled();
    expect(deleteThreadMock).not.toHaveBeenCalled();
    expect(expireThreadsMock).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
    expect(hook.result.current.threadsError).toBe(false);
  });

  it("no recovery key: persistence no-recovery-key and no save", async () => {
    const hook = renderChatThreads({ chat: { ...CHAT_ON, recoveryKey: null } });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect(hook.result.current.persistence).toBe("no-recovery-key");
    await sendTurn(hook);
    expect(saveThreadMock).not.toHaveBeenCalled();
    expect(hook.result.current.threadsError).toBe(false);
  });

  it("crypto unavailable: persistence no-crypto (ahead of a missing recovery key) and no save", async () => {
    h.available.value = false;
    const hook = renderChatThreads({ chat: { ...CHAT_ON, recoveryKey: null } });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect(hook.result.current.persistence).toBe("no-crypto");
    await sendTurn(hook);
    expect(saveThreadMock).not.toHaveBeenCalled();
  });

  it("an identity the device key cannot open: persistence identity-locked and no save", async () => {
    h.locked.add(CFG_A.httpUrl);
    const hook = renderChatThreads();
    await waitFor(() => expect(hook.result.current.persistence).toBe("identity-locked"));
    await sendTurn(hook);
    expect(saveThreadMock).not.toHaveBeenCalled();
  });

  it("starting a new chat identity over a locked one resumes saving under it", async () => {
    h.locked.add(CFG_A.httpUrl);
    const hook = renderChatThreads();
    await waitFor(() => expect(hook.result.current.persistence).toBe("identity-locked"));
    await act(async () => {
      await hook.result.current.startNewIdentity();
    });
    expect(hook.result.current.persistence).toBe("on");
    const fresh = h.vault.get(CFG_A.httpUrl)!;
    await sendTurn(hook);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    expect((saveThreadMock.mock.calls[0]![2] as { ownerId: string }).ownerId).toBe(fresh.ownerId);
  });

  it("a new identity that could not be stored is a failed save with a retry, not a locked identity", async () => {
    const hook = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    h.failStore.value = true;
    await sendTurn(hook);
    await waitFor(() => expect(hook.result.current.threadsError).toBe(true));
    expect(hook.result.current.persistence).toBe("on");
    expect(saveThreadMock).not.toHaveBeenCalled();
    h.failStore.value = false;
    await act(async () => {
      hook.result.current.retryLoad();
    });
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    expect(hook.result.current.persistence).toBe("on");
  });

  it("a stored identity the device key stops opening before a save: identity-locked and no save", async () => {
    h.vault.set(CFG_A.httpUrl, { ownerId: "owner-stored", chatKey: new Uint8Array(32) });
    const hook = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect(hook.result.current.persistence).toBe("on");
    h.locked.add(CFG_A.httpUrl);
    // Another tab replaced the entry, so the save reads the vault afresh and finds it locked.
    h.vault.set(CFG_A.httpUrl, { ownerId: "owner-other-tab", chatKey: new Uint8Array(32) });
    await sendTurn(hook);
    await waitFor(() => expect(hook.result.current.persistence).toBe("identity-locked"));
    expect(saveThreadMock).not.toHaveBeenCalled();
  });

  it("status unknown wins over the other two", async () => {
    h.available.value = false;
    const hook = renderChatThreads({ chat: null });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect(hook.result.current.persistence).toBe("status-unknown");
  });
});

describe("useChatThreads — identity", () => {
  it("continuing a legacy thread saves it as this browser's owner, with the recovery key", async () => {
    const legacy = thread("t1", { display: [{ kind: "user", text: "old" }] });
    loadThreadsMock.mockResolvedValue([legacy]);
    const hook = renderChatThreads();
    await waitFor(() => expect(hook.result.current.activeThreadId).toBe("t1"));
    await sendTurn(hook);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    const [cfg, saved, identity, recovery] = saveThreadMock.mock.calls.at(-1)!;
    expect(cfg).toBe(CFG_A);
    expect((saved as ChatThread).id).toBe("t1");
    expect((identity as { ownerId: string }).ownerId).toBe("owner-1");
    expect(recovery).toBe(RECOVERY);
    expect(ensureMock).toHaveBeenCalledWith(CFG_A.httpUrl);
  });

  it("keeps the identity across a remount, and uses a separate one per database", async () => {
    const first = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    await sendTurn(first);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    const ownerA = (saveThreadMock.mock.calls.at(-1)![2] as { ownerId: string }).ownerId;
    first.unmount();

    saveThreadMock.mockClear();
    loadThreadsMock.mockClear();
    const again = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    expect((loadThreadsMock.mock.calls[0]![2] as { ownerId: string }).ownerId).toBe(ownerA);
    await sendTurn(again);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    expect((saveThreadMock.mock.calls.at(-1)![2] as { ownerId: string }).ownerId).toBe(ownerA);
    again.unmount();

    saveThreadMock.mockClear();
    const other = renderChatThreads({ tursoConfig: CFG_B });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledWith(CFG_B, "default", null));
    await sendTurn(other);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalled());
    const ownerB = (saveThreadMock.mock.calls.at(-1)![2] as { ownerId: string }).ownerId;
    expect(ownerB).not.toBe(ownerA);
    expect(ensureMock).toHaveBeenCalledWith(CFG_B.httpUrl);
  });

  it("deletes with this browser's owner id", async () => {
    h.vault.set(CFG_A.httpUrl, { ownerId: "me", chatKey: new Uint8Array(32) });
    loadThreadsMock.mockResolvedValue([thread("t1", { ownerId: "me" })]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    await act(async () => {
      await result.current.requestDeleteThread("t1");
    });
    await waitFor(() => expect(deleteThreadMock).toHaveBeenCalledWith(CFG_A, "t1", "default", "me"));
  });
});

describe("useChatThreads — retention", () => {
  it("expires this project's old threads after the load, with the server's retention period", async () => {
    const { result } = renderChatThreads();
    await waitFor(() => expect(expireThreadsMock).toHaveBeenCalledTimes(1));
    expect(expireThreadsMock).toHaveBeenCalledWith(CFG_A, CHAT_ON.retentionDays, "default");
    expect(result.current.persistence).toBe("on");
  });

  it("expires before each save", async () => {
    const hook = renderChatThreads();
    await waitFor(() => expect(expireThreadsMock).toHaveBeenCalledTimes(1));
    loadThreadsMock.mockResolvedValue([]);
    act(() => {
      hook.result.current.ensureThreadForSend(turn.history, turn.display);
    });
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    expect(expireThreadsMock).toHaveBeenCalledTimes(2);
    expect(expireThreadsMock.mock.invocationCallOrder[1]!).toBeLessThan(saveThreadMock.mock.invocationCallOrder[0]!);
  });

  it("a failed expiry does not block the save, and is logged without detail", async () => {
    expireThreadsMock.mockRejectedValue(new Error("https://database-a.example.invalid boom"));
    const hook = renderChatThreads();
    await waitFor(() => expect(expireThreadsMock).toHaveBeenCalledTimes(1));
    act(() => {
      hook.result.current.ensureThreadForSend(turn.history, turn.display);
    });
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readDiagLog().filter((e) => e.code === "chat.retentionExpireFailed").length).toBeGreaterThan(0));
    for (const e of readDiagLog().filter((x) => x.code === "chat.retentionExpireFailed")) {
      expect(e.fields).toBeUndefined();
    }
    expect(hook.result.current.threadsError).toBe(false);
  });

  it("never lists a thread past the retention period after a load, nor publishes it", async () => {
    loadThreadsMock.mockResolvedValue([
      thread("old", { updatedAt: "2026-09-22T12:00:00.000Z" }),
      thread("fresh"),
    ]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads.map((th) => th.id)).toEqual(["fresh"]));
    await waitFor(() => expect(readChatThreads("default").available).toBe(true));
    expect(readChatThreads("default").threads.map((th) => th.id)).toEqual(["fresh"]);
  });

  it("drops a thread past the retention period once the status arrives after the first load", async () => {
    loadThreadsMock.mockResolvedValue([
      thread("old", { updatedAt: "2026-09-22T12:00:00.000Z" }), // 40 days before NOW
      thread("fresh"),
    ]);
    const hook = renderChatThreads({ chat: null });
    await waitFor(() => expect(hook.result.current.threads.map((th) => th.id)).toEqual(["old", "fresh"]));
    hook.rerender({ ...hook.initialProps, chat: CHAT_ON });
    await waitFor(() => expect(hook.result.current.threads.map((th) => th.id)).toEqual(["fresh"]));
    expect(loadThreadsMock).toHaveBeenCalledTimes(2);
    // Known → known again (a new settings object) does not reload.
    hook.rerender({ ...hook.initialProps, chat: { ...CHAT_ON } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(loadThreadsMock).toHaveBeenCalledTimes(2);
  });

  it("while the retention setting is invalid: no expiry on load or save, and nothing hidden by age", async () => {
    loadThreadsMock.mockResolvedValue([
      thread("old", { updatedAt: "2026-09-22T12:00:00.000Z" }), // 40 days before NOW
      thread("fresh"),
    ]);
    const hook = renderChatThreads({ chat: { ...CHAT_ON, retentionInvalid: true } });
    await waitFor(() => expect(hook.result.current.threads.map((th) => th.id)).toEqual(["old", "fresh"]));
    expect(hook.result.current.persistence).toBe("on");
    await sendTurn(hook);
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    expect(expireThreadsMock).not.toHaveBeenCalled();
  });

  it("never expires while the status is unknown", async () => {
    renderChatThreads({ chat: null });
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(expireThreadsMock).not.toHaveBeenCalled();
  });
});

describe("useChatThreads — an erased chat never comes back", () => {
  const stored = (call: unknown[] | undefined): boolean | undefined => (call?.[4] as { stored?: boolean } | undefined)?.stored;
  const OUTBOX_KEY = `${PENDING_EDITS_PREFIX}${pendingEditScope(CFG_A.httpUrl, "chat:default")}`;
  const storedRenameIds = (): string[] => {
    flushPendingEdits(Date.now());
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as { id: string }[]).map((e) => e.id).sort() : [];
  };
  beforeEach(() => resetPendingEditsForTests());

  it("a loaded thread whose row was deleted is dropped on its next save, with its pending rename, never re-inserted", async () => {
    loadThreadsMock.mockResolvedValue([thread("t1"), thread("t2")]);
    const hook = renderChatThreads();
    await waitFor(() => expect(hook.result.current.threads).toHaveLength(2));
    act(() => {
      hook.result.current.trackRenameDraft("t1", "Draft one");
      hook.result.current.trackRenameDraft("t2", "Draft two");
    });
    expect(storedRenameIds()).toEqual(["t1", "t2"]);
    saveThreadMock.mockResolvedValueOnce("gone");
    await sendTurn(hook);
    await waitFor(() => expect(hook.result.current.threads.map((th) => th.id)).toEqual(["t2"]));
    expect(saveThreadMock).toHaveBeenCalledTimes(1);
    expect(stored(saveThreadMock.mock.calls[0])).toBe(true);
    expect(readChatThreads("default").threads.map((th) => th.id)).toEqual(["t2"]);
    expect(hook.result.current.threadsError).toBe(false);
    expect(readDiagLog().filter((e) => e.code === "chat.threadGone")).toHaveLength(1);
    expect(readDiagLog().some((e) => e.code === "chat.threadNotOwned")).toBe(false);
    expect(storedRenameIds()).toEqual(["t2"]);
  });

  it("a brand-new thread is saved as not yet stored, and as stored once its first save landed", async () => {
    const hook = renderChatThreads();
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    act(() => {
      hook.result.current.ensureThreadForSend(turn.history, turn.display);
    });
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(1));
    expect(stored(saveThreadMock.mock.calls[0])).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const id = hook.result.current.activeThreadId!;
    act(() => hook.result.current.renameThread(id, "Renamed"));
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(2));
    expect(stored(saveThreadMock.mock.calls[1])).toBe(true);
  });
});

describe("useChatThreads — a thread somebody else now owns", () => {
  it("a save that changed no row drops the thread here and withdraws it from the registry", async () => {
    loadThreadsMock.mockResolvedValue([thread("t1"), thread("t2")]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.activeThreadId).toBe("t1");
    saveThreadMock.mockResolvedValueOnce("not-owned");
    act(() => result.current.renameThread("t1", "Mine now"));
    await waitFor(() => expect(result.current.threads.map((th) => th.id)).toEqual(["t2"]));
    expect(readChatThreads("default").threads.map((th) => th.id)).toEqual(["t2"]);
    expect(result.current.activeThreadId).toBeNull();
    expect(result.current.threadsError).toBe(false);
  });
});
