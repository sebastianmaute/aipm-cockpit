// src/app/use-chat-threads.vault.test.tsx — the hook against the REAL chat-key vault (fake-indexeddb):
// overlapping first writes share one identity, and a delete never creates one.
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatThreads, type UseChatThreadsDeps } from "./use-chat-threads";
import { loadThreads, saveThread, deleteThread, expireThreads } from "./chat-threads-store";
import { CHAT_IDENTITY_KEY } from "./chat-key-vault";
import type { ChatThread } from "./chat-threads";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import { PENDING_EDITS_PREFIX, pendingEditScope, resetPendingEditsForTests } from "./pending-edits";

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

const CFG: TursoConfig = { httpUrl: "https://database-v.example.invalid", authToken: "token-v" };
const CHAT_ON: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: "recovery-spki", recoveryKeyInvalid: false };

// Within the retention period by the real clock: a load drops a thread past it.
const RECENT = new Date(Date.now() - 86_400_000).toISOString();

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id, projectId: "default", ownerId: null, name: `Thread ${id}`,
    createdAt: RECENT, updatedAt: RECENT, history: [], display: [], ...over,
  };
}

function renderChatThreads() {
  const props: UseChatThreadsDeps = {
    tursoMode: true, tursoConfig: CFG, projectId: "default", lang: "en-US", busy: false, history: [], display: [],
    setHistory: vi.fn(), setDisplay: vi.fn(), cancelledRef: { current: false }, abortRef: { current: null },
    confirm: vi.fn(async () => true), chat: CHAT_ON,
  };
  return renderHook((p: UseChatThreadsDeps) => useChatThreads(p), { initialProps: props });
}

const storedVault = (): Record<string, { ownerId: string }> | null => {
  const raw = window.localStorage.getItem(CHAT_IDENTITY_KEY);
  return raw ? (JSON.parse(raw) as Record<string, { ownerId: string }>) : null;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetPendingEditsForTests();
  saveThreadMock.mockResolvedValue("saved");
  deleteThreadMock.mockResolvedValue(undefined);
  expireThreadsMock.mockResolvedValue(undefined);
});

describe("useChatThreads with the real vault", () => {
  it("two replayed renames with no identity yet save under one owner id, the one stored", async () => {
    const edits = ["t1", "t2"].map((id) => ({
      v: 1, kind: "chat-thread-name", id, base: `Thread ${id}`, value: `Renamed ${id}`, savedAt: Date.now(),
    }));
    window.localStorage.setItem(`${PENDING_EDITS_PREFIX}${pendingEditScope(CFG.httpUrl, "chat:default")}`, JSON.stringify(edits));
    loadThreadsMock.mockResolvedValue([thread("t1"), thread("t2")]);
    renderChatThreads();
    await waitFor(() => expect(saveThreadMock).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const owners = saveThreadMock.mock.calls.map((c) => (c[2] as { ownerId: string }).ownerId);
    expect(new Set(owners).size).toBe(1);
    expect(storedVault()![CFG.httpUrl]!.ownerId).toBe(owners[0]);
  });

  it("deleting a legacy thread with no stored identity issues the delete and stores no identity", async () => {
    loadThreadsMock.mockResolvedValue([thread("t1")]);
    const { result } = renderChatThreads();
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    await act(async () => {
      await result.current.requestDeleteThread("t1");
    });
    await waitFor(() => expect(deleteThreadMock).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const [cfg, id, projectId, ownerId] = deleteThreadMock.mock.calls[0]!;
    expect([cfg, id, projectId]).toEqual([CFG, "t1", "default"]);
    expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.localStorage.getItem(CHAT_IDENTITY_KEY)).toBeNull();
  });
});
