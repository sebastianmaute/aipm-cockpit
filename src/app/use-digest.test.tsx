import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDigest, type UseDigestDeps } from "./use-digest";
import { advanceDigestState } from "./digest/digest-state";
import type { DashboardModel } from "./dashboard";

function model(rag: "R" | "A" | "G" = "A"): DashboardModel {
  return {
    overall: { computed: rag, effective: rag, overridden: false },
    overdue: [], dueSoonMilestones: [], overdueMilestones: [], openRaidCount: 0,
  } as unknown as DashboardModel;
}

function deps(over: Partial<UseDigestDeps> = {}): UseDigestDeps {
  return {
    projectId: "p1",
    isPopout: false,
    lang: "en-US",
    now: () => "2026-07-10T09:00:00.000Z",
    today: "2026-07-10",
    getModel: () => model(),
    getRaid: () => [],
    config: { enabled: false, cadenceDays: 7 },
    aiKey: null,
    aiModel: "claude-sonnet-5",
    m365Configured: false,
    acquireToken: vi.fn(),
    sendDigestMail: vi.fn(),
    fireNotification: vi.fn(),
    showToast: vi.fn(),
    runNarrative: vi.fn(),
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe("useDigest", () => {
  it("generateNow builds a digest and advances state even when disabled", async () => {
    const { result } = renderHook(() => useDigest(deps({ config: { enabled: false, cadenceDays: 7 } })));
    await act(async () => { await result.current.generateNow(); });
    expect(result.current.digest?.rag).toBe("A");
    const raw = JSON.parse(localStorage.getItem("lop-app:digest-state") || "{}");
    expect(raw.p1?.nextDueAt).toBe("2026-07-17T09:00:00.000Z");
  });

  it("does NOT auto-fire when disabled and not due", () => {
    const fire = vi.fn();
    renderHook(() => useDigest(deps({ config: { enabled: false, cadenceDays: 7 }, fireNotification: fire })));
    expect(fire).not.toHaveBeenCalled();
  });

  it("auto-fires + notifies on mount when enabled and due", async () => {
    advanceDigestState("p1", { now: "2026-07-02T09:00:00.000Z", cadenceDays: 7, rag: "G", metrics: { overdue: 0, openRaid: 0 } });
    const fire = vi.fn();
    await act(async () => {
      renderHook(() => useDigest(deps({ config: { enabled: true, cadenceDays: 7 }, fireNotification: fire })));
    });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("popout is read-only: no advance, no send, no notify", async () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useDigest(deps({ isPopout: true, fireNotification: fire })));
    await act(async () => { await result.current.generateNow(); });
    expect(fire).not.toHaveBeenCalled();
    expect(localStorage.getItem("lop-app:digest-state")).toBeNull();
  });

  it("emailDigest sends via Graph when m365 configured", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDigest(deps({ m365Configured: true, sendDigestMail: send, acquireToken: vi.fn().mockResolvedValue("tok") })));
    await act(async () => { await result.current.generateNow(); });
    await act(async () => { await result.current.emailDigest(); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("AI-off → no narrative on the digest", async () => {
    const runNarrative = vi.fn();
    const { result } = renderHook(() => useDigest(deps({ aiKey: null, runNarrative })));
    await act(async () => { await result.current.generateNow(); });
    expect(runNarrative).not.toHaveBeenCalled();
    expect(result.current.digest?.narrative).toBeUndefined();
  });
});
