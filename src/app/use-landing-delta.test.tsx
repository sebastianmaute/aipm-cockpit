import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useLandingDelta } from "./use-landing-delta";
import { clearLandingState, loadLandingState, saveLandingState } from "./landing-state";
import type { RagScope } from "./dashboard-delta";
import type { Health } from "./health";

afterEach(() => { clearLandingState(); vi.useRealTimers(); });

const RAG: Record<RagScope, Health | null> = { overall: "A", schedule: "G", budget: null, scope: null };
const METRICS = { complete: 50, overdue: 4, openRaid: 3 };

function Harness({ projectId, isPopout }: { projectId: string; isPopout: boolean }) {
  const { delta, trends } = useLandingDelta({
    projectId, currentRag: RAG, currentMetrics: METRICS, overdue: [], today: "2026-06-21", isPopout,
  });
  return (
    <>
      <div data-testid="first">{String(delta.isFirstVisit)}</div>
      <div data-testid="overdue-dir">{trends.overdue.direction}</div>
      <div data-testid="overdue-improved">{String(trends.overdue.improved)}</div>
    </>
  );
}

describe("useLandingDelta", () => {
  test("captures delta from the prior snapshot at mount", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z", rag: { overall: "G" } });
    const { getByTestId } = render(<Harness projectId="p1" isPopout={false} />);
    expect(getByTestId("first").textContent).toBe("false");
  });

  test("advances the snapshot after the debounce (non-popout)", () => {
    vi.useFakeTimers();
    render(<Harness projectId="p1" isPopout={false} />);
    expect(loadLandingState("p1").lastVisitAt).toBeUndefined();
    act(() => { vi.advanceTimersByTime(4000); });
    const saved = loadLandingState("p1");
    expect(saved.lastVisitAt).toBeDefined();
    expect(saved.rag).toEqual({ overall: "A", schedule: "G" });
    expect(saved.metrics).toEqual({ complete: 50, overdue: 4, openRaid: 3 });
  });

  test("computes KPI trends from the prior metrics snapshot (overdue rose → worse)", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z", metrics: { complete: 40, overdue: 1, openRaid: 3 } });
    const { getByTestId } = render(<Harness projectId="p1" isPopout={false} />);
    // current overdue 4 > prior 1 → up, and more overdue is worse.
    expect(getByTestId("overdue-dir").textContent).toBe("up");
    expect(getByTestId("overdue-improved").textContent).toBe("false");
  });

  test("no prior metrics → trend improved is null (renders no arrow)", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z" });
    const { getByTestId } = render(<Harness projectId="p1" isPopout={false} />);
    expect(getByTestId("overdue-improved").textContent).toBe("null");
  });

  test("popout never advances the snapshot", () => {
    vi.useFakeTimers();
    render(<Harness projectId="p1" isPopout={true} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(loadLandingState("p1")).toEqual({});
  });
});
