// src/app/export-sections.project.test.ts
import { describe, it, expect } from "vitest";
import { buildExportSections } from "./export-sections";
import { emptyWorkspace } from "./storage";
import { defaultExportConfig } from "./settings-types";
import type { ProjectMeta } from "./types";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeProjectMeta(): ProjectMeta {
  return {
    name: "Apollo | Re-platform",
    code: "APL-001",
    description: "Line one\nLine two",
    sponsor: "Jane Sponsor",
    projectManager: "John PM",
    keyStakeholdersInternal: ["Alice Internal", "Bob Internal"],
    keyStakeholdersExternal: ["Carol External"],
    customer: "Acme Corp",
    naceSection: "C",
    identityTypes: ["B2B", "B2C"],
    identityCount: 42,
    products: "Widget Suite",
    platform: "Azure",
    deployment: "Cloud",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    profitCenter: "PC-100",
    quotes: "Q-2026-001",
    salesforceUrl: "https://sf.example.com/a",
    sharepointUrl: "https://sp.example.com/b",
    confluenceUrl: "https://cf.example.com/c",
    contactPersons: [
      { name: "Eve Contact", email: "eve@example.com", synced: true },
      { name: "Frank Contact", email: "frank@example.com", synced: false },
    ],
    docRepoLocation: "C:\\repos\\apollo",
    regulatory: ["GDPR / data protection regulation", "DORA"],
    notes: "Some notes",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildExportSections – project section", () => {
  it("includes a project section when project: true and ws.project is set", () => {
    const ws = { ...emptyWorkspace(), project: makeProjectMeta() };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");

    const projectSec = sections.find((s) => s.key === "project");
    expect(projectSec).toBeDefined();
  });

  it("project section has exactly 2 columns (field + value)", () => {
    const ws = { ...emptyWorkspace(), project: makeProjectMeta() };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const projectSec = sections.find((s) => s.key === "project")!;

    expect(projectSec.columns).toHaveLength(2);
    expect(projectSec.columns[0]).toBe("field");
    expect(projectSec.columns[1]).toBe("value");
  });

  it("each row is a [fieldLabel, value] pair with a non-empty label", () => {
    const ws = { ...emptyWorkspace(), project: makeProjectMeta() };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const projectSec = sections.find((s) => s.key === "project")!;

    for (const row of projectSec.rows) {
      expect(row).toHaveLength(2);
      expect(typeof row[0]).toBe("string");
      expect((row[0] as string).length).toBeGreaterThan(0);
    }
  });

  it("known fields appear as rows — name, code, projectManager", () => {
    const meta = makeProjectMeta();
    const ws = { ...emptyWorkspace(), project: meta };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const rows = sections.find((s) => s.key === "project")!.rows;
    const values = rows.map((r) => r[1] as string);

    // name must appear
    expect(values).toContain(meta.name);
    // code must appear
    expect(values).toContain(meta.code);
    // projectManager must appear
    expect(values).toContain(meta.projectManager);
  });

  it("contactPersons are rendered as 'name <email>' joined by ', '", () => {
    const meta = makeProjectMeta();
    const ws = { ...emptyWorkspace(), project: meta };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const rows = sections.find((s) => s.key === "project")!.rows;
    const values = rows.map((r) => r[1] as string);

    expect(values).toContain("Eve Contact <eve@example.com>, Frank Contact <frank@example.com>");
  });

  it("arrays are joined with ', ' (e.g. regulatory, identityTypes)", () => {
    const meta = makeProjectMeta();
    const ws = { ...emptyWorkspace(), project: meta };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const rows = sections.find((s) => s.key === "project")!.rows;
    const values = rows.map((r) => r[1] as string);

    expect(values).toContain("GDPR / data protection regulation, DORA");
    expect(values).toContain("B2B, B2C");
  });

  it("omits optional fields that are absent (undefined)", () => {
    const meta: ProjectMeta = {
      name: "Minimal",
      code: "MIN-001",
      projectManager: "PM",
      keyStakeholdersInternal: [],
      keyStakeholdersExternal: [],
      customer: "Cust",
      naceSection: "A",
      identityTypes: [],
      products: "P",
      deployment: "On-premise",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      profitCenter: "PC-1",
      contactPersons: [],
      regulatory: [],
      // description, sponsor, identityCount, platform, quotes, salesforceUrl,
      // sharepointUrl, confluenceUrl, docRepoLocation, notes — all absent
    };
    const ws = { ...emptyWorkspace(), project: meta };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const rows = sections.find((s) => s.key === "project")!.rows;
    const labels = rows.map((r) => r[0] as string);

    // None of the absent optional fields should appear
    expect(labels).not.toContain("Description");
    expect(labels).not.toContain("Sponsor");
    expect(labels).not.toContain("Notes");
    expect(labels).not.toContain("Platform");
    expect(labels).not.toContain("Quotes");
  });

  it("omits empty-array fields from rows", () => {
    const meta: ProjectMeta = {
      name: "No Arrays",
      code: "NA-001",
      projectManager: "PM",
      keyStakeholdersInternal: [],   // empty — should be omitted
      keyStakeholdersExternal: [],   // empty — should be omitted
      customer: "Cust",
      naceSection: "A",
      identityTypes: [],             // empty — should be omitted
      products: "P",
      deployment: "On-premise",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      profitCenter: "PC-1",
      contactPersons: [],            // empty — should be omitted
      regulatory: [],                // empty — should be omitted
    };
    const ws = { ...emptyWorkspace(), project: meta };
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const rows = sections.find((s) => s.key === "project")!.rows;
    const labels = rows.map((r) => r[0] as string);

    expect(labels).not.toContain("Internal stakeholders");
    expect(labels).not.toContain("External stakeholders");
    expect(labels).not.toContain("Identity types");
    expect(labels).not.toContain("Contact persons");
    expect(labels).not.toContain("Regulatory");
  });

  it("returns no project section when project: false", () => {
    const ws = { ...emptyWorkspace(), project: makeProjectMeta() };
    const cfg = { ...defaultExportConfig, project: false };

    const sections = buildExportSections(ws, cfg, "en-US");
    expect(sections.find((s) => s.key === "project")).toBeUndefined();
  });

  it("returns no project section when ws.project is undefined and project: true", () => {
    const ws = { ...emptyWorkspace() };
    // ws.project is undefined — no section expected
    const cfg = { ...defaultExportConfig, project: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    expect(sections.find((s) => s.key === "project")).toBeUndefined();
  });

  it("project section appears first (before tasks) because 'project' is first in EXPORT_SECTION_KEYS", () => {
    const ws = {
      ...emptyWorkspace(),
      project: makeProjectMeta(),
      tasks: [
        {
          id: 1, taskName: "T1", assignee: "", assigneeEmail: "",
          startDate: "2026-01-01", dueDate: "2026-06-01", lastUpdateDate: "2026-01-01",
          priority: "Medium" as const, blockers: "", notes: "",
          completedDate: undefined, inquiriesSent: 0, group: undefined,
          labels: [], dependencies: [], jiraKey: undefined, jiraIssueType: undefined,
          lastSyncedAt: undefined, localModifiedAt: undefined, healthOverride: undefined,
          resourceId: undefined, originalEstimateMinutes: undefined, timeSpentMinutes: undefined,
        },
      ],
    };
    const cfg = { ...defaultExportConfig, project: true, tasks: true };

    const sections = buildExportSections(ws, cfg, "en-US");
    const keys = sections.map((s) => s.key);

    expect(keys[0]).toBe("project");
    expect(keys).toContain("tasks");
    expect(keys.indexOf("project")).toBeLessThan(keys.indexOf("tasks"));
  });
});
