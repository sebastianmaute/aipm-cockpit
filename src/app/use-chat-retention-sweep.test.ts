import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";

const expireThreads = vi.fn();
const logDiag = vi.fn();
vi.mock("./chat-threads-store", () => ({ expireThreads: (...a: unknown[]) => expireThreads(...a) }));
vi.mock("./diagnostics", () => ({ logDiag: (...a: unknown[]) => logDiag(...a) }));
const retryPendingProjectSweeps = vi.fn();
vi.mock("./pending-project-sweeps", () => ({ retryPendingProjectSweeps: (...a: unknown[]) => retryPendingProjectSweeps(...a) }));
// The hook reads the server's chat settings from the deployment state itself; each render below
// sets them first, as `IntegrationSwitchesSync` does before any child renders.
let deploymentChat: ChatSettings | null = null;
vi.mock("./ai-deployment", () => ({ getAiDeploymentState: () => ({ chat: deploymentChat }) }));

import { useChatRetentionSweep, resetChatRetentionSweepForTests } from "./use-chat-retention-sweep";

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
