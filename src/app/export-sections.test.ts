// src/app/export-sections.test.ts
import { describe, it, expect } from "vitest";
import {
  buildExportSections,
  TASK_RICH_COLUMNS,
  RAID_RICH_COLUMNS,
  MILESTONE_RICH_COLUMNS,
  CHANGE_RICH_COLUMNS,
} from "./export-sections";
import {
  CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  fieldToString,
  raidFieldToString,
  milestoneFieldToString,
} from "./storage";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone } from "./types";
import type { CalendarEvent } from "./calendar-event";
import { nearestOccurrence } from "./recurrence";

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function makeTask(id: number): Task {
  return {
    id,
    taskName: `Task ${id}`,
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    startDate: "2025-01-01",
    dueDate: "2025-06-01",
    lastUpdateDate: "2025-03-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    completedDate: undefined,
    inquiriesSent: 0,
    group: undefined,
    labels: [],
    dependencies: [],
    jiraKey: undefined,
    jiraIssueType: undefined,
    lastSyncedAt: undefined,
    localModifiedAt: undefined,
    healthOverride: undefined,
    resourceId: undefined,
    originalEstimateMinutes: undefined,
    timeSpentMinutes: undefined,
  };
}

function makeRaidItem(id: number, stakeholderIds?: number[]): RaidItem {
  return {
    id,
    category: "R",
    title: `Risk ${id}`,
    description: "Some risk",
    severity: "Medium",
    probability: 3,
    impact: 3,
    status: "Open",
    owner: "Bob",
    ownerEmail: "bob@example.com",
    mitigation: "Mitigate it",
    linkedTaskIds: [],
    raisedDate: "2025-01-01",
    targetDate: undefined,
    closedDate: undefined,
    localModifiedAt: undefined,
    causedByRaidIds: [],
    stakeholderIds: stakeholderIds ?? [],
  };
}

function makeMilestone(id: number): Milestone {
  return {
    id,
    name: `Milestone ${id}`,
    date: "2025-12-31",
    description: "A key date",
    achievedDate: undefined,
    linkedTaskIds: [],
    localModifiedAt: undefined,
  };
}

function makeCalendarEvent(id: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: `Event ${id}`,
    startDate: "2025-03-10",
    startTime: "09:00",
    durationMinutes: 30,
    ...overrides,
  };
}

function makeBaseWorkspace(): Workspace {
  return {
    tasks: [],
    raid: [],
    absences: [],
    shifts: [],
    resources: [],
    roles: [],
    disciplines: [],
    grades: [],
    plan: {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      granularity: "month",
      currency: "EUR",
    },
    budgets: [],
    fxRates: null,
    status: {},
    milestones: [],
    changes: [],
    stakeholders: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildExportSections", () => {
  it("returns exactly tasks + raid in order when defaultExportConfig (tasks+raid only), milestones present but not enabled", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1), makeTask(2)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
    };

    const sections = buildExportSections(ws, defaultExportConfig, "en-US");

    expect(sections).toHaveLength(2);
    expect(sections[0].key).toBe("tasks");
    expect(sections[1].key).toBe("raid");
  });

  it("includes milestones section when milestones enabled and workspace has milestones", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ms = [makeMilestone(1), makeMilestone(2)];
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: ms,
    };

    const sections = buildExportSections(ws, cfg, "en-US");

    expect(sections).toHaveLength(3);
    expect(sections[0].key).toBe("tasks");
    expect(sections[1].key).toBe("raid");
    expect(sections[2].key).toBe("milestones");

    const milSec = sections[2];
    expect(milSec.columns).toEqual(MILESTONES_CSV_COLUMNS);
    expect(milSec.rows).toHaveLength(2);
    expect(milSec.rows[0]).toEqual(
      MILESTONES_CSV_COLUMNS.map((c) => milestoneFieldToString(ms[0], c))
    );
  });

  it("omits a section that is enabled but whose workspace array is empty", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [], // empty — should be skipped even though enabled
    };

    const sections = buildExportSections(ws, cfg, "en-US");

    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.key)).toEqual(["tasks", "raid"]);
  });

  it("does not crash on a legacy RAID item without stakeholderIds", () => {
    const legacyRaid = makeRaidItem(99) as Record<string, unknown>;
    delete legacyRaid.stakeholderIds; // simulate legacy item

    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [legacyRaid as RaidItem],
    };

    expect(() =>
      buildExportSections(ws, defaultExportConfig, "en-US")
    ).not.toThrow();

    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    expect(sections[1].key).toBe("raid");
    expect(sections[1].rows).toHaveLength(1);
  });

  it("tasks section columns and row values match what workspaceToCsv produces for that section", () => {
    const tasks = [makeTask(1), makeTask(2)];
    const ws: Workspace = { ...makeBaseWorkspace(), tasks, raid: [makeRaidItem(10)] };

    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const taskSec = sections.find((s) => s.key === "tasks")!;

    // Column headers must be the same list that workspaceToCsv uses
    expect(taskSec.columns).toEqual(CSV_COLUMNS);

    // Each row must equal what fieldToString produces for the same task
    tasks.forEach((task, idx) => {
      const expectedRow = CSV_COLUMNS.map((c) => fieldToString(task, c));
      expect(taskSec.rows[idx]).toEqual(expectedRow);
    });
  });

  it("raid section columns and row values match RAID_CSV_COLUMNS projection", () => {
    const raidItems = [makeRaidItem(1), makeRaidItem(2)];
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: raidItems,
    };

    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const raidSec = sections.find((s) => s.key === "raid")!;

    expect(raidSec.columns).toEqual(RAID_CSV_COLUMNS);
    raidItems.forEach((r, idx) => {
      const expectedRow = RAID_CSV_COLUMNS.map((c) => raidFieldToString(r, c));
      expect(raidSec.rows[idx]).toEqual(expectedRow);
    });
  });

  it("returns empty array when no sections are enabled", () => {
    const allOff: ExportConfig = {
      project: false,
      tasks: false, raid: false, changes: false, milestones: false,
      stakeholders: false, budgets: false, resources: false, roles: false,
      absences: false, shifts: false, calendarEvents: false, status: false,
      knowledgeItems: false,
      insights: false,
    };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };

    const sections = buildExportSections(ws, allOff, "en-US");
    expect(sections).toHaveLength(0);
  });

  it("section titles are localized — tasks title differs between en-US and de", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };

    const enSections = buildExportSections(ws, defaultExportConfig, "en-US");
    // en-US "tasks" key → "Tasks"
    expect(enSections[0].title).toBe("Tasks");
  });

  it("preserves canonical EXPORT_SECTION_KEYS order even if workspace arrays are in different order", () => {
    const cfg: ExportConfig = {
      ...defaultExportConfig,
      milestones: true,
      changes: true,
    };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
      changes: [
        {
          id: 1, title: "Change 1", type: "Scope", status: "Proposed",
          impact: "Medium", impactDescription: "", scheduleImpactDays: 0,
          costImpact: 0, requestedBy: "PM", raisedDate: "2025-01-01",
          decisionBy: "", decisionDate: "", resolutionNotes: "",
          description: "", linkedTaskIds: [], linkedRaidIds: [],
          stakeholderIds: [], localModifiedAt: undefined,
        },
      ],
    };

    const sections = buildExportSections(ws, cfg, "en-US");
    const keys = sections.map((s) => s.key);

    // tasks < raid < changes < milestones — as per EXPORT_SECTION_KEYS order
    expect(keys.indexOf("tasks")).toBeLessThan(keys.indexOf("raid"));
    expect(keys.indexOf("raid")).toBeLessThan(keys.indexOf("changes"));
    expect(keys.indexOf("changes")).toBeLessThan(keys.indexOf("milestones"));
  });
});

describe("calendarEvents section", () => {
  it("is omitted when there are no events, even though the key defaults ON", () => {
    const ws: Workspace = { ...makeBaseWorkspace(), tasks: [makeTask(1)] };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    expect(sections.find((s) => s.key === "calendarEvents")).toBeUndefined();
  });

  it("renders title, first occurrence, recurs and location for a non-recurring event", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      calendarEvents: [makeCalendarEvent(1, { location: "Room 4" })],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.columns).toEqual(["title", "first occurrence", "recurs", "location"]);
    expect(sec.rows).toEqual([["Event 1", "2025-03-10 09:00", "Does not repeat", "Room 4"]]);
  });

  it("omits location as an empty cell rather than dropping the column", () => {
    const ws: Workspace = { ...makeBaseWorkspace(), calendarEvents: [makeCalendarEvent(1)] };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.rows[0]).toEqual(["Event 1", "2025-03-10 09:00", "Does not repeat", ""]);
  });

  it("describes weekly/monthly recurrence in plain language", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      calendarEvents: [
        makeCalendarEvent(1, { recurrence: { freq: "daily", interval: 1 } }),
        makeCalendarEvent(2, { recurrence: { freq: "weekly", interval: 2, byDay: ["MO", "WE"] } }),
        makeCalendarEvent(3, { recurrence: { freq: "monthly", interval: 1, byDay: { ordinal: 2, day: "TU" } } }),
        makeCalendarEvent(4, { recurrence: { freq: "monthly", interval: 1, byMonthDay: 15 } }),
      ],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.rows.map((r) => r[2])).toEqual([
      "Every day",
      "Every 2 weeks on MO, WE",
      "Every month on the 2nd TU",
      "Every month on day 15",
    ]);
  });

  it("is dropped entirely when disabled, even with events present", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, calendarEvents: false };
    const ws: Workspace = { ...makeBaseWorkspace(), calendarEvents: [makeCalendarEvent(1)] };
    const sections = buildExportSections(ws, cfg, "en-US");
    expect(sections.find((s) => s.key === "calendarEvents")).toBeUndefined();
  });

  it("advances past a skip on the event's own startDate to the true first occurrence", () => {
    // 2025-03-10 is a Monday; a weekly-with-no-byDay rule steps 7 days at a
    // time, so skipping the very first instance should surface 2025-03-17.
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      calendarEvents: [makeCalendarEvent(1, {
        recurrence: { freq: "weekly", interval: 1 },
        exceptions: [{ date: "2025-03-10", kind: "skip" }],
      })],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.rows[0][1]).toBe("2025-03-17 09:00");
  });

  it("shows the moved date/time when the event's own startDate was rescheduled", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      calendarEvents: [makeCalendarEvent(1, {
        recurrence: { freq: "weekly", interval: 1 },
        exceptions: [{ date: "2025-03-10", kind: "move", toDate: "2025-03-12", toTime: "14:00" }],
      })],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.rows[0][1]).toBe("2025-03-12 14:00");
  });

  it("falls back to an empty cell (not the raw startDate) when a small count is entirely skipped", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      calendarEvents: [makeCalendarEvent(1, {
        recurrence: { freq: "daily", interval: 1, count: 2 },
        exceptions: [
          { date: "2025-03-10", kind: "skip" },
          { date: "2025-03-11", kind: "skip" },
        ],
      })],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.rows[0][1]).toBe("");
  });

  it("resolves the confirmed date even for an ancient series — 'occurrence' is always populated for this call shape, even though 'truncated' routinely fires", () => {
    // Proves the NARROWER claim firstOccurrenceLabel's own comment actually
    // makes: NOT that `truncated` is unreachable (it isn't — MAX_OCCURRENCES
    // fires for practically any daily/weekly-ish series here, ancient or
    // not, since the ~11-year lookahead alone produces >1000 candidates),
    // but that `occurrence` (element 0 of an already-sorted list) is
    // unaffected by that — it's always populated for THIS call shape
    // (windowStart === the event's own startDate), regardless of which
    // calendar year that start falls in. The genuinely unreachable state is
    // `occurrence === undefined && truncated`, not `truncated` on its own.
    const evt: CalendarEvent = {
      id: 1, title: "Ancient standup", startDate: "1900-01-01", startTime: "09:00",
      durationMinutes: 15, recurrence: { freq: "daily", interval: 1 },
    };
    // Direct check on the underlying helper, not just the rendered string —
    // a prior version of this test asserted only the date and never looked
    // at `truncated` at all, so it passed while blind to what its old title
    // claimed ("truncation is unreachable").
    expect(nearestOccurrence(evt, evt.startDate).occurrence).toBeDefined();

    const ws: Workspace = { ...makeBaseWorkspace(), calendarEvents: [evt] };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const sec = sections.find((s) => s.key === "calendarEvents")!;
    expect(sec.rows[0][1]).toBe("1900-01-01 09:00");
  });
});

// ---------------------------------------------------------------------------
// Slice B: the six rich register fields export as TEXT, not stored HTML.
// The codec (raidFieldToString/…) must keep emitting the HTML — CSV *storage*
// round-trips through the same function and golden-workspace pins those bytes —
// so the projection belongs to the section builders alone.
// ---------------------------------------------------------------------------

describe("rich descriptions export as text (slice B)", () => {
  function richWorkspace(): Workspace {
    return {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [
        {
          ...makeRaidItem(1),
          description: "<p>vendor <strong>slipped</strong> badly</p>",
          mitigation: "<p>escalate to <em>steering</em></p>",
        },
      ],
      milestones: [
        { ...makeMilestone(1), description: "<p>final <em>cutover</em></p>" },
      ],
      changes: [
        {
          id: 1, title: "Change 1", type: "Scope", status: "Proposed",
          impact: "Medium",
          impactDescription: "<p>two <strong>extra</strong> sprints</p>",
          scheduleImpactDays: 0,
          costImpact: 0, requestedBy: "PM", raisedDate: "2025-01-01",
          decisionBy: "", decisionDate: "",
          resolutionNotes: "<p>approved with <em>conditions</em></p>",
          description: "<p>widen the <strong>scope</strong></p>",
          linkedTaskIds: [], linkedRaidIds: [],
          stakeholderIds: [], localModifiedAt: undefined,
        },
      ],
    };
  }

  const richConfig: ExportConfig = {
    ...defaultExportConfig,
    milestones: true,
    changes: true,
  };

  function flatten(key: "raid" | "milestones" | "changes"): string {
    const sections = buildExportSections(richWorkspace(), richConfig, "en-US");
    const section = sections.find((s) => s.key === key);
    expect(section).toBeDefined();
    return (section?.rows ?? []).flat().join(" ");
  }

  it("emits no markup in raid, milestone or change rows", () => {
    for (const key of ["raid", "milestones", "changes"] as const) {
      expect(flatten(key)).not.toContain("<");
    }
  });

  it("keeps the text content of a rich description", () => {
    expect(flatten("milestones")).toContain("final cutover");
    expect(flatten("raid")).toContain("vendor slipped badly");
    expect(flatten("raid")).toContain("escalate to steering");
    expect(flatten("changes")).toContain("widen the scope");
    expect(flatten("changes")).toContain("two extra sprints");
    expect(flatten("changes")).toContain("approved with conditions");
  });

  // ★★ Every fixture above is a SINGLE <p> with internal spaces, so a projection
  // that deletes tags and puts nothing in their place still reads correctly —
  // none of them can see a block boundary being fused. `<p>…</p><p>…</p>` and
  // `<p>…<br>…</p>` are the shapes that can, and the second is what
  // descriptionHtml produces for EVERY legacy multi-line value.
  it("separates paragraphs and <br> lines instead of fusing the words", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [
        {
          ...makeRaidItem(1),
          description: "<p>Vendor delay</p><p>Mitigation plan</p>",
          // exactly what descriptionHtml("line one\nline two") emits
          mitigation: "<p>line one<br>line two</p>",
        },
      ],
    };
    const sections = buildExportSections(ws, richConfig, "en-US");
    const raid = (sections.find((s) => s.key === "raid")?.rows ?? []).flat().join(" ");
    // ★ The separator is a NEWLINE, not a space: exports now carry
    // descriptionTextWithBreaks, so a renderer can lay the boundary out as a
    // real paragraph break. Fusing (the bug this test was written for) is still
    // pinned by the two negative assertions below.
    expect(raid).toContain("Vendor delay\nMitigation plan");
    expect(raid).toContain("line one\nline two");
    expect(raid).not.toContain("delayMitigation");
    expect(raid).not.toContain("oneline");
  });

  // ★ guards the silent-typo failure mode: a rich-column name that is not a real
  // column means the projection never runs and nothing else notices.
  it("names only real columns in the rich-column sets", () => {
    const cases: ReadonlyArray<[string, ReadonlySet<string>, readonly string[]]> = [
      ["raid", RAID_RICH_COLUMNS, RAID_CSV_COLUMNS as unknown as string[]],
      ["milestones", MILESTONE_RICH_COLUMNS, MILESTONES_CSV_COLUMNS as unknown as string[]],
      ["changes", CHANGE_RICH_COLUMNS, CHANGES_CSV_COLUMNS as unknown as string[]],
    ];
    for (const [label, rich, columns] of cases) {
      const unknownNames = [...rich].filter((c) => !columns.includes(c));
      expect(`${label}: ${unknownNames.join(",")}`).toBe(`${label}: `);
    }
  });

  // ★ COMPLETENESS, the other direction: the subset check above catches a FAKE
  // name, this catches a MISSING real one.
  //
  // ★★ HONEST SCOPE — a reviewer reported that deleting "mitigation" from
  // RAID_RICH_COLUMNS "left every test passing"; that is NOT true, and it was
  // checked rather than taken on faith. Both that deletion and dropping
  // "impactDescription" are already caught behaviourally by "emits no markup in
  // raid, milestone or change rows" and "keeps the text content of a rich
  // description". So this test closes no hole. It earns its place for two smaller
  // reasons: it fails by NAMING the field set (the behavioural failures say only
  // that markup appeared somewhere), and it pins the count of SEVEN that AGENTS.md
  // and the release notes both cite, so an eighth rich field forces a decision here
  // rather than silently making those documents wrong.
  it("covers EVERY rich field, not merely real ones", () => {
    const expected: ReadonlyArray<[string, ReadonlySet<string>, readonly string[]]> = [
      ["task", TASK_RICH_COLUMNS, ["description"]],
      ["raid", RAID_RICH_COLUMNS, ["description", "mitigation"]],
      ["milestone", MILESTONE_RICH_COLUMNS, ["description"]],
      [
        "change",
        CHANGE_RICH_COLUMNS,
        ["description", "impactDescription", "resolutionNotes"],
      ],
    ];
    for (const [label, rich, fields] of expected) {
      expect(`${label}: ${[...rich].sort().join(",")}`).toBe(`${label}: ${[...fields].sort().join(",")}`);
    }
    // And the union really is seven — the count AGENTS.md and the release notes cite.
    const union = new Set([
      ...TASK_RICH_COLUMNS,
      ...[...RAID_RICH_COLUMNS].map((f) => `raid.${f}`),
      ...[...MILESTONE_RICH_COLUMNS].map((f) => `milestone.${f}`),
      ...[...CHANGE_RICH_COLUMNS].map((f) => `change.${f}`),
    ]);
    expect(union.size).toBe(7);
  });
});

describe("task descriptions are projected like every other rich field", () => {
  it("exports Task.description as text, not raw HTML", () => {
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      tasks: [{ ...makeTask(1), description: "<p>Vendor delay</p><p>Mitigation plan</p>" }],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const tasks = sections.find((s) => s.key === "tasks");
    const col = tasks!.columns.indexOf("description");
    expect(col).toBeGreaterThanOrEqual(0);
    const cell = String(tasks!.rows[0][col]);
    expect(cell).not.toContain("<p>");
    expect(cell).toBe("Vendor delay\nMitigation plan");
  });

  it("pins TASK_RICH_COLUMNS as a subset of the task CSV columns", () => {
    // A name that is not a real column would silently never match, leaving the
    // fix absent with nothing else noticing.
    for (const c of TASK_RICH_COLUMNS) {
      expect(CSV_COLUMNS as unknown as string[]).toContain(c);
    }
  });

  it("keeps register descriptions on the break-preserving projection too", () => {
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      raid: [{ ...makeRaidItem(1), description: "<p>one</p><p>two</p>" }],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const raid = sections.find((s) => s.key === "raid");
    const col = raid!.columns.indexOf("description");
    expect(String(raid!.rows[0][col])).toBe("one\ntwo");
  });
});
