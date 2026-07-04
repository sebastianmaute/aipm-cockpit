import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as secrets from "./secrets";
import { sealDevice, sealPassphrase } from "./secrets";
import { saveSealed, loadSealed, removeSealed, readDeviceSecret, isPassphraseLocked, migratePlaintextSecrets } from "./secrets-store";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("secrets-store", () => {
  it("saves, reads back a device secret, and reports not passphrase-locked", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    expect(loadSealed("anthropicApiKey")?.wrap).toBe("device");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
    expect(isPassphraseLocked("anthropicApiKey")).toBe(false);
  });

  it("returns null for a passphrase secret on device read, and flags it locked", async () => {
    saveSealed(await sealPassphrase("tursoAuthToken", "tok-1", "pw"));
    expect(await readDeviceSecret("tursoAuthToken")).toBeNull();
    expect(isPassphraseLocked("tursoAuthToken")).toBe(true);
  });

  it("removeSealed deletes the entry", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    removeSealed("anthropicApiKey");
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("migrates plaintext apiKey + authToken + jiraApiToken + timelogApiToken + sttApiKey to device-sealed secrets, blanks input", async () => {
    const blanked = await migratePlaintextSecrets({ apiKey: "sk-x", authToken: "tok-y", jiraApiToken: "jira-z", timelogApiToken: "timelog-z", sttApiKey: "stt-z" });
    expect(blanked).toEqual({ apiKey: "", authToken: "", jiraApiToken: "", timelogApiToken: "", sttApiKey: "" });
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-x");
    expect(await readDeviceSecret("tursoAuthToken")).toBe("tok-y");
    expect(await readDeviceSecret("jiraApiToken")).toBe("jira-z");
    expect(await readDeviceSecret("timelogApiToken")).toBe("timelog-z");
    expect(await readDeviceSecret("sttApiKey")).toBe("stt-z");
  });

  it("is a no-op when inputs are already blank", async () => {
    const blanked = await migratePlaintextSecrets({ apiKey: "", authToken: undefined });
    expect(blanked).toEqual({ apiKey: "", authToken: "", jiraApiToken: "", timelogApiToken: "", sttApiKey: "" });
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(loadSealed("jiraApiToken")).toBeNull();
    expect(loadSealed("timelogApiToken")).toBeNull();
    expect(loadSealed("sttApiKey")).toBeNull();
  });

  it("migratePlaintextSecrets does not clobber an already-sealed (passphrase) secret", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", "sk-orig", "pw"));
    await migratePlaintextSecrets({ apiKey: "sk-new-plaintext" });
    expect(loadSealed("anthropicApiKey")?.wrap).toBe("passphrase"); // untouched
  });

  it("does not reject when sealing fails (no IndexedDB/WebCrypto) and keeps the plaintext un-migrated", async () => {
    // Simulate a degraded env: sealDevice rejects (e.g. indexedDB.open / crypto.subtle absent).
    vi.spyOn(secrets, "sealDevice").mockRejectedValue(new Error("no IndexedDB"));
    const result = await migratePlaintextSecrets({ apiKey: "sk-x", authToken: "tok-y", jiraApiToken: "jira-z", timelogApiToken: "timelog-z", sttApiKey: "stt-z" });
    // Failed seals return the ORIGINAL plaintext so the caller keeps it for the session.
    expect(result).toEqual({ apiKey: "sk-x", authToken: "tok-y", jiraApiToken: "jira-z", timelogApiToken: "timelog-z", sttApiKey: "stt-z" });
    // Nothing was persisted to the secret store.
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(loadSealed("tursoAuthToken")).toBeNull();
  });

  it("ignores a corrupt/garbage secrets record in localStorage", async () => {
    localStorage.setItem("lop-app:secrets", JSON.stringify({ anthropicApiKey: { junk: true } }));
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });
});
