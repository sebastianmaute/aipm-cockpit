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

const fetchProjectEventDates = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []);
vi.mock("./outlook-calendar-read", () => ({
  fetchProjectEventDates: (...a: unknown[]) => fetchProjectEventDates(...a),
}));

const writeBaselineDate = vi.fn();
const loadBaseline = vi.fn<(...a: unknown[]) => Record<string, string>>(() => ({}));
vi.mock("./calendar-sync-baseline", () => ({
  loadBaseline: (...a: unknown[]) => loadBaseline(...a),
  writeBaselineDate: (...a: unknown[]) => writeBaselineDate(...a),
}));

import { useEntityCalendarPull } from "./use-entity-calendar-pull";

interface FakeItem {
  id: number;
  outlookEventId?: string;
  d?: string;
  jiraKey?: string;
}

const setItems = vi.fn();
const renderPull = (items: FakeItem[]) =>
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
    }));

beforeEach(() => {
  vi.clearAllMocks();
  acquireToken.mockResolvedValue("tok");
  updateEvent.mockResolvedValue(undefined);
  loadBaseline.mockReturnValue({});
});

describe("useEntityCalendarPull pull()", () => {
  it("applies a moved Outlook event (baseline===appDate) → setItems + writeBaselineDate(newDate)", async () => {
    fetchProjectEventDates.mockResolvedValueOnce([{ id: "evt", date: "2026-07-10" }]);
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
    fetchProjectEventDates.mockResolvedValueOnce([{ id: "evt", date: "2026-07-10" }]);
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
    fetchProjectEventDates.mockResolvedValueOnce([
      { id: "evt", date: "2026-07-10", endDate: "2026-07-14" },
    ]);
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
