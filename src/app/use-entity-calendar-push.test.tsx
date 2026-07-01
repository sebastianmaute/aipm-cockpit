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
import { taskToGraphEvent, GraphCalendarError, updateEvent, listEntityEvents, createEvent } from "./outlook-calendar-write";
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
    notes: "",
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
});
