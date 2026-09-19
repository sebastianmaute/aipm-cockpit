import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { writeSettings, SETTINGS_KEY, hydrateSecretsInto, useSettings } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { defaultTimelogConfig } from "./timelog-types";
import { sealDevice, sealPassphrase, SECRET_IDS } from "./secrets";
import { saveSealed } from "./secrets-store";
import * as secretsStoreModule from "./secrets-store";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("writeSettings secret blanking", () => {
  it("never persists apiKey, turso authToken, or jira apiToken into aipm-cockpit:settings", () => {
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
  it("persist effect never writes plaintext secrets to aipm-cockpit:settings", async () => {
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

  it("hydrateSecretsInto merges the device-sealed timelog apiToken into settings.timelog", async () => {
    saveSealed(await sealDevice("timelogApiToken", "timelog-live"));
    const merged = await hydrateSecretsInto({
      ...defaultSettings,
      timelog: { ...defaultTimelogConfig, apiToken: "" },
    });
    expect(merged.timelog?.apiToken).toBe("timelog-live");
  });

  it("hydrateSecretsInto merges the device-sealed STT apiKey into settings.dictation", async () => {
    saveSealed(await sealDevice("sttApiKey", "stt-live"));
    const merged = await hydrateSecretsInto({
      ...defaultSettings,
      dictation: { engine: "stt", sttApiKey: "" },
    });
    expect(merged.dictation?.sttApiKey).toBe("stt-live");
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

describe("writeSettings timelog token blanking", () => {
  it("writeSettings blanks settings.timelog.apiToken on disk", () => {
    writeSettings({
      ...defaultSettings,
      timelog: { ...defaultTimelogConfig, apiToken: "secret" },
    });
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.timelog.apiToken ?? "").toBe("");
  });
});

describe("writeSettings STT apiKey blanking", () => {
  it("writeSettings blanks settings.dictation.sttApiKey on disk", () => {
    writeSettings({
      ...defaultSettings,
      dictation: { engine: "stt", sttApiKey: "stt-plaintext-secret" },
    });
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.dictation.sttApiKey ?? "").toBe("");
  });
});

describe("on-load unreadable-secret probe", () => {
  // §567 (fix round 1) — the mount-load probe that flags a sealed-but-
  // unreadable secret used to carry its OWN five-id list, a third hardcoded
  // copy alongside isSealedSecret/readStore. A missed id there never gets
  // probed, so a corrupt secret for that id is silently reported as
  // "never configured" instead of "lost". Generated from SECRET_IDS, so a
  // sixth id is covered here without being named.
  it("probes every id in SECRET_IDS after hydration", async () => {
    // The probe only runs on the mount-load path that finds a PERSISTED
    // settings blob (a fresh-install default-settings mount takes the
    // no-probe branch), so seed one first.
    writeSettings(defaultSettings);
    const spy = vi.spyOn(secretsStoreModule, "probeDeviceSecretReadable");
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await waitFor(() => {
      const probed = spy.mock.calls.map((call) => call[0]).sort();
      expect(probed).toEqual([...SECRET_IDS].sort());
    });
  });
});
