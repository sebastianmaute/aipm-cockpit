import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDestructiveSaveGuard } from "./use-destructive-save-guard";

describe("useDestructiveSaveGuard", () => {
  it("starts unarmed with no standing refusal", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    expect(result.current.refusal).toBeNull();
    expect(result.current.consumeArm()).toBe(false);
  });

  it("arms a one-shot that the first consume spends", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.allowDestructiveSave(); });
    expect(result.current.consumeArm()).toBe(true);
    // ★ The SECOND consume is the assertion that matters — "one-shot" is the
    // whole contract, and a consume that merely READ the ref would pass the
    // line above and fail here.
    expect(result.current.consumeArm()).toBe(false);
  });

  it("refuses a mass deletion against synced baselines and records the counts", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    let verdict!: ReturnType<typeof result.current.evaluate>;
    act(() => { verdict = result.current.evaluate(3, 2, false); });
    expect(verdict.refuse).toBe(true);
    expect(result.current.refusal).toEqual({
      prevCollections: 3, prevRecords: 90, curCollections: 3, curRecords: 2, fullWipe: false,
    });
  });

  it("flags a full wipe on the refusal so the surface can pick the heavier tier", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    act(() => { result.current.evaluate(0, 0, false); });
    expect(result.current.refusal?.fullWipe).toBe(true);
  });

  it("records no refusal when an armed bypass lets the deletion through", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    let verdict!: ReturnType<typeof result.current.evaluate>;
    act(() => { verdict = result.current.evaluate(3, 2, true); });
    expect(verdict.refuse).toBe(false);
    expect(result.current.refusal).toBeNull();
  });

  it("re-arms and clears the refusal when the user saves anyway", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    act(() => { result.current.evaluate(3, 2, false); });
    expect(result.current.refusal).not.toBeNull();
    act(() => { result.current.allowDestructiveSaveAnyway(); });
    expect(result.current.refusal).toBeNull();
    expect(result.current.consumeArm()).toBe(true);
  });

  it("keeps allowDestructiveSave identity-stable across renders", () => {
    // ★ NOT cosmetic: `use-register-tools.ts` lists this callback in an
    // exhaustive `useMemo` deps array that assumes every member is stable. A
    // fresh identity each render rebuilds the AI tool table on every render.
    const { result, rerender } = renderHook(() => useDestructiveSaveGuard());
    const first = result.current.allowDestructiveSave;
    rerender();
    expect(result.current.allowDestructiveSave).toBe(first);
  });
});
