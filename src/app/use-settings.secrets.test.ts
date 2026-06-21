import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { writeSettings, SETTINGS_KEY, hydrateSecretsInto, useSettings } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { sealDevice, sealPassphrase } from "./secrets";
import { saveSealed } from "./secrets-store";

afterEach(() => localStorage.clear());

describe("writeSettings secret blanking", () => {
  it("never persists apiKey, turso authToken, or jira apiToken into lop-app:settings", () => {
    writeSettings({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-secret" },
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tok-secret" },
      },
      jira: { ...defaultSettings.jira, siteUrl: "https://x.atlassian.net", email: "a@b.c", apiToken: "jira-secret" },
    });
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.ai.apiKey).toBe("");
    expect(persisted.integrations.turso.authToken ?? "").toBe("");
    expect(persisted.integrations.turso.databaseUrl).toBe("libsql://x");
    // Jira token blanked, but identifying (non-secret) fields preserved.
    expect(persisted.jira.apiToken ?? "").toBe("");
    expect(persisted.jira.siteUrl).toBe("https://x.atlassian.net");
    expect(persisted.jira.email).toBe("a@b.c");
  });
});

describe("persist effect secret blanking", () => {
  it("persist effect never writes plaintext secrets to lop-app:settings", async () => {
    const { result } = renderHook(() => useSettings());

    // Wait for the mount-load hydration gate to lift; the persist effect only
    // runs after hydration, so a pre-hydration write would be a false pass.
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    // Put both at-rest secrets into in-memory settings via the hook's setter.
    // This is exactly what happens after a load decrypts the device-wrapped
    // secrets back into memory, then the user changes any setting.
    await act(async () => {
      result.current.setSettings((prev) => ({
        ...prev,
        ai: { ...prev.ai, apiKey: "sk-plaintext-secret" },
        integrations: {
          ...prev.integrations,
          turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tok-plaintext-secret" },
        },
      }));
    });

    // The persist effect must have routed the write through writeSettings,
    // blanking both secrets in localStorage while keeping non-secret fields.
    await waitFor(() => {
      const raw = localStorage.getItem(SETTINGS_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.ai.apiKey).toBe("");
      expect(parsed.integrations?.turso?.authToken ?? "").toBe("");
      expect(parsed.integrations.turso.databaseUrl).toBe("libsql://x");
    });
  });
});

describe("hydrateSecretsInto", () => {
  it("hydrateSecretsInto merges device secrets into in-memory settings", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-live"));
    const merged = await hydrateSecretsInto({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "" },
    });
    expect(merged.ai.apiKey).toBe("sk-live");
  });

  it("hydrateSecretsInto merges the device-sealed jira apiToken into settings.jira", async () => {
    saveSealed(await sealDevice("jiraApiToken", "jira-live"));
    const merged = await hydrateSecretsInto({
      ...defaultSettings,
      jira: { ...defaultSettings.jira, apiToken: "" },
    });
    expect(merged.jira.apiToken).toBe("jira-live");
  });

  it("hydrateSecretsInto leaves a passphrase-locked secret empty", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", "sk-live", "pw"));
    const merged = await hydrateSecretsInto({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "" },
    });
    expect(merged.ai.apiKey).toBe("");
  });
});
