// §491 — the four insight lifecycle handlers, pinned at the hook that now owns
// them. The detect → reconcile runner is driven through `TaskManager` by
// `task-manager.guardrail-reconcile.test.tsx`; `hydrated: false` keeps it inert
// here so every write below comes from a handler.
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Insight } from "./insights/insight";
import { saveActualsCache } from "./timelog-actuals-store";
import { dailyKey, type TimelogLinks } from "./timelog-types";
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

// Insight 2 carries an extractable metric (`stalledWork` → `count`), so acting on
// it must capture the `metricAtAction` baseline.
const INITIAL = [insight(1), insight(2, { data: { count: 3 } })];

function setup(isPopout = false) {
  const requestOpen = vi.fn();
  const setSpy = vi.fn();
  const { result } = renderHook(() => {
    const [insights, setInsights] = useState<readonly Insight[] | undefined>(INITIAL);
    const deps: InsightLifecycleDeps = {
      hydrated: false, isPopout, loadPending: false, today: TODAY,
      currentProjectId: "p1", landingProjectId: "p1",
      tasks: [], milestones: [], raid: [], budgets: [], roles: [], resources: [], plan: null,
      holidaySet: new Set<string>(), holidaysReady: true, shifts: [], absences: [], timelogLinks: undefined,
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
    expect(result.current.insights?.[1]).toEqual(INITIAL[1]);
  });

  it("act stamps the target, captures its metric baseline and opens its entity", () => {
    const { result, requestOpen } = setup();
    act(() => result.current.handlers.onActInsight(2));
    expect(result.current.insights?.[1]).toMatchObject({ status: "acted", actedAt: TODAY, metricAtAction: { count: 3 } });
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
    expect(result.current.insights).toEqual(INITIAL);
  });
});

// §699 — the runner hands the stored close to the engine. Driven hydrated, with
// fake timers for the 4 s debounce; the cache entry is the only roll source.
describe("useInsightLifecycle runner → timelogClosedMonth", () => {
  const cell = (hours: number) => ({ hours, maxEntryHours: hours, entryCount: 1 });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("passes the close to the engine", () => {
    vi.useFakeTimers();
    saveActualsCache("p1", {
      fetchedAt: "2026-10-04T08:00:00.000Z",
      daily: { [dailyKey(7, "2026-09-12")]: cell(6) },
      dailyWindow: { from: "2026-01-01", to: "2026-10-04" },
      // §699 revision — a project-scope entry: nobody in dailyUsers, the project set recorded.
      dailyUsers: [],
      dailyProjects: [55],
    });
    const timelogLinks: TimelogLinks = {
      userLinks: [{ timelogUserId: 7, resourceId: 40, manual: true }],
      projectLinks: [],
      close: { through: "2026-09", projectIds: [55], saved: { "2026-09": { "7": { "2026-09-12": 8 } } } },
    };
    const { result } = renderHook(() => {
      const [insights, setInsights] = useState<readonly Insight[] | undefined>([]);
      const deps: InsightLifecycleDeps = {
        hydrated: true, isPopout: false, loadPending: false, today: TODAY,
        currentProjectId: "p1", landingProjectId: "p1",
        tasks: [], milestones: [], raid: [], budgets: [], roles: [], resources: [], plan: null,
        holidaySet: new Set<string>(), holidaysReady: true, shifts: [], absences: [], timelogLinks,
        insights, setInsights, requestOpen: vi.fn(),
      };
      useInsightLifecycle(deps);
      return insights;
    });
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(result.current?.map((i) => i.key)).toEqual(["timelog:timelogClosedMonth:7"]);
    expect(result.current?.[0]?.data).toMatchObject({ netHours: -2, timelogUserId: 7 });
  });
});
