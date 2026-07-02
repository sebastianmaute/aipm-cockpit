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
  milestoneToGraphEvent: (m: { id: number }) => ({ subject: `M${m.id}` }),
}));

const fetchProjectEventDates = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []);
vi.mock("./outlook-calendar-read", () => ({
  fetchProjectEventDates: (...a: unknown[]) => fetchProjectEventDates(...a),
}));

const writeBaselineDate = vi.fn();
const removeBaselineEntry = vi.fn();
vi.mock("./calendar-sync-baseline", () => ({
  loadBaseline: () => ({}),
  writeBaselineDate: (...a: unknown[]) => writeBaselineDate(...a),
  removeBaselineEntry: (...a: unknown[]) => removeBaselineEntry(...a),
}));

import { useMilestoneCalendarPull } from "./use-milestone-calendar-pull";
import type { Milestone } from "./types";

const ms = (id: number, over: Partial<Milestone> = {}): Milestone => ({
  id, name: `M${id}`, date: "2026-07-01", linkedTaskIds: [], ...over,
});

const setMilestones = vi.fn();
const renderPull = (milestones: Milestone[]) =>
  renderHook(() =>
    useMilestoneCalendarPull({ milestones, projectId: "p", setMilestones, isPopout: false, lang: "en-US", enabled: true }));

beforeEach(() => { vi.clearAllMocks(); acquireToken.mockResolvedValue("tok"); updateEvent.mockResolvedValue(undefined); });

describe("useMilestoneCalendarPull keepApp (converge Outlook to app date)", () => {
  it("updates the Outlook event and writes baseline=appDate on success", async () => {
    const { result } = renderPull([ms(1, { outlookEventId: "evt", date: "2026-07-05" })]);
    await act(async () => {
      await result.current.keepApp({ id: 1, eventId: "evt", appDate: "2026-07-05" });
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith("tok", "evt", { subject: "M1" });
    expect(writeBaselineDate).toHaveBeenCalledWith("p", "milestone", "evt", "2026-07-05");
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("does NOT write baseline when the Outlook update rejects (stays conflicting next pull)", async () => {
    updateEvent.mockRejectedValueOnce(new Error("graph 500"));
    const { result } = renderPull([ms(1, { outlookEventId: "evt", date: "2026-07-05" })]);
    await act(async () => {
      await result.current.keepApp({ id: 1, eventId: "evt", appDate: "2026-07-05" });
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(writeBaselineDate).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("toasts and does nothing when no token", async () => {
    acquireToken.mockResolvedValueOnce(null);
    const { result } = renderPull([ms(1, { outlookEventId: "evt" })]);
    await act(async () => {
      await result.current.keepApp({ id: 1, eventId: "evt", appDate: "2026-07-05" });
    });
    expect(updateEvent).not.toHaveBeenCalled();
    expect(writeBaselineDate).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
});

describe("useMilestoneCalendarPull pull (prune stale link on deletion)", () => {
  it("clears outlookEventId and removes the baseline entry for a definitively-gone event, still opening the modal", async () => {
    // Event "evt" is NOT among the fetched events -> a definitive deletion.
    fetchProjectEventDates.mockResolvedValueOnce([]);
    const { result } = renderPull([ms(1, { outlookEventId: "evt", date: "2026-07-01" })]);
    await act(async () => {
      await result.current.pull();
    });
    // The stale baseline entry is pruned.
    expect(removeBaselineEntry).toHaveBeenCalledWith("p", "milestone", "evt");
    // The milestone's outlookEventId is cleared via the functional setter.
    expect(setMilestones).toHaveBeenCalled();
    const updater = setMilestones.mock.calls.at(-1)![0] as (prev: Milestone[]) => Milestone[];
    const next = updater([ms(1, { outlookEventId: "evt", date: "2026-07-01" })]);
    expect(next[0].outlookEventId).toBeUndefined();
    // The modal still opens (plan.deletions is non-empty).
    expect(result.current.result).not.toBeNull();
    expect(result.current.result!.plan.deletions).toHaveLength(1);
  });
});
