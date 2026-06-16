import { describe, expect, it } from "vitest";
import {
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
  sanitizeIntegrations,
} from "./settings-types";

describe("sanitizeIntegrations", () => {
  it("returns defaults for undefined input", () => {
    expect(sanitizeIntegrations(undefined)).toEqual(defaultIntegrations);
  });

  it("returns defaults for null input", () => {
    expect(sanitizeIntegrations(null)).toEqual(defaultIntegrations);
  });

  it("returns defaults for non-object input", () => {
    expect(sanitizeIntegrations(42)).toEqual(defaultIntegrations);
    expect(sanitizeIntegrations("hello")).toEqual(defaultIntegrations);
  });

  it("fills missing m365 fields with false defaults", () => {
    const result = sanitizeIntegrations({});
    expect(result.m365).toEqual(defaultM365Integrations);
    expect(result.turso).toEqual(defaultTursoIntegrations);
  });

  it("preserves provided booleans", () => {
    const result = sanitizeIntegrations({ m365: { enabled: true, sharepoint: true } });
    expect(result.m365?.enabled).toBe(true);
    expect(result.m365?.sharepoint).toBe(true);
    expect(result.m365?.outlookContacts).toBe(false);
    expect(result.m365?.outlookCalendar).toBe(false);
  });

  it("preserves provided string fields", () => {
    const result = sanitizeIntegrations({
      m365: { enabled: true, clientId: "abc123", tenantId: "common" },
    });
    expect(result.m365?.clientId).toBe("abc123");
    expect(result.m365?.tenantId).toBe("common");
  });

  it("rejects non-string clientId / tenantId", () => {
    const result = sanitizeIntegrations({ m365: { enabled: true, clientId: 42 } });
    expect(result.m365?.clientId).toBeUndefined();
  });
});

describe("sanitizeIntegrations outlookCalendarPush", () => {
  it("defaults outlookCalendarPush to false", () => {
    expect(sanitizeIntegrations({ m365: {} }).m365!.outlookCalendarPush).toBe(false);
  });
  it("preserves outlookCalendarPush=true and coerces non-bool to false", () => {
    expect(sanitizeIntegrations({ m365: { outlookCalendarPush: true } }).m365!.outlookCalendarPush).toBe(true);
    expect(sanitizeIntegrations({ m365: { outlookCalendarPush: "yes" } }).m365!.outlookCalendarPush).toBe(false);
  });
});
