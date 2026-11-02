// src/app/use-chat-thread-renames.test.ts — renaming a saved chat thread: the save it sends, the rename
// outbox entry it keeps for a page close (based on the server-confirmed name), what a landed save
// settles, and the renames a load replays.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatThreadRenames, type UseChatThreadRenamesDeps } from "./use-chat-thread-renames";
import type { ChatThread } from "./chat-threads";
import type { TursoConfig } from "./turso-config";
import type { SaveGate } from "./chat-thread-writes";
import {
  PENDING_EDITS_PREFIX, flushPendingEdits, pendingEditScope, resetPendingEditsForTests, trackPendingEdit,
} from "./pending-edits";

const CFG: TursoConfig = { httpUrl: "https://renames.example.invalid", authToken: "t" };
const SCOPE = pendingEditScope(CFG.httpUrl, "chat:p");
const GATE: SaveGate = { recoveryKey: "spki", retentionDays: 30 };

function thread(id: string, name = `Thread ${id}`): ChatThread {
  return {
    id, projectId: "p", ownerId: "me", name, createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z", history: [], display: [],
  };
}

/** The stored outbox entries of this project, after flushing this page's live edits. */
function stored(): { id: string; base: string; value: string }[] {
  flushPendingEdits(Date.now());
  const raw = window.localStorage.getItem(`${PENDING_EDITS_PREFIX}${SCOPE}`);
  return raw ? (JSON.parse(raw) as { id: string; base: string; value: string }[]).map(({ id, base, value }) => ({ id, base, value })) : [];
}

function setup(over: Partial<UseChatThreadRenamesDeps> = {}) {
  let threads = [thread("a")];
  const setThreads = vi.fn((next: ChatThread[] | ((prev: ChatThread[]) => ChatThread[])) => {
    threads = typeof next === "function" ? next(threads) : next;
  });
  const runPersist = vi.fn();
  const saveAction = vi.fn(() => async () => undefined);
  const deps: UseChatThreadRenamesDeps = {
    tursoMode: true, tursoConfig: CFG, projectId: "p", lang: "en-US", threads, setThreads, saveGate: GATE,
    runPersist, saveAction, writeConfig: (pinned) => pinned, landed: () => new Map(), ...over,
  };
  const hook = renderHook(() => useChatThreadRenames(deps));
  return { hook, deps, runPersist, saveAction, setThreads, threads: () => threads };
}

beforeEach(() => {
  window.localStorage.clear();
  resetPendingEditsForTests();
});

describe("useChatThreadRenames", () => {
  it("a rename updates the list, keeps an outbox entry based on the name it started from, and sends the save", () => {
    const { hook, runPersist, saveAction, threads } = setup();
    act(() => hook.result.current.renameThread("a", "Budget review"));
    expect(threads()[0].name).toBe("Budget review");
    expect(stored()).toEqual([{ id: "a", base: "Thread a", value: "Budget review" }]);
    expect(runPersist).toHaveBeenCalledTimes(1);
    expect(runPersist.mock.calls[0][0]).toBe("a");
    expect((saveAction.mock.calls[0] as unknown[])[1]).toMatchObject({ id: "a", name: "Budget review" });
  });

  it("a landed save that owns the entry settles it; one that does not re-bases it", () => {
    const { hook, runPersist } = setup();
    act(() => hook.result.current.renameThread("a", "First"));
    const onLanded = runPersist.mock.calls[0][2] as (owns: boolean) => void;
    act(() => onLanded(false));
    expect(stored()).toEqual([{ id: "a", base: "First", value: "First" }]);
    act(() => onLanded(true));
    expect(stored()).toEqual([]);
  });

  it("without a save gate the rename is kept in the outbox but not sent", () => {
    const { hook, runPersist } = setup({ saveGate: null });
    act(() => hook.result.current.renameThread("a", "Offline"));
    expect(runPersist).not.toHaveBeenCalled();
    expect(stored()).toEqual([{ id: "a", base: "Thread a", value: "Offline" }]);
  });

  it("outside Turso mode there is no outbox scope", () => {
    const { hook } = setup({ tursoMode: false });
    expect(hook.result.current.renameScope()).toBeNull();
    act(() => hook.result.current.renameThread("a", "Local"));
    expect(stored()).toEqual([]);
  });

  it("a draft equal to the confirmed name settles; another one is kept; cancelling keeps the committed name", () => {
    const { hook } = setup();
    act(() => hook.result.current.trackRenameDraft("a", "Draft"));
    expect(stored()).toEqual([{ id: "a", base: "Thread a", value: "Draft" }]);
    act(() => hook.result.current.trackRenameDraft("a", "Thread a"));
    expect(stored()).toEqual([]);
    act(() => hook.result.current.trackRenameDraft("a", "Draft again"));
    act(() => hook.result.current.cancelRenameDraft("a"));
    expect(stored()).toEqual([]);
  });

  it("a load adopts its names and replays a stored rename whose base still matches, normalized", () => {
    trackPendingEdit(SCOPE, { kind: "chat-thread-name", id: "a", base: "Thread a", value: "  Replayed  " });
    flushPendingEdits(Date.now());
    resetPendingEditsForTests();
    const { hook, runPersist, threads } = setup();
    act(() => hook.result.current.namesLoadedRef.current([thread("a")], 0));
    expect(threads()[0].name).toBe("Replayed");
    expect(runPersist).toHaveBeenCalledTimes(1);
  });
});
