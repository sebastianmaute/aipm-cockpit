// Persistence registry guard.
//
// AGENTS.md landmine: a new persisted field on an entity must be wired into
// every write path (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB) — miss one
// and data silently drops on that backend. This suite turns the two
// user-editable text backends (CSV + Markdown) into a red test for the
// calendar-sync `outlookEventId` field across ALL SIX calendar-synced entities
// (milestone · task · raid · change · absence · calendarEvent). CSV also drives the Turso single
// + tenant schemas (their DDL/insert derive from *_CSV_COLUMNS), so a CSV-column
// assertion covers three backends at once. JSON/IndexedDB pass the whole object
// through, so they cannot selectively drop one field.
//
// Adding a new calendar-synced entity ⇒ add one row here; forgetting a codec
// column ⇒ this fails instead of dropping the field in production.
//
// SCOPE: this is CODEC-scoped. The seeds go straight through the codecs and do
// NOT run each entity's per-entity sanitizeX validator, so it would not catch a
// sanitizer that stripped the field on the save path — the sanitizer suites
// (sanitize-*.test.ts) cover that. Here we guard only the CSV/MD/Turso columns.
import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
  workspaceToJson,
  jsonToWorkspace,
} from "./storage";
import {
  CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  ABSENCES_CSV_COLUMNS,
  ROLES_CSV_COLUMNS,
  BUDGETS_CSV_COLUMNS,
  EVENTS_CSV_COLUMNS,
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
        blockers: "", description: "", outlookEventId: EVT,
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
  {
    entity: "calendarEvent",
    csvColumns: EVENTS_CSV_COLUMNS as readonly string[],
    seed: () => ({
      ...emptyWorkspace(),
      calendarEvents: [{
        id: 1, title: "Standup", startDate: "2026-01-05", startTime: "09:00", durationMinutes: 15,
        outlookEventId: EVT,
      }],
    }),
    read: (ws) => ws.calendarEvents?.[0]?.outlookEventId,
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

// New heavy fields: RaidItem.inquiriesSent (mirrors Task.inquiriesSent) and
// Task.noteLog (structured JSON-in-cell). CSV column presence also covers Turso
// single+tenant; the round-trip covers CSV + Markdown.
describe("entity persistence registry — inquiriesSent + noteLog survive every text backend", () => {
  it("inquiriesSent is in the RAID CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(RAID_CSV_COLUMNS as readonly string[]).toContain("inquiriesSent");
  });
  it("noteLog is in the Task CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(CSV_COLUMNS as readonly string[]).toContain("noteLog");
  });
  it("noteLog is in the RAID CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(RAID_CSV_COLUMNS as readonly string[]).toContain("noteLog");
  });

  const seedRaid = (): Workspace => ({
    ...emptyWorkspace(),
    raid: [{
      id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", inquiriesSent: 5,
    }],
  });
  const seedNote = (): Workspace => ({
    ...emptyWorkspace(),
    tasks: [{
      id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.com",
      dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", priority: "Medium", status: "To Do",
      blockers: "", description: "",
      noteLog: [{ id: 1, authorName: "Ann", timestamp: "2026-07-16T10:00:00.000Z", html: "<p>hi</p>", text: "hi" }],
    }],
  });
  const seedRaidNote = (): Workspace => ({
    ...emptyWorkspace(),
    raid: [{
      id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      noteLog: [{ id: 1, authorName: "Ann", timestamp: "2026-07-16T10:00:00.000Z", html: "<p>hi</p>", text: "hi" }],
    }],
  });

  it("raid inquiriesSent survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seedRaid())).raid[0]?.inquiriesSent).toBe(5);
  });
  it("raid inquiriesSent survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seedRaid())).raid[0]?.inquiriesSent).toBe(5);
  });
  it("task noteLog survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seedNote())).tasks[0]?.noteLog?.[0]?.text).toBe("hi");
  });
  it("task noteLog survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seedNote())).tasks[0]?.noteLog?.[0]?.text).toBe("hi");
  });
  it("raid noteLog survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seedRaidNote())).raid[0]?.noteLog?.[0]?.text).toBe("hi");
  });
  it("raid noteLog survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seedRaidNote())).raid[0]?.noteLog?.[0]?.text).toBe("hi");
  });
});

// Rate-card day-rate columns (T13): internalRateDay/externalRateDay/rateBasis
// ride the same CSV+MD columns (CSV also drives Turso single/tenant).
describe("entity persistence registry — role day rates survive every text backend", () => {
  const seedRoles = (): Workspace => ({
    ...emptyWorkspace(),
    roles: [{
      id: 1, disciplineId: 2, gradeId: 3, internalRate: 100, externalRate: 150,
      internalRateDay: 800, externalRateDay: 1200, rateBasis: "day",
    }],
  });

  it("role day columns are in the CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(ROLES_CSV_COLUMNS as readonly string[]).toContain("internalRateDay");
    expect(ROLES_CSV_COLUMNS as readonly string[]).toContain("externalRateDay");
    expect(ROLES_CSV_COLUMNS as readonly string[]).toContain("rateBasis");
  });

  it("role day rates + basis survive the CSV round-trip", () => {
    const r = csvToWorkspace(workspaceToCsv(seedRoles())).roles[0];
    expect(r?.internalRateDay).toBe(800);
    expect(r?.externalRateDay).toBe(1200);
    expect(r?.rateBasis).toBe("day");
  });

  it("role day rates + basis survive the Markdown round-trip", () => {
    const r = markdownToWorkspace(workspaceToMarkdown(seedRoles())).roles[0];
    expect(r?.internalRateDay).toBe(800);
    expect(r?.externalRateDay).toBe(1200);
    expect(r?.rateBasis).toBe("day");
  });
});

// Task.createdDate (Open Points Kanban roadmap): rides the same CSV+MD columns
// (CSV also drives Turso single/tenant).
describe("entity persistence registry — task createdDate survives every text backend", () => {
  it("createdDate is in the Task CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(CSV_COLUMNS as readonly string[]).toContain("createdDate");
  });

  const seedTask = (): Workspace => ({
    ...emptyWorkspace(),
    tasks: [{
      id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.com",
      dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", createdDate: "2026-01-01",
      priority: "Medium", status: "To Do", blockers: "", description: "",
    }],
  });

  it("task createdDate survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seedTask())).tasks[0]?.createdDate).toBe("2026-01-01");
  });

  it("task createdDate survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seedTask())).tasks[0]?.createdDate).toBe("2026-01-01");
  });
});

// Earned-value linkage (C2): BudgetBucket.taskIds/percentComplete ride the same
// CSV+MD columns (CSV also drives Turso single/tenant).
describe("entity persistence registry — bucket task links + manual completion survive every text backend", () => {
  const seedBudget = (): Workspace => ({
    ...emptyWorkspace(),
    budgets: [{
      id: 1, name: "EV bucket", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
      taskIds: [3, 4], percentComplete: 40, allocations: [],
    }],
  });

  it("budget columns are in the CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(BUDGETS_CSV_COLUMNS as readonly string[]).toContain("taskIds");
    expect(BUDGETS_CSV_COLUMNS as readonly string[]).toContain("percentComplete");
  });

  it("bucket taskIds + percentComplete survive the CSV round-trip", () => {
    const b = csvToWorkspace(workspaceToCsv(seedBudget())).budgets?.[0];
    expect(b?.taskIds).toEqual([3, 4]);
    expect(b?.percentComplete).toBe(40);
  });

  it("bucket taskIds + percentComplete survive the Markdown round-trip", () => {
    const b = markdownToWorkspace(workspaceToMarkdown(seedBudget())).budgets?.[0];
    expect(b?.taskIds).toEqual([3, 4]);
    expect(b?.percentComplete).toBe(40);
  });
});

// Project documents (AI document authoring, S1).
//
// ★★ THIS BLOCK COVERS TWO BACKENDS, NOT THREE — do not copy the sibling
// comment above. Every other entry here guards a COLUMN, so asserting the name
// is in `*_CSV_COLUMNS` also covers Turso single+tenant (their DDL and inserts
// derive from that list). A document is not a column: it rides as ONE
// `config,<json>` row under `# DOCUMENTS` (CSV) and one fenced JSON block
// (Markdown), so there is no column list to assert and the CSV assertion buys
// nothing on Turso. The other four write paths are covered elsewhere — Turso
// single + tenant persist documents as a `meta` row keyed "documents"
// (`turso-schema.documents.test.ts`), and JSON + IndexedDB pass the whole
// object through (`workspace.documents.test.ts`, `browser-backend.ts`).
//
// ★ The assertion is a deep-equal on the WHOLE array rather than one field:
// a document is nested, so a codec that dropped a single block TYPE (the
// `table` rows, say, or the `dataSection` key) would still return a document
// with the right title and pass a shallower check.
describe("entity persistence registry — documents survive every text backend", () => {
  const seedDocs = (): Workspace => ({
    ...emptyWorkspace(),
    documents: [{
      id: 1,
      title: "Steering update",
      blocks: [
        { type: "heading", level: 1, text: "Steering update" },
        { type: "paragraph", html: "<p>Delivery is on track.</p>" },
        { type: "bullets", items: ["API integration complete"] },
        { type: "table", columns: ["Risk", "Owner"], rows: [["Vendor delay", "Ann"]] },
        { type: "dataSection", key: "raid" },
        { type: "pageBreak" },
      ],
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
    }],
  });

  it("documents survive the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedDocs()));
    expect(back.documents).toEqual(seedDocs().documents);
  });

  it("documents survive the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedDocs()));
    expect(back.documents).toEqual(seedDocs().documents);
  });
});

// documentVersions is the second meta-blob slice of the documents feature and
// rides the same three text paths. It gets its own block rather than extra
// fields on seedDocs() because it is a SEPARATE top-level key: a codec can
// carry `documents` perfectly and drop `documentVersions` outright.
//
// ★★ The seed deliberately avoids BOTH of sanitizeDocumentVersions' fallback
// values. It maps an unrecognised `source` to "user" and an unrecognised `op`
// to "update", so a seed carrying those two values round-trips to itself even
// if the field were lost and re-invented in the fallback — the test would pass
// on a backend that stored neither. Seeding `source: "ai"` and `op: "restored"`
// means only a genuinely preserved value can satisfy the assertion.
//
// ★ `op: "restored"` is also the marker op (document-versions.ts
// RESTORED_MARKER_OP) — the one value the tombstone derivation reads to tell
// "still deleted" from "already restored", so a backend that normalised it to
// "update" would resurrect a phantom deleted document on that backend alone.
//
// ★ JSON is included here even though the header above says JSON passes whole
// objects through: that is true of `documents`, but jsonToWorkspace routes
// documentVersions through sanitizeDocumentVersions plus a rich-field pass, so
// it is a real filter with its own way to drop data.
describe("entity persistence registry — documentVersions survive every text backend", () => {
  const seedVersions = (): Workspace => ({
    ...emptyWorkspace(),
    documents: [{
      id: 7,
      title: "Steering update",
      blocks: [{ type: "heading", level: 1, text: "Steering update" }],
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-06T09:00:00.000Z",
    }],
    documentVersions: [{
      id: 1,
      documentId: 7,
      title: "Steering update — first cut",
      blocks: [
        { type: "heading", level: 2, text: "Steering update" },
        { type: "paragraph", html: "<p>Delivery is on track.</p>" },
        { type: "bullets", ordered: true, items: ["API integration complete"] },
        { type: "table", caption: "Risks", columns: ["Risk", "Owner"], rows: [["Vendor delay", "Ann"]] },
        { type: "dataSection", key: "raid" },
        { type: "pageBreak" },
      ],
      savedAt: "2026-08-05T09:00:00.000Z",
      source: "ai",
      op: "restored",
    }],
  });

  it("documentVersions survive the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedVersions()));
    expect(back.documentVersions).toEqual(seedVersions().documentVersions);
  });

  it("documentVersions survive the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedVersions()));
    expect(back.documentVersions).toEqual(seedVersions().documentVersions);
  });

  it("documentVersions survive the JSON round-trip", () => {
    const back = jsonToWorkspace(workspaceToJson(seedVersions()));
    expect(back.documentVersions).toEqual(seedVersions().documentVersions);
  });
});

// Activity log (audit trail, promoted from a per-device localStorage blob to
// a workspace meta-blob slice) — same shape as documents/documentVersions
// above: it rides as a fenced JSON blob (Markdown) / one `config,<json>` row
// (CSV), STORAGE-ONLY. There is deliberately no `activityLog` key in
// EXPORT_SECTION_KEYS — an entry's `changes` carries old/new field values, an
// internal audit trail that does not belong in a document handed to a client.
//
// ★ The seed includes a `changes` entry so the assertion cannot pass on a
// backend that kept `id`/`timestamp`/`kind`/`args` but silently dropped the
// nested field-diff array.
describe("entity persistence registry — activityLog survives every text backend", () => {
  const seedActivity = (): Workspace => ({
    ...emptyWorkspace(),
    activityLog: [{
      id: "dev1-s1-1",
      timestamp: "2026-08-01T00:00:00.000Z",
      kind: "task.updated",
      args: ["T-1"],
      changes: [{ field: "status", from: "To Do", to: "In Progress" }],
    }],
  });

  it("activityLog survives the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedActivity()));
    expect(back.activityLog).toEqual(seedActivity().activityLog);
  });

  it("activityLog survives the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedActivity()));
    expect(back.activityLog).toEqual(seedActivity().activityLog);
  });
});
