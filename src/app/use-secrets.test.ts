import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { saveSecretValue, setSecretPassphrase, unlockSecret } from "./use-secrets";
import { loadSealed, readDeviceSecret } from "./secrets-store";

afterEach(() => localStorage.clear());

describe("use-secrets controller", () => {
  it("saveSecretValue device-seals and stores", async () => {
    await saveSecretValue("anthropicApiKey", "sk-1", "device");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
  });
  it("setSecretPassphrase re-seals an existing value under a passphrase", async () => {
    await saveSecretValue("tursoAuthToken", "tok-1", "device");
    await setSecretPassphrase("tursoAuthToken", "tok-1", "pw");
    expect(loadSealed("tursoAuthToken")?.wrap).toBe("passphrase");
  });
  it("unlockSecret returns the plaintext for a correct passphrase, null for wrong", async () => {
    await setSecretPassphrase("anthropicApiKey", "sk-1", "pw");
    expect(await unlockSecret("anthropicApiKey", "pw")).toBe("sk-1");
    expect(await unlockSecret("anthropicApiKey", "nope")).toBeNull();
  });
});
