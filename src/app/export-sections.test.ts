// src/app/export-sections.test.ts
import { describe, it, expect } from "vitest";
import { buildExportSections } from "./export-sections";
import {
  CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  fieldToString,
  raidFieldToString,
  milestoneFieldToString,
} from "./storage";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone } from "./types";

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
    notes: "",
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
      absences: false, shifts: false, status: false, knowledgeItems: false,
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
