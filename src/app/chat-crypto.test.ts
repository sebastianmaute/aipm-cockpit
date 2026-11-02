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

/** An unbound "c1." envelope (AES-GCM without additional data): not a format the app accepts. */
async function sealC1(key: Uint8Array, plaintext: string): Promise<string> {
  const raw = new Uint8Array(key);
  const aes = await globalThis.crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(plaintext)));
  return `c1.${bytesToB64(iv)}.${bytesToB64(ct)}`;
}

const AD = "t1\np1\nowner-a\nname";

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
    const envelope = await sealText(key, text, AD);
    expect(envelope.startsWith("c2.")).toBe(true);
    expect(envelope.split(".")).toHaveLength(3);
    expect(envelope).not.toContain("chat line");
    expect(await openText(key, envelope, AD)).toBe(text);
  });

  it("a c2 envelope opens only with the additional data it was sealed with", async () => {
    const key = await generateThreadKey();
    const envelope = await sealText(key, "secret", AD);
    for (const other of ["t2\np1\nowner-a\nname", "t1\np2\nowner-a\nname", "t1\np1\nowner-b\nname", "t1\np1\nowner-a\nhistory", ""]) {
      await expect(openText(key, envelope, other)).rejects.toBeInstanceOf(ChatCryptoError);
    }
  });

  it("refuses an unbound c1 envelope under the right key with ChatCryptoError", async () => {
    const key = await generateThreadKey();
    const envelope = await sealC1(key, "unbound");
    await expect(openText(key, envelope, AD)).rejects.toBeInstanceOf(ChatCryptoError);
    await expect(openText(key, envelope, "")).rejects.toBeInstanceOf(ChatCryptoError);
  });

  it("two seals of the same text differ (fresh IV)", async () => {
    const key = await generateThreadKey();
    const a = await sealText(key, "same", AD);
    const b = await sealText(key, "same", AD);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("rejects a flipped ciphertext byte with ChatCryptoError", async () => {
    const key = await generateThreadKey();
    const [prefix, iv, ct] = (await sealText(key, "secret", AD)).split(".");
    const bytes = b64ToBytes(ct);
    bytes[0] ^= 0x01;
    const tampered = [prefix, iv, bytesToB64(bytes)].join(".");
    // Control: the untampered envelope opens.
    expect(await openText(key, [prefix, iv, ct].join("."), AD)).toBe("secret");
    await expect(openText(key, tampered, AD)).rejects.toBeInstanceOf(ChatCryptoError);
  });

  it("rejects a wrong key with ChatCryptoError", async () => {
    const envelope = await sealText(await generateThreadKey(), "secret", AD);
    await expect(openText(await generateThreadKey(), envelope, AD)).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
  });

  it.each([
    ["empty", ""],
    ["wrong version", "c3.AAAA.AAAA"],
    ["too few parts", "c2.AAAA"],
    ["too many parts", "c2.AAAA.AAAA.AAAA"],
    ["not base64", "c2.!!!.@@@"],
  ])("rejects a malformed envelope (%s) with ChatCryptoError", async (_label, envelope) => {
    await expect(openText(await generateThreadKey(), envelope, AD)).rejects.toBeInstanceOf(
      ChatCryptoError,
    );
  });

  it("rejects a key that is not 32 bytes with ChatCryptoError", async () => {
    await expect(sealText(new Uint8Array(16), "x", AD)).rejects.toBeInstanceOf(ChatCryptoError);
    const envelope = await sealText(await generateThreadKey(), "x", AD);
    await expect(openText(new Uint8Array(31), envelope, AD)).rejects.toBeInstanceOf(ChatCryptoError);
  });
});

describe("owner wrapping", () => {
  it("round-trips a thread key under the chat key", async () => {
    const chatKey = await generateChatKey();
    const threadKey = await generateThreadKey();
    const wrapped = await wrapForOwner(chatKey, threadKey, "t1\nowner-a\nkey");
    expect(wrapped.startsWith("c2.")).toBe(true);
    expect(await unwrapForOwner(chatKey, wrapped, "t1\nowner-a\nkey")).toEqual(threadKey);
    await expect(unwrapForOwner(chatKey, wrapped, "t2\nowner-a\nkey")).rejects.toBeInstanceOf(ChatCryptoError);
    await expect(unwrapForOwner(chatKey, wrapped, "t1\nowner-b\nkey")).rejects.toBeInstanceOf(ChatCryptoError);
  });

  it("refuses an unbound c1 owner wrap under the right chat key", async () => {
    const chatKey = await generateChatKey();
    const threadKey = await generateThreadKey();
    const wrapped = await sealC1(chatKey, bytesToB64(threadKey));
    await expect(unwrapForOwner(chatKey, wrapped, "t1\nowner-a\nkey")).rejects.toBeInstanceOf(ChatCryptoError);
  });

  it("refuses to unwrap under another chat key", async () => {
    const wrapped = await wrapForOwner(await generateChatKey(), await generateThreadKey(), "t1\nowner-a\nkey");
    await expect(unwrapForOwner(await generateChatKey(), wrapped, "t1\nowner-a\nkey")).rejects.toBeInstanceOf(
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
