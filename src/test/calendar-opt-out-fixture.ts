// §486 — one workspace carrying `calendarOptOut: true` on each of the five
// calendar-pushed entities, shared by the six write-path round trips
// (CSV, Markdown and JSON in entity-persistence-registry.test.ts; Turso single
// and tenant in turso-schema.execute.test.ts; IndexedDB in
// browser-backend.test.ts). A second, opted-IN row per entity pins that an
// unset flag stays unset rather than decoding to `true` or `false`.
import { emptyWorkspace, type Workspace } from "../app/workspace";

export function calendarOptOutWorkspace(): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [1, 2].map((id) => ({
      id, taskName: `Task ${id}`, assignee: "Alex", assigneeEmail: "alex@example.com",
      dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", createdDate: "2026-01-01",
      priority: "Medium" as const, status: "To Do" as const, blockers: "", description: "",
      inquiriesSent: 0, ...(id === 1 ? { calendarOptOut: true } : {}),
    })),
    raid: [1, 2].map((id) => ({
      id, category: "R" as const, title: `Risk ${id}`, status: "Open" as const, linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", targetDate: "2026-03-01",
      ...(id === 1 ? { calendarOptOut: true } : {}),
    })),
    milestones: [1, 2].map((id) => ({
      id, name: `Milestone ${id}`, date: "2026-02-01", linkedTaskIds: [],
      ...(id === 1 ? { calendarOptOut: true } : {}),
    })),
    changes: [1, 2].map((id) => ({
      id, title: `Change ${id}`, description: "d", type: "Scope" as const, status: "Approved" as const,
      impact: "High" as const, requestedBy: "Ann", raisedDate: "2026-06-01", decisionDate: "2026-06-09",
      linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
      ...(id === 1 ? { calendarOptOut: true } : {}),
    })),
    absences: [1, 2].map((id) => ({
      id, assignee: "Jane Doe", startDate: "2026-01-05", endDate: "2026-01-09", type: "vacation" as const,
      ...(id === 1 ? { calendarOptOut: true } : {}),
    })),
  };
}

/** The flag of row 1 (opted out) and row 2 (not) for each entity, as loaded. */
export function readCalendarOptOuts(ws: Workspace): Record<string, [unknown, unknown]> {
  const pick = (rows: readonly { id: number; calendarOptOut?: boolean }[] | undefined): [unknown, unknown] => [
    rows?.find((r) => r.id === 1)?.calendarOptOut,
    rows?.find((r) => r.id === 2)?.calendarOptOut,
  ];
  return {
    task: pick(ws.tasks),
    raid: pick(ws.raid),
    milestone: pick(ws.milestones),
    change: pick(ws.changes),
    absence: pick(ws.absences),
  };
}

/** What every write path must load back: row 1 opted out, row 2 untouched. */
export const EXPECTED_CALENDAR_OPT_OUTS: Record<string, [unknown, unknown]> = {
  task: [true, undefined],
  raid: [true, undefined],
  milestone: [true, undefined],
  change: [true, undefined],
  absence: [true, undefined],
};
