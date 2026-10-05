// §491 — the four insight lifecycle handlers, pinned at the hook that now owns
// them. The detect → reconcile runner is driven through `TaskManager` by
// `task-manager.guardrail-reconcile.test.tsx`; `hydrated: false` keeps it inert
// here so every write below comes from a handler.
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Insight } from "./insights/insight";
import { type InsightLifecycleDeps, useInsightLifecycle } from "./use-insight-lifecycle";

const TODAY = "2026-10-05";
const insight = (id: number, over: Partial<Insight> = {}): Insight => ({
  id,
  key: `stalledWork:${id}`,
  type: "stalledWork",
  severity: "medium",
  entityRef: { view: "raid", id: 70 + id },
  data: {},
  status: "active",
  firstSeenAt: "2026-10-01",
  lastSeenAt: "2026-10-04",
  occurrences: 2,
  ...over,
});

function setup(isPopout = false) {
  const requestOpen = vi.fn();
  const setSpy = vi.fn();
  const { result } = renderHook(() => {
    const [insights, setInsights] = useState<readonly Insight[] | undefined>([insight(1), insight(2)]);
    const deps: InsightLifecycleDeps = {
      hydrated: false, isPopout, loadPending: false, today: TODAY,
      currentProjectId: "p1", landingProjectId: "p1",
      tasks: [], milestones: [], raid: [], budgets: [], roles: [], resources: [], plan: null,
      holidaySet: new Set<string>(), holidaysReady: true, shifts: [], timelogLinks: undefined,
      insights,
      setInsights: (u) => { setSpy(u); setInsights(u); },
      requestOpen,
    };
    return { insights, handlers: useInsightLifecycle(deps) };
  });
  return { result, requestOpen, setSpy };
}

describe("useInsightLifecycle handlers", () => {
  it("acknowledge stamps the target only", () => {
    const { result } = setup();
    act(() => result.current.handlers.onAcknowledgeInsight(1));
    expect(result.current.insights?.[0]).toMatchObject({ status: "acknowledged", acknowledgedAt: TODAY });
    expect(result.current.insights?.[1]).toEqual(insight(2));
  });

  it("act stamps the target and opens its entity", () => {
    const { result, requestOpen } = setup();
    act(() => result.current.handlers.onActInsight(2));
    expect(result.current.insights?.[1]).toMatchObject({ status: "acted", actedAt: TODAY });
    expect(result.current.insights?.[0]).toEqual(insight(1));
    expect(requestOpen).toHaveBeenCalledWith("raid", 72);
  });

  it("logged-as-RAID acts and links the committed RAID id", () => {
    const { result } = setup();
    act(() => result.current.handlers.onInsightLoggedAsRaid(1, 42));
    expect(result.current.insights?.[0]).toMatchObject({ status: "acted", actedAt: TODAY, loggedRaidId: 42 });
  });

  it("dismiss records the reason only when one is given", () => {
    const { result } = setup();
    act(() => result.current.handlers.onDismissInsight(1, "not relevant"));
    act(() => result.current.handlers.onDismissInsight(2));
    expect(result.current.insights?.[0]).toMatchObject({ status: "dismissed", dismissedAt: TODAY, dismissReason: "not relevant" });
    expect(result.current.insights?.[1]).toMatchObject({ status: "dismissed", dismissedAt: TODAY });
    expect(result.current.insights?.[1]).not.toHaveProperty("dismissReason");
  });

  it("a popout writes nothing and opens nothing", () => {
    const { result, requestOpen, setSpy } = setup(true);
    act(() => {
      result.current.handlers.onAcknowledgeInsight(1);
      result.current.handlers.onActInsight(1);
      result.current.handlers.onInsightLoggedAsRaid(1, 42);
      result.current.handlers.onDismissInsight(1, "x");
    });
    expect(setSpy).not.toHaveBeenCalled();
    expect(requestOpen).not.toHaveBeenCalled();
    expect(result.current.insights).toEqual([insight(1), insight(2)]);
  });
});
