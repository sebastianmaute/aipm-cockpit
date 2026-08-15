// src/app/markdown-codecs.test.ts
import { describe, it, expect } from "vitest";
import { workspaceToMarkdown, markdownToWorkspace, statusToMarkdown, markdownToStatus, EVENTS_MD_COLUMNS } from "./markdown-codecs";
import { EVENTS_CSV_COLUMNS } from "./csv-codecs-core";
import { emptyWorkspace, type Workspace } from "./workspace";
import { defaultExportConfig } from "./settings-types";

describe("markdown fieldVisibility section", () => {
  it("emits nothing when undefined", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Field Visibility");
  });
  it("emits the section when present", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    expect(workspaceToMarkdown(ws)).toContain("## Field Visibility");
  });
  it("round-trips fieldVisibility through Markdown", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { raid: { fields: ["title", "status", "owner", "category", "description"] } } };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.fieldVisibility?.raid.fields).toContain("title");
  });
  it("emits nothing for an empty fieldVisibility object", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: {} };
    expect(workspaceToMarkdown(ws)).not.toContain("## Field Visibility");
  });
  it("round-trips with a populated plan without corrupting it", () => {
    const base = emptyWorkspace();
    const ws = { ...base, fieldVisibility: { task: { fields: ["taskName", "assignee", "dueDate", "status", "notes"] } } };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.plan.startDate).toBe(base.plan.startDate);
    expect(back.plan.endDate).toBe(base.plan.endDate);
    expect(back.fieldVisibility?.task.fields).toContain("taskName");
  });
});

// The status narrative became rich HTML in R3, and the markdown backend writes
// it as ONE `- narrative: <value>` line decoded by a single-line regex. Nothing
// pinned that, and the golden fixture's narrative is still plain text — so the
// one property the format depends on (normalizeNarrativeHtml collapses newlines,
// therefore the value is always single-line) had no test behind it.
describe("markdown status narrative round-trip", () => {
  const RICH = "<p>Week 30</p><p>Shipped <strong>auth</strong></p><ul><li>one</li></ul>";

  it("survives statusToMarkdown -> markdownToStatus intact", () => {
    const status = { ragOverride: "A" as const, narrative: RICH, narrativeUpdatedAt: "2026-07-25" };
    expect(markdownToStatus(statusToMarkdown(status))).toEqual(status);
  });

  it("survives the whole-workspace markdown round-trip", () => {
    const ws = { ...emptyWorkspace(), status: { narrative: RICH } };
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).status?.narrative).toBe(RICH);
  });

  // A newline used to cut everything after it away, silently. The editor path
  // normalizes newlines out, but an imported / AI-written / backend-converted
  // status never passes through that — so the codec honours its own single-line
  // format for any value it is handed.
  it.each([
    ["\n", "<p>a</p>\n<p>b</p>"],
    ["\r\n", "<p>a</p>\r\n<p>b</p>"],
    ["bare \\r", "<p>a</p>\r<p>b</p>"],
  ])("collapses an embedded %s instead of truncating", (_label, narrative) => {
    const back = markdownToStatus(statusToMarkdown({ narrative }));
    expect(back.narrative).toBe("<p>a</p> <p>b</p>");
  });

  it("keeps every field when one of them carried a newline", () => {
    const back = markdownToStatus(
      statusToMarkdown({ ragOverride: "R", narrative: "<p>a</p>\n<p>b</p>", narrativeUpdatedAt: "2026-07-25" }),
    );
    expect(back).toEqual({ ragOverride: "R", narrative: "<p>a</p> <p>b</p>", narrativeUpdatedAt: "2026-07-25" });
  });
});

describe("markdown features section", () => {
  it("emits nothing when undefined", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Functions");
  });
  it("emits and round-trips features incl. explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "gantt"] as const };
    expect(workspaceToMarkdown(ws)).toContain("## Functions");
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).features).toEqual(expect.arrayContaining(["raid", "gantt"]));
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(workspaceToMarkdown(simple)).toContain("## Functions"); // empty STILL emits
    expect(markdownToWorkspace(workspaceToMarkdown(simple)).features).toEqual([]);
  });
});

describe("calendar events markdown", () => {
  it("round-trips a recurring event with exceptions", () => {
    const ws = {
      ...emptyWorkspace(),
      calendarEvents: [{
        id: 1, title: "Standup | with a pipe", startDate: "2026-07-27", startTime: "09:00",
        durationMinutes: 15,
        recurrence: { freq: "weekly" as const, interval: 1 },
        exceptions: [{ date: "2026-08-03", kind: "skip" as const }],
      }],
    };
    const md = workspaceToMarkdown(ws);
    expect(md).toContain("## Calendar Events");
    expect(markdownToWorkspace(md).calendarEvents).toEqual(ws.calendarEvents);
  });

  it("round-trips all 13 fields, including a title with both a pipe and a literal backslash", () => {
    const event = {
      id: 1,
      title: "Planning sync | budget \\v2\\ review",
      startDate: "2026-07-27",
      startTime: "09:00",
      durationMinutes: 15,
      location: "Room 4 | Floor 2",
      notes: "Agenda:\nBudget | review \\draft\\",
      recurrence: { freq: "weekly" as const, interval: 1, byDay: ["MO" as const, "WE" as const] },
      exceptions: [
        { date: "2026-08-03", kind: "skip" as const },
        { date: "2026-08-10", kind: "move" as const, toDate: "2026-08-11", toTime: "10:00" },
      ],
      attendeeResourceIds: [3, 9, 42],
      sendInvitations: true,
      localModifiedAt: "2026-07-26T10:00:00.000Z",
      outlookEventId: "AAMk-some-id",
    };

    // Verify the fixture itself before trusting the round-trip assertion — a
    // heredoc-authored version of a fixture like this one silently collapsed
    // its backslashes earlier in this release, producing a test that passed
    // while exercising nothing.
    expect(event.title).toContain("\\");
    expect(event.title.split("\\").length - 1).toBe(2);
    expect(event.title).toContain("|");
    expect(event.notes).toContain("\\");
    expect(Object.keys(event)).toHaveLength(13);

    const ws = { ...emptyWorkspace(), calendarEvents: [event] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.calendarEvents).toEqual(ws.calendarEvents);
  });

  it("omits the section entirely when there are no events", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Calendar Events");
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
    expect(workspaceToMarkdown(ws, on)).toContain("## Calendar Events");
    expect(workspaceToMarkdown(ws, off)).not.toContain("## Calendar Events");
  });

  // EVENTS_MD_COLUMNS is documented (markdown-codecs-core.ts) as "same 13
  // fields as EVENTS_CSV_COLUMNS, same order" — assert that invariant directly
  // so an edit to one list that forgets the other fails here instead of
  // silently dropping a field from one format only. Lives beside the MD side
  // of the pairing since EVENTS_CSV_COLUMNS is documented as the canonical
  // order MD mirrors; entity-persistence-registry.test.ts guards a narrower,
  // different thing (outlookEventId survives the round-trip), not column parity.
  it("EVENTS_MD_COLUMNS covers the same keys, in the same order, as EVENTS_CSV_COLUMNS", () => {
    expect(EVENTS_MD_COLUMNS.map((c) => c.key)).toEqual([...EVENTS_CSV_COLUMNS]);
  });
});

describe("activity log markdown", () => {
  const log = [
    { id: "dev1-s1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] },
  ];

  it("round-trips activityLog through Markdown storage", () => {
    const ws = { ...emptyWorkspace(), activityLog: log } as Workspace;
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).activityLog).toEqual(log);
  });

  it("omits the section entirely when the log is absent", () => {
    // emptyWorkspace() leaves activityLog unset — the "absent" path through
    // the emission guard, distinct from an explicit empty array below.
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Activity Log");
  });

  it("omits the section when the log is an explicit empty array", () => {
    // ★ Pins the non-empty half of the gate (`ws.activityLog.length`). The
    //   absent case above exercises only `ws.activityLog &&`, so without this
    //   the length check can be deleted with the whole suite green — the
    //   golden fixtures would then report it as an unexplained byte diff a
    //   task later, not as the gate bug it actually is.
    const ws = { ...emptyWorkspace(), activityLog: [] } as Workspace;
    expect(workspaceToMarkdown(ws)).not.toContain("## Activity Log");
  });

  it("is STORAGE-ONLY: present without a config, absent with one", () => {
    // ★ The audit trail is persisted on every backend but must NEVER reach a
    //   user-facing document export: an entry's `changes` field carries the
    //   old AND new values for up to 12 fields per update — internal audit
    //   detail that must not appear in a document handed to a client. Markdown
    //   implements that by gating emission on `config === undefined` (no
    //   config = storage; a config = document export). Deleting that clause
    //   ships the trail in every client-facing export; this test is what
    //   catches it. CSV pins the same invariant in csv-codecs.test.ts.
    const ws = { ...emptyWorkspace(), activityLog: log } as Workspace;
    expect(workspaceToMarkdown(ws)).toContain("## Activity Log");
    expect(workspaceToMarkdown(ws, defaultExportConfig)).not.toContain("## Activity Log");
  });
});
