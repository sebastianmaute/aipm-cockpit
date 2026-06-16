import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const acquireToken = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "tok");
vi.mock("./use-ms-auth", () => ({ useMsAuth: () => ({ acquireToken }) }));
const showToast = vi.fn();
vi.mock("./toast-context", () => ({ useToastContext: () => showToast }));
const listProjectEvents = vi.fn<(...a: unknown[]) => Promise<{ id: string }[]>>(async () => [{ id: "orphan" }]);
const createEvent = vi.fn<(...a: unknown[]) => Promise<string>>(async () => "new-evt");
const updateEvent = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const deleteEvent = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("./outlook-calendar-write", () => ({
  CALENDAR_READWRITE_SCOPE: ["Calendars.ReadWrite"],
  // real class so `err instanceof GraphCalendarError` holds in the hook under test
  GraphCalendarError: class GraphCalendarError extends Error {
    constructor(public status: number, m: string) { super(m); this.name = "GraphCalendarError"; }
  },
  milestoneToGraphEvent: (m: { id: number }) => ({ subject: `M${m.id}` }),
  listProjectEvents: (...a: unknown[]) => listProjectEvents(...a),
  createEvent: (...a: unknown[]) => createEvent(...a),
  updateEvent: (...a: unknown[]) => updateEvent(...a),
  deleteEvent: (...a: unknown[]) => deleteEvent(...a),
}));

import { useOutlookCalendarPush } from "./use-outlook-calendar-push";
import { GraphCalendarError } from "./outlook-calendar-write";
import type { Milestone } from "./types";

const ms = (id: number, over: Partial<Milestone> = {}): Milestone => ({ id, name: `M${id}`, date: "2026-07-01", linkedTaskIds: [], ...over });

beforeEach(() => { vi.clearAllMocks(); acquireToken.mockResolvedValue("tok"); listProjectEvents.mockResolvedValue([{ id: "orphan" }]); createEvent.mockResolvedValue("new-evt"); });

describe("useOutlookCalendarPush", () => {
  it("creates new, deletes orphans, and writes the new event id back", async () => {
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1)], projectId: "p", setMilestones, isPopout: false, lang: "en-US", enabled: true }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(deleteEvent).toHaveBeenCalledWith("tok", "orphan");
    const updater = setMilestones.mock.calls.at(-1)![0];
    const next = typeof updater === "function" ? updater([ms(1)]) : updater;
    expect(next[0].outlookEventId).toBe("new-evt");
    expect(showToast).toHaveBeenCalled();
  });
  it("clears a stale outlookEventId when the update returns 404 (event deleted in Outlook)", async () => {
    listProjectEvents.mockResolvedValue([{ id: "stale" }]); // matches the milestone link → routed to update
    updateEvent.mockRejectedValueOnce(new GraphCalendarError(404, "gone"));
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1, { outlookEventId: "stale" })], projectId: "p", setMilestones, isPopout: false, lang: "en-US", enabled: true }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(setMilestones).toHaveBeenCalled();
    const updater = setMilestones.mock.calls.at(-1)![0];
    const next = typeof updater === "function" ? updater([ms(1, { outlookEventId: "stale" })]) : updater;
    expect(next[0].outlookEventId).toBeUndefined();
    // a 404 self-heal must NOT raise the partial-failure ("error") toast on its own
    expect(showToast).not.toHaveBeenCalledWith("error", expect.anything());
  });
  it("toasts and does nothing when no token", async () => {
    acquireToken.mockResolvedValueOnce(null);
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1)], projectId: "p", setMilestones, isPopout: false, lang: "en-US", enabled: true }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(createEvent).not.toHaveBeenCalled();
    expect(setMilestones).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
  it("no-ops in a popout", async () => {
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1)], projectId: "p", setMilestones, isPopout: true, lang: "en-US", enabled: true }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(acquireToken).not.toHaveBeenCalled();
  });
});
