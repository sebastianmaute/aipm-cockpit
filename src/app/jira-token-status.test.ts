import { afterEach, describe, it, expect } from "vitest";
import { setDisabledIntegrations } from "./integration-switches";
import { getJiraTokenAlert, daysUntil } from "./jira-token-status";
import type { JiraConfig, NotificationsConfig } from "./settings-types";

// Pure helper mirroring the Jira-token banner gating condition in use-reminder-banners.tsx:
// !isPopout && jiraTokenAlert && !snoozed && !dismissed && jiraTokenError.enabled
function shouldShowJiraBanner(opts: {
  alert: ReturnType<typeof getJiraTokenAlert>;
  snoozed: boolean;
  dismissed: boolean;
  notifications: Pick<NotificationsConfig, "jiraTokenError">;
}): boolean {
  return (
    opts.alert !== null &&
    !opts.snoozed &&
    !opts.dismissed &&
    opts.notifications.jiraTokenError.enabled
  );
}

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

describe("Jira token banner gating (jiraTokenError.enabled)", () => {
  const expiringAlert = getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-05-30" }), TODAY, 7);

  it("shows when jiraTokenError.enabled=true and alert present", () => {
    expect(shouldShowJiraBanner({
      alert: expiringAlert,
      snoozed: false,
      dismissed: false,
      notifications: { jiraTokenError: { enabled: true } },
    })).toBe(true);
  });

  it("does NOT show when jiraTokenError.enabled=false even with a valid alert", () => {
    expect(shouldShowJiraBanner({
      alert: expiringAlert,
      snoozed: false,
      dismissed: false,
      notifications: { jiraTokenError: { enabled: false } },
    })).toBe(false);
  });

  it("does NOT show when alert is null", () => {
    expect(shouldShowJiraBanner({
      alert: null,
      snoozed: false,
      dismissed: false,
      notifications: { jiraTokenError: { enabled: true } },
    })).toBe(false);
  });

  it("does NOT show when snoozed=true", () => {
    expect(shouldShowJiraBanner({
      alert: expiringAlert,
      snoozed: true,
      dismissed: false,
      notifications: { jiraTokenError: { enabled: true } },
    })).toBe(false);
  });

  it("does NOT show when dismissed=true", () => {
    expect(shouldShowJiraBanner({
      alert: expiringAlert,
      snoozed: false,
      dismissed: true,
      notifications: { jiraTokenError: { enabled: true } },
    })).toBe(false);
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

describe("§762 — getJiraTokenAlert with Jira switched off by the deployment", () => {
  afterEach(() => setDisabledIntegrations([]));
  const invalid = () => cfg({ enabled: true, tokenInvalidAt: "2026-05-26T10:00:00Z", tokenExpiresAt: "2026-05-27" });
  it("§762 — still alerts when Jira is on (positive control)", () => {
    expect(getJiraTokenAlert(invalid(), TODAY, 7)?.state).toBe("invalid");
  });
  it("§762 — gives no alert when jira is switched off, though enabled and tokenInvalidAt are set", () => {
    setDisabledIntegrations(["jira"]);
    expect(getJiraTokenAlert(invalid(), TODAY, 7)).toBeNull();
  });
  it("§762 — another switched-off integration does not silence the alert", () => {
    setDisabledIntegrations(["timelog"]);
    expect(getJiraTokenAlert(invalid(), TODAY, 7)?.state).toBe("invalid");
  });
});
