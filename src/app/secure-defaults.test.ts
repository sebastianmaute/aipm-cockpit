import { describe, expect, test } from "vitest";
import {
  defaultAiConfig,
  defaultIntegrations,
  defaultJiraConfig,
  defaultSettings,
} from "./settings-types";
import { defaultTimelogConfig } from "./timelog-types";

// Secure-by-default guard: every integration and every billed/background AI
// feature must ship OFF. A shipped default of `true` (or a truthy value where
// the code treats `!== true`/`=== true` as the gate) is a real regression —
// this test fails the moment one flips. See threat-model.md B1/B4.
describe("secure defaults — integrations and billed AI ship disabled", () => {
  test("AI master switch is off (undefined = off)", () => {
    expect(defaultAiConfig.enabled === true).toBe(false);
  });

  test("AI scheduled jobs are off (opt-in, recurring billed calls)", () => {
    expect(defaultAiConfig.scheduledJobs === true).toBe(false);
  });

  test("Jira integration is off", () => {
    expect(defaultJiraConfig.enabled).toBe(false);
  });

  test("Timelog integration is off", () => {
    expect(defaultTimelogConfig.enabled).toBe(false);
  });

  test("M365 integration is off", () => {
    expect(defaultIntegrations.m365?.enabled === true).toBe(false);
  });

  test("Turso integration is off", () => {
    expect(defaultIntegrations.turso?.enabled === true).toBe(false);
  });

  test("no calendar entity ships with auto-sync enabled", () => {
    // outlookCalendar is optional per-device; absent = nothing auto-syncs.
    const cal = defaultSettings.outlookCalendar ?? {};
    for (const cfg of Object.values(cal)) {
      expect(cfg?.auto === true).toBe(false);
    }
  });
});
