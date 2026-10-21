// §762 — every route of a switched-off integration refuses before it does anything.
import { describe, expect, it } from "vitest";
import { refuseIfDisabled } from "./integration-switch";

describe("refuseIfDisabled", () => {
  it("lets a request through when the setting does not name the integration", () => {
    expect(refuseIfDisabled("jira", {})).toBeNull();
    expect(refuseIfDisabled("jira", { AIPM_DISABLED_INTEGRATIONS: "ecb,stt" })).toBeNull();
  });

  it("refuses a named integration with 403 and the integration-disabled code", async () => {
    const res = refuseIfDisabled("ecb", { AIPM_DISABLED_INTEGRATIONS: "jira, ECB" });
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "integration-disabled" });
  });

  it("reads the setting at call time, not once at load", () => {
    const env: Record<string, string | undefined> = {};
    expect(refuseIfDisabled("timelog", env)).toBeNull();
    env.AIPM_DISABLED_INTEGRATIONS = "timelog";
    expect(refuseIfDisabled("timelog", env)?.status).toBe(403);
  });
});
