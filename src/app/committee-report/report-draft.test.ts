import { describe, it, expect } from "vitest";
import { REPORT_TOOL, parseMeetingReport, buildMeetingReportPrompt } from "./report-draft";
import type { DashboardModel } from "../dashboard";

const MODEL = {
  overall: { computed: "A", effective: "R", overridden: true },
  schedule: { computed: "A", effective: "A", overridden: false },
  budget: { computed: "G", effective: "G", overridden: false },
  scope: { computed: "G", effective: "G", overridden: false },
  changes: { pending: 1, approved: 2, implemented: 0, total: 3 },
  topChanges: [
    { id: 1, title: "Rescope phase 2", status: "pending" },
    { id: 2, title: "Add QA gate", status: "approved" },
  ],
  progress: { total: 10, completed: 4, percent: 40, counts: { R: 1, A: 2, G: 7 } },
  burn: null,
  burndown: null,
  evm: {},
  topRaid: [],
  openRaidCount: 5,
  overdue: [{ id: 1 }, { id: 2 }, { id: 3 }],
  dueSoon: [{ id: 4 }],
  overdueMilestones: [{ id: 1, name: "Kickoff", date: "2026-06-01" }],
  atRiskMilestones: [],
  dueSoonMilestones: [{ id: 2, name: "Go-live", date: "2026-07-20" }],
  recentActivity: [],
  narrative: { text: "" },
} as unknown as DashboardModel;

describe("REPORT_TOOL", () => {
  it("is the write_status_report forced tool requiring html", () => {
    expect(REPORT_TOOL.name).toBe("write_status_report");
    expect(REPORT_TOOL.input_schema.required).toContain("html");
    expect(REPORT_TOOL.input_schema.properties.html.type).toBe("string");
  });
});

describe("parseMeetingReport", () => {
  it("strips control chars and trims", () => {
    expect(parseMeetingReport("<p>Hi</p>\x00\x07 ")).toBe("<p>Hi</p>");
  });
  it("caps length at 100_000", () => {
    const long = "x".repeat(200_000);
    expect(parseMeetingReport(long)!.length).toBeLessThanOrEqual(100_000);
  });
  it("returns null for non-string and empty", () => {
    expect(parseMeetingReport(undefined)).toBeNull();
    expect(parseMeetingReport(123)).toBeNull();
    expect(parseMeetingReport("   ")).toBeNull();
  });
});

describe("buildMeetingReportPrompt", () => {
  it("weaves in the agenda and key metrics", () => {
    const p = buildMeetingReportPrompt(MODEL, "Budget review\nStaffing", "en-US");
    expect(p).toContain("Budget review");
    expect(p).toContain("Staffing");
    // overall RAG effective = R -> Red
    expect(p).toContain("Red");
    // progress percent
    expect(p).toContain("40");
    // overdue count (3) + open RAID (5)
    expect(p).toContain("3");
    expect(p).toContain("5");
    // top change woven in
    expect(p).toContain("Rescope phase 2");
    // milestone bucket woven in
    expect(p).toContain("Go-live");
    // never leaks a key
    expect(p).not.toMatch(/sk-ant/);
  });
});
