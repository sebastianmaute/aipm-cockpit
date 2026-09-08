// src/app/ai-usage-context.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { AI_CAP_BASIS_NOTICE_KEY, AI_USAGE_KEY, AiUsageProvider, useAiUsageContext } from "./ai-usage-context";
import { defaultAiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";
import { t } from "./i18n";

beforeEach(() => {
  localStorage.clear();
});

function makeWrapper(showToast: (kind: "info" | "error", text: string) => void) {
  // Pin the multiplier to 1 so these raw-count assertions are unaffected by the
  // default 5× multiplier (that behaviour is covered by its own tests below).
  const ai = { ...defaultAiConfig, tokenMultiplier: 1 };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
        {children}
      </AiUsageProvider>
    );
  };
}

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

  it("record increments sessionTotal and weekTotal", async () => {
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => {
      result.current.record({ input: 100, output: 50, cacheWrite: 0, cacheRead: 0 });
    });

    expect(result.current.sessionTotal).toBe(150);
    expect(result.current.weekTotal).toBe(150);
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
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    // Record today's usage (untouched, unrelated day) then read the WHOLE
    // persisted blob back — record()'s save persists prevBuckets spread
    // through unchanged, so the legacy day's shape survives the round-trip
    // exactly as loadBucketsAndSeedCapBasisNotice produced it.
    act(() => {
      result.current.record({ input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
    });

    const raw = localStorage.getItem(AI_USAGE_KEY);
    const persisted = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(persisted[other]).toEqual({ input: 100, output: 50, cacheWrite: 0, cacheRead: 0 });
  });

  it("multiplies counted tokens by tokenMultiplier (5) toward sessionTotal", async () => {
    const ai = { ...defaultAiConfig, tokenMultiplier: 5 };
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={vi.fn()}>
          {children}
        </AiUsageProvider>
      );
    }
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => { result.current.record({ input: 100, output: 100, cacheWrite: 0, cacheRead: 0 }); });

    // The multiplier applies to BOTH the session total AND the weekly buckets,
    // so the two caps are compared against the same (multiplied) scale.
    expect(result.current.sessionTotal).toBe(1000);
    expect(result.current.weekTotal).toBe(1000);
  });

  it("accumulates raw tokens when tokenMultiplier is 1", async () => {
    const ai = { ...defaultAiConfig, tokenMultiplier: 1 };
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={vi.fn()}>
          {children}
        </AiUsageProvider>
      );
    }
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => { result.current.record({ input: 100, output: 100, cacheWrite: 0, cacheRead: 0 }); });

    expect(result.current.sessionTotal).toBe(200);
  });

  it("applies tokenMultiplier to the cache fields exactly as to input and output", async () => {
    const ai = { ...defaultAiConfig, tokenMultiplier: 2 };
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={vi.fn()}>
          {children}
        </AiUsageProvider>
      );
    }
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => {
      result.current.record({ input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
    });

    expect(result.current.sessionTotal).toBe(8); // 4 fields x 1 token x 2
  });

  it("fires showToast once when session usage crosses 80 % of sessionTokenCap", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    // Set cap to 1 000 tokens; 80 % = 800. Record 900 → crosses 80 % but not
    // 100 % (multiplier pinned to 1 so the scaled count == raw count).
    const ai = { ...defaultAiConfig, tokenMultiplier: 1, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    // The one-time cap-basis explanatory notice is covered by its own tests
    // below — pre-seed its flag so it does not add a second showToast call
    // here and this test stays scoped to the 80 % warning alone.
    localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => {
      result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe("error");
  });

  it("does NOT re-fire showToast on a second record above the 80 % threshold", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    // Multiplier 1 so 900 + 50 = 950 stays above 80 % but below 100 % (no 100 % toast).
    const ai = { ...defaultAiConfig, tokenMultiplier: 1, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    // See the note above — this test is scoped to the 80 % warning alone.
    localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    // First record crosses 80 %.
    act(() => { result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    // Second record stays above 80 %.
    act(() => { result.current.record({ input: 50, output: 0, cacheWrite: 0, cacheRead: 0 }); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("fires showToast for weekly cap crossing independently", async () => {
    const showToast = vi.fn();
    const weekCap = 1_000;
    // Session cap is very large so it never fires; weekly cap is 1 000.
    const ai = {
      ...defaultAiConfig,
      tokenMultiplier: 1,
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

    // See the note above — this test is scoped to the 80 % warning alone.
    localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => { result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 }); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("fires the self-limit notice once when session usage crosses 100 % of the cap, without blocking", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    const ai = { ...defaultAiConfig, tokenMultiplier: 1, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

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
    act(() => { result.current.record({ input: 850, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.some((c) => c[1] === selfLimitText)).toBe(false);

    // 850 + 200 = 1050 crosses 100 % → the self-limit notice fires once.
    act(() => { result.current.record({ input: 200, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    const afterCross = showToast.mock.calls.filter((c) => c[1] === selfLimitText).length;
    expect(afterCross).toBe(1);

    // Recording is NEVER blocked — the total keeps accumulating past the cap.
    expect(result.current.sessionTotal).toBe(1050);

    // A further record above 100 % does NOT re-fire the notice.
    act(() => { result.current.record({ input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }); });
    expect(showToast.mock.calls.filter((c) => c[1] === selfLimitText).length).toBe(1);
    expect(result.current.sessionTotal).toBe(1150);
  });

  it("explains the changed cap basis once when the first 80% warning fires, then never again on remount", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    // Cap unchanged across the two mounts — only the notice's persistence
    // (localStorage, not a per-instance ref) is under test here.
    const ai = { ...defaultAiConfig, tokenMultiplier: 1, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    const noticeText = t("en-US", "aiUsageCapBasisChanged");

    // This scenario is an UPGRADING user, not a fresh install: they already
    // carried a legacy usage blob (input/output only) before this mount, so
    // the "warnings now arrive earlier" explanation is true for them and
    // must fire. A
    // fresh-install user (no blob at all) must NEVER see it — that is its
    // own test below.
    const other = "2000-01-01";
    localStorage.setItem(
      AI_USAGE_KEY,
      JSON.stringify({ [other]: { input: 1, output: 1 } }),
    );

    const first = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    // 900 crosses 80 % of the 1 000 session cap.
    act(() => {
      first.result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    expect(showToast.mock.calls.filter((c) => c[1] === noticeText)).toHaveLength(1);
    expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBe("1");
    first.unmount();

    // A FRESH provider mount (simulating a page reload after the upgrade)
    // resets every in-memory "already warned" ref, but the notice must not
    // repeat — it is keyed in localStorage precisely so it survives a reload.
    const second = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => {
      second.result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    expect(showToast.mock.calls.filter((c) => c[1] === noticeText)).toHaveLength(1);
  });

  it("fires the cap-basis notice once globally even when session and weekly cross 80% together", async () => {
    const showToast = vi.fn();
    // Same cap for both scopes so a single record() crosses 80 % of BOTH at
    // once — the notice must still appear exactly once, not once per scope.
    const ai = { ...defaultAiConfig, tokenMultiplier: 1, sessionTokenCap: 1_000, weeklyTokenCap: 1_000 };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    // An upgrading user (pre-existing blob) — see the note in the test above.
    const other = "2000-01-01";
    localStorage.setItem(
      AI_USAGE_KEY,
      JSON.stringify({ [other]: { input: 1, output: 1 } }),
    );

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    const noticeText = t("en-US", "aiUsageCapBasisChanged");

    act(() => {
      result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    expect(showToast.mock.calls.filter((c) => c[1] === noticeText)).toHaveLength(1);
  });

  it("seeds the cap-basis notice flag immediately on a fresh install, before any crossing", async () => {
    // localStorage is clear (beforeEach) — no AI_USAGE_KEY blob has ever been
    // written, i.e. a genuinely fresh install. Mounting alone (no record())
    // must seed the flag so the explanatory notice can never fire for this
    // user later — there is no "before" for them to be told about.
    renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBe("1");
  });

  it("does NOT seed the cap-basis notice flag when a usage blob is already present, even if empty", async () => {
    // An EMPTY-but-PRESENT blob (e.g. all history aged out) is not the same
    // as "never written" — this user did experience the old cap basis at
    // some point, so the flag must stay unset until they actually cross 80%.
    localStorage.setItem(AI_USAGE_KEY, JSON.stringify({}));

    renderHook(() => useAiUsageContext(), { wrapper: makeWrapper(vi.fn()) });
    await act(async () => {});

    expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBeNull();
  });

  it("does NOT explain the cap basis for a fresh install, even after it crosses 80%", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    const ai = { ...defaultAiConfig, tokenMultiplier: 1, sessionTokenCap: cap, weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AiUsageProvider lang="en-US" ai={ai} showToast={showToast}>
          {children}
        </AiUsageProvider>
      );
    }

    // localStorage is clear (beforeEach) — fresh install, no prior blob.
    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    const noticeText = t("en-US", "aiUsageCapBasisChanged");

    act(() => {
      result.current.record({ input: 900, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    // The 80 % warning itself still fires...
    expect(showToast.mock.calls.some((c) => c[1] === t("en-US", "usage80Toast"))).toBe(true);
    // ...but the cap-basis explanation never does — this user never
    // experienced the old (uncached-only) cap basis.
    expect(showToast.mock.calls.some((c) => c[1] === noticeText)).toBe(false);
  });

  it("explains the cap basis when a weekly bucket already above 80% at load crosses 100%", async () => {
    // ★ crossed80 is an EDGE detector (prev < threshold && next >= threshold).
    //   A bucket already above 80 % when the provider mounts never crosses
    //   that edge again, so the two crossed80 call sites can never reach this
    //   user — only the crossed100 call sites can, which is what this pins.
    const showToast = vi.fn();
    const weekCap = 1_000;
    const ai = {
      ...defaultAiConfig,
      tokenMultiplier: 1,
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

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    const noticeText = t("en-US", "aiUsageCapBasisChanged");
    const selfLimitText = t("en-US", "aiSelfLimitReached");

    // 850 + 200 = 1050: never "crosses" 80 % (already above it), but DOES
    // cross 100 %.
    act(() => {
      result.current.record({ input: 200, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    expect(showToast.mock.calls.some((c) => c[1] === selfLimitText)).toBe(true);
    expect(showToast.mock.calls.filter((c) => c[1] === noticeText)).toHaveLength(1);
  });

  it("persists usage to localStorage", async () => {
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => { result.current.record({ input: 300, output: 100, cacheWrite: 0, cacheRead: 0 }); });

    const raw = localStorage.getItem(AI_USAGE_KEY);
    expect(raw).not.toBeNull();
    const buckets = JSON.parse(raw!) as Record<string, { input: number; output: number }>;
    const values = Object.values(buckets);
    expect(values[0].input).toBe(300);
    expect(values[0].output).toBe(100);
  });
});
