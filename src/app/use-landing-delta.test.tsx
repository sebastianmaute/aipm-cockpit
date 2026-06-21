import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useLandingDelta } from "./use-landing-delta";
import { clearLandingState, loadLandingState, saveLandingState } from "./landing-state";
import type { RagScope } from "./dashboard-delta";
import type { Health } from "./health";

afterEach(() => { clearLandingState(); vi.useRealTimers(); });

const RAG: Record<RagScope, Health | null> = { overall: "A", schedule: "G", budget: null, scope: null };

function Harness({ projectId, isPopout }: { projectId: string; isPopout: boolean }) {
  const delta = useLandingDelta({ projectId, currentRag: RAG, overdue: [], today: "2026-06-21", isPopout });
  return <div data-testid="first">{String(delta.isFirstVisit)}</div>;
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
  });

  test("popout never advances the snapshot", () => {
    vi.useFakeTimers();
    render(<Harness projectId="p1" isPopout={true} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(loadLandingState("p1")).toEqual({});
  });
});
