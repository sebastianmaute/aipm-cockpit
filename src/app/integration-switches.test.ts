// §762 — a deployment switches server-side integrations off with one server setting.
import { afterEach, describe, expect, it } from "vitest";
import {
  DISABLED_INTEGRATIONS_ENV,
  INTEGRATION_IDS,
  isIntegrationDisabled,
  isJiraOn,
  parseDisabledIntegrations,
  setDisabledIntegrations,
} from "./integration-switches";

afterEach(() => setDisabledIntegrations([]));

describe("parseDisabledIntegrations", () => {
  it("reads a comma list, trimmed and case-folded, in registry order without repeats", () => {
    expect(parseDisabledIntegrations(" STT, jira ,ecb,jira")).toEqual(["jira", "ecb", "stt"]);
  });

  it("ignores unknown names and empty items", () => {
    expect(parseDisabledIntegrations("jira,,outlook, ,timelog")).toEqual(["jira", "timelog"]);
  });

  it("an unset or empty setting switches nothing off", () => {
    expect(parseDisabledIntegrations(undefined)).toEqual([]);
    expect(parseDisabledIntegrations("")).toEqual([]);
  });

  it("names the five integrations and the setting", () => {
    expect(INTEGRATION_IDS).toEqual(["jira", "confluence", "timelog", "ecb", "stt"]);
    expect(DISABLED_INTEGRATIONS_ENV).toBe("AIPM_DISABLED_INTEGRATIONS");
  });
});

describe("the deployment's switched-off set", () => {
  it("starts empty, so a deployment that sets nothing behaves as before", () => {
    for (const id of INTEGRATION_IDS) expect(isIntegrationDisabled(id)).toBe(false);
  });

  it("holds exactly the integrations it was given", () => {
    setDisabledIntegrations(["timelog", "stt"]);
    expect(INTEGRATION_IDS.filter(isIntegrationDisabled)).toEqual(["timelog", "stt"]);
  });

  it("isJiraOn needs the user's Jira switch AND the deployment allowing Jira", () => {
    expect(isJiraOn({ enabled: true })).toBe(true);
    expect(isJiraOn({ enabled: false })).toBe(false);
    expect(isJiraOn(undefined)).toBe(false);
    setDisabledIntegrations(["jira"]);
    expect(isJiraOn({ enabled: true })).toBe(false);
  });
});
