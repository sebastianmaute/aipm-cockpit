// Persistence registry guard.
//
// AGENTS.md landmine: a new persisted field on an entity must be wired into
// every write path (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB) — miss one
// and data silently drops on that backend. This suite turns the two
// user-editable text backends (CSV + Markdown) into a red test for the
// calendar-sync `outlookEventId` field across ALL FIVE calendar-synced entities
// (milestone · task · raid · change · absence). CSV also drives the Turso single
// + tenant schemas (their DDL/insert derive from *_CSV_COLUMNS), so a CSV-column
// assertion covers three backends at once. JSON/IndexedDB pass the whole object
// through, so they cannot selectively drop one field.
//
// Adding a new calendar-synced entity ⇒ add one row here; forgetting a codec
// column ⇒ this fails instead of dropping the field in production.
import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
} from "./storage";
import {
  CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  ABSENCES_CSV_COLUMNS,
} from "./csv-codecs-core";
import type { Workspace } from "./workspace";

const EVT = "evt-registry-123";

// Each entry seeds a workspace with ONE entity carrying outlookEventId, and
// reads the field back off the decoded workspace. The CSV column list is the
// exported registry that also feeds the Turso schemas.
const REGISTRY: ReadonlyArray<{
  entity: string;
  csvColumns: readonly string[];
  seed: () => Workspace;
  read: (ws: Workspace) => string | undefined;
}> = [
  {
    entity: "milestone",
    csvColumns: MILESTONES_CSV_COLUMNS as readonly string[],
    seed: () => ({
      ...emptyWorkspace(),
      milestones: [{ id: 1, name: "Phase 1 done", date: "2026-02-01", linkedTaskIds: [], outlookEventId: EVT }],
    }),
    read: (ws) => ws.milestones?.[0]?.outlookEventId,
  },
  {
    entity: "task",
    csvColumns: CSV_COLUMNS as readonly string[],
    seed: () => ({
      ...emptyWorkspace(),
      tasks: [{
        id: 1, taskName: "Wire calendar", assignee: "Alex", assigneeEmail: "alex@example.com",
        dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", priority: "Medium", status: "To Do",
        blockers: "", notes: "", outlookEventId: EVT,
      }],
    }),
    read: (ws) => ws.tasks[0]?.outlookEventId,
  },
  {
    entity: "raid",
    csvColumns: RAID_CSV_COLUMNS as readonly string[],
    seed: () => ({
      ...emptyWorkspace(),
      raid: [{
        id: 1, category: "R", title: "Some risk", status: "Open", linkedTaskIds: [],
        causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", targetDate: "2026-03-01",
        outlookEventId: EVT,
      }],
    }),
    read: (ws) => ws.raid[0]?.outlookEventId,
  },
  {
    entity: "change",
    csvColumns: CHANGES_CSV_COLUMNS as readonly string[],
    seed: () => ({
      ...emptyWorkspace(),
      changes: [{
        id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved", impact: "High",
        requestedBy: "Ann", raisedDate: "2026-06-01", decisionDate: "2026-06-09",
        linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], outlookEventId: EVT,
      }],
    }),
    read: (ws) => ws.changes?.[0]?.outlookEventId,
  },
  {
    entity: "absence",
    csvColumns: ABSENCES_CSV_COLUMNS as readonly string[],
    seed: () => ({
      ...emptyWorkspace(),
      absences: [{ id: 1, assignee: "Jane Doe", startDate: "2026-01-05", endDate: "2026-01-09", type: "vacation", outlookEventId: EVT }],
    }),
    read: (ws) => ws.absences?.[0]?.outlookEventId,
  },
];

describe("entity persistence registry — outlookEventId survives every text backend", () => {
  for (const { entity, csvColumns, seed, read } of REGISTRY) {
    it(`${entity}: outlookEventId is in the CSV column registry (drives CSV + Turso single/tenant)`, () => {
      expect(csvColumns).toContain("outlookEventId");
    });

    it(`${entity}: outlookEventId survives the CSV round-trip`, () => {
      const back = csvToWorkspace(workspaceToCsv(seed()));
      expect(read(back)).toBe(EVT);
    });

    it(`${entity}: outlookEventId survives the Markdown round-trip`, () => {
      const back = markdownToWorkspace(workspaceToMarkdown(seed()));
      expect(read(back)).toBe(EVT);
    });
  }
});
