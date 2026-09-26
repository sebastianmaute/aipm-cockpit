import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stable mock refs so a test can control the token result AND assert on toasts.
const { acquireTokenMock, showToastMock } = vi.hoisted(() => ({
  acquireTokenMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("./use-ms-auth", () => ({ useMsAuth: () => ({ acquireToken: acquireTokenMock }) }));
vi.mock("./toast-context", () => ({ useToastContext: () => showToastMock }));
vi.mock("./outlook-calendar-write", async (imp) => {
  const actual = await imp<typeof import("./outlook-calendar-write")>();
  return {
    ...actual,
    listEntityEvents: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockResolvedValue("NEW1"),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import { useEntityCalendarPush } from "./use-entity-calendar-push";
import { taskToGraphEvent, GraphCalendarError, updateEvent, listEntityEvents, createEvent, deleteEvent } from "./outlook-calendar-write";
import { isPushableTask } from "./calendar-pushable";
import { planCalendarPull } from "./calendar-pull";
import type { HasEventLink } from "./calendar-reconcile";
import type { Task } from "./types";

// The generic hook writes back `outlookEventId`, which the base Task type doesn't
// declare — `Task & HasEventLink` exposes the optional link field for assertions
// while staying assignable to `Task` (so `taskToGraphEvent` accepts it).
type LinkedTask = Task & HasEventLink;

function makeTask(over: Partial<LinkedTask> = {}): LinkedTask {
  return {
    id: 1,
    taskName: "A",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-07-10",
    lastUpdateDate: "2026-07-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    ...over,
  };
}

describe("useEntityCalendarPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireTokenMock.mockResolvedValue("tok");
  });

  it("writes back the created event id", async () => {
    let items: LinkedTask[] = [makeTask()];
    const setItems = (u: (p: LinkedTask[]) => LinkedTask[]) => { items = u(items); };
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items, entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true,
    }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(items[0].outlookEventId).toBe("NEW1");
  });

  it("clears the id on a 404 update (event deleted in Outlook)", async () => {
    vi.mocked(updateEvent).mockRejectedValueOnce(new GraphCalendarError(404, "gone"));
    let items: LinkedTask[] = [makeTask({ outlookEventId: "OLD1" })];
    const setItems = (u: (p: LinkedTask[]) => LinkedTask[]) => { items = u(items); };
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items, entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true,
    }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(items[0].outlookEventId).toBeUndefined();
  });

  it("no-ops in popouts", async () => {
    const setItems = vi.fn();
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items: [makeTask()], entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: true, lang: "en-US", enabled: true,
    }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(setItems).not.toHaveBeenCalled();
  });

  it("interactive:false + null token → silent no-op (no toast, no Graph calls)", async () => {
    acquireTokenMock.mockResolvedValueOnce(null);
    const setItems = vi.fn();
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items: [makeTask()], entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true, interactive: false,
    }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(showToastMock).not.toHaveBeenCalled();
    expect(vi.mocked(listEntityEvents)).not.toHaveBeenCalled();
    expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
    expect(setItems).not.toHaveBeenCalled();
  });

  it("interactive:false stays silent on SUCCESS (work happens, no result toast)", async () => {
    let items: LinkedTask[] = [makeTask()];
    const setItems = (u: (p: LinkedTask[]) => LinkedTask[]) => { items = u(items); };
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items, entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true, interactive: false,
    }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(items[0].outlookEventId).toBe("NEW1"); // the reconcile ran
    expect(showToastMock).not.toHaveBeenCalled(); // but auto-sync is silent
  });

  it("serializes concurrent pushes via the in-flight lock (no double-create)", async () => {
    let items: LinkedTask[] = [makeTask()];
    const setItems = (u: (p: LinkedTask[]) => LinkedTask[]) => { items = u(items); };
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items, entityType: "task", projectId: "lockp", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true,
    }));
    // Fire two pushes concurrently: the first grabs the module lock before its
    // first await, so the second sees it held and no-ops → createEvent runs once.
    await act(async () => {
      await Promise.all([result.current.pushToOutlook(), result.current.pushToOutlook()]);
    });
    expect(vi.mocked(createEvent)).toHaveBeenCalledTimes(1);
  });
});

// §548 (F7) — a push already in flight when a project swap starts must not write the OLD project's
// event ids onto the NEW project's rows. `enabled`/`loadPending` only gate a push that has not started.
describe("useEntityCalendarPush — the scope epoch (§548)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireTokenMock.mockResolvedValue("tok");
    vi.mocked(createEvent).mockResolvedValue("NEW1");
    vi.mocked(listEntityEvents).mockResolvedValue([]);
  });

  /** A push whose Outlook LISTING is held open, so the test can swap projects mid-flight. */
  function startHeldPush(epochRef: { v: number }) {
    let release!: () => void;
    vi.mocked(listEntityEvents).mockReturnValueOnce(new Promise((r) => { release = () => r([]); }));
    let items: LinkedTask[] = [makeTask()];
    const setItems = vi.fn((u: (p: LinkedTask[]) => LinkedTask[]) => { items = u(items); });
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items, entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true, getScopeEpoch: () => epochRef.v,
    }));
    return { result, setItems, release, getItems: () => items };
  }

  it("drops the whole reconcile — no Graph mutation, no workspace write — when the scope changed during the listing", async () => {
    const epoch = { v: 7 };
    const { result, setItems, release, getItems } = startHeldPush(epoch);
    let push: Promise<void> = Promise.resolve();
    act(() => { push = result.current.pushToOutlook(); });
    epoch.v = 8; // a swap/backend change started while Graph was answering
    await act(async () => { release(); await push; });

    expect(vi.mocked(listEntityEvents)).toHaveBeenCalledTimes(1); // control: the push really ran
    expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
    expect(setItems).not.toHaveBeenCalled();
    expect(getItems()[0].outlookEventId).toBeUndefined();
  });

  it("CONTROL — the same push writes back normally when the scope is unchanged", async () => {
    const epoch = { v: 7 };
    const { result, setItems, release, getItems } = startHeldPush(epoch);
    let push: Promise<void> = Promise.resolve();
    act(() => { push = result.current.pushToOutlook(); });
    await act(async () => { release(); await push; });

    expect(vi.mocked(createEvent)).toHaveBeenCalledTimes(1);
    expect(setItems).toHaveBeenCalledTimes(1);
    expect(getItems()[0].outlookEventId).toBe("NEW1");
  });

  it("drops the workspace write when the scope changes DURING the create/update loop (the ids are orphaned on purpose)", async () => {
    const epoch = { v: 7 };
    let items: LinkedTask[] = [makeTask()];
    const setItems = vi.fn((u: (p: LinkedTask[]) => LinkedTask[]) => { items = u(items); });
    // The swap lands after the plan was judged fresh, while Outlook is being written.
    vi.mocked(createEvent).mockImplementationOnce(async () => { epoch.v = 8; return "NEW1"; });
    const { result } = renderHook(() => useEntityCalendarPush<LinkedTask>({
      items, entityType: "task", projectId: "p2", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true, getScopeEpoch: () => epoch.v,
    }));
    await act(async () => { await result.current.pushToOutlook(); });

    expect(vi.mocked(createEvent)).toHaveBeenCalledTimes(1); // control: the event WAS created in Outlook
    expect(setItems).not.toHaveBeenCalled();
    expect(items[0].outlookEventId).toBeUndefined();
  });
});

// §486 final review (I1) — the app's OWN delete must drop the item's link, or
// a pull that runs before the next push reads the missing event as a user-side
// deletion, and its prune opts the item out of sync for good.
describe("useEntityCalendarPush — its own delete clears the item's link (§486)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireTokenMock.mockResolvedValue("tok");
  });

  function renderPush(get: () => LinkedTask[], set: (next: LinkedTask[]) => void) {
    const setItems = (u: (p: LinkedTask[]) => LinkedTask[]) => { set(u(get())); };
    return renderHook(() => useEntityCalendarPush<LinkedTask>({
      items: get().filter(isPushableTask), entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
      setItems, isPopout: false, lang: "en-US", enabled: true,
    }));
  }

  it("done → push deletes → reopen → pull finds nothing to prune → next push re-creates", async () => {
    let live: LinkedTask[] = [makeTask({ status: "Done", completedDate: "2026-07-05", outlookEventId: "E1" })];
    const get = () => live; const set = (n: LinkedTask[]) => { live = n; };
    // 1. The finished task left the pushable set, so the push deletes its event.
    vi.mocked(listEntityEvents).mockResolvedValueOnce([{ id: "E1" }]);
    const first = renderPush(get, set);
    await act(async () => { await first.result.current.pushToOutlook(); });
    expect(vi.mocked(deleteEvent)).toHaveBeenCalledWith("tok", "E1");
    expect(live[0].outlookEventId).toBeUndefined();
    expect(live[0].calendarOptOut).toBeUndefined();
    // 2. Reopened. A pull that runs first sees no link, so it has nothing to prune.
    live = [{ ...live[0], status: "To Do", completedDate: undefined }];
    const pull = planCalendarPull({
      entities: live.map((t) => ({ id: t.id, date: t.dueDate, outlookEventId: t.outlookEventId })),
      events: [], baseline: {}, eventsComplete: true,
    });
    expect(pull.deletions).toEqual([]);
    // 3. The next push re-creates the event and re-links the item.
    vi.mocked(listEntityEvents).mockResolvedValueOnce([]);
    const second = renderPush(get, set);
    await act(async () => { await second.result.current.pushToOutlook(); });
    expect(vi.mocked(createEvent)).toHaveBeenCalledTimes(1);
    expect(live[0].outlookEventId).toBe("NEW1");
    expect(live[0].calendarOptOut).toBeUndefined();
  });

  it("a FAILED delete keeps the link, so the next push retries it", async () => {
    let live: LinkedTask[] = [makeTask({ status: "Done", completedDate: "2026-07-05", outlookEventId: "E1" })];
    vi.mocked(listEntityEvents).mockResolvedValueOnce([{ id: "E1" }]);
    vi.mocked(deleteEvent).mockRejectedValueOnce(new Error("503"));
    const { result } = renderPush(() => live, (n) => { live = n; });
    await act(async () => { await result.current.pushToOutlook(); });
    expect(live[0].outlookEventId).toBe("E1");
  });

  it("never touches an opted-out item's flag", async () => {
    let live: LinkedTask[] = [
      makeTask({ id: 1, status: "Done", completedDate: "2026-07-05", outlookEventId: "E1" }),
      makeTask({ id: 2, status: "Done", completedDate: "2026-07-05", outlookEventId: "E2", calendarOptOut: true }),
    ];
    vi.mocked(listEntityEvents).mockResolvedValueOnce([{ id: "E1" }, { id: "E2" }]);
    const { result } = renderPush(() => live, (n) => { live = n; });
    await act(async () => { await result.current.pushToOutlook(); });
    expect(vi.mocked(deleteEvent)).toHaveBeenCalledTimes(1); // E2 is kept (§486)
    expect(live[1]).toMatchObject({ outlookEventId: "E2", calendarOptOut: true });
    expect(live[0].outlookEventId).toBeUndefined();
  });
});
