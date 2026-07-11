// src/app/ai-usage-context.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { AiUsageProvider, useAiUsageContext } from "./ai-usage-context";
import { defaultAiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";

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
      result.current.record({ input: 100, output: 50 });
    });

    expect(result.current.sessionTotal).toBe(150);
    expect(result.current.weekTotal).toBe(150);
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

    act(() => { result.current.record({ input: 100, output: 100 }); });

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

    act(() => { result.current.record({ input: 100, output: 100 }); });

    expect(result.current.sessionTotal).toBe(200);
  });

  it("fires showToast once when session usage crosses 80 % of sessionTokenCap", async () => {
    const showToast = vi.fn();
    const cap = 1_000;
    // Set cap to 1 000 tokens; 80 % = 800. Record 900 → should cross once.
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

    act(() => {
      result.current.record({ input: 900, output: 0 });
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe("error");
  });

  it("does NOT re-fire showToast on a second record above the 80 % threshold", async () => {
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

    // First record crosses 80 %.
    act(() => { result.current.record({ input: 900, output: 0 }); });
    // Second record stays above 80 %.
    act(() => { result.current.record({ input: 50, output: 0 }); });

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

    const { result } = renderHook(() => useAiUsageContext(), { wrapper: Wrapper });
    await act(async () => {});

    act(() => { result.current.record({ input: 900, output: 0 }); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("persists usage to localStorage", async () => {
    const { result } = renderHook(() => useAiUsageContext(), {
      wrapper: makeWrapper(vi.fn()),
    });
    await act(async () => {});

    act(() => { result.current.record({ input: 300, output: 100 }); });

    const raw = localStorage.getItem("lop-app:ai-usage");
    expect(raw).not.toBeNull();
    const buckets = JSON.parse(raw!) as Record<string, { input: number; output: number }>;
    const values = Object.values(buckets);
    expect(values[0].input).toBe(300);
    expect(values[0].output).toBe(100);
  });
});
