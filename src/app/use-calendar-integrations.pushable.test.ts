// §486 fix round 2 — the four push inputs `useCalendarIntegrations` builds use
// the shared `calendar-pushable.ts` predicates. An opted-out item that still
// holds a link and has LEFT the synced set must stay in the push input, or
// `planEntityReconcile` deletes the event the user chose to keep. The push hook
// is stubbed to record what it is handed; every other Graph-facing hook is inert.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";
import type { Absence, ChangeItem, RaidItem, Task } from "./types";

const seen = vi.hoisted(() => ({ push: [] as Array<{ entityType: string; interactive?: boolean; items: Array<{ id: number }> }> }));

vi.mock("./use-calendar-auto-sync", () => ({ useCalendarAutoSync: () => {} }));
vi.mock("./use-calendar-auto-pull", () => ({ useCalendarAutoPull: () => {} }));
vi.mock("./use-entity-calendar-push", () => ({
  useEntityCalendarPush: (a: { entityType: string; interactive?: boolean; items: Array<{ id: number }> }) => {
    seen.push.push(a);
    return { pushToOutlook: vi.fn(), busy: false };
  },
}));
vi.mock("./use-entity-calendar-pull", () => ({
  useEntityCalendarPull: () => ({ pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() }),
}));
vi.mock("./use-outlook-calendar-push", () => ({ useOutlookCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }) }));
vi.mock("./use-milestone-calendar-pull", () => ({
  useMilestoneCalendarPull: () => ({ pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() }),
}));
vi.mock("./use-committee-outlook-push", () => ({ useCommitteeOutlookPush: () => ({ pushToOutlook: vi.fn(), pushingTarget: null }) }));

import { useCalendarIntegrations, type CalendarIntegrationDeps } from "./use-calendar-integrations";

const ON = { enabled: true, auto: true };
const TODAY = "2026-09-19";

// Per entity: id 1 = opted out + linked + OUT of the synced set (must be kept),
// id 2 = the same but not opted out (control: must be dropped),
// id 3 = an ordinary synced item (must be kept).
const tasks: Task[] = [1, 2, 3].map((id) => ({
  id, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-10-01", lastUpdateDate: "2026-09-01",
  priority: "Medium", blockers: "", description: "",
  status: id === 3 ? "To Do" : "Done", ...(id === 3 ? {} : { completedDate: "2026-09-01", outlookEventId: `T${id}` }),
  ...(id === 1 ? { calendarOptOut: true } : {}),
}));
const raid: RaidItem[] = [1, 2, 3].map((id) => ({
  id, category: "R", title: "R", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
  targetDate: "2026-10-01", status: id === 3 ? "Open" : "Closed",
  ...(id === 3 ? {} : { closedDate: "2026-09-01", outlookEventId: `R${id}` }),
  ...(id === 1 ? { calendarOptOut: true } : {}),
}));
const changes: ChangeItem[] = [1, 2, 3].map((id) => ({
  id, title: "C", description: "", type: "Scope", status: "Approved", raisedDate: "2026-01-01",
  linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
  ...(id === 3 ? { decisionDate: "2026-10-01" } : { outlookEventId: `C${id}` }),
  ...(id === 1 ? { calendarOptOut: true } : {}),
}));
const absences: Absence[] = [1, 2, 3].map((id) => ({
  id, assignee: "Jane", type: "vacation",
  ...(id === 3 ? { startDate: "2026-10-01", endDate: "2026-10-05" } : { startDate: "2026-08-01", endDate: "2026-08-05", outlookEventId: `A${id}` }),
  ...(id === 1 ? { calendarOptOut: true } : {}),
}));

function deps(): CalendarIntegrationDeps {
  return {
    isPopout: false, loadPending: false, getScopeEpoch: () => 0,
    settings: {
      integrations: { m365: { enabled: true, outlookCalendarPush: true } },
      outlookCalendar: { task: ON, raid: ON, change: ON, absence: ON },
    } as unknown as Settings,
    m365Enabled: true, portfolioCurrentId: "p1", project: undefined, lang: "en-US", today: TODAY,
    logActivityAs: vi.fn() as unknown as CalendarIntegrationDeps["logActivityAs"],
    setSettings: vi.fn(),
    milestones: [], setMilestones: vi.fn(),
    steeringCommittee: undefined, setSteeringCommittee: vi.fn(),
    tasks, setTasks: vi.fn(), raid, setRaid: vi.fn(), changes, setChanges: vi.fn(), absences, setAbsences: vi.fn(),
  };
}

beforeEach(() => { seen.push.length = 0; });

describe("useCalendarIntegrations — the push inputs keep an opted-out item's linked event (§486)", () => {
  it.each(["task", "raid", "change", "absence"])("%s: every push instance is handed the kept item, not the synced-out one", (entityType) => {
    renderHook(() => useCalendarIntegrations(deps()));
    const calls = seen.push.filter((c) => c.entityType === entityType);
    // Anti-vacuity: the auto instance (task) — and for the other three the manual one
    // too — was mounted. The task pane's manual push is pinned in tasks-section.test.tsx.
    expect(calls.length).toBeGreaterThanOrEqual(entityType === "task" ? 1 : 2);
    for (const c of calls) expect(c.items.map((i) => i.id)).toEqual([1, 3]);
  });
});
