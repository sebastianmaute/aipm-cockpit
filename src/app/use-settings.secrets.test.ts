import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { writeSettings, SETTINGS_KEY, hydrateSecretsInto } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { sealDevice, sealPassphrase } from "./secrets";
import { saveSealed } from "./secrets-store";

afterEach(() => localStorage.clear());

describe("writeSettings secret blanking", () => {
  it("never persists apiKey or turso authToken into lop-app:settings", () => {
    writeSettings({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-secret" },
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tok-secret" },
      },
    });
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.ai.apiKey).toBe("");
    expect(persisted.integrations.turso.authToken ?? "").toBe("");
    expect(persisted.integrations.turso.databaseUrl).toBe("libsql://x");
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

  it("hydrateSecretsInto leaves a passphrase-locked secret empty", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", "sk-live", "pw"));
    const merged = await hydrateSecretsInto({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "" },
    });
    expect(merged.ai.apiKey).toBe("");
  });
});
