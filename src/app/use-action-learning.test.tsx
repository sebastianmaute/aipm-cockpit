import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActionLearning } from "./use-action-learning";
import type { SuggestedAction } from "./next-actions/types";

function action(source: SuggestedAction["source"], whyKey: string): SuggestedAction {
  return { id: `${source}:1:x`, source, title: { key: "x" as never }, why: { key: whyKey as never }, score: 40, tier: "soon", cta: { kind: "snooze", actionId: "x" } };
}
const cfg = (enabled: boolean) => ({ enabled, store: "local" as const });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useActionLearning", () => {
  it("records nothing when disabled", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(false), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });
  it("records when enabled and surfaces bias after enough evidence", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => {
      for (let i = 0; i < 3; i++) await result.current.record(action("raid", "wk"), "dismissed");
    });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeLessThan(0));
  });
  it("setOverride pins bias; reset clears", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.setOverride("raid:wk", "surface"); });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeGreaterThan(0));
    await act(async () => { await result.current.reset(); });
    await waitFor(() => expect(result.current.bias).toEqual({}));
  });
  it("does not record in a popout", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: true }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });
});
