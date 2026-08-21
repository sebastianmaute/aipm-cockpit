// src/app/csv-codecs.test.ts
import { describe, it, expect } from "vitest";
import {
  workspaceToCsv, csvToWorkspace, statusToCsv, csvToStatus,
  calendarEventsToCsv, csvToCalendarEvents, EVENTS_CSV_COLUMNS,
  CSV_SECTION_ACTIVITY,
  DOCUMENT_ASSETS_CSV_COLUMNS, documentAssetsToCsv, buildDocumentAssetFromObj,
  CSV_SECTION_DOCUMENT_ASSETS,
} from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { workspaceToJson, jsonToWorkspace, emptyWorkspace } from "./workspace";
import { defaultExportConfig, EXPORT_SECTION_KEYS } from "./settings-types";
import type { Task } from "./types";

describe("csv fieldVisibility section", () => {
  it("emits no field-visibility section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# FIELD-VISIBILITY");
  });
  it("emits the field-visibility section when present", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    expect(workspaceToCsv(ws)).toContain("# FIELD-VISIBILITY");
  });
  it("round-trips fieldVisibility through CSV", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName", "assignee"] } } };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.fieldVisibility?.task.fields).toEqual(["taskName", "assignee"]);
  });
});

// The status blob round-trips through the CSV config codec too, and the R3 rich
// narrative carries the characters CSV actually cares about (quotes in an href,
// commas in prose). Pinned alongside the markdown round-trip so a change to
// either format shows up as a failing test rather than a mangled narrative.
describe("csv status narrative round-trip", () => {
  const RICH = "<p>Week 30</p><p>Shipped <strong>auth</strong></p><ul><li>one</li></ul>";

  it("survives statusToCsv -> csvToStatus intact", () => {
    const status = { ragOverride: "A" as const, narrative: RICH, narrativeUpdatedAt: "2026-07-25" };
    expect(csvToStatus(statusToCsv(status))).toEqual(status);
  });

  it("survives the whole-workspace CSV round-trip", () => {
    const ws = { ...emptyWorkspace(), status: { narrative: RICH } };
    expect(csvToWorkspace(workspaceToCsv(ws)).status?.narrative).toBe(RICH);
  });

  // A comma splits a CSV cell and a double quote is the escape character, so a
  // narrative with a link and prose punctuation is the case that would break
  // first if the cell escaping were ever bypassed for this field.
  it("survives commas and quoted attributes", () => {
    const rich = '<p>Auth, billing and <a href="https://x.test">the "plan"</a> shipped.</p>';
    expect(csvToStatus(statusToCsv({ narrative: rich })).narrative).toBe(rich);
  });
});

describe("csv milestone outlookEventId", () => {
  it("round-trips Milestone.outlookEventId through CSV", () => {
    const ws = {
      ...emptyWorkspace(),
      milestones: [
        { id: 1, name: "Kickoff", date: "2026-01-15", linkedTaskIds: [], outlookEventId: "AAMk-evt-1" },
      ],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.milestones?.[0]?.outlookEventId).toBe("AAMk-evt-1");
  });
});

describe("Task.outlookEventId persistence", () => {
  const task: Task = {
    id: 1,
    taskName: "Wire calendar",
    assignee: "Alex",
    assigneeEmail: "alex@example.com",
    dueDate: "2026-02-01",
    lastUpdateDate: "2026-01-10",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    outlookEventId: "E9",
  };

  it("survives workspaceToCsv -> csvToWorkspace", () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks[0]?.outlookEventId).toBe("E9");
  });

  it("survives workspaceToMarkdown -> markdownToWorkspace", () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.tasks[0]?.outlookEventId).toBe("E9");
  });

  it("survives workspaceToJson -> jsonToWorkspace", () => {
    const ws = { ...emptyWorkspace(), tasks: [task] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.tasks[0]?.outlookEventId).toBe("E9");
  });
});

describe("csv features section", () => {
  it("emits no section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# FUNCTIONS");
  });
  it("emits and round-trips features, preserving explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid"] as const };
    expect(workspaceToCsv(ws)).toContain("# FUNCTIONS");
    expect(csvToWorkspace(workspaceToCsv(ws)).features).toEqual(["raid"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(workspaceToCsv(simple)).toContain("# FUNCTIONS"); // empty STILL emits
    expect(csvToWorkspace(workspaceToCsv(simple)).features).toEqual([]);
  });
});

describe("calendar events CSV", () => {
  it("round-trips a recurring event with exceptions", () => {
    const events = [{
      id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
      recurrence: { freq: "weekly" as const, interval: 1, byDay: ["MO" as const, "WE" as const] },
      exceptions: [{ date: "2026-08-03", kind: "skip" as const }],
      attendeeResourceIds: [3, 9],
    }];
    expect(csvToCalendarEvents(calendarEventsToCsv(events))).toEqual(events);
  });

  it("round-trips a plain event with no JSON cells", () => {
    const events = [{ id: 2, title: "Kickoff", startDate: "2026-08-01", startTime: "14:30", durationMinutes: 90 }];
    const csv = calendarEventsToCsv(events);
    expect(csv.split("\r\n")[1]).toBe("2,Kickoff,2026-08-01,14:30,90,,,,,,,,");
    expect(csvToCalendarEvents(csv)).toEqual(events);
  });

  it("declares the expected column order", () => {
    expect(EVENTS_CSV_COLUMNS).toEqual([
      "id", "title", "startDate", "startTime", "durationMinutes", "location", "notes",
      "recurrence", "exceptions", "attendeeResourceIds", "sendInvitations",
      "localModifiedAt", "outlookEventId",
    ]);
  });

  it("is EXPORTED when the export section is enabled, omitted when disabled", () => {
    const ws = {
      ...emptyWorkspace(),
      calendarEvents: [
        { id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15 },
      ],
    };
    const on = { ...defaultExportConfig, calendarEvents: true };
    const off = { ...defaultExportConfig, calendarEvents: false };
    expect(workspaceToCsv(ws, on)).toContain("# CALENDAR EVENTS");
    expect(workspaceToCsv(ws, off)).not.toContain("# CALENDAR EVENTS");
  });
});

describe("csv activityLog section", () => {
  const log = [
    { id: "dev1-s1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] },
  ];

  it("emits no activity section when the log is undefined", () => {
    // emptyWorkspace() leaves activityLog unset — the "absent" path through
    // the emission guard, distinct from an explicit empty array below.
    expect(workspaceToCsv(emptyWorkspace())).not.toContain(CSV_SECTION_ACTIVITY);
  });

  it("emits no activity section when the log is empty", () => {
    // ★ Pins the non-empty emission gate. Without this the golden CSV
    //   fixtures are the only thing that would notice a regression here, and
    //   they would report it as an unexplained byte diff a task later, not as
    //   the gate bug it actually is.
    const ws = { ...emptyWorkspace(), activityLog: [] };
    expect(workspaceToCsv(ws)).not.toContain(CSV_SECTION_ACTIVITY);
  });

  it("round-trips activityLog through CSV storage", () => {
    const ws = { ...emptyWorkspace(), activityLog: log };
    expect(csvToWorkspace(workspaceToCsv(ws)).activityLog).toEqual(log);
  });

  it("is STORAGE-ONLY: present without a config, absent with one", () => {
    const ws = { ...emptyWorkspace(), activityLog: log };
    expect(workspaceToCsv(ws)).toContain(CSV_SECTION_ACTIVITY);
    // A document export must never carry the audit trail.
    expect(workspaceToCsv(ws, defaultExportConfig)).not.toContain(CSV_SECTION_ACTIVITY);
  });

  it("keeps activityLog out of EXPORT_SECTION_KEYS", () => {
    expect(EXPORT_SECTION_KEYS).not.toContain("activityLog");
  });
});

describe("documentAssets CSV", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };

  it("round-trips an asset through the CSV codec", () => {
    const csv = documentAssetsToCsv([asset]);
    const [, row] = csv.split("\r\n");
    const cells = row.split(",");
    const obj: Record<string, string> = {};
    DOCUMENT_ASSETS_CSV_COLUMNS.forEach((c, i) => { obj[c] = cells[i]; });
    expect(buildDocumentAssetFromObj(obj)).toEqual(asset);
  });

  it("emits CRLF line endings, matching every other CSV section", () => {
    expect(documentAssetsToCsv([asset])).toContain("\r\n");
  });

  it("leaves an absent dimension as an empty cell, not the string 'undefined'", () => {
    const pdf = { ...asset, mime: "application/pdf", width: undefined, height: undefined };
    const [, row] = documentAssetsToCsv([pdf]).split("\r\n");
    expect(row).not.toContain("undefined");
  });

  // ★ Pins the DEVIATION from calendarEvents: asset metadata is internal
  // (backs `<img data-asset-id>` references in document blocks) and is not
  // an ExportSectionKey — same storage-only shape as documents/
  // documentVersions/activityLog, not the exportable enabled() shape
  // calendarEvents uses. See the comment in csv-codecs-config.ts.
  it("is STORAGE-ONLY: present without a config, absent with one", () => {
    const ws = { ...emptyWorkspace(), documentAssets: [asset] };
    expect(workspaceToCsv(ws)).toContain(CSV_SECTION_DOCUMENT_ASSETS);
    expect(workspaceToCsv(ws, defaultExportConfig)).not.toContain(CSV_SECTION_DOCUMENT_ASSETS);
  });

  it("round-trips documentAssets through CSV storage", () => {
    const ws = { ...emptyWorkspace(), documentAssets: [asset] };
    expect(csvToWorkspace(workspaceToCsv(ws)).documentAssets).toEqual([asset]);
  });

  it("emits no section and stays free of the key when there are no assets", () => {
    const ws = emptyWorkspace();
    const csv = workspaceToCsv(ws);
    expect(csv).not.toContain(CSV_SECTION_DOCUMENT_ASSETS);
    expect(csvToWorkspace(csv).documentAssets).toBeUndefined();
  });

  it("keeps documentAssets out of EXPORT_SECTION_KEYS", () => {
    expect(EXPORT_SECTION_KEYS).not.toContain("documentAssets");
  });
});
