// src/app/chat-thread-writes.test.ts — the helpers useChatThreads and its sibling hooks share for
// writing chat threads: which database a config names, the rename outbox's scope and replay, the
// confirmed names a load adopts, and the retention expiry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatThread } from "./chat-threads";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";

const expireThreads = vi.fn();
vi.mock("./chat-threads-store", () => ({ expireThreads: (...a: unknown[]) => expireThreads(...a) }));
const logDiag = vi.fn();
vi.mock("./diagnostics", () => ({ logDiag: (...a: unknown[]) => logDiag(...a) }));

import {
  RENAME_KIND, adoptConfirmedNames, expireOldThreads, expiredBy, outboxScope, retentionInForce, sameDatabase,
  takeRenameReplays, urlOf,
} from "./chat-thread-writes";
import {
  PENDING_EDITS_PREFIX, flushPendingEdits, pendingEditScope, resetPendingEditsForTests, trackPendingEdit,
} from "./pending-edits";

const CFG: TursoConfig = { httpUrl: "https://writes.example.invalid", authToken: "t" };
const DAY = 24 * 60 * 60 * 1000;

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id, projectId: "p", ownerId: "me", name: `Thread ${id}`, createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(), history: [], display: [], ...over,
  };
}

/** The ids with a stored rename in `scope`, after flushing this page's live edits. */
function storedIds(scope: string): string[] {
  flushPendingEdits(Date.now());
  const raw = window.localStorage.getItem(`${PENDING_EDITS_PREFIX}${scope}`);
  return raw ? (JSON.parse(raw) as { id: string }[]).map((e) => e.id).sort() : [];
}

beforeEach(() => {
  window.localStorage.clear();
  resetPendingEditsForTests();
  expireThreads.mockReset().mockResolvedValue(undefined);
  logDiag.mockReset();
});

describe("which database a config names", () => {
  it("urlOf is the config's URL, or empty without one", () => {
    expect(urlOf(CFG)).toBe(CFG.httpUrl);
    expect(urlOf(null)).toBe("");
  });

  it("two configs name the same database when their URLs match, whatever the token", () => {
    expect(sameDatabase(CFG, { ...CFG, authToken: "rotated" })).toBe(true);
    expect(sameDatabase(CFG, { ...CFG, httpUrl: "https://other.example.invalid" })).toBe(false);
    expect(sameDatabase(null, null)).toBe(true);
    expect(sameDatabase(CFG, null)).toBe(false);
  });

  it("the outbox scope is per database and project, and null without a usable URL", () => {
    expect(outboxScope(CFG, "p")).toBe(pendingEditScope(CFG.httpUrl, "chat:p"));
    expect(outboxScope(CFG, "templates")).not.toBe(pendingEditScope(CFG.httpUrl, "templates"));
    expect(outboxScope(null, "p")).toBeNull();
    expect(outboxScope({ ...CFG, httpUrl: "" }, "p")).toBeNull();
  });
});

describe("takeRenameReplays", () => {
  it("returns the renames whose thread is loaded with the name the draft started from, and drops the others", () => {
    const scope = outboxScope(CFG, "p")!;
    trackPendingEdit(scope, { kind: RENAME_KIND, id: "keep", base: "Thread keep", value: "Renamed" });
    trackPendingEdit(scope, { kind: RENAME_KIND, id: "moved-on", base: "Old name", value: "Lost" });
    trackPendingEdit(scope, { kind: RENAME_KIND, id: "gone", base: "Thread gone", value: "Lost too" });
    trackPendingEdit(scope, { kind: "template-name", id: "keep", base: "x", value: "not a chat" });
    flushPendingEdits(Date.now());
    resetPendingEditsForTests();
    const keep = thread("keep");

    const replays = takeRenameReplays(scope, [keep, thread("moved-on")]);

    expect(replays).toEqual([{ target: keep, value: "Renamed" }]);
    const dropped = logDiag.mock.calls.filter((c) => c[1] === "storage.pendingEditDropped").map((c) => c[2]);
    expect(dropped).toEqual([
      { reason: "changed", kind: RENAME_KIND, id: "moved-on" },
      { reason: "missing", kind: RENAME_KIND, id: "gone" },
    ]);
    // Never the typed value in a log line.
    expect(JSON.stringify(logDiag.mock.calls)).not.toContain("Lost");
  });
});

describe("adoptConfirmedNames", () => {
  it("adopts a load's names, except for a thread whose save landed after the load started", () => {
    const confirmed = new Map<string, string>([["a", "older"]]);
    const landed = new Map([["b", { seq: 3, at: 5 }], ["c", { seq: 1, at: 2 }]]);
    adoptConfirmedNames(confirmed, landed, [thread("a", { name: "A" }), thread("b", { name: "B" }), thread("c", { name: "C" })], 4);
    expect([...confirmed.entries()].sort()).toEqual([["a", "A"], ["c", "C"]]);
  });
});

describe("retention", () => {
  const CHAT: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: "k", recoveryKeyInvalid: false };

  it("a period is in force only while the setting is known and valid", () => {
    expect(retentionInForce(CHAT)).toBe(30);
    expect(retentionInForce({ ...CHAT, retentionInvalid: true })).toBeNull();
    expect(retentionInForce(null)).toBeNull();
  });

  it("expiredBy matches the expiry statement: older than the cutoff, or no usable date", () => {
    const cutoff = "2026-10-01T00:00:00.000Z";
    expect(expiredBy("2026-09-30T23:59:59.999Z", cutoff)).toBe(true);
    expect(expiredBy("2026-10-01T00:00:00.000Z", cutoff)).toBe(false);
    expect(expiredBy("2026-10-02T00:00:00.000Z", cutoff)).toBe(false);
    expect(expiredBy("", cutoff)).toBe(true);
    expect(expiredBy("not a date", cutoff)).toBe(true);
  });

  it("expireOldThreads deletes the project's old threads, then drops only the renames of the ones it removed", async () => {
    const scope = outboxScope(CFG, "p")!;
    const old = thread("old", { updatedAt: new Date(Date.now() - 40 * DAY).toISOString() });
    const recent = thread("recent");
    const elsewhere = thread("elsewhere", { projectId: "q", updatedAt: old.updatedAt });
    for (const th of [old, recent, elsewhere]) trackPendingEdit(scope, { kind: RENAME_KIND, id: th.id, base: th.name, value: "x" });

    expireOldThreads(CFG, 30, "p", () => [old, recent, elsewhere]);

    await vi.waitFor(() => expect(storedIds(scope)).toEqual(["elsewhere", "recent"]));
    expect(expireThreads).toHaveBeenCalledWith(CFG, 30, "p");
  });

  it("expireOldThreads never throws: a failure is logged without detail and drops no rename", async () => {
    const scope = outboxScope(CFG, "p")!;
    const old = thread("old", { updatedAt: new Date(Date.now() - 40 * DAY).toISOString() });
    trackPendingEdit(scope, { kind: RENAME_KIND, id: "old", base: old.name, value: "x" });
    expireThreads.mockRejectedValue(new Error("secret detail"));

    expect(() => expireOldThreads(CFG, 30, "p", () => [old])).not.toThrow();

    await vi.waitFor(() => expect(logDiag).toHaveBeenCalledWith("warn", "chat.retentionExpireFailed"));
    expect(storedIds(scope)).toEqual(["old"]);
  });
});
