import { afterEach, describe, expect, it, vi } from "vitest";
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
});
