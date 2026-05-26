import { describe, it, expect } from "vitest";
import { getJiraTokenAlert, daysUntil } from "./jira-token-status";
import type { JiraConfig } from "./settings-menu";

function cfg(over: Partial<JiraConfig>): JiraConfig {
  return {
    enabled: true, siteUrl: "", email: "", apiToken: "", projectKey: "", projectName: "",
    issueTypes: [], assigneeMode: "currentUser", assigneeAccountId: "", assigneeDisplayName: "",
    tokenExpiresAt: "", ...over,
  } as JiraConfig;
}
const TODAY = "2026-05-26";

describe("getJiraTokenAlert", () => {
  it("returns null when Jira is disabled", () => {
    expect(getJiraTokenAlert(cfg({ enabled: false, tokenExpiresAt: "2026-05-27" }), TODAY, 7)).toBeNull();
  });
  it("returns null with no date and no invalid flag", () => {
    expect(getJiraTokenAlert(cfg({}), TODAY, 7)).toBeNull();
  });
  it("returns expiring when within lead days", () => {
    expect(getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-05-30" }), TODAY, 7))
      .toEqual({ state: "expiring", daysLeft: 4, date: "2026-05-30" });
  });
  it("returns null when beyond lead days", () => {
    expect(getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-07-01" }), TODAY, 7)).toBeNull();
  });
  it("returns expired when the date is past", () => {
    const a = getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-05-20" }), TODAY, 7);
    expect(a?.state).toBe("expired");
  });
  it("invalid overrides a still-future date", () => {
    const a = getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-12-31", tokenInvalidAt: "2026-05-26T10:00:00Z" }), TODAY, 7);
    expect(a?.state).toBe("invalid");
  });
});

describe("daysUntil", () => {
  it("returns whole-day difference", () => {
    expect(daysUntil("2026-05-30", "2026-05-26")).toBe(4);
    expect(daysUntil("2026-05-20", "2026-05-26")).toBe(-6);
  });
  it("returns null on an unparseable date", () => {
    expect(daysUntil("not-a-date", "2026-05-26")).toBeNull();
  });
});
