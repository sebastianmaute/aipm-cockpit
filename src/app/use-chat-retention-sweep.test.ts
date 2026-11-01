import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";

const expireThreads = vi.fn();
const logDiag = vi.fn();
vi.mock("./chat-threads-store", () => ({ expireThreads: (...a: unknown[]) => expireThreads(...a) }));
vi.mock("./diagnostics", () => ({ logDiag: (...a: unknown[]) => logDiag(...a) }));

import { useChatRetentionSweep, resetChatRetentionSweepForTests } from "./use-chat-retention-sweep";

const config: TursoConfig = { httpUrl: "https://a.example", authToken: "t" };
const other: TursoConfig = { httpUrl: "https://b.example", authToken: "t" };
const chat: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: null } as unknown as ChatSettings;

type Props = { tursoConfig: TursoConfig | null; chat: ChatSettings | null; loadPending: boolean };
const run = (p: Props) => renderHook((props: Props) => useChatRetentionSweep(props), { initialProps: p });

beforeEach(() => {
  expireThreads.mockReset().mockResolvedValue(undefined);
  logDiag.mockReset();
  resetChatRetentionSweepForTests();
});

describe("useChatRetentionSweep", () => {
  it("sweeps the whole database once and not again on rerender or remount", async () => {
    const h = run({ tursoConfig: config, chat, loadPending: false });
    await waitFor(() => expect(expireThreads).toHaveBeenCalledTimes(1));
    const [cfg, cutoff, projectId] = expireThreads.mock.calls[0];
    expect(cfg).toBe(config);
    expect(typeof cutoff).toBe("string");
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
