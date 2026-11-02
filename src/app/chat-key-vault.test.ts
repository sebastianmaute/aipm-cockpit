// src/app/chat-key-vault.test.ts — this browser's chat identity per Turso database.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CHAT_IDENTITY_KEY, ensureChatIdentity, getChatIdentity, readChatIdentity, replaceChatIdentity, startNewChatIdentity,
  storedChatOwnerIds,
} from "./chat-key-vault";
import { bytesToBase64 } from "./base64";
import { generateChatKey } from "./chat-crypto";

const URL_A = "https://a.example";
const URL_B = "https://b.example";

const stored = (): string | null => window.localStorage.getItem(CHAT_IDENTITY_KEY);

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A stand-in for `navigator.locks`: one queue per lock name, shared by every module instance. */
function installFakeLocks(): { names: string[] } {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  const locks = {
    request: (name: string, cb: () => Promise<unknown>) => {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(() => cb());
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
  Object.defineProperty(window.navigator, "locks", { value: locks, configurable: true });
  return { names };
}

describe("chat-key-vault across tabs", () => {
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, "locks");
    vi.restoreAllMocks();
  });

  it("two tabs creating the first identity at once write one, under the identity lock", async () => {
    // Tab A creates the device key (and an identity for another database) first, so both tabs seal
    // with the same device key; then each tab is a separate module instance, as in two tabs.
    vi.resetModules();
    const tabA = await import("./chat-key-vault");
    await tabA.ensureChatIdentity(URL_B);
    vi.resetModules();
    const tabB = await import("./chat-key-vault");
    const { names } = installFakeLocks();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const [a, b] = await Promise.all([tabA.ensureChatIdentity(URL_A), tabB.ensureChatIdentity(URL_A)]);

    const writes = setItem.mock.calls.filter(([k]) => k === CHAT_IDENTITY_KEY);
    expect(writes).toHaveLength(1);
    expect(a!.ownerId).toBe(b!.ownerId);
    expect(names).toContain("aipm-cockpit:chat-identity");
  });
});

describe("chat-key-vault", () => {
  it("getChatIdentity never creates one", async () => {
    expect(await getChatIdentity(URL_A)).toBeNull();
    expect(await readChatIdentity(URL_A)).toEqual({ kind: "absent" });
    expect(stored()).toBeNull();
  });

  it("ensureChatIdentity creates one on first use and returns the same one afterwards", async () => {
    const first = await ensureChatIdentity(URL_A);
    expect(first).not.toBeNull();
    expect(first!.ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first!.chatKey).toHaveLength(32);
    const again = await ensureChatIdentity(URL_A);
    const read = await getChatIdentity(URL_A);
    expect(again!.ownerId).toBe(first!.ownerId);
    expect(Array.from(again!.chatKey)).toEqual(Array.from(first!.chatKey));
    expect(read!.ownerId).toBe(first!.ownerId);
    expect(Array.from(read!.chatKey)).toEqual(Array.from(first!.chatKey));
  });

  it("two concurrent first calls create one identity, the one stored", async () => {
    const [x, y] = await Promise.all([ensureChatIdentity(URL_A), ensureChatIdentity(URL_A)]);
    expect(x!.ownerId).toBe(y!.ownerId);
    expect(Array.from(x!.chatKey)).toEqual(Array.from(y!.chatKey));
    const parsed = JSON.parse(stored()!) as Record<string, { ownerId: string }>;
    expect(parsed[URL_A]!.ownerId).toBe(x!.ownerId);
    expect((await getChatIdentity(URL_A))!.ownerId).toBe(x!.ownerId);
  });

  it("keeps one identity per database URL", async () => {
    const a = await ensureChatIdentity(URL_A);
    const b = await ensureChatIdentity(URL_B);
    expect(b!.ownerId).not.toBe(a!.ownerId);
    expect((await getChatIdentity(URL_A))!.ownerId).toBe(a!.ownerId);
    expect((await getChatIdentity(URL_B))!.ownerId).toBe(b!.ownerId);
  });

  it("stores the chat key sealed, never in the clear", async () => {
    const id = await ensureChatIdentity(URL_A);
    const raw = stored()!;
    expect(raw).not.toContain(bytesToBase64(id!.chatKey));
    const parsed = JSON.parse(raw) as Record<string, { ownerId: string; sealed: { iv: string; ciphertext: string } }>;
    expect(parsed[URL_A]!.ownerId).toBe(id!.ownerId);
    expect(typeof parsed[URL_A]!.sealed.iv).toBe("string");
    expect(typeof parsed[URL_A]!.sealed.ciphertext).toBe("string");
  });

  it("treats a malformed entry as absent and replaces only that entry on the next save", async () => {
    const a = await ensureChatIdentity(URL_A);
    const vault = JSON.parse(stored()!) as Record<string, unknown>;
    window.localStorage.setItem(CHAT_IDENTITY_KEY, JSON.stringify({ ...vault, [URL_B]: { ownerId: 7 } }));
    expect(await readChatIdentity(URL_B)).toEqual({ kind: "absent" });
    const b = await ensureChatIdentity(URL_B);
    expect(b).not.toBeNull();
    expect((await getChatIdentity(URL_A))!.ownerId).toBe(a!.ownerId);
  });

  it("treats an unparseable vault as absent", async () => {
    window.localStorage.setItem(CHAT_IDENTITY_KEY, "{not json");
    expect(await readChatIdentity(URL_A)).toEqual({ kind: "absent" });
    expect(await ensureChatIdentity(URL_A)).not.toBeNull();
  });

  it("reports an entry the device key cannot open as unavailable, and never overwrites it", async () => {
    const entry = { ownerId: "o-1", sealed: { iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } };
    const raw = JSON.stringify({ [URL_A]: entry });
    window.localStorage.setItem(CHAT_IDENTITY_KEY, raw);
    expect(await readChatIdentity(URL_A)).toEqual({ kind: "unavailable" });
    expect(await getChatIdentity(URL_A)).toBeNull();
    expect(await ensureChatIdentity(URL_A)).toBeNull();
    expect(stored()).toBe(raw);
  });

  it("reports a failure other than a key that cannot open the entry (IndexedDB blocked) as transient, and never overwrites", async () => {
    await ensureChatIdentity(URL_A);
    const raw = stored();
    vi.resetModules();
    vi.doMock("./secrets", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./secrets")>()),
      openDeviceValue: vi.fn(async () => { throw new Error("idb blocked"); }),
    }));
    try {
      const vault = await import("./chat-key-vault");
      expect(await vault.readChatIdentity(URL_A)).toEqual({ kind: "transient" });
      expect(await vault.getChatIdentity(URL_A)).toBeNull();
      expect(await vault.ensureChatIdentity(URL_A)).toBeNull();
      expect(stored()).toBe(raw);
    } finally {
      vi.doUnmock("./secrets");
      vi.resetModules();
    }
  });

  it("is unavailable without IndexedDB, and creates nothing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await readChatIdentity(URL_A)).toEqual({ kind: "unavailable" });
    expect(await ensureChatIdentity(URL_A)).toBeNull();
    expect(stored()).toBeNull();
  });

  it("refuses an empty database URL", async () => {
    expect(await readChatIdentity("")).toEqual({ kind: "unavailable" });
    expect(await ensureChatIdentity("")).toBeNull();
    expect(stored()).toBeNull();
  });

  it("replaceChatIdentity stores the given identity for that URL only", async () => {
    const b = await ensureChatIdentity(URL_B);
    const next = { ownerId: "owner-next", chatKey: await generateChatKey() };
    await replaceChatIdentity(URL_A, next);
    const read = await getChatIdentity(URL_A);
    expect(read!.ownerId).toBe("owner-next");
    expect(Array.from(read!.chatKey)).toEqual(Array.from(next.chatKey));
    expect((await getChatIdentity(URL_B))!.ownerId).toBe(b!.ownerId);
  });

  it("a locked entry's owner ids stay readable without the key", async () => {
    const entry = {
      ownerId: "o-locked", previousOwnerIds: ["o-older", "", 7],
      sealed: { iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    };
    window.localStorage.setItem(CHAT_IDENTITY_KEY, JSON.stringify({ [URL_A]: entry }));
    expect(await readChatIdentity(URL_A)).toEqual({ kind: "unavailable" });
    expect(storedChatOwnerIds(URL_A)).toEqual(["o-locked", "o-older"]);
    expect(storedChatOwnerIds(URL_B)).toEqual([]);
  });

  it("a new identity keeps the old owner ids for a later delete only when asked to", async () => {
    const first = await ensureChatIdentity(URL_A);
    const kept = await startNewChatIdentity(URL_A, { keepOld: true });
    expect(storedChatOwnerIds(URL_A)).toEqual([kept.ownerId, first!.ownerId]);
    const again = await startNewChatIdentity(URL_A, { keepOld: true });
    expect(storedChatOwnerIds(URL_A)).toEqual([again.ownerId, kept.ownerId, first!.ownerId]);
    const fresh = await startNewChatIdentity(URL_A, { keepOld: false });
    expect(storedChatOwnerIds(URL_A)).toEqual([fresh.ownerId]);
  });

  it("replaceChatIdentity carries the entry's earlier owner ids and adds the ones given", async () => {
    await replaceChatIdentity(URL_A, { ownerId: "o-1", chatKey: await generateChatKey() }, ["o-0"]);
    await replaceChatIdentity(URL_A, { ownerId: "o-2", chatKey: await generateChatKey() }, ["o-1", "o-2"]);
    expect(storedChatOwnerIds(URL_A)).toEqual(["o-2", "o-1", "o-0"]);
    expect((await getChatIdentity(URL_A))!.ownerId).toBe("o-2");
  });
});
