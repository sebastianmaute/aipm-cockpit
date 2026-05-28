import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMsalConfig } from "./msal-config";

describe("getMsalConfig", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when no clientId is available", () => {
    expect(getMsalConfig()).toBeNull();
    expect(getMsalConfig("", "")).toBeNull();
  });

  it("uses env var when set", () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "env-client");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "env-tenant");
    expect(getMsalConfig()).toEqual({ clientId: "env-client", tenantId: "env-tenant" });
  });

  it("falls back to settings when env vars absent", () => {
    expect(getMsalConfig("settings-client", "settings-tenant")).toEqual({
      clientId: "settings-client",
      tenantId: "settings-tenant",
    });
  });

  it("env var wins over settings", () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "env-client");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "env-tenant");
    expect(getMsalConfig("settings-client", "settings-tenant")).toEqual({
      clientId: "env-client",
      tenantId: "env-tenant",
    });
  });

  it("defaults tenantId to 'common' when neither env nor settings provide it", () => {
    expect(getMsalConfig("settings-client")).toEqual({
      clientId: "settings-client",
      tenantId: "common",
    });
  });

  it("partial env (clientId only) uses 'common' for tenant", () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "env-client");
    expect(getMsalConfig()).toEqual({ clientId: "env-client", tenantId: "common" });
  });
});
