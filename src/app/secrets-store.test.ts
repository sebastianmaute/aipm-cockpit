import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { sealDevice, sealPassphrase } from "./secrets";
import { saveSealed, loadSealed, removeSealed, readDeviceSecret, isPassphraseLocked } from "./secrets-store";

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
});
