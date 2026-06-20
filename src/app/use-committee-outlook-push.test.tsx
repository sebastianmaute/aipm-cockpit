import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const acquireToken = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "tok");
vi.mock("./use-ms-auth", () => ({ useMsAuth: () => ({ acquireToken }) }));
const showToast = vi.fn();
vi.mock("./toast-context", () => ({ useToastContext: () => showToast }));
const createEvent = vi.fn<(...a: unknown[]) => Promise<string>>(async () => "new-evt");
const updateEvent = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const deleteEvent = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("./outlook-calendar-write", () => ({
  CALENDAR_READWRITE_SCOPE: ["Calendars.ReadWrite"],
  // real class so `err instanceof GraphCalendarError` holds in code under test
  GraphCalendarError: class GraphCalendarError extends Error {
    constructor(public status: number, m: string) { super(m); this.name = "GraphCalendarError"; }
  },
  committeeMeetingToGraphEvent: (m: { id: number }) => ({ subject: `MEET${m.id}` }),
  committeeInfoToGraphEvent: (i: { label: string }) => ({ subject: i.label }),
  createEvent: (...a: unknown[]) => createEvent(...a),
  updateEvent: (...a: unknown[]) => updateEvent(...a),
  deleteEvent: (...a: unknown[]) => deleteEvent(...a),
}));

import { useCommitteeOutlookPush } from "./use-committee-outlook-push";
import { GraphCalendarError } from "./outlook-calendar-write";
import type { SteeringCommittee } from "./types";

const TODAY = "2026-06-20";

// A committee with one FUTURE meeting (id 1, no stored eventId) and one info
// schedule (id 9). dueInfoReminders is real: the future meeting × schedule
// yields one desired info instance keyed "1:9".
function committee(over: Partial<SteeringCommittee> = {}): SteeringCommittee {
  return {
    name: "Board",
    memberResourceIds: [],
    meetings: [{ id: 1, date: "2026-07-15", title: "Q3 review" }],
    infoSchedules: [{ id: 9, label: "Send pack", leadDays: 5 }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  acquireToken.mockResolvedValue("tok");
  createEvent.mockResolvedValue("new-evt");
});

describe("useCommitteeOutlookPush", () => {
  it("creates meeting + info events and persists their ids back immutably", async () => {
    createEvent.mockResolvedValueOnce("meet-evt").mockResolvedValueOnce("info-evt");
    const setSteeringCommittee = vi.fn();
    const c = committee();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: c, committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); });

    expect(createEvent).toHaveBeenCalledTimes(2); // one meeting, one info instance
    const updater = setSteeringCommittee.mock.calls.at(-1)![0];
    const prev = committee();
    const next = updater(prev)!;
    expect(next.meetings[0].outlookEventId).toBe("meet-evt");
    expect(next.infoReminderEventIds!["1:9"]).toBe("info-evt");
    expect(prev.meetings[0].outlookEventId).toBeUndefined(); // prev untouched
    expect(showToast).toHaveBeenCalled();
  });

  it("deletes a stale stored info id and prunes its key", async () => {
    // schedule 9 removed → stored "1:9" is no longer desired → delete + prune
    const c = committee({ infoSchedules: [], infoReminderEventIds: { "1:9": "old-info" } });
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: c, committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); });

    expect(deleteEvent).toHaveBeenCalledWith("tok", "old-info");
    const updater = setSteeringCommittee.mock.calls.at(-1)![0];
    const next = updater(committee({ infoSchedules: [], infoReminderEventIds: { "1:9": "old-info" } }))!;
    expect(next.infoReminderEventIds!["1:9"]).toBeUndefined();
  });

  it("no-ops in a popout", async () => {
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: committee(), committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: true, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(acquireToken).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("continues the batch when one create throws and reflects the failure", async () => {
    createEvent.mockRejectedValueOnce(new GraphCalendarError(500, "boom")).mockResolvedValueOnce("info-evt");
    const setSteeringCommittee = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: committee(), committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); }); // must not throw
    expect(createEvent).toHaveBeenCalledTimes(2); // failure did not abort the batch
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String)); // partial-fail toast
    warn.mockRestore();
  });

  it("toasts and does nothing when no token", async () => {
    acquireToken.mockResolvedValueOnce(null);
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: committee(), committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(createEvent).not.toHaveBeenCalled();
    expect(setSteeringCommittee).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
});
