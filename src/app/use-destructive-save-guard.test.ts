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

  // ★★★ Identity, not equality. `use-storage-backend.ts` puts `refusal` in the save
  // effect's dep array, so a fresh object per evaluation loops the effect forever.
  // ★★ NOT the only detector, and do not restore a claim that it is: the same
  // property is pinned end-to-end by "keeps refusing every later save while a
  // refusal stands" in `use-storage-backend.test.tsx`, whose closing
  // `toBe(standing)` runs the REAL save effect and so is the one that would
  // actually reach the heap OOM. What THIS test covers that the sibling cannot is
  // the hook's own contract with no effect in the loop: it fails on the CAUSE (a
  // fresh `refusal` from a repeat `evaluate`) rather than on a downstream symptom,
  // and it stays valid if `use-storage-backend.ts` ever stops depending on it.
  // Neither subsumes the other — deleting either leaves a real gap.
  it("keeps a standing refusal's identity stable while nothing about it changes", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    act(() => { result.current.evaluate(3, 2, false); });
    const first = result.current.refusal;
    expect(first).not.toBeNull();
    act(() => { result.current.evaluate(3, 2, false); });
    expect(result.current.refusal).toBe(first);
  });

  it("replaces the refusal when the counts change", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    act(() => { result.current.evaluate(3, 2, false); });
    const first = result.current.refusal;
    act(() => { result.current.evaluate(3, 5, false); });
    expect(result.current.refusal).not.toBe(first);
    expect(result.current.refusal?.curRecords).toBe(5);
  });
});
