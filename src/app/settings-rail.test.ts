import { describe, expect, it } from "vitest";
import { isBranchActive, type RailEntry } from "./settings-rail";

const RAIL: RailEntry<string>[] = [
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "ai", labelKey: "settingsSectionAi" },
  { id: "aiGuides", labelKey: "aiGuidesHeading", parent: "ai" },
  { id: "aiViews", labelKey: "aiViewsTitle", parent: "ai" },
  { id: "scheduledJobs", labelKey: "scheduledJobsTitle", parent: "ai" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
];

describe("isBranchActive", () => {
  it("is true when the parent itself is active", () => {
    expect(isBranchActive("ai", "ai", RAIL)).toBe(true);
  });

  it("is true when any child of the parent is active", () => {
    expect(isBranchActive("aiGuides", "ai", RAIL)).toBe(true);
    expect(isBranchActive("aiViews", "ai", RAIL)).toBe(true);
    expect(isBranchActive("scheduledJobs", "ai", RAIL)).toBe(true);
  });

  it("is false for an unrelated top-level section", () => {
    expect(isBranchActive("integrations", "ai", RAIL)).toBe(false);
    expect(isBranchActive("general", "ai", RAIL)).toBe(false);
  });

  it("is false for an id that is not in the rail at all", () => {
    // `jira` is a real SectionId with no rail entry — it must not open a branch.
    expect(isBranchActive("jira", "ai", RAIL)).toBe(false);
  });

  it("does not open a branch whose parent is a different section", () => {
    const nested: RailEntry<string>[] = [
      ...RAIL,
      { id: "otherChild", labelKey: "x", parent: "integrations" },
    ];
    expect(isBranchActive("otherChild", "ai", nested)).toBe(false);
    expect(isBranchActive("otherChild", "integrations", nested)).toBe(true);
  });
});
