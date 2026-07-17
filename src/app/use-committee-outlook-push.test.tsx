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

  it("deletes an orphaned deleted-meeting event (pendingDeleteEventIds) and clears it", async () => {
    // A meeting was deleted while carrying a pushed event id — stashed in
    // pendingDeleteEventIds. The push must delete it and clear the pending list.
    const c = committee({ infoSchedules: [], pendingDeleteEventIds: ["orphan-evt"] });
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: c, committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); });

    expect(deleteEvent).toHaveBeenCalledWith("tok", "orphan-evt");
    const updater = setSteeringCommittee.mock.calls.at(-1)![0];
    const next = updater(committee({ infoSchedules: [], pendingDeleteEventIds: ["orphan-evt"] }))!;
    expect(next.pendingDeleteEventIds).toBeUndefined(); // cleared after delete
  });

  it("self-heals a 404 on meeting update: clears the stale id so next push re-creates", async () => {
    // Meeting carries a stored eventId, but it was deleted in Outlook → update 404s.
    updateEvent.mockRejectedValueOnce(new GraphCalendarError(404, "gone"));
    const c = committee({
      infoSchedules: [],
      meetings: [{ id: 1, date: "2026-07-15", title: "Q3 review", outlookEventId: "dead-ev" }],
    });
    const setSteeringCommittee = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: c, committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook(); });

    expect(updateEvent).toHaveBeenCalled();
    // Not a hard failure (no partial-fail error toast); the id is cleared instead.
    expect(showToast).not.toHaveBeenCalledWith("error", expect.any(String));
    const updater = setSteeringCommittee.mock.calls.at(-1)![0];
    const next = updater(c)!;
    expect(next.meetings[0].outlookEventId).toBeUndefined();
    warn.mockRestore();
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

  it("scoped meeting push creates ONLY that meeting and preserves pendingDeleteEventIds", async () => {
    createEvent.mockResolvedValueOnce("meet-evt");
    // Two meetings + a pending orphaned event; a scoped push of meeting 1 must
    // not touch the info instance, meeting 2, or the pending-delete accounting.
    const c = committee({
      meetings: [
        { id: 1, date: "2026-07-15", title: "Q3 review" },
        { id: 2, date: "2026-07-20", title: "Board", outlookEventId: "ev2" },
      ],
      pendingDeleteEventIds: ["orphan-evt"],
    });
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: c, committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));
    await act(async () => { await result.current.pushToOutlook({ kind: "meeting", id: 1 }); });

    expect(createEvent).toHaveBeenCalledTimes(1); // only meeting 1
    expect(updateEvent).not.toHaveBeenCalled(); // meeting 2 untouched
    expect(deleteEvent).not.toHaveBeenCalled(); // pending orphan NOT deleted
    const updater = setSteeringCommittee.mock.calls.at(-1)![0];
    const next = updater(c)! as SteeringCommittee;
    expect(next.meetings.find((m) => m.id === 1)!.outlookEventId).toBe("meet-evt");
    expect(next.pendingDeleteEventIds).toEqual(["orphan-evt"]); // preserved
  });

  it("tracks the in-flight target key and ignores a concurrent push (no double write)", async () => {
    // Hold the token so the first push stays in flight while we fire a second.
    let releaseToken!: (v: string) => void;
    acquireToken.mockImplementationOnce(
      () => new Promise<string>((res) => { releaseToken = res; }),
    );
    const setSteeringCommittee = vi.fn();
    const c = committee();
    const { result } = renderHook(() =>
      useCommitteeOutlookPush({
        committee: c, committeeName: "Board", projectId: "p", today: TODAY,
        setSteeringCommittee, isPopout: false, lang: "en-US", enabled: true,
      }));

    // Start a scoped meeting push; it parks on the held token (do NOT await).
    let firstPush!: Promise<void>;
    act(() => { firstPush = result.current.pushToOutlook({ kind: "meeting", id: 1 }); });
    expect(result.current.pushingTarget).toBe("m:1"); // only this row is busy

    // A concurrent push while the first is in flight is a synchronous no-op:
    // the in-flight ref guard bails before acquiring a second token/reconcile.
    await act(async () => { await result.current.pushToOutlook({ kind: "schedule", id: 9 }); });
    expect(acquireToken).toHaveBeenCalledTimes(1); // second call bailed
    expect(createEvent).not.toHaveBeenCalled(); // first still parked on the token
    expect(result.current.pushingTarget).toBe("m:1"); // still the first target

    // Release the token → the first push finishes and clears the busy state.
    await act(async () => { releaseToken("tok"); await firstPush; });
    expect(result.current.pushingTarget).toBeNull();
    expect(createEvent).toHaveBeenCalled(); // the first push ran its reconcile
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
