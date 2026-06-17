import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { sealDevice, sealPassphrase } from "./secrets";
import { saveSealed, loadSealed, removeSealed, readDeviceSecret, isPassphraseLocked, migratePlaintextSecrets } from "./secrets-store";

afterEach(() => localStorage.clear());

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

  it("migrates plaintext apiKey + authToken to device-sealed secrets, blanks input", async () => {
    const blanked = await migratePlaintextSecrets({ apiKey: "sk-x", authToken: "tok-y" });
    expect(blanked).toEqual({ apiKey: "", authToken: "" });
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-x");
    expect(await readDeviceSecret("tursoAuthToken")).toBe("tok-y");
  });

  it("is a no-op when inputs are already blank", async () => {
    const blanked = await migratePlaintextSecrets({ apiKey: "", authToken: undefined });
    expect(blanked).toEqual({ apiKey: "", authToken: "" });
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("migratePlaintextSecrets does not clobber an already-sealed (passphrase) secret", async () => {
    saveSealed(await sealPassphrase("anthropicApiKey", "sk-orig", "pw"));
    await migratePlaintextSecrets({ apiKey: "sk-new-plaintext" });
    expect(loadSealed("anthropicApiKey")?.wrap).toBe("passphrase"); // untouched
  });

  it("ignores a corrupt/garbage secrets record in localStorage", async () => {
    localStorage.setItem("lop-app:secrets", JSON.stringify({ anthropicApiKey: { junk: true } }));
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });
});
