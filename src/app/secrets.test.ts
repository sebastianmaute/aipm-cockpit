import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { sealDevice, openDevice, sealPassphrase, openPassphrase, SecretUnlockError } from "./secrets";

describe("secrets", () => {
  it("round-trips a secret through the device key", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-ant-secret-123");
    expect(sealed.wrap).toBe("device");
    expect(sealed.ciphertext).not.toContain("sk-ant"); // ciphertext, not plaintext
    expect(await openDevice(sealed)).toBe("sk-ant-secret-123");
  });

  it("round-trips a secret through a passphrase", async () => {
    const sealed = await sealPassphrase("tursoAuthToken", "tok-abc", "correct horse");
    expect(sealed.wrap).toBe("passphrase");
    expect(sealed.salt).toBeTruthy();
    expect(sealed.kdf?.iters).toBe(600_000);
    expect(await openPassphrase(sealed, "correct horse")).toBe("tok-abc");
  });

  it("rejects a wrong passphrase with SecretUnlockError", async () => {
    const sealed = await sealPassphrase("tursoAuthToken", "tok-abc", "right");
    await expect(openPassphrase(sealed, "wrong")).rejects.toBeInstanceOf(SecretUnlockError);
  });

  it("openDevice rejects tampered ciphertext with SecretUnlockError", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-keep");
    const flipped = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith("A") ? "B" : "A") + "=" };
    await expect(openDevice(flipped as typeof sealed)).rejects.toBeInstanceOf(SecretUnlockError);
  });
});
