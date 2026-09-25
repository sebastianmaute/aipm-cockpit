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
import { DOCUMENT_ASSETS_CSV_COLUMNS } from "./csv-codecs";
import { sanitizeRaidEscalations } from "./raid-escalation";
import { ENTITY_SPECS, SCHEMA_DDL } from "./turso-schema";
import { tenantSchemaDdl } from "./turso-tenant-schema";
import type { Workspace } from "./workspace";
import type { RaidEscalation } from "./types";
import type { DocumentAsset } from "./document-asset";
import { recordBudgetChange } from "./budget-history";
import {
  calendarOptOutWorkspace,
  EXPECTED_CALENDAR_OPT_OUTS,
  readCalendarOptOuts,
} from "../test/calendar-opt-out-fixture";

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

// New heavy fields: RaidItem.inquiriesSent (mirrors Task.inquiriesSent) and the
// noteLog (structured JSON-in-cell) now carried by Task, RaidItem AND ChangeItem.
// CSV column presence also covers Turso single+tenant; the round-trip covers CSV
// + Markdown. The remaining two write paths are covered elsewhere and are
// deliberately NOT re-asserted here: JSON by workspace.test.ts ("preserves a
// change noteLog through jsonToWorkspace"), IndexedDB by sanitizeChangeRichFields
// (browser-backend.ts never calls sanitizeChangeItem).
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
  it("noteLog is in the Change CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(CHANGES_CSV_COLUMNS as readonly string[]).toContain("noteLog");
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

  const seedChangeNote = (): Workspace => ({
    ...emptyWorkspace(),
    changes: [{
      id: 1, title: "C", description: "", type: "Scope", status: "Proposed",
      raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
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
  it("change noteLog survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seedChangeNote())).changes?.[0]?.noteLog?.[0]?.text).toBe("hi");
  });
  it("change noteLog survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seedChangeNote())).changes?.[0]?.noteLog?.[0]?.text).toBe("hi");
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
    expect(BUDGETS_CSV_COLUMNS as readonly string[]).toContain("createdDate");
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

// budgetHistory — the budget-at-completion series, a meta-blob SIBLING of
// activityLog (same fenced-JSON / `config,<json>` shape, storage-only). The
// seed is a baseline + updated pair from recordBudgetChange, so a backend that
// kept only the first entry, or dropped the nullable baseline bucketId, fails.
describe("entity persistence registry — budgetHistory survives every text backend", () => {
  const seedHistory = (): Workspace => {
    let n = 0;
    return {
      ...emptyWorkspace(),
      budgetHistory: recordBudgetChange([], {
        kind: "updated", bucketId: 3, bucketName: "Design",
        before: { hours: 40, value: 4000 }, after: { hours: 55.5, value: 5550 },
        at: "2026-09-02T08:00:00.000Z", date: "2026-09-02", newId: () => `bh-${++n}`,
      }),
    };
  };

  it("budgetHistory survives the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedHistory()));
    expect(back.budgetHistory).toHaveLength(2);
    expect(back.budgetHistory).toEqual(seedHistory().budgetHistory);
  });

  it("budgetHistory survives the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedHistory()));
    expect(back.budgetHistory).toHaveLength(2);
    expect(back.budgetHistory).toEqual(seedHistory().budgetHistory);
  });

  it("an empty budgetHistory emits no section on either text backend", () => {
    const ws: Workspace = { ...emptyWorkspace(), budgetHistory: [] };
    expect(csvToWorkspace(workspaceToCsv(ws)).budgetHistory).toBeUndefined();
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).budgetHistory).toBeUndefined();
    expect(workspaceToCsv(ws)).toBe(workspaceToCsv(emptyWorkspace()));
    expect(workspaceToMarkdown(ws)).toBe(workspaceToMarkdown(emptyWorkspace()));
  });
});

// documentAssets (S3c-1: document images) — DocumentAsset METADATA rows
// (bytes live in a separate side table, document-asset.ts, out of scope
// here). This block is the six-path proof for the slice: one ENTITY_SPECS
// row (turso-schema.ts) drives CSV + both Turso layouts at once, so it gets
// its own DDL-shape assertions per layout rather than only a name-presence
// check — the tenant layout's whole reason to exist is the composite
// (id, project_id) primary key, which a name-only check can't tell apart
// from the single-tenant layout.
//
// Six paths, six locations:
//   1. CSV        — round-trip below
//   2. Markdown    — round-trip below
//   3. JSON         — round-trip below (a real filter: jsonToWorkspace routes
//      documentAssets through sanitizeDocumentAsset, workspace.ts:721-725)
//   4. Turso single-tenant — SCHEMA_DDL assertion below
//   5. Turso multi-tenant  — tenantSchemaDdl() composite-PK assertion below
//   6. IndexedDB    — proved in browser-backend.test.ts, describe
//      "documentAssets over IndexedDB" > "round-trips documentAssets through
//      save and load" (that file owns the fake-indexeddb harness this suite
//      does not set up)
describe("entity persistence registry — documentAssets across all six write paths", () => {
  const asset: DocumentAsset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };
  const seedAssets = (): Workspace => ({ ...emptyWorkspace(), documentAssets: [asset] });

  it("1+4+5: the ENTITY_SPECS column registry drives CSV and both Turso layouts", () => {
    const spec = ENTITY_SPECS.find((s) => s.table === "document_assets");
    expect(spec?.columns).toEqual(DOCUMENT_ASSETS_CSV_COLUMNS);
  });

  it("4: the single-tenant SCHEMA_DDL declares the document_assets table", () => {
    expect(SCHEMA_DDL.some((ddl) => ddl.includes("CREATE TABLE IF NOT EXISTS document_assets"))).toBe(true);
  });

  it("5: the multi-tenant DDL gives document_assets a composite (id, project_id) primary key", () => {
    const ddl = tenantSchemaDdl().find((s) => s.includes("CREATE TABLE IF NOT EXISTS document_assets"));
    expect(ddl).toBeDefined();
    expect(ddl).toContain("PRIMARY KEY (id, project_id)");
  });

  it("1: documentAssets survives the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedAssets()));
    expect(back.documentAssets?.[0]).toEqual(asset);
  });

  it("2: documentAssets survives the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedAssets()));
    expect(back.documentAssets?.[0]).toEqual(asset);
  });

  it("3: documentAssets survives the JSON round-trip", () => {
    const back = jsonToWorkspace(workspaceToJson(seedAssets()));
    expect(back.documentAssets?.[0]).toEqual(asset);
  });

  // 6. IndexedDB — proved in browser-backend.test.ts, describe "documentAssets
  // over IndexedDB" > "round-trips documentAssets through save and load".
});

// §515 — RaidItem.escalations is a JSON-in-cell array like noteLog. CSV column
// presence covers Turso single + tenant (their DDL/INSERT derive from
// RAID_CSV_COLUMNS); the round-trips cover CSV, Markdown and JSON. IndexedDB is
// a whole-object pass-through and is NOT asserted here.
describe("entity persistence registry — RaidItem.escalations", () => {
  const ESC: RaidEscalation[] = [
    { at: "2026-05-20T09:30:00.000Z", toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical" },
    { at: "2026-05-21T10:00:00.000Z", toEmail: "ops@example.com" },
  ];
  const seed = (): Workspace => ({
    ...emptyWorkspace(),
    raid: [{
      id: 1, category: "I", title: "Vendor down", status: "Open", severity: "Critical", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", escalations: ESC,
    }],
  });

  it("is in the RAID CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(RAID_CSV_COLUMNS as readonly string[]).toContain("escalations");
  });
  it("survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seed())).raid[0]?.escalations).toEqual(ESC);
  });
  it("survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seed())).raid[0]?.escalations).toEqual(ESC);
  });
  it("survives the JSON round-trip", () => {
    expect(jsonToWorkspace(workspaceToJson(seed())).raid[0]?.escalations).toEqual(ESC);
  });
  // mdUnescape turns a literal `<br>` inside the JSON cell into a real newline,
  // JSON.parse throws, and the decoder returns [] — the WHOLE history was lost.
  it("keeps every entry over Markdown when a recipient name carried a literal <br>", () => {
    const withBreak = sanitizeRaidEscalations([ESC[1], { ...ESC[0], toName: "Jane<br>Doe" }]);
    const ws: Workspace = { ...seed(), raid: [{ ...seed().raid[0], escalations: withBreak }] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws)).raid[0]?.escalations;
    expect(back).toHaveLength(2);
    expect(back?.[1]?.toName).toBe("Jane Doe");
  });
  // fix-all-1 review Minor 1: `toName` is stripped and `toEmail` rejects "<"/
  // ">", but `at` has no bracket guard — only a `Date.parse` check. V8's
  // legacy parser is lenient about a leading tag-like prefix in front of a
  // bare "YYYY-MM-DD" date (no time suffix): `Date.parse("<br/>2026-06-20")`
  // is a valid timestamp, not NaN, so this is the ONE remaining way a literal
  // break tag reaches the escalations JSON cell. Pinned directly, not just
  // via the noteLog test below, which would stay green even if THIS column's
  // own `<` escaping regressed independently.
  it("keeps every entry over Markdown when an entry's at carries a literal <br/>", () => {
    const withBreak = sanitizeRaidEscalations([ESC[1], { ...ESC[0], at: "<br/>2026-06-20" }]);
    const ws: Workspace = { ...seed(), raid: [{ ...seed().raid[0], escalations: withBreak }] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws)).raid[0]?.escalations;
    expect(back).toHaveLength(2);
    expect(back?.[1]?.at).toBe("<br/>2026-06-20");
  });
});

// fix-all-1 — root cause: `mdEscape` left a literal `<br>` unescaped, so
// `mdUnescape` could not tell it from the "<br>" it inserts for a real
// newline and decoded it into one. Inside a JSON-in-cell column (noteLog,
// escalations) that extra newline landed inside a JSON string, `JSON.parse`
// threw, and `decode*` returned [] — the WHOLE column silently wiped, not
// just the value carrying the `<br>`. Fixed at the root in `mdEscape`/
// `mdUnescape` (markdown-codecs-core.ts). These pin the previously-wiped
// paths that are NOT already covered by the escalation `toName` test above
// (that one round-tripped clean even before this fix, because
// `sanitizeRaidEscalations` already stripped `<br>` from `toName` — §515).
describe("Markdown <br> wipe — root cause fix (fix-all-1)", () => {
  // `sanitizeNoteLogWith` (note-log-policy.ts) RE-DERIVES `text` from `html`
  // via `htmlToText` whenever `html` projects to something non-empty — a real
  // `<br>` tag inside the html is a genuine line break and htmlToText turns it
  // into "\n" in the derived text, which is correct rich-text behaviour and
  // NOT what this fix is about. So the assertion here is on SURVIVAL (the
  // entry is not dropped, and the JSON-in-cell round trip did not corrupt the
  // html's own `<br>` tag), not on `.text` holding a literal "<br>".
  const note = (htmlBody: string) =>
    [{ id: 1, authorName: "Ann", timestamp: "2026-07-16T10:00:00.000Z", html: `<p>${htmlBody}</p>`, text: htmlBody }];

  it("keeps a task's whole noteLog when an entry's html holds a literal <br>", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      tasks: [{
        id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.com",
        dueDate: "2026-02-01", lastUpdateDate: "2026-01-10", priority: "Medium", status: "To Do",
        blockers: "", description: "",
        noteLog: note("line one<br>line two"),
      }],
    };
    const back = markdownToWorkspace(workspaceToMarkdown(ws)).tasks[0]?.noteLog;
    expect(back).toHaveLength(1);
    expect(back?.[0]?.html).toMatch(/<br\s*\/?>/i);
    expect(back?.[0]?.html).toContain("line one");
    expect(back?.[0]?.html).toContain("line two");
  });

  it("keeps a RAID item's whole noteLog when an entry's html holds a literal <br>", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      raid: [{
        id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [],
        causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
        noteLog: note("line one<br>line two"),
      }],
    };
    const back = markdownToWorkspace(workspaceToMarkdown(ws)).raid[0]?.noteLog;
    expect(back).toHaveLength(1);
    expect(back?.[0]?.html).toMatch(/<br\s*\/?>/i);
    expect(back?.[0]?.html).toContain("line one");
    expect(back?.[0]?.html).toContain("line two");
  });

  it("keeps a Change's whole noteLog when an entry's html holds a literal <br>", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      changes: [{
        id: 1, title: "C", description: "", type: "Scope", status: "Proposed",
        raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
        noteLog: note("line one<br>line two"),
      }],
    };
    const back = markdownToWorkspace(workspaceToMarkdown(ws)).changes?.[0]?.noteLog;
    expect(back).toHaveLength(1);
    expect(back?.[0]?.html).toMatch(/<br\s*\/?>/i);
    expect(back?.[0]?.html).toContain("line one");
    expect(back?.[0]?.html).toContain("line two");
  });

  // A RAID item carrying BOTH a noteLog with a literal <br> AND an escalation
  // history in the SAME row: neither JSON-in-cell column may clobber the
  // other's survival. `at` deliberately does NOT carry a "<br>" here — that is
  // pinned separately above ("keeps every entry over Markdown when an entry's
  // at carries a literal <br/>"). CORRECTION (fix-all-1 review Minor 1, and
  // its re-review): whether `Date.parse` drops a tag-prefixed `at` turns on the
  // TIME SUFFIX, not on the slash. With a full ISO time-of-day it is NaN and the
  // sanitizer drops the entry (`"<br>2026-06-20T00:00:00.000Z"` and
  // `"<br/>2026-06-20T00:00:00.000Z"` alike); a bare date parses under V8's
  // lenient legacy parser (`"<br>2026-06-20"` and `"<br/>2026-06-20"` alike), so
  // a break tag CAN reach the escalations JSON cell via `at`; see the dedicated
  // test above.
  // `description` is a PLAIN passthrough field on this codec path (no
  // rich-text re-derivation), so it is asserted byte-exact.
  it("keeps noteLog AND escalations together when the noteLog html holds a literal <br>", () => {
    const escalations: RaidEscalation[] = [{ at: "2026-05-20T09:30:00.000Z", toEmail: "ops@example.com" }];
    const ws: Workspace = {
      ...emptyWorkspace(),
      raid: [{
        id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [],
        causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
        description: "Impact spans two lines:<br>see attachment",
        noteLog: note("line one<br>line two"),
        escalations,
      }],
    };
    const back = markdownToWorkspace(workspaceToMarkdown(ws)).raid[0];
    expect(back?.noteLog).toHaveLength(1);
    expect(back?.noteLog?.[0]?.html).toMatch(/<br\s*\/?>/i);
    expect(back?.escalations).toEqual(escalations);
    expect(back?.description).toBe("Impact spans two lines:<br>see attachment");
  });
});

// §486 — Task/RaidItem/Milestone/ChangeItem/Absence.calendarOptOut across the
// SIX write paths. Counted, not implied:
//   1. CSV            — round trip below
//   2. Markdown       — round trip below
//   3. JSON           — round trip below (runs the load sanitizers for
//                       milestone/change/absence; task/raid pass through)
//   4. Turso single   — turso-schema.execute.test.ts, "calendarOptOut (§486)"
//   5. Turso tenant   — same describe, against the tenant DDL + load
//   6. IndexedDB      — browser-backend.test.ts, "calendarOptOut over IndexedDB (§486)"
// Row 2 of each entity carries no flag, and must load back WITHOUT one.
describe("entity persistence registry — calendarOptOut (§486)", () => {
  it.each([
    ["task", CSV_COLUMNS],
    ["raid", RAID_CSV_COLUMNS],
    ["milestone", MILESTONES_CSV_COLUMNS],
    ["change", CHANGES_CSV_COLUMNS],
    ["absence", ABSENCES_CSV_COLUMNS],
  ] as const)("%s: calendarOptOut sits right after outlookEventId in the CSV column registry", (_e, cols) => {
    const list = cols as readonly string[];
    expect(list.indexOf("calendarOptOut")).toBe(list.indexOf("outlookEventId") + 1);
  });
  it("is NOT a pulled-meeting column (EVENTS_CSV_COLUMNS)", () => {
    expect(EVENTS_CSV_COLUMNS as readonly string[]).not.toContain("calendarOptOut");
  });
  it("1: survives the CSV round-trip on all five entities", () => {
    expect(readCalendarOptOuts(csvToWorkspace(workspaceToCsv(calendarOptOutWorkspace())))).toEqual(EXPECTED_CALENDAR_OPT_OUTS);
  });
  it("1: encodes the cell as \"true\" / \"\"", () => {
    const csv = workspaceToCsv(calendarOptOutWorkspace());
    expect(csv).not.toMatch(/,false(,|\r?\n)/);
    expect(csv).toMatch(/,true(,|\r?\n)/);
  });
  it("2: survives the Markdown round-trip on all five entities", () => {
    expect(readCalendarOptOuts(markdownToWorkspace(workspaceToMarkdown(calendarOptOutWorkspace())))).toEqual(EXPECTED_CALENDAR_OPT_OUTS);
  });
  it("3: survives the JSON round-trip on all five entities", () => {
    expect(readCalendarOptOuts(jsonToWorkspace(workspaceToJson(calendarOptOutWorkspace())))).toEqual(EXPECTED_CALENDAR_OPT_OUTS);
  });
  it("a hand-edited cell other than \"true\" decodes to unset (the item syncs)", () => {
    const csv = workspaceToCsv(calendarOptOutWorkspace()).replace(/,true(?=,|\r?\n)/g, ",yes");
    expect(readCalendarOptOuts(csvToWorkspace(csv))).toEqual({
      task: [undefined, undefined], raid: [undefined, undefined], milestone: [undefined, undefined],
      change: [undefined, undefined], absence: [undefined, undefined],
    });
  });
});
