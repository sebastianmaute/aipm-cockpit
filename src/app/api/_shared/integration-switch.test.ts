// §762 — every route of a switched-off integration refuses before it does anything.
import { describe, expect, it } from "vitest";
import { refuseIfDisabled } from "./integration-switch";
import { classifyJiraError, JiraApiError } from "../../jira-api";

describe("refuseIfDisabled", () => {
  it("lets a request through when the setting does not name the integration", () => {
    expect(refuseIfDisabled("jira", {})).toBeNull();
    expect(refuseIfDisabled("jira", { AIPM_DISABLED_INTEGRATIONS: "ecb,stt" })).toBeNull();
  });

  it("refuses a named integration with 503 and the integration-disabled code", async () => {
    const res = refuseIfDisabled("ecb", { AIPM_DISABLED_INTEGRATIONS: "jira, ECB" });
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: "integration-disabled" });
  });

  it("reads the setting at call time, not once at load", () => {
    const env: Record<string, string | undefined> = {};
    expect(refuseIfDisabled("timelog", env)).toBeNull();
    env.AIPM_DISABLED_INTEGRATIONS = "timelog";
    expect(refuseIfDisabled("timelog", env)?.status).toBe(503);
  });

  it("is never read as a rejected token, so no client writes tokenInvalidAt (review I1)", () => {
    const status = refuseIfDisabled("jira", { AIPM_DISABLED_INTEGRATIONS: "jira" })?.status ?? 0;
    // The Jira client's classifier, and the TimeLog sync's own 401/403 test.
    expect(classifyJiraError(new JiraApiError(status, { error: "integration-disabled" }))).not.toBe("auth");
    expect([401, 403]).not.toContain(status);
  });
});
