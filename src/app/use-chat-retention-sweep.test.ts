import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";

const expireThreads = vi.fn();
const loadAllThreadIds = vi.fn();
const logDiag = vi.fn();
vi.mock("./chat-threads-store", () => ({
  expireThreads: (...a: unknown[]) => expireThreads(...a),
  loadAllThreadIds: (...a: unknown[]) => loadAllThreadIds(...a),
}));
const dropPendingEditsWhere = vi.fn();
vi.mock("./pending-edits", async (orig) => ({
  ...(await orig<typeof import("./pending-edits")>()),
  dropPendingEditsWhere: (...a: unknown[]) => dropPendingEditsWhere(...a),
}));
vi.mock("./diagnostics", () => ({ logDiag: (...a: unknown[]) => logDiag(...a) }));
const retryPendingProjectSweeps = vi.fn();
vi.mock("./pending-project-sweeps", () => ({ retryPendingProjectSweeps: (...a: unknown[]) => retryPendingProjectSweeps(...a) }));
// The hook reads the server's chat settings from the deployment state itself; each render below
// sets them first, as `IntegrationSwitchesSync` does before any child renders.
let deploymentChat: ChatSettings | null = null;
vi.mock("./ai-deployment", () => ({ getAiDeploymentState: () => ({ chat: deploymentChat }) }));

import { useChatRetentionSweep, resetChatRetentionSweepForTests } from "./use-chat-retention-sweep";
import { PENDING_EDITS_PREFIX, pendingEditScope } from "./pending-edits";

const config: TursoConfig = { httpUrl: "https://a.example", authToken: "t" };
const other: TursoConfig = { httpUrl: "https://b.example", authToken: "t" };
const chat: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: null } as unknown as ChatSettings;

type Props = { tursoConfig: TursoConfig | null; chat: ChatSettings | null; loadPending: boolean };
const run = (p: Props) => renderHook((props: Props) => {
  deploymentChat = props.chat;
  return useChatRetentionSweep({ tursoConfig: props.tursoConfig, loadPending: props.loadPending });
}, { initialProps: p });

beforeEach(() => {
  expireThreads.mockReset().mockResolvedValue(undefined);
  loadAllThreadIds.mockReset().mockResolvedValue([]);
  dropPendingEditsWhere.mockReset();
  logDiag.mockReset();
  retryPendingProjectSweeps.mockReset().mockResolvedValue(undefined);
  resetChatRetentionSweepForTests();
  deploymentChat = null;
});

describe("useChatRetentionSweep — failed project sweeps", () => {
  it("retries them once per database per page load, after the chat sweep has settled", async () => {
    let finishChatSweep: () => void = () => {};
    expireThreads.mockReturnValue(new Promise<void>((resolve) => { finishChatSweep = resolve; }));
    const h = run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(retryPendingProjectSweeps).not.toHaveBeenCalled();
    finishChatSweep();
    await waitFor(() => expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(1));
    expect(retryPendingProjectSweeps.mock.calls[0][0]).toBe(config);
    h.unmount();
    run({ tursoConfig: { ...config }, chat, loadPending: false });
    run({ tursoConfig: other, chat, loadPending: false });
    await waitFor(() => expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(2));
    expect(retryPendingProjectSweeps.mock.calls[1][0]).toBe(other);
  });

  it("retries them after a failed chat sweep too", async () => {
    expireThreads.mockRejectedValue(new Error("x"));
    run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(1));
  });

  it("retries them while the chat settings are unknown, and not again once they arrive", async () => {
    const h = run({ tursoConfig: config, chat: null, loadPending: false });
    await waitFor(() => expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(1));
    h.rerender({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(1);
  });

  it("waits while the load is pending or no database is configured", async () => {
    const h = run({ tursoConfig: null, chat, loadPending: false });
    h.rerender({ tursoConfig: config, chat, loadPending: true });
    await Promise.resolve();
    expect(retryPendingProjectSweeps).not.toHaveBeenCalled();
  });
});

describe("useChatRetentionSweep", () => {
  it("sweeps the whole database once and not again on rerender or remount", async () => {
    const h = run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(1));
    const [cfg, days, projectId] = expireThreads.mock.calls[0];
    expect(cfg).toBe(config);
    expect(days).toBe(chat.retentionDays);
    expect(projectId).toBeUndefined();
    h.rerender({ tursoConfig: { ...config }, chat: { ...chat }, loadPending: false });
    h.unmount();
    run({ tursoConfig: config, chat, loadPending: false });
    await Promise.resolve();
    expect(expireThreads).toHaveBeenCalledTimes(1);
  });

  it("sweeps a different database separately", async () => {
    run({ tursoConfig: config, chat, loadPending: false });
    run({ tursoConfig: other, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(2));
  });

  it("waits while chat settings are unknown or the load is pending, then runs once", async () => {
    const h = run({ tursoConfig: config, chat: null, loadPending: false });
    h.rerender({ tursoConfig: config, chat, loadPending: true });
    await Promise.resolve();
    expect(expireThreads).not.toHaveBeenCalled();
    h.rerender({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(1));
  });

  it("skips the chat expiry while the retention setting is invalid, and still retries the project sweeps", async () => {
    run({ tursoConfig: config, chat: { ...chat, retentionInvalid: true }, loadPending: false });
    await waitFor(() => expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(expireThreads).not.toHaveBeenCalled();
  });

  it("after the sweep, drops the pending chat renames of this database whose thread is gone", async () => {
    loadAllThreadIds.mockResolvedValue(["kept"]);
    run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(dropPendingEditsWhere).toHaveBeenCalledTimes(1));
    expect(loadAllThreadIds).toHaveBeenCalledWith(config);
    expect(loadAllThreadIds.mock.invocationCallOrder[0]).toBeGreaterThan(expireThreads.mock.invocationCallOrder[0]);
    const [prefix, kind, keep] = dropPendingEditsWhere.mock.calls[0] as [string, string, (id: string) => boolean];
    expect(prefix).toBe(pendingEditScope(config.httpUrl, "chat:"));
    expect(kind).toBe("chat-thread-name");
    expect(keep("kept")).toBe(true);
    expect(keep("gone")).toBe(false);
  });

  it("drops no pending rename when the ids cannot be read, the sweep failed, or it did not run", async () => {
    loadAllThreadIds.mockRejectedValue(new Error("network"));
    run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(loadAllThreadIds).toHaveBeenCalledTimes(1));
    expireThreads.mockRejectedValue(new Error("x"));
    run({ tursoConfig: other, chat, loadPending: false });
    await waitFor(() => expect(logDiag).toHaveBeenCalledWith("warn", "chat.retentionSweepFailed"));
    run({ tursoConfig: { httpUrl: "https://c.example", authToken: "t" }, chat: { ...chat, retentionInvalid: true }, loadPending: false });
    await waitFor(() => expect(retryPendingProjectSweeps).toHaveBeenCalledTimes(3));
    expect(loadAllThreadIds).toHaveBeenCalledTimes(1);
    expect(dropPendingEditsWhere).not.toHaveBeenCalled();
    expect(logDiag).not.toHaveBeenCalledWith("warn", expect.stringMatching(/ids/i));
  });

  it("does nothing without a Turso config", async () => {
    run({ tursoConfig: null, chat, loadPending: false });
    await Promise.resolve();
    expect(expireThreads).not.toHaveBeenCalled();
  });

  it("does not depend on the AI switch", async () => {
    run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(1));
  });

  it("logs a detail-free warning on failure and does not retry this page load", async () => {
    expireThreads.mockRejectedValue(new Error("secret detail"));
    const h = run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(logDiag).toHaveBeenCalledWith("warn", "chat.retentionSweepFailed"));
    expect(logDiag.mock.calls[0]).toHaveLength(2);
    h.rerender({ tursoConfig: { ...config }, chat, loadPending: false });
    await Promise.resolve();
    expect(expireThreads).toHaveBeenCalledTimes(1);
  });
});

describe("useChatRetentionSweep — thread-name drafts of other databases", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const key = (url: string, part: string) => `${PENDING_EDITS_PREFIX}${pendingEditScope(url, part)}`;
  function store(url: string, part: string, edits: { id: string; kind?: string; ageDays: number }[]): void {
    const now = Date.now();
    window.localStorage.setItem(key(url, part), JSON.stringify(edits.map((e) => ({
      v: 1, kind: e.kind ?? "chat-thread-name", id: e.id, base: "b", value: "draft", savedAt: now - e.ageDays * DAY,
    }))));
  }
  const ids = (url: string, part: string): string[] => {
    const raw = window.localStorage.getItem(key(url, part));
    return raw ? (JSON.parse(raw) as { id: string }[]).map((e) => e.id).sort() : [];
  };

  beforeEach(() => window.localStorage.clear());

  it("drops drafts of another database older than the retention period, once per page load; the current database's stay", async () => {
    store(other.httpUrl, "chat:p", [{ id: "old", ageDays: 8 }, { id: "fresh", ageDays: 2 }]);
    store(other.httpUrl, "chat:q", [{ id: "old-q", ageDays: 40 }]);
    store(other.httpUrl, "templates", [{ id: "tpl", kind: "template-name", ageDays: 40 }]);
    store(config.httpUrl, "chat:p", [{ id: "mine-old", ageDays: 40 }]);
    const h = run({ tursoConfig: config, chat: { ...chat, retentionDays: 7 }, loadPending: false });
    await waitFor(() => expect(ids(other.httpUrl, "chat:p")).toEqual(["fresh"]));
    expect(ids(other.httpUrl, "chat:q")).toEqual([]);
    expect(ids(other.httpUrl, "templates")).toEqual(["tpl"]);
    expect(ids(config.httpUrl, "chat:p")).toEqual(["mine-old"]);
    store(other.httpUrl, "chat:r", [{ id: "later", ageDays: 40 }]);
    h.rerender({ tursoConfig: { ...config }, chat: { ...chat, retentionDays: 7 }, loadPending: false });
    await Promise.resolve();
    expect(ids(other.httpUrl, "chat:r")).toEqual(["later"]);
  });

  it("uses 30 days while the retention period is unknown or paused, and waits for the load", async () => {
    store(other.httpUrl, "chat:p", [{ id: "d40", ageDays: 40 }, { id: "d20", ageDays: 20 }]);
    const h = run({ tursoConfig: config, chat: { ...chat, retentionInvalid: true }, loadPending: true });
    await Promise.resolve();
    expect(ids(other.httpUrl, "chat:p")).toEqual(["d20", "d40"]);
    h.rerender({ tursoConfig: config, chat: { ...chat, retentionInvalid: true }, loadPending: false });
    await waitFor(() => expect(ids(other.httpUrl, "chat:p")).toEqual(["d20"]));
  });

  it("drops none without a current Turso database", async () => {
    store(other.httpUrl, "chat:p", [{ id: "d40", ageDays: 40 }]);
    run({ tursoConfig: null, chat: null, loadPending: false });
    await Promise.resolve();
    expect(ids(other.httpUrl, "chat:p")).toEqual(["d40"]);
  });
});
