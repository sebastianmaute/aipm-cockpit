import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ChatCryptoError,
  generateChatKey,
  generateThreadKey,
  isChatCryptoAvailable,
  openText,
  sealText,
  unwrapForOperator,
  unwrapForOwner,
  wrapForOperator,
  wrapForOwner,
} from "./chat-crypto";

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function rsaPair(modulusLength = 3072): Promise<{ spkiB64: string; privateKey: CryptoKey }> {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey));
  return { spkiB64: bytesToB64(spki), privateKey: pair.privateKey };
}

describe("chat-crypto keys", () => {
  it("generates 32-byte keys that differ between calls", async () => {
    const a = await generateThreadKey();
    const b = await generateThreadKey();
    const c = await generateChatKey();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(c.length).toBe(32);
    expect(bytesToB64(a)).not.toBe(bytesToB64(b));
  });
});

describe("sealText / openText", () => {
  it("round-trips text, including non-ASCII", async () => {
    const key = await generateThreadKey();
    const text = "Grüße — chat line ✓";
    const envelope = await sealText(key, text);
    expect(envelope.startsWith("c1.")).toBe(true);
    expect(envelope.split(".")).toHaveLength(3);
    expect(envelope).not.toContain("chat line");
    expect(await openText(key, envelope)).toBe(text);
  });

  it("two seals of the same text differ (fresh IV)", async () => {
    const key = await generateThreadKey();
    const a = await sealText(key, "same");
    const b = await sealText(key, "same");
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("rejects a flipped ciphertext byte with ChatCryptoError", async () => {
    const key = await generateThreadKey();
    const [prefix, iv, ct] = (await sealText(key, "secret")).split(".");
    const bytes = b64ToBytes(ct);
    bytes[0] ^= 0x01;
    const tampered = [prefix, iv, bytesToB64(bytes)].join(".");
    // Control: the untampered envelope opens.
    expect(await openText(key, [prefix, iv, ct].join("."))).toBe("secret");
    await expect(openText(key, tampered)).rejects.toBeInstanceOf(ChatCryptoError);
  });

  it("rejects a wrong key with ChatCryptoError", async () => {
    const envelope = await sealText(await generateThreadKey(), "secret");
    await expect(openText(await generateThreadKey(), envelope)).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
  });

  it.each([
    ["empty", ""],
    ["wrong version", "c2.AAAA.AAAA"],
    ["too few parts", "c1.AAAA"],
    ["too many parts", "c1.AAAA.AAAA.AAAA"],
    ["not base64", "c1.!!!.@@@"],
  ])("rejects a malformed envelope (%s) with ChatCryptoError", async (_label, envelope) => {
    await expect(openText(await generateThreadKey(), envelope)).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
  });

  it("rejects a key that is not 32 bytes with ChatCryptoError", async () => {
    await expect(sealText(new Uint8Array(16), "x")).rejects.toBeInstanceOf(ChatCryptoError);
    const envelope = await sealText(await generateThreadKey(), "x");
    await expect(openText(new Uint8Array(31), envelope)).rejects.toBeInstanceOf(ChatCryptoError);
  });
});

describe("owner wrapping", () => {
  it("round-trips a thread key under the chat key", async () => {
    const chatKey = await generateChatKey();
    const threadKey = await generateThreadKey();
    const wrapped = await wrapForOwner(chatKey, threadKey);
    expect(wrapped.startsWith("c1.")).toBe(true);
    expect(await unwrapForOwner(chatKey, wrapped)).toEqual(threadKey);
  });

  it("refuses to unwrap under another chat key", async () => {
    const wrapped = await wrapForOwner(await generateChatKey(), await generateThreadKey());
    await expect(unwrapForOwner(await generateChatKey(), wrapped)).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
  });
});

describe("operator wrapping", () => {
  it("round-trips a thread key through an RSA-OAEP 3072 pair", async () => {
    const { spkiB64, privateKey } = await rsaPair();
    const threadKey = await generateThreadKey();
    const wrapped = await wrapForOperator(spkiB64, threadKey);
    expect(wrapped.startsWith("r1.")).toBe(true);
    expect(wrapped.split(".")).toHaveLength(2);
    expect(await unwrapForOperator(privateKey, wrapped)).toEqual(threadKey);
  }, 20_000);

  it("rejects an unusable public key and a malformed operator envelope", async () => {
    await expect(wrapForOperator("not-a-key", await generateThreadKey())).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
    const { privateKey } = await rsaPair(2048);
    await expect(unwrapForOperator(privateKey, "c1.AAAA.AAAA")).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
    await expect(unwrapForOperator(privateKey, "r1.AAAA")).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
  }, 20_000);
});

describe("isChatCryptoAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when Web Crypto and IndexedDB are present", () => {
    vi.stubGlobal("indexedDB", {});
    expect(isChatCryptoAvailable()).toBe(true);
  });

  it("is false, without throwing, when IndexedDB is absent", () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(isChatCryptoAvailable()).toBe(false);
  });

  it("is false, without throwing, when Web Crypto is absent", () => {
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal("crypto", undefined);
    expect(isChatCryptoAvailable()).toBe(false);
  });
});
