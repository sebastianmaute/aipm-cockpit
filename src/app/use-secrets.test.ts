import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as secrets from "./secrets";
import { type SealedSecret, sealDevice, sealPassphrase } from "./secrets";
import { saveSecretValue, setSecretPassphrase, unlockSecret } from "./use-secrets";
import { loadSealed, readDeviceSecret, removeSealed, saveSealed } from "./secrets-store";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("use-secrets controller", () => {
  it("saveSecretValue device-seals and stores", async () => {
    expect(await saveSecretValue("anthropicApiKey", "sk-1", "device")).toBe(true);
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
  });
  it("setSecretPassphrase re-seals an existing value under a passphrase", async () => {
    await saveSecretValue("tursoAuthToken", "tok-1", "device");
    expect(await setSecretPassphrase("tursoAuthToken", "tok-1", "pw")).toBe(true);
    expect(loadSealed("tursoAuthToken")?.wrap).toBe("passphrase");
  });
  it("unlockSecret returns the plaintext for a correct passphrase, null for wrong", async () => {
    await setSecretPassphrase("anthropicApiKey", "sk-1", "pw");
    expect(await unlockSecret("anthropicApiKey", "pw")).toBe("sk-1");
    expect(await unlockSecret("anthropicApiKey", "nope")).toBeNull();
  });
  it("saveSecretValue in passphrase mode still requires a passphrase", async () => {
    await expect(saveSecretValue("anthropicApiKey", "sk-1", "passphrase")).rejects.toThrow("passphrase required");
  });
});

// §609 — the seal awaits WebCrypto; the tests hold it open with a hand-resolved promise so a
// clear or a newer seal can land in between. The ciphertexts are real (sealed BEFORE the spy).
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("use-secrets — a late seal never resurrects a cleared secret (§609)", () => {
  it("a clear while a device seal is in flight wins: nothing is stored and the save reports false", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-old");
    const seal = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(seal.promise);

    const saving = saveSecretValue("anthropicApiKey", "sk-old", "device");
    removeSealed("anthropicApiKey");
    seal.resolve(sealed);

    expect(await saving).toBe(false);
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });

  it("the newest keystroke wins even when the older seal finishes last", async () => {
    const sealedA = await sealDevice("anthropicApiKey", "sk-A");
    const sealedB = await sealDevice("anthropicApiKey", "sk-B");
    const sealA = deferred<SealedSecret>();
    const sealB = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(sealA.promise).mockReturnValueOnce(sealB.promise);

    const savingA = saveSecretValue("anthropicApiKey", "sk-A", "device");
    const savingB = saveSecretValue("anthropicApiKey", "sk-B", "device");
    sealB.resolve(sealedB);
    expect(await savingB).toBe(true);
    sealA.resolve(sealedA);
    expect(await savingA).toBe(false);

    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-B");
  });

  it("the newest keystroke wins when the older seal finishes first, too", async () => {
    const sealedA = await sealDevice("anthropicApiKey", "sk-A");
    const sealedB = await sealDevice("anthropicApiKey", "sk-B");
    const sealA = deferred<SealedSecret>();
    const sealB = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(sealA.promise).mockReturnValueOnce(sealB.promise);

    const savingA = saveSecretValue("anthropicApiKey", "sk-A", "device");
    const savingB = saveSecretValue("anthropicApiKey", "sk-B", "device");
    sealA.resolve(sealedA);
    expect(await savingA).toBe(false);
    sealB.resolve(sealedB);
    expect(await savingB).toBe(true);

    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-B");
  });

  it("setSecretPassphrase: a clear while the seal is in flight wins", async () => {
    const sealed = await sealPassphrase("tursoAuthToken", "tok-old", "pw");
    const seal = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealPassphrase").mockReturnValueOnce(seal.promise);

    const saving = setSecretPassphrase("tursoAuthToken", "tok-old", "pw");
    removeSealed("tursoAuthToken");
    seal.resolve(sealed);

    expect(await saving).toBe(false);
    expect(loadSealed("tursoAuthToken")).toBeNull();
  });

  it("saveSecretValue in passphrase mode: a clear while the seal is in flight wins", async () => {
    const sealed = await sealPassphrase("tursoAuthToken", "tok-old", "pw");
    const seal = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealPassphrase").mockReturnValueOnce(seal.promise);

    const saving = saveSecretValue("tursoAuthToken", "tok-old", "passphrase", "pw");
    removeSealed("tursoAuthToken");
    seal.resolve(sealed);

    expect(await saving).toBe(false);
    expect(loadSealed("tursoAuthToken")).toBeNull();
  });

  it("clearing one id leaves another id's seal in flight untouched", async () => {
    const sealedKey = await sealDevice("anthropicApiKey", "sk-1");
    const sealedStt = await sealDevice("sttApiKey", "stt-1");
    const sealKey = deferred<SealedSecret>();
    const sealStt = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealDevice").mockReturnValueOnce(sealKey.promise).mockReturnValueOnce(sealStt.promise);

    const savingKey = saveSecretValue("anthropicApiKey", "sk-1", "device");
    const savingStt = saveSecretValue("sttApiKey", "stt-1", "device");
    removeSealed("anthropicApiKey");
    sealKey.resolve(sealedKey);
    sealStt.resolve(sealedStt);

    expect(await savingKey).toBe(false);
    expect(await savingStt).toBe(true);
    expect(loadSealed("anthropicApiKey")).toBeNull();
    expect(await readDeviceSecret("sttApiKey")).toBe("stt-1");
  });

  // Round 2 M4 — the documented "no fallback": when the NEWEST seal fails, the older one it
  // superseded still resolves false and writes nothing; the previous record stays.
  it("when the newest seal rejects, the older in-flight seal still writes nothing", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-prev"));
    const sealedA = await sealDevice("anthropicApiKey", "sk-A");
    const sealA = deferred<SealedSecret>();
    vi.spyOn(secrets, "sealDevice")
      .mockReturnValueOnce(sealA.promise)
      .mockRejectedValueOnce(new Error("crypto unavailable"));

    const savingA = saveSecretValue("anthropicApiKey", "sk-A", "device");
    const savingB = saveSecretValue("anthropicApiKey", "sk-B", "device");
    await expect(savingB).rejects.toThrow("crypto unavailable");
    sealA.resolve(sealedA);

    expect(await savingA).toBe(false);
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-prev");
  });
});
