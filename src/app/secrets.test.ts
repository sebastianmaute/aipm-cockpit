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
    // Flip exactly one byte of the GCM ciphertext (the trailing 16 bytes are the
    // auth tag) without changing its length. AES-GCM verification ALWAYS fails on
    // any single-byte change, so tamper detection is deterministic.
    const bytes = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    const flipped = { ...sealed, ciphertext: btoa(s) };
    await expect(openDevice(flipped as typeof sealed)).rejects.toBeInstanceOf(SecretUnlockError);
  });
});
