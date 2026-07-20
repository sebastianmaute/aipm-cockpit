// src/app/insights-persistence.test.ts
// Round-trip tests for Workspace.insights (the Insights → Action Loop record
// list) across the three text codecs (JSON, CSV, Markdown) plus byte-stability
// checks (an insight-less workspace must NOT emit the # INSIGHTS / ## Insights
// sections).
//
// Like knowledgeItems this field is EXPORTABLE, so it is also emitted on the
// document-export path when its export section is enabled.

import { describe, it, expect } from "vitest";
import { emptyWorkspace, workspaceToJson, jsonToWorkspace } from "./workspace";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { defaultExportConfig } from "./settings-types";
import type { Insight } from "./insights/insight";

const SAMPLE_INSIGHTS: Insight[] = [
  {
    id: 1,
    key: "milestoneSlip:5",
    type: "milestoneSlip",
    severity: "high",
    status: "active",
    data: { milestoneId: 5, days: 12 },
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-10T00:00:00.000Z",
    occurrences: 3,
    entityRef: { view: "milestones", id: 5 },
  },
  {
    id: 2,
    key: "overdueTrend",
    type: "overdueTrend",
    severity: "medium",
    status: "acknowledged",
    data: { count: 4 },
    firstSeenAt: "2026-07-05T00:00:00.000Z",
    lastSeenAt: "2026-07-05T00:00:00.000Z",
    occurrences: 1,
    acknowledgedAt: "2026-07-06T00:00:00.000Z",
  },
];

function wsWithInsights() {
  return { ...emptyWorkspace(), insights: SAMPLE_INSIGHTS };
}

// --- JSON round-trip ----------------------------------------------------------

describe("JSON codec — insights", () => {
  it("round-trips insights", () => {
    const restored = jsonToWorkspace(workspaceToJson(wsWithInsights()));
    expect(restored.insights).toEqual(SAMPLE_INSIGHTS);
  });

  it("insight-less workspace has no insights key in JSON output", () => {
    expect(workspaceToJson(emptyWorkspace())).not.toContain("insights");
  });
});

// --- CSV round-trip -----------------------------------------------------------

describe("CSV codec — insights", () => {
  it("round-trips insights on the storage path", () => {
    const restored = csvToWorkspace(workspaceToCsv(wsWithInsights()));
    expect(restored.insights).toEqual(SAMPLE_INSIGHTS);
  });

  it("insight-less workspace emits no # INSIGHTS section", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# INSIGHTS");
  });

  it("is EXPORTED when the export section is enabled, omitted when disabled", () => {
    const on = { ...defaultExportConfig, insights: true };
    const off = { ...defaultExportConfig, insights: false };
    expect(workspaceToCsv(wsWithInsights(), on)).toContain("# INSIGHTS");
    expect(workspaceToCsv(wsWithInsights(), off)).not.toContain("# INSIGHTS");
  });
});

// --- Markdown round-trip ------------------------------------------------------

describe("Markdown codec — insights", () => {
  it("round-trips insights on the storage path", () => {
    const restored = markdownToWorkspace(workspaceToMarkdown(wsWithInsights()));
    expect(restored.insights).toEqual(SAMPLE_INSIGHTS);
  });

  it("insight-less workspace emits no ## Insights section", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Insights");
  });

  it("is EXPORTED when the export section is enabled, omitted when disabled", () => {
    const on = { ...defaultExportConfig, insights: true };
    const off = { ...defaultExportConfig, insights: false };
    expect(workspaceToMarkdown(wsWithInsights(), on)).toContain("## Insights");
    expect(workspaceToMarkdown(wsWithInsights(), off)).not.toContain("## Insights");
  });
});

// --- Byte-stability -----------------------------------------------------------

describe("insights byte-stability (empty ⇒ no section)", () => {
  it("CSV of an insights:[] workspace equals the field-removed workspace", () => {
    const withField = { ...emptyWorkspace(), insights: [] as Insight[] };
    const withoutField = emptyWorkspace();
    expect(workspaceToCsv(withField)).toBe(workspaceToCsv(withoutField));
  });

  it("Markdown of an insights:[] workspace equals the field-removed workspace", () => {
    const withField = { ...emptyWorkspace(), insights: [] as Insight[] };
    const withoutField = emptyWorkspace();
    expect(workspaceToMarkdown(withField)).toBe(workspaceToMarkdown(withoutField));
  });
});
