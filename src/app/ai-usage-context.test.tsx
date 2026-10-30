// src/app/ai-usage-context.test.tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { isBackgroundCapReached, publishBackgroundCapState } from "./ai-consent";
import type { AiConfig } from "./settings-types";
import {
  AI_HARD_CAP_WARNED_KEY,
  AI_CAP_BASIS_NOTICE_KEY,
  AI_COST_BASIS_NOTICE_KEY,
  AI_VIEW_SWITCH_KEY,
  AiUsageProvider,
  useAiUsageContext,
} from "./ai-usage-context";
import { defaultAiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";
import { t } from "./i18n";
import { isoDate, mondayOf, usageCostEquivalent, type Usage } from "./ai-usage";
import { AI_USAGE_BY_PATH_KEY, AI_USAGE_KEY, recordPathUsage } from "./ai-usage-store";
import { emitUsage, tapListenerCount } from "../test/usage-tap";

// The provider records what the transport's tap reports, so the tests drive that tap directly.
vi.mock("./ai-transport", async (orig) => ({
  ...(await orig<typeof import("./ai-transport")>()),
  subscribeAiUsage: (await import("../test/usage-tap")).fakeSubscribeAiUsage,
}));

beforeEach(() => {
  localStorage.clear();
});

function makeWrapper(showToast: (kind: "info" | "error", text: string) => void) {
  const ai = { ...defaultAiConfig };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
        {children}
      </AiUsageProvider>
    );
  };
}

describe("AiUsageProvider weekly hard cap (AI-03)", () => {
  const seedWeek = (cost: number) =>
    recordPathUsage(localStorage, new Date(), "chat", { input: cost, output: 0, cacheWrite: 0, cacheRead: 0 });
  const hardWrapper = (showToast: (kind: "info" | "error", text: string) => void) =>
    function Wrapper({ children, ai }: { children: ReactNode; ai: AiConfig }) {
      return <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>{children}</AiUsageProvider>;
    };
  const render = (showToast: (kind: "info" | "error", text: string) => void, ai: AiConfig) => {
    const W = hardWrapper(showToast);
    return renderHook(() => useAiUsageContext(), {
      wrapper: ({ children }: { children: ReactNode }) => <W ai={ai}>{children}</W>,
    });
  };
  const withCap = (weeklyHardCap?: number): AiConfig => ({ ...defaultAiConfig, weeklyHardCap });
  afterEach(() => publishBackgroundCapState(false));

  it("publishes the cap state on a settings change, with no new recording", async () => {
    seedWeek(900);
    const W = hardWrapper(vi.fn());
    const ai = { current: withCap(1000) };
    const view = renderHook(() => useAiUsageContext(), {
      wrapper: ({ children }: { children: ReactNode }) => <W ai={ai.current}>{children}</W>,
    });
    await act(async () => {});
    expect(isBackgroundCapReached()).toBe(false);
    ai.current = withCap(800);
    view.rerender();
    await act(async () => {});
    expect(isBackgroundCapReached()).toBe(true);
    ai.current = withCap(undefined);
    view.rerender();
    await act(async () => {});
    expect(isBackgroundCapReached()).toBe(false);
  });

  it("is not reached without a hard cap, however much is used", async () => {
    seedWeek(5_000_000);
    render(vi.fn(), withCap(undefined));
    await act(async () => {});
    expect(isBackgroundCapReached()).toBe(false);
  });

  it("publishes reached when another tab's storage event raises the week total", async () => {
    render(vi.fn(), withCap(1000));
    await act(async () => {});
    expect(isBackgroundCapReached()).toBe(false);
    act(() => {
      seedWeek(1200);
      window.dispatchEvent(new StorageEvent("storage", { key: AI_USAGE_BY_PATH_KEY }));
    });
    expect(isBackgroundCapReached()).toBe(true);
  });

  it("warns once per week on an interactive tap while reached, and keeps the key", async () => {
    seedWeek(900);
    const showToast = vi.fn();
    render(showToast, withCap(1000));
    await act(async () => {});
    const hardCalls = () => showToast.mock.calls.filter((c) => c[1] === t("en-US", "aiHardCapPausedToast"));
    act(() => { emitUsage("chat", { input: 50, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(hardCalls()).toHaveLength(0); // 950: not yet reached
    act(() => { emitUsage("chat", { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(hardCalls()).toHaveLength(1);
    expect(localStorage.getItem(AI_HARD_CAP_WARNED_KEY)).toBe(isoDate(mondayOf(new Date())));
    act(() => { emitUsage("chat", { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(hardCalls()).toHaveLength(1);
  });

  it("does not warn for a background tap", async () => {
    seedWeek(900);
    const showToast = vi.fn();
    render(showToast, withCap(1000));
    await act(async () => {});
    act(() => { emitUsage("report_analysis:background", { input: 500, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.some((c) => c[1] === t("en-US", "aiHardCapPausedToast"))).toBe(false);
    expect(localStorage.getItem(AI_HARD_CAP_WARNED_KEY)).toBeNull();
  });

  it("does not warn again when this week was already warned on this device", async () => {
    seedWeek(2000);
    localStorage.setItem(AI_HARD_CAP_WARNED_KEY, isoDate(mondayOf(new Date())));
    const showToast = vi.fn();
    render(showToast, withCap(1000));
    await act(async () => {});
    act(() => { emitUsage("chat", { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.some((c) => c[1] === t("en-US", "aiHardCapPausedToast"))).toBe(false);
  });

  it("warns again in a later week (a stale key is not this week)", async () => {
    seedWeek(2000);
    localStorage.setItem(AI_HARD_CAP_WARNED_KEY, "2000-01-03");
    const showToast = vi.fn();
    render(showToast, withCap(1000));
    await act(async () => {});
    act(() => { emitUsage("chat", { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.filter((c) => c[1] === t("en-US", "aiHardCapPausedToast"))).toHaveLength(1);
  });
});

describe("AiUsageProvider", () => {
  it("starts with sessionTotal = 0 and weekTotal = 0", async () => {
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});
    expect(result.current.sessionTotal).toBe(0);
    expect(result.current.weekTotal).toBe(0);
    expect(result.current.nextReset).toBeInstanceOf(Date);
  });

  it("a tap increments sessionTotal and weekTotal", async () => {
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => {
      emitUsage("chat", { input: 100, output: 50, cacheWrite: 0, cacheRead: 0 });
    });

    // Cost basis, not a raw sum: 100 input * 1 + 50 output * 5 = 350. This
    // predates the weighted-cost design (Task 1) and previously passed only
    // because the provider had not yet switched to usageCostEquivalent.
    expect(result.current.sessionTotal).toBe(350);
    expect(result.current.weekTotal).toBe(350);
  });

  it("normalises a legacy stored blob (input/output only) instead of casting it", async () => {
    // ★★★ THE SEED DAY MUST NOT BE TODAY. addToBuckets (ai-usage.ts) rebuilds
    // ONLY today's bucket ({ ...b, [k]: … }) and spreads every OTHER day's
    // bucket through byte-for-byte, exactly as the loading read returned it.
    // A fixture seeded on today's key is therefore normalised by addToBuckets
    // on the way past regardless of what that read does, and cannot tell
    // the normalising read apart from a raw `as UsageBuckets` cast — that
    // shape was measured vacuous against the cast mutant. A day far in the
    // past guarantees it is never "today", however long this fixture lives.
    const other = "2000-01-01";
    localStorage.setItem(
      AI_USAGE_KEY,
      JSON.stringify({ [other]: { input: 100, output: 50 } }),
    );
    renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    // Record today's usage (untouched, unrelated day) then read the WHOLE
    // persisted blob back — record()'s save persists prevBuckets spread
    // through unchanged, so the legacy day's shape survives the round-trip
    // exactly as loadBucketsAndSeedBasisNotices produced it.
    act(() => {
      emitUsage("chat", { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
    });

    const raw = localStorage.getItem(AI_USAGE_BY_PATH_KEY);
    const persisted = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(persisted[other]).toEqual({ legacy: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0 } });
  });

  it("stores raw API counts in sessionUsage rather than scaled ones", async () => {
    // The panel labels these three figures as token counts. Before this change
    // they were multiplied by tokenMultiplier (default 5) and rendered at 5x
    // while claiming to be counts.
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => { emitUsage("chat", { input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 }); });

    expect(result.current.sessionUsage).toEqual({
      input: 100,
      output: 10,
      cacheWrite: 20,
      cacheRead: 1000,
    });
  });

  it("totals the session on the cost basis", async () => {
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => { emitUsage("chat", { input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 }); });

    // 100*1 + 10*5 + 20*1.25 + 1000*0.1 = 275
    expect(result.current.sessionTotal).toBeCloseTo(275, 6);
  });

  it("ignores a stored tokenMultiplier instead of scaling by it", async () => {
    // ★★ A REINTRODUCTION PIN, NOT A BEHAVIOURAL CHECK, and the distinction is
    //    the whole point: the extra property is INERT, so this is behaviourally
    //    identical to the test above it and NO mutation in `src` can fail it
    //    alone. What it buys is a red run the day someone wires
    //    `ai.tokenMultiplier` back into the provider — every existing device
    //    still carries the persisted field, so that is a live temptation rather
    //    than an edge case. The field no longer exists on AiConfig, so a stored
    //    value can only arrive as an untyped extra property on the settings
    //    blob; the cast is what lets the fixture carry it at all.
    const ai = { ...defaultAiConfig, tokenMultiplier: 5 } as typeof defaultAiConfig;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={vi.fn()}>
          {children}
        </AiUsageProvider>
      );
    }
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => { emitUsage("chat", { input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 }); });

    expect(result.current.sessionTotal).toBeCloseTo(275, 6);
  });

  it("fires showToast once when session usage crosses 80 % of sessionTokenCap", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    // Set cap to 1 000 tokens; 80 % = 800. Record 900 → crosses 80 % but not
    // 100 % (an all-input usage prices at weight 1, so the cost equals the raw count).
    const ai = { ...defaultAiConfig, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => {
      emitUsage("chat", { input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    // ★ EXACTLY ONE call, and that is now structural rather than arranged: the
    //   cost-basis explanation used to ride along on this branch and had to be
    //   pre-suppressed here with a localStorage seed. It never painted (single
    //   toast slot, same tick) and lives in AiUsagePanel now, so a SECOND call
    //   appearing here is a regression, not a fixture detail.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe("error");
  });

  it("does NOT re-fire showToast on a second record above the 80 % threshold", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    // All-input usage prices at weight 1, so 900 + 50 = 950 stays above 80 % but below 100 % (no 100 % toast).
    const ai = { ...defaultAiConfig, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    // First record crosses 80 %.
    act(() => { emitUsage("chat", { input: 900, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    // Second record stays above 80 %.
    act(() => { emitUsage("chat", { input: 50, output: 0, cacheWrite: 0, cacheRead: 0 }); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("fires showToast for weekly cap crossing independently", async () => {
    const showToast = vi.fn();
    const weekCap = 1_000;
    // Session cap is very large so it never fires; weekly cap is 1 000.
    const ai = {
      ...defaultAiConfig,
      sessionTokenCap: DEFAULT_SESSION_TOKEN_CAP,
      weeklyTokenCap: weekCap,
    };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => { emitUsage("chat", { input: 900, output: 0, cacheWrite: 0, cacheRead: 0 }); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("fires the self-limit notice once when session usage crosses 100 % of the cap, without blocking", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    const ai = { ...defaultAiConfig, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    const selfLimitText = t("en-US", "aiSelfLimitReached");

    // 850 crosses 80 % (fires usage80Toast) but NOT 100 %.
    act(() => { emitUsage("chat", { input: 850, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.some((c) => c[1] === selfLimitText)).toBe(false);

    // 850 + 200 = 1050 crosses 100 % → the self-limit notice fires once.
    act(() => { emitUsage("chat", { input: 200, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    const afterCross = showToast.mock.calls.filter((c) => c[1] === selfLimitText).length;
    expect(afterCross).toBe(1);

    // Recording is NEVER blocked — the total keeps accumulating past the cap.
    expect(result.current.sessionTotal).toBe(1050);

    // A further record above 100 % does NOT re-fire the notice.
    act(() => { emitUsage("chat", { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.filter((c) => c[1] === selfLimitText).length).toBe(1);
    expect(result.current.sessionTotal).toBe(1150);
  });

  // ★★★ THE COST-BASIS NOTICE IS NO LONGER A TOAST AND HAS NO TESTS HERE.
  //     Four tests stood at this point asserting it through
  //     `showToast.mock.calls`, and all four passed while the notice was never
  //     PAINTED — `useToast` holds one `Toast | null` slot with no queue, and
  //     every call site fired it in the same tick as its own cap warning, so
  //     React batched the pair and only the warning reached the screen. The
  //     mock recorded the argument; the user saw nothing, and the localStorage
  //     flag had already been written so it could never come back. Asserting on
  //     a mock's ARGUMENTS proves the call was made, never that anything
  //     rendered. The notice now lives in `AiUsagePanel`, where its tests are;
  //     do not re-add a toast-shaped one here.
  //     ★ Deliberately absent, not lost: the flag SEEDING those tests shared is
  //     still pinned by the two tests immediately below.

  it("seeds BOTH basis-notice flags immediately on a fresh install, before any crossing", async () => {
    // localStorage is clear (beforeEach) — no AI_USAGE_KEY blob has ever been
    // written, i.e. a genuinely fresh install. Mounting alone (no record())
    // must seed the flags so the explanatory notice can never fire for this
    // user later — there is no "before" for them to be told about.
    renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    expect(window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY)).toBe("1");
    expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBe("1");
  });

  it("does NOT seed either basis-notice flag when a usage blob is already present, even if empty", async () => {
    // An EMPTY-but-PRESENT blob (e.g. all history aged out) is not the same
    // as "never written" — this user did experience the old cost basis at
    // some point, so the flags must stay unset until they actually cross 80%.
    localStorage.setItem(AI_USAGE_KEY, JSON.stringify({}));

    renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    expect(window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBeNull();
  });

  it("still warns a fresh install at 80%, with nothing else riding along", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    const ai = { ...defaultAiConfig, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    // localStorage is clear (beforeEach) — fresh install, no prior blob.
    renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => {
      emitUsage("chat", { input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    // The 80 % warning fires, and it is the ONLY thing that fires. The
    // "a fresh install is never told about a cost basis it never had" half of
    // this scenario moved to ai-usage-panel.test.tsx with the notice itself.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe(t("en-US", "usage80Toast"));
  });

  it("fires the self-limit notice for a weekly bucket already above 80% at load", async () => {
    // ★ crossed80 is an EDGE detector (prev < threshold && next >= threshold).
    //   A bucket already above 80 % when the provider mounts never crosses
    //   that edge again, so the two crossed80 call sites can never reach this
    //   user — only the crossed100 call sites can, which is what this pins.
    //   ★★ It is also why the cost-basis explanation could not be carried by
    //   either detector for the population that needed it, and now is not:
    //   a device already OVER its cap at mount crosses NOTHING.
    const showToast = vi.fn();
    const weekCap = 1_000;
    const ai = {
      ...defaultAiConfig,
      sessionTokenCap: 1_000_000, // never crosses — isolates the WEEKLY path
      weeklyTokenCap: weekCap,
    };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    // Seed TODAY's bucket (so weekToDate counts it) already at 85 % of the
    // weekly cap — an upgrading user with real prior usage, already above
    // 80 % before this mount.
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    localStorage.setItem(
      AI_USAGE_KEY,
      JSON.stringify({ [todayKey]: { input: 850, output: 0, cacheWrite: 0, cacheRead: 0 } }),
    );

    renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    const selfLimitText = t("en-US", "aiSelfLimitReached");

    // 850 + 200 = 1050: never "crosses" 80 % (already above it), but DOES
    // cross 100 %.
    act(() => {
      emitUsage("chat", { input: 200, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe(selfLimitText);
  });

  it("persists usage to localStorage", async () => {
    renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => { emitUsage("chat", { input: 300, output: 100, cacheWrite: 0, cacheRead: 0 }); });

    const raw = localStorage.getItem(AI_USAGE_BY_PATH_KEY);
    expect(raw).not.toBeNull();
    const buckets = JSON.parse(raw!) as Record<string, Record<string, { input: number; output: number }>>;
    const values = Object.values(buckets);
    expect(values[0].chat.input).toBe(300);
    expect(values[0].chat.output).toBe(100);
  });

  it("leaves both basis-notice flags alone for an upgrading user — recording never stamps them", async () => {
    // ★ The provider used to WRITE both flags from inside record(), as the
    //   side effect of a notice that never painted. That is now the panel's
    //   job, and it matters that record() no longer does it: a user who racks
    //   up usage without ever opening Settings must still be owed the
    //   explanation the next time they look at the bars.
    //   An UPGRADING user, so the fresh-install seed branch does not fire. The
    //   day is far in the past for the reason the legacy-blob test above spells
    //   out: it can never collide with "today".
    localStorage.setItem(
      AI_USAGE_KEY,
      JSON.stringify({ "2000-01-01": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } }),
    );
    const ai = { ...defaultAiConfig, sessionTokenCap: 100 };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={vi.fn()}>
          {children}
        </AiUsageProvider>
      );
    }

    renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    // Enough to cross both 80 % and 100 % of the 100-token session cap.
    act(() => { emitUsage("chat", { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    act(() => { emitUsage("chat", { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });

    expect(window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBeNull();
  });
});

describe("AiUsageProvider — the tap is the recorder", () => {
  const U: Usage = { input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 };
  const renderProvider = (showToast = vi.fn(), ai = { ...defaultAiConfig }) =>
    renderHook(() => useAiUsageContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>{children}</AiUsageProvider>
      ),
    });

  it("a chat tap raises weekTotal and sessionTotal by its cost and adds a chat row", async () => {
    const { result } = renderProvider();
    await act(async () => {});
    act(() => { emitUsage("chat", U); });
    expect(result.current.weekTotal).toBeCloseTo(usageCostEquivalent(U), 6);
    expect(result.current.sessionTotal).toBeCloseTo(usageCostEquivalent(U), 6);
    expect(result.current.weekByFeature).toEqual([{ feature: "chat", usage: U, cost: usageCostEquivalent(U) }]);
    expect(result.current.backgroundWeekCost).toBe(0);
  });

  it("a background tap also raises backgroundWeekCost", async () => {
    const { result } = renderProvider();
    await act(async () => {});
    // The smaller feature is tapped first, so largest-first differs from insertion order.
    act(() => { emitUsage("chat", { input: 1, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    act(() => { emitUsage("report_analysis:background", U); });
    // A tap that cost nothing leaves no row.
    act(() => { emitUsage("propose_raci", { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(result.current.backgroundWeekCost).toBeCloseTo(usageCostEquivalent(U), 6);
    expect(result.current.weekByFeature.map((r) => r.feature)).toEqual(["job-analysis", "chat"]);
  });

  it("a storage event from another tab updates the week, not the session", async () => {
    const { result } = renderProvider();
    await act(async () => {});
    act(() => { emitUsage("chat", { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    const day = isoDate(new Date());
    localStorage.setItem(AI_USAGE_BY_PATH_KEY, JSON.stringify({
      [day]: {
        chat: { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 },
        "propose_wbs_changes:background": { input: 900, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
    }));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: AI_USAGE_BY_PATH_KEY })); });
    expect(result.current.weekTotal).toBe(1000);
    expect(result.current.sessionTotal).toBe(100);
    expect(result.current.backgroundWeekCost).toBe(900);
    // An unrelated key's event is ignored: change storage again and only that event arrives.
    localStorage.setItem(AI_USAGE_BY_PATH_KEY, JSON.stringify({ [day]: { chat: { input: 5000, output: 0, cacheWrite: 0, cacheRead: 0 } } }));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "aipm-cockpit:something-else" })); });
    expect(result.current.weekTotal).toBe(1000);
    // A cleared storage (null key) re-reads.
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    expect(result.current.weekTotal).toBe(5000);
  });

  it("persists through the store, so another tab's recording between two taps survives", async () => {
    const { result } = renderProvider();
    await act(async () => {});
    act(() => { emitUsage("chat", { input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    const day = isoDate(new Date());
    const stored = JSON.parse(localStorage.getItem(AI_USAGE_BY_PATH_KEY)!) as Record<string, Record<string, Usage>>;
    // Another tab records; no storage event reaches this one.
    stored[day]["propose_wbs_changes:background"] = { input: 500, output: 0, cacheWrite: 0, cacheRead: 0 };
    localStorage.setItem(AI_USAGE_BY_PATH_KEY, JSON.stringify(stored));
    act(() => { emitUsage("chat", { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    const after = JSON.parse(localStorage.getItem(AI_USAGE_BY_PATH_KEY)!) as Record<string, Record<string, Usage>>;
    expect(after[day]["propose_wbs_changes:background"].input).toBe(500);
    expect(after[day].chat.input).toBe(110);
    expect(result.current.weekTotal).toBe(610);
  });

  it("the soft cap counts every path: a background recording alone crosses 80 %", async () => {
    const showToast = vi.fn();
    const { result } = renderProvider(showToast, { ...defaultAiConfig, sessionTokenCap: 10_000_000, weeklyTokenCap: 1_000 });
    await act(async () => {});
    act(() => { emitUsage("propose_wbs_changes:background", { input: 900, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe(t("en-US", "usage80Toast"));
    expect(result.current.weekTotal).toBe(900);
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderProvider();
    await act(async () => {});
    expect(tapListenerCount()).toBe(1);
    unmount();
    expect(tapListenerCount()).toBe(0);
    emitUsage("chat", { input: 5, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(localStorage.getItem(AI_USAGE_BY_PATH_KEY)).toBeNull();
  });
});

// §702: the view-switch counter lives beside the token meter but in its own
// key, so nothing here may reach the cap arithmetic.
describe("AiUsageProvider — view-switch counter (§702)", () => {
  const fp = (viewText: string, startedAt: number, threadKey = "p1:t1") => ({
    threadKey,
    model: "m",
    toolNames: "t",
    stableText: "S",
    viewText,
    startedAt,
    lastRequestAt: startedAt + 5_000,
    // Each later send continues the conversation, so it has more turns before
    // it: one more for every second it starts later.
    priorTurns: Math.floor(startedAt / 1_000),
  });

  it("neither counts nor remembers a send no request of which went out", async () => {
    // Nothing reached the cache, so the next send must still be compared with
    // the one before it: A, (B with no request), B → a switch, not a warm send.
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    act(() => { result.current.recordChatSend(fp("A", 1_000), 0, 1); });
    act(() => { result.current.recordChatSend(fp("B", 61_000), 0, 0); });
    act(() => { result.current.recordChatSend(fp("B", 121_000), 4_000, 1); });

    expect(result.current.viewSwitchWeek).toEqual({
      sends: 2,
      requests: 2,
      switches: 1,
      warmSends: 0,
      switchCacheWrite: 4_000,
      warmCacheWrite: 0,
    });
  });

  it("classifies each chat send against the previous one and totals the week", async () => {
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    act(() => { result.current.recordChatSend(fp("A", 1_000), 20_000, 1); }); // cold: first send
    act(() => { result.current.recordChatSend(fp("B", 61_000), 9_000, 3); }); // switch
    act(() => { result.current.recordChatSend(fp("B", 121_000), 200, 2); }); // warm

    expect(result.current.viewSwitchWeek).toEqual({
      sends: 3,
      requests: 6,
      switches: 1,
      warmSends: 1,
      switchCacheWrite: 9_000,
      warmCacheWrite: 200,
    });
  });

  it("compares a send with the previous send in ITS thread, not with whatever ran last", async () => {
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    act(() => { result.current.recordChatSend(fp("A", 1_000, "p1:x"), 0, 1); });
    act(() => { result.current.recordChatSend(fp("A", 31_000, "p1:y"), 0, 1); });
    act(() => { result.current.recordChatSend(fp("B", 61_000, "p1:x"), 7_000, 1); });

    expect(result.current.viewSwitchWeek.switches).toBe(1);
    expect(result.current.viewSwitchWeek.switchCacheWrite).toBe(7_000);
  });

  it("lets an unbilled send move the thread's baseline without counting it", async () => {
    // A send stopped or failed after a response still wrote its prefix to the
    // cache, so the next send must be compared with IT, not with the one before.
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    act(() => { result.current.recordChatSend(fp("A", 1_000), 0, 1); });
    act(() => { result.current.noteUnbilledChatSend(fp("B", 61_000)); });
    act(() => { result.current.recordChatSend(fp("B", 121_000), 300, 1); });

    expect(result.current.viewSwitchWeek).toEqual({
      sends: 2,
      requests: 2,
      switches: 0,
      warmSends: 1,
      switchCacheWrite: 0,
      warmCacheWrite: 300,
    });
  });

  it("persists to its own key and reloads it, leaving the token buckets untouched", async () => {
    const first = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});
    act(() => { first.result.current.recordChatSend(fp("A", 1_000), 50, 1); });
    first.unmount();

    expect(localStorage.getItem(AI_VIEW_SWITCH_KEY)).not.toBeNull();
    expect(localStorage.getItem(AI_USAGE_KEY)).toBeNull();

    const second = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});
    expect(second.result.current.viewSwitchWeek.sends).toBe(1);
    expect(second.result.current.weekTotal).toBe(0);
  });

  it("normalises a malformed stored blob instead of casting it", async () => {
    // Today's bucket, so it is summed into the week: a cast would carry the
    // string through and the totals below would not be numbers.
    localStorage.setItem(
      AI_VIEW_SWITCH_KEY,
      JSON.stringify({ [isoDate(new Date())]: { sends: "x", requests: 2 }, junk: { sends: 9 } }),
    );
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    act(() => { result.current.recordChatSend(fp("A", 1_000), 10, 1); });

    expect(result.current.viewSwitchWeek).toEqual({
      sends: 1,
      requests: 3,
      switches: 0,
      warmSends: 0,
      switchCacheWrite: 0,
      warmCacheWrite: 0,
    });
  });
});
