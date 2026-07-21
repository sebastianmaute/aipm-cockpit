import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDigest, type UseDigestDeps } from "./use-digest";
import { t } from "./i18n";
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
    const raw = JSON.parse(localStorage.getItem("aipm-cockpit:digest-state") || "{}");
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

  it("renders a display-only digest on remount when enabled but NOT due (no advance, no notify)", async () => {
    advanceDigestState("p1", { now: "2026-07-10T09:00:00.000Z", cadenceDays: 7, rag: "G", metrics: { overdue: 0, openRaid: 0 } });
    const before = JSON.parse(localStorage.getItem("aipm-cockpit:digest-state")!).p1.nextDueAt;
    const fire = vi.fn();
    let hook: ReturnType<typeof renderHook> | undefined;
    await act(async () => {
      hook = renderHook(() =>
        useDigest(deps({ config: { enabled: true, cadenceDays: 7 }, now: () => "2026-07-11T09:00:00.000Z", fireNotification: fire })),
      );
    });
    // Card renders the current facts even though it's not a scheduled run…
    expect((hook!.result.current as { digest: unknown }).digest).not.toBeNull();
    // …but the cadence is NOT advanced and no notification fires.
    expect(fire).not.toHaveBeenCalled();
    const after = JSON.parse(localStorage.getItem("aipm-cockpit:digest-state")!).p1.nextDueAt;
    expect(after).toBe(before);
  });

  it("popout is read-only: no advance, no send, no notify", async () => {
    const fire = vi.fn();
    const { result } = renderHook(() => useDigest(deps({ isPopout: true, fireNotification: fire })));
    await act(async () => { await result.current.generateNow(); });
    expect(fire).not.toHaveBeenCalled();
    expect(localStorage.getItem("aipm-cockpit:digest-state")).toBeNull();
  });

  it("emailDigest sends via Graph when m365 configured", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDigest(deps({ m365Configured: true, sendDigestMail: send, acquireToken: vi.fn().mockResolvedValue("tok") })));
    await act(async () => { await result.current.generateNow(); });
    await act(async () => { await result.current.emailDigest(); });
    expect(send).toHaveBeenCalledTimes(1);
  });

  // A null token means "no signed-in M365 account". The Email button renders on
  // the Settings checkbox alone, NOT on being signed in, so this state is fully
  // reachable — and a bare `return` here made the button a visible no-op. Every
  // other interactive acquireToken call site in the app reports a null token.
  it("tells the user when no account is signed in instead of silently doing nothing", async () => {
    const showToast = vi.fn();
    const send = vi.fn();
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      showToast,
      sendDigestMail: send,
      acquireToken: vi.fn().mockResolvedValue(null),
    })));
    await act(async () => { await result.current.generateNow(); });
    showToast.mockClear();
    await act(async () => { await result.current.emailDigest(); });
    expect(send).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    // Assert the exact MESSAGE: the whole point of this change is which words
    // the user sees, and `expect.any(String)` let the two keys be swapped
    // without any test noticing.
    expect(showToast).toHaveBeenCalledWith(t("en-US", "digestEmailNoAccess"), "info");
  });

  // The send SUCCEEDING was equally silent: the mail left the mailbox and the UI
  // said nothing, so a working button still read as broken.
  it("confirms a successful send so the button is not a no-op to the user", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      showToast,
      sendDigestMail: vi.fn().mockResolvedValue(undefined),
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.generateNow(); });
    showToast.mockClear();
    await act(async () => { await result.current.emailDigest(); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(t("en-US", "digestEmailSent"), "info");
  });

  // Guard the one branch that was already correct, so the fix can't regress it
  // into a success toast on a failed send. `toHaveBeenCalledTimes(1)` plus the
  // exact args pins the whole call set, so a success toast leaking into the
  // catch cannot survive this. The sender's own contract — resolve only on a
  // real send — is tested in digest/digest-mail-sender.test.ts.
  it("still reports a failed send as an error", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      showToast,
      sendDigestMail: vi.fn().mockRejectedValue(new Error("graph 500")),
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.generateNow(); });
    showToast.mockClear();
    await act(async () => { await result.current.emailDigest(); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(t("en-US", "digestEmailFailed"), "error");
  });

  // The Graph POST is bounded at 30s. Without a busy flag the button stays
  // enabled for that whole window, so an impatient user clicking again sends a
  // SECOND email. generate() already guards itself this way; the send did not.
  it("stays busy while the send is in flight so the button can't double-send", async () => {
    let release: () => void = () => {};
    const send = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      sendDigestMail: send,
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.generateNow(); });
    expect(result.current.busy).toBe(false);

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.emailDigest();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Asserting send fired too keeps this honest: busy must be true DURING the
    // in-flight send, not merely set and cleared before it starts.
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    await act(async () => { release(); await pending; });
    expect(result.current.busy).toBe(false);
  });

  // The `busy` FLAG is state, and emailDigest awaits generate() — whose own
  // `finally` clears busy — before setting it again. Between those two the flag
  // is false, so the guard against a duplicate send rested on React batching
  // rather than on anything structural. A ref closes the window outright: two
  // calls in the same tick must produce ONE send, no matter how state settles.
  it("sends once when clicked twice before the first send resolves", async () => {
    let release: () => void = () => {};
    const send = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      sendDigestMail: send,
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.generateNow(); });

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = result.current.emailDigest();
      second = result.current.emailDigest(); // same tick — no re-render between
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => { release(); await first; await second; });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false); // and the guard still releases
  });

  // Emailing is a USER action, not a scheduled run, so it must not reschedule
  // the next digest. Reachable whenever the card has no digest yet — with the
  // feature disabled the mount effect early-returns, so `digest` is null and
  // emailDigest falls through to generate(), which was advancing the cadence.
  it("emailing does not reschedule the next digest", async () => {
    advanceDigestState("p1", { now: "2026-07-03T09:00:00.000Z", cadenceDays: 7, rag: "G", metrics: { overdue: 0, openRaid: 0 } });
    const before = JSON.parse(localStorage.getItem("aipm-cockpit:digest-state")!).p1.nextDueAt;
    const { result } = renderHook(() => useDigest(deps({
      config: { enabled: false, cadenceDays: 7 },
      m365Configured: true,
      sendDigestMail: vi.fn().mockResolvedValue(undefined),
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.emailDigest(); });

    const after = JSON.parse(localStorage.getItem("aipm-cockpit:digest-state")!).p1.nextDueAt;
    expect(after).toBe(before);
  });

  // …and decoupling the cadence must NOT cost the email its AI narrative: the
  // narrative used to ride the same `advance` flag, so flipping that alone would
  // silently email a thinner digest.
  it("still runs the AI narrative for an emailed digest", async () => {
    const runNarrative = vi.fn().mockResolvedValue("Narrative line.");
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDigest(deps({
      config: { enabled: false, cadenceDays: 7 },
      m365Configured: true,
      aiKey: "sk-ant-test",
      runNarrative,
      sendDigestMail: send,
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.emailDigest(); });

    expect(runNarrative).toHaveBeenCalledTimes(1);
    expect(result.current.digest?.narrative).toBe("Narrative line.");
    expect(send).toHaveBeenCalledTimes(1);
  });

  // A NOT-DUE remount auto-generates display-only (narrative:false), caching a
  // digest with no narrative. Emailing then reused that cached value and the
  // narrative:true branch never ran — so the email went out thinner than the
  // code claimed. Regenerate when a narrative is possible but absent.
  it("regenerates for the narrative when the cached digest has none", async () => {
    localStorage.setItem(
      "aipm-cockpit:digest-state",
      // priorMetrics is REQUIRED by the state validator — omit it and the entry
      // is rejected, loadDigestState returns null, and the run counts as DUE
      // (which silently generates WITH a narrative and voids this test).
      JSON.stringify({
        p1: {
          lastRunAt: "2026-07-09T09:00:00.000Z",
          nextDueAt: "2026-07-16T09:00:00.000Z",
          priorRag: "G",
          priorMetrics: { overdue: 0, openRaid: 0 },
        },
      }),
    );
    const runNarrative = vi.fn().mockResolvedValue("Narrative line.");
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDigest(deps({
      config: { enabled: true, cadenceDays: 7 },
      m365Configured: true,
      aiKey: "sk-ant-test",
      runNarrative,
      sendDigestMail: send,
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    // Let the not-due auto-run settle: a digest exists, without a narrative.
    await act(async () => { await Promise.resolve(); });
    expect(result.current.digest).not.toBeNull();
    expect(result.current.digest?.narrative).toBeUndefined();
    expect(runNarrative).not.toHaveBeenCalled();

    await act(async () => { await result.current.emailDigest(); });
    expect(runNarrative).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // …but with AI off a narrative can never appear, so the cached digest must be
  // reused rather than regenerated on every click.
  it("reuses the cached digest when AI is off", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const getModel = vi.fn(() => model());
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true, aiKey: null, getModel,
      sendDigestMail: send, acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.generateNow(); });
    const callsAfterGenerate = getModel.mock.calls.length;
    await act(async () => { await result.current.emailDigest(); });
    expect(getModel.mock.calls.length).toBe(callsAfterGenerate);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // A failing send must release the button, or one Graph error leaves the card
  // permanently disabled with no way back except a reload.
  it("releases busy even when the send fails", async () => {
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      sendDigestMail: vi.fn().mockRejectedValue(new Error("graph 500")),
      acquireToken: vi.fn().mockResolvedValue("tok"),
    })));
    await act(async () => { await result.current.generateNow(); });
    await act(async () => { await result.current.emailDigest(); });
    expect(result.current.busy).toBe(false);
  });

  // Same trap on the guidance path: a null token returns early, and an early
  // return that skips the release would wedge the button.
  it("releases busy when there is no signed-in account", async () => {
    const { result } = renderHook(() => useDigest(deps({
      m365Configured: true,
      sendDigestMail: vi.fn(),
      acquireToken: vi.fn().mockResolvedValue(null),
    })));
    await act(async () => { await result.current.generateNow(); });
    await act(async () => { await result.current.emailDigest(); });
    expect(result.current.busy).toBe(false);
  });

  it("AI-off → no narrative on the digest", async () => {
    const runNarrative = vi.fn();
    const { result } = renderHook(() => useDigest(deps({ aiKey: null, runNarrative })));
    await act(async () => { await result.current.generateNow(); });
    expect(runNarrative).not.toHaveBeenCalled();
    expect(result.current.digest?.narrative).toBeUndefined();
  });
});
