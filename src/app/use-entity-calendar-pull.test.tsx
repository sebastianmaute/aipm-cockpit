import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const acquireToken = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "tok");
vi.mock("./use-ms-auth", () => ({ useMsAuth: () => ({ acquireToken }) }));
const showToast = vi.fn();
vi.mock("./toast-context", () => ({ useToastContext: () => showToast }));

const updateEvent = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("./outlook-calendar-write", () => ({
  CALENDAR_READWRITE_SCOPE: ["Calendars.ReadWrite"],
  updateEvent: (...a: unknown[]) => updateEvent(...a),
}));

// The hook now expects `{ events, truncated }` from fetchProjectEventDates.
const fetchProjectEventDates = vi.fn<(...a: unknown[]) => Promise<{ events: unknown[]; truncated: boolean }>>(
  async () => ({ events: [], truncated: false }),
);
vi.mock("./outlook-calendar-read", () => ({
  fetchProjectEventDates: (...a: unknown[]) => fetchProjectEventDates(...a),
}));
// Helper: queue one fetch result in the new shape (defaults to a complete fetch).
const mockEvents = (events: unknown[], truncated = false) =>
  fetchProjectEventDates.mockResolvedValueOnce({ events, truncated });

const writeBaselineDate = vi.fn();
const removeBaselineEntry = vi.fn();
const loadBaseline = vi.fn<(...a: unknown[]) => Record<string, string>>(() => ({}));
vi.mock("./calendar-sync-baseline", () => ({
  loadBaseline: (...a: unknown[]) => loadBaseline(...a),
  writeBaselineDate: (...a: unknown[]) => writeBaselineDate(...a),
  removeBaselineEntry: (...a: unknown[]) => removeBaselineEntry(...a),
}));

import { useEntityCalendarPull } from "./use-entity-calendar-pull";
import { t } from "./i18n";

interface FakeItem {
  id: number;
  outlookEventId?: string;
  d?: string;
  jiraKey?: string;
}

const setItems = vi.fn();
const renderPullOpts = (
  items: FakeItem[],
  opts?: { background?: boolean; onBackgroundApply?: (n: number) => void },
) =>
  renderHook(() =>
    useEntityCalendarPull<FakeItem>({
      items,
      entityType: "task",
      projectId: "p",
      getDate: (x) => x.d,
      withDate: (x, date) => ({ ...x, d: date }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toGraphEvent: (x) => ({ subject: String(x.id) } as any),
      setItems,
      isPullable: (x) => !x.jiraKey,
      isPopout: false,
      lang: "en-US",
      enabled: true,
      background: opts?.background,
      onBackgroundApply: opts?.onBackgroundApply,
    }));
const renderPull = (items: FakeItem[]) => renderPullOpts(items);

beforeEach(() => {
  vi.clearAllMocks();
  acquireToken.mockResolvedValue("tok");
  updateEvent.mockResolvedValue(undefined);
  loadBaseline.mockReturnValue({});
});

describe("useEntityCalendarPull pull()", () => {
  it("applies a moved Outlook event (baseline===appDate) → setItems + writeBaselineDate(newDate)", async () => {
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({ evt: "2026-07-01" });
    const { result } = renderPull([{ id: 1, outlookEventId: "evt", d: "2026-07-01" }]);
    await act(async () => {
      await result.current.pull();
    });
    expect(setItems).toHaveBeenCalledTimes(1);
    expect(writeBaselineDate).toHaveBeenCalledWith("p", "task", "evt", "2026-07-10");
  });

  it("excludes a Jira-synced item (isPullable false) — no apply/conflict/deletion row", async () => {
    // Event moved for the jira item, but it must be filtered out entirely.
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({ evt: "2026-07-01" });
    const { result } = renderPull([
      { id: 1, outlookEventId: "evt", d: "2026-07-01", jiraKey: "ABC-1" },
    ]);
    await act(async () => {
      await result.current.pull();
    });
    expect(setItems).not.toHaveBeenCalled();
    // no rows → "in sync" info toast, no result plan
    expect(result.current.result).toBeNull();
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });
});

describe("useEntityCalendarPull background auto-pull mode", () => {
  it("(a) background apply: auto-applies + writes baseline, does NOT open the modal", async () => {
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({ evt: "2026-07-01" });
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true },
    );
    await act(async () => {
      await result.current.pull();
    });
    expect(setItems).toHaveBeenCalledTimes(1);
    expect(writeBaselineDate).toHaveBeenCalledWith("p", "task", "evt", "2026-07-10");
    expect(result.current.result).toBeNull();
  });

  it("(b) background conflict: fires the conflicts-pending info toast, does NOT setResult", async () => {
    // Event moved but no baseline → the engine classifies it a conflict.
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({});
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true },
    );
    await act(async () => {
      await result.current.pull();
    });
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "calendarPullConflictsPending", 1));
    expect(result.current.result).toBeNull();
  });

  it("(b-dedupe) background conflict toast fires ONCE across repeated pulls with the same unresolved conflict", async () => {
    loadBaseline.mockReturnValue({});
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true },
    );
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    await act(async () => { await result.current.pull(); });
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    await act(async () => { await result.current.pull(); });
    const conflictToasts = showToast.mock.calls.filter(
      (c) => c[1] === t("en-US", "calendarPullConflictsPending", 1),
    );
    expect(conflictToasts).toHaveLength(1);
  });

  it("(c-bg) background definitive deletion prunes the link + baseline", async () => {
    // Item's event id is not among the fetched events → definitive deletion.
    mockEvents([]);
    loadBaseline.mockReturnValue({});
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "gone", d: "2026-07-01" }],
      { background: true },
    );
    await act(async () => {
      await result.current.pull();
    });
    expect(removeBaselineEntry).toHaveBeenCalledWith("p", "task", "gone");
    // the setItems updater clears outlookEventId
    const updater = setItems.mock.calls.at(-1)![0] as (prev: FakeItem[]) => FakeItem[];
    const next = updater([{ id: 1, outlookEventId: "gone", d: "2026-07-01" }]);
    expect(next[0].outlookEventId).toBeUndefined();
    // background never opens the modal
    expect(result.current.result).toBeNull();
  });

  it("(e) background with no token returns silently (no error toast)", async () => {
    acquireToken.mockResolvedValueOnce(null);
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true },
    );
    await act(async () => {
      await result.current.pull();
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(setItems).not.toHaveBeenCalled();
  });

  it("(FIX#5) background apply calls onBackgroundApply once with the applied count", async () => {
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({ evt: "2026-07-01" }); // baseline===appDate → auto-apply
    const onBackgroundApply = vi.fn();
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true, onBackgroundApply },
    );
    await act(async () => {
      await result.current.pull();
    });
    expect(onBackgroundApply).toHaveBeenCalledTimes(1);
    expect(onBackgroundApply).toHaveBeenCalledWith(1);
  });

  it("(FIX#5) does NOT call onBackgroundApply when there are no applies", async () => {
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({}); // no baseline → conflict, not apply
    const onBackgroundApply = vi.fn();
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true, onBackgroundApply },
    );
    await act(async () => {
      await result.current.pull();
    });
    expect(onBackgroundApply).not.toHaveBeenCalled();
  });

  it("(FIX#4) background pull never toggles the busy state", async () => {
    let release: (v: string) => void = () => {};
    acquireToken.mockReturnValueOnce(new Promise<string>((res) => { release = res; }));
    mockEvents([]);
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true },
    );
    let p: Promise<void> = Promise.resolve();
    act(() => { p = result.current.pull(); });
    // busy stays false even while the token acquisition is pending
    expect(result.current.busy).toBe(false);
    await act(async () => { release("tok"); await p; });
    expect(result.current.busy).toBe(false);
  });

  it("(FIX#3) background no-token pull resets the dedupe ref so a re-conflict re-toasts", async () => {
    loadBaseline.mockReturnValue({}); // no baseline → conflict
    const { result } = renderPullOpts(
      [{ id: 1, outlookEventId: "evt", d: "2026-07-01" }],
      { background: true },
    );
    const conflictToastCount = () =>
      showToast.mock.calls.filter((c) => c[1] === t("en-US", "calendarPullConflictsPending", 1)).length;
    // 1) conflict → toast fires, ref = sig
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    await act(async () => { await result.current.pull(); });
    expect(conflictToastCount()).toBe(1);
    // 2) no token → the ref is reset to null (can't confirm the conflict set)
    acquireToken.mockResolvedValueOnce(null);
    await act(async () => { await result.current.pull(); });
    // 3) SAME conflict again → re-toasts because the dedupe ref was cleared
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    await act(async () => { await result.current.pull(); });
    expect(conflictToastCount()).toBe(2);
  });
});

describe("useEntityCalendarPull cross-instance in-flight lock (FIX#1)", () => {
  it("a second concurrent pull for the same entity is a no-op (only one fetch)", async () => {
    let release: (v: string) => void = () => {};
    acquireToken.mockReturnValueOnce(new Promise<string>((res) => { release = res; }));
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({ evt: "2026-07-01" });
    const { result } = renderPull([{ id: 1, outlookEventId: "evt", d: "2026-07-01" }]);
    await act(async () => {
      const p1 = result.current.pull(); // acquires the lock, suspends on the pending token
      const p2 = result.current.pull(); // sees the lock held → returns immediately
      release("tok");
      await Promise.all([p1, p2]);
    });
    // The second pull short-circuited before fetching.
    expect(fetchProjectEventDates).toHaveBeenCalledTimes(1);
  });
});

describe("useEntityCalendarPull manual deletion prune + modal", () => {
  it("(c-manual) definitive deletion prunes link + baseline", async () => {
    mockEvents([]);
    loadBaseline.mockReturnValue({});
    const { result } = renderPull([{ id: 1, outlookEventId: "gone", d: "2026-07-01" }]);
    await act(async () => {
      await result.current.pull();
    });
    expect(removeBaselineEntry).toHaveBeenCalledWith("p", "task", "gone");
    const updater = setItems.mock.calls.at(-1)![0] as (prev: FakeItem[]) => FakeItem[];
    const next = updater([{ id: 1, outlookEventId: "gone", d: "2026-07-01" }]);
    expect(next[0].outlookEventId).toBeUndefined();
  });

  it("(d) manual with rows opens the modal (result set)", async () => {
    mockEvents([{ id: "evt", date: "2026-07-10" }]);
    loadBaseline.mockReturnValue({});
    const { result } = renderPull([{ id: 1, outlookEventId: "evt", d: "2026-07-01" }]);
    await act(async () => {
      await result.current.pull();
    });
    expect(result.current.result).not.toBeNull();
    expect(result.current.result?.plan.conflicts.length).toBe(1);
  });
});

describe("useEntityCalendarPull keepApp (converge Outlook to app date)", () => {
  it("updates the Outlook event and writes baseline=appDate on success", async () => {
    const { result } = renderPull([{ id: 1, outlookEventId: "evt", d: "2026-07-05" }]);
    await act(async () => {
      await result.current.keepApp({ id: 1, eventId: "evt", appDate: "2026-07-05" });
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith("tok", "evt", { subject: "1" });
    expect(writeBaselineDate).toHaveBeenCalledWith("p", "task", "evt", "2026-07-05");
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("does NOT write baseline when the Outlook update rejects", async () => {
    updateEvent.mockRejectedValueOnce(new Error("graph 500"));
    const { result } = renderPull([{ id: 1, outlookEventId: "evt", d: "2026-07-05" }]);
    await act(async () => {
      await result.current.keepApp({ id: 1, eventId: "evt", appDate: "2026-07-05" });
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(writeBaselineDate).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
});

interface FakeRangeItem {
  id: number;
  outlookEventId?: string;
  d?: string;
  end?: string;
}

const renderRangePull = (items: FakeRangeItem[]) =>
  renderHook(() =>
    useEntityCalendarPull<FakeRangeItem>({
      items,
      entityType: "absence",
      projectId: "p",
      getDate: (x) => x.d,
      getEndDate: (x) => x.end,
      withDate: (x, date, endDate) => ({ ...x, d: date, end: endDate ?? x.end }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toGraphEvent: (x) => ({ subject: String(x.id) } as any),
      setItems,
      isPopout: false,
      lang: "en-US",
      enabled: true,
    }));

describe("useEntityCalendarPull date-range (absence) entities", () => {
  it("applies a moved range event: setItems sets BOTH dates, baseline = 'start|end'", async () => {
    mockEvents([{ id: "evt", date: "2026-07-10", endDate: "2026-07-14" }]);
    loadBaseline.mockReturnValue({ evt: "2026-07-01|2026-07-05" });
    const { result } = renderRangePull([
      { id: 1, outlookEventId: "evt", d: "2026-07-01", end: "2026-07-05" },
    ]);
    await act(async () => {
      await result.current.pull();
    });
    expect(setItems).toHaveBeenCalledTimes(1);
    // the setItems updater applies withDate with BOTH dates
    const updater = setItems.mock.calls[0][0] as (prev: FakeRangeItem[]) => FakeRangeItem[];
    const next = updater([
      { id: 1, outlookEventId: "evt", d: "2026-07-01", end: "2026-07-05" },
    ]);
    expect(next[0]).toMatchObject({ d: "2026-07-10", end: "2026-07-14" });
    expect(writeBaselineDate).toHaveBeenCalledWith(
      "p",
      "absence",
      "evt",
      "2026-07-10|2026-07-14",
    );
  });

  it("keepApp with appEndDate writes baseline 'start|end' after updateEvent resolves", async () => {
    const { result } = renderRangePull([
      { id: 1, outlookEventId: "evt", d: "2026-07-01", end: "2026-07-05" },
    ]);
    await act(async () => {
      await result.current.keepApp({
        id: 1,
        eventId: "evt",
        appDate: "2026-07-01",
        appEndDate: "2026-07-05",
      });
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(writeBaselineDate).toHaveBeenCalledWith(
      "p",
      "absence",
      "evt",
      "2026-07-01|2026-07-05",
    );
  });
});
