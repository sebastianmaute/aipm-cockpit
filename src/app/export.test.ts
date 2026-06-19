// src/app/export.test.ts
//
// Tests for buildPdfHtml — the pure HTML-building helper extracted from
// exportPdf. Tests run in Node (no DOM); window.print() is never called here.

import { describe, it, expect } from "vitest";
import { buildPdfHtml } from "./export";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone } from "./types";

// ---------------------------------------------------------------------------
// Minimal fixture helpers (shared with export-sections.test.ts style)
// ---------------------------------------------------------------------------

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
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
    ...overrides,
  };
}

function makeRaidItem(id: number): RaidItem {
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
    stakeholderIds: [],
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

describe("buildPdfHtml", () => {
  it("with defaultExportConfig — tasks table present, RAID table present (when non-empty)", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)], // milestones NOT enabled by default
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Tasks section must be present
    expect(html).toContain("Task 1");
    // RAID section present (non-empty + enabled)
    expect(html).toContain("Risk 10");
    // Milestones must NOT appear (not enabled in defaultExportConfig)
    expect(html).not.toContain("Milestone 1");
    expect(html).not.toContain("milestones");
  });

  it("with defaultExportConfig — RAID table absent when workspace has no raid items", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [], // empty
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Tasks present
    expect(html).toContain("Task 1");
    // RAID section heading absent
    expect(html).not.toContain("RAID");
  });

  it("enabling milestones — HTML contains milestones heading + a row per milestone", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1), makeMilestone(2)],
    };

    const html = buildPdfHtml(ws, cfg, "en-US");

    // Milestones heading appears
    expect(html).toContain("Milestone 1");
    expect(html).toContain("Milestone 2");
  });

  it("cell values are HTML-escaped — < and & in task title are escaped", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1, { taskName: "Fix <b>bold</b> & deploy" })],
      raid: [],
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    expect(html).toContain("Fix &lt;b&gt;bold&lt;/b&gt; &amp; deploy");
    // The raw injected tag must not appear as unescaped markup in the table body
    expect(html).not.toContain("<td>Fix <b>");
  });

  it("produces valid HTML with correct doctype and head structure", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("</body>");
    expect(html).toContain("window.print()");
  });

  it("empty workspace — outputs 'No tasks to export' style message, no crash", () => {
    const ws: Workspace = makeBaseWorkspace(); // all arrays empty

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Should not throw and should produce a valid HTML document
    expect(html).toContain("<!DOCTYPE html>");
    // No section tables rendered when everything is empty
    expect(html).not.toContain("<tbody>");
  });

  it("section heading appears before its table, using section.title", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Each section emits an <h2> with the section title
    // tasks section title is "Tasks" (en-US)
    expect(html).toMatch(/<h2[^>]*>Tasks<\/h2>/);
  });

  it("status section (2-column key/value) renders as a normal 2-column table", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, status: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      status: {
        ragOverride: "G",
        narrative: "On track",
      },
    };

    const html = buildPdfHtml(ws, cfg, "en-US");

    // Status section heading (title from export-sections: "Project Status")
    expect(html).toContain("Project Status");
    // Status field/value rows appear in the table
    expect(html).toContain("On track");
  });
});
