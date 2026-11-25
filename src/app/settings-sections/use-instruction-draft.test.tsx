import { afterEach, describe, expect, it, vi } from "vitest";
import { LOST_DRAFT_KEY } from "../scheduled-jobs/lost-draft";
import { renderHook } from "@testing-library/react";
import { useInstructionDraft } from "./use-instruction-draft";
import type { ScheduledJob } from "../scheduled-jobs/types";

const job = (over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: 1, name: "J", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
  projectId: "p1", timeZone: "UTC", key: "k1", instruction: "b", lastRunAt: null, history: [], ...over,
});

afterEach(() => sessionStorage.clear());

describe("useInstructionDraft — lost texts add no render of their own", () => {
  it("mounting, and the stored text changing, re-render no more than the change itself needs", () => {
    let renders = 0;
    const onUpdate = vi.fn();
    const { rerender } = renderHook(({ j }: { j: ScheduledJob }) => {
      renders += 1;
      return useInstructionDraft(j, onUpdate);
    }, { initialProps: { j: job() } });
    expect(renders).toBe(1); // the mount-time removal of the stored text from the kept ones changes nothing
    const before = renders;
    rerender({ j: job({ instruction: "y" }) });
    // The rerender, plus the render-phase reconcile of the new stored text: nothing more.
    expect(renders - before).toBeLessThanOrEqual(2);
  });

  it("a kept text equal to the stored instruction is dropped at mount in the first render, with no other", () => {
    sessionStorage.setItem(LOST_DRAFT_KEY, JSON.stringify({ k1: [{ text: "c", reason: "notSaved" }] }));
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useInstructionDraft(job({ instruction: "c" }), vi.fn());
    });
    expect(result.current.lostText).toBeNull();
    expect(renders).toBe(1);
    expect(sessionStorage.getItem(LOST_DRAFT_KEY)).toBeNull();
  });

  it("a text kept between the first render and the subscription is shown newest first", () => {
    sessionStorage.setItem(LOST_DRAFT_KEY, JSON.stringify({ k1: [{ text: "early", reason: "dropped" }] }));
    const realGet = Storage.prototype.getItem;
    let injected = false;
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) {
      const value = realGet.call(this, k);
      if (k === LOST_DRAFT_KEY && !injected) {
        injected = true; // a newer text lands right after the row's first read
        Storage.prototype.setItem.call(this, LOST_DRAFT_KEY, JSON.stringify({ k1: [{ text: "late", reason: "notSaved" }, { text: "early", reason: "dropped" }] }));
      }
      return value;
    });
    try {
      const { result } = renderHook(() => useInstructionDraft(job({ instruction: "x" }), vi.fn()));
      expect(result.current.lostText).toBe("late\n\nearly");
    } finally {
      spy.mockRestore();
    }
  });
});
