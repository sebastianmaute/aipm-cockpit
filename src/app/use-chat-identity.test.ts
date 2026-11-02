import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatIdentity, chatPersistence } from "./use-chat-identity";
import type { ChatSettings } from "./ai-chat-retention-config";
import type { TursoConfig } from "./turso-config";

const h = vi.hoisted(() => ({
  vault: new Map<string, { ownerId: string; chatKey: Uint8Array }>(),
  locked: new Set<string>(),
  transient: new Set<string>(),
  failStart: { value: false },
}));

vi.mock("./chat-key-vault", () => ({
  CHAT_IDENTITY_KEY: "aipm-cockpit:chat-identity",
  chatVaultAvailable: () => true,
  readChatIdentity: vi.fn(async (url: string) => {
    if (h.locked.has(url)) return { kind: "unavailable" };
    if (h.transient.has(url)) return { kind: "transient" };
    const identity = h.vault.get(url);
    return identity ? { kind: "found", identity } : { kind: "absent" };
  }),
  getChatIdentity: vi.fn(async (url: string) => h.vault.get(url) ?? null),
  ensureChatIdentity: vi.fn(async (url: string) => {
    if (h.locked.has(url) || h.transient.has(url)) return null;
    let identity = h.vault.get(url);
    if (!identity) {
      identity = { ownerId: "minted", chatKey: new Uint8Array(32) };
      h.vault.set(url, identity);
    }
    return identity;
  }),
  storedChatOwnerId: (url: string) => h.vault.get(url)?.ownerId ?? null,
  startNewChatIdentity: vi.fn(async (url: string) => {
    if (h.failStart.value) throw new Error("no");
    const identity = { ownerId: "fresh", chatKey: new Uint8Array(32) };
    h.vault.set(url, identity);
    h.locked.delete(url);
    return identity;
  }),
}));

const CFG: TursoConfig = { httpUrl: "https://a.example", authToken: "t" };
const CHAT_ON: ChatSettings = { retentionDays: 30, retentionInvalid: false, recoveryKey: "spki", recoveryKeyInvalid: false };
const id = (ownerId: string) => ({ ownerId, chatKey: new Uint8Array(32) });

function render(chat: ChatSettings | null = CHAT_ON) {
  return renderHook(() => useChatIdentity({ tursoMode: true, tursoConfig: CFG, chat }));
}

beforeEach(() => {
  h.vault.clear();
  h.locked.clear();
  h.transient.clear();
  h.failStart.value = false;
});

describe("chatPersistence", () => {
  it("checks status, crypto, lock and recovery key in that order", () => {
    expect(chatPersistence(null, false, true)).toBe("status-unknown");
    expect(chatPersistence(CHAT_ON, false, true)).toBe("no-crypto");
    expect(chatPersistence(CHAT_ON, true, true)).toBe("identity-locked");
    expect(chatPersistence({ ...CHAT_ON, recoveryKey: "" }, true, false)).toBe("no-recovery-key");
    expect(chatPersistence(CHAT_ON, true, false)).toBe("on");
    expect(chatPersistence(CHAT_ON, true, false, true)).toBe("identity-retry");
    expect(chatPersistence(CHAT_ON, true, true, true)).toBe("identity-locked");
    expect(chatPersistence({ ...CHAT_ON, recoveryKey: "" }, true, false, true)).toBe("no-recovery-key");
  });
});

describe("useChatIdentity", () => {
  it("a read records the identity as known, and its owner id", async () => {
    h.vault.set(CFG.httpUrl, id("own"));
    const { result } = render();
    let read: unknown;
    await act(async () => {
      read = await result.current.readIdentity(CFG);
    });
    expect(read).toEqual(id("own"));
    expect(result.current.knownIdentity(CFG)?.ownerId).toBe("own");
    expect(result.current.knownOwnerId).toBe("own");
    expect(result.current.knownIdentity({ httpUrl: "https://b.example", authToken: "" })).toBeNull();
  });

  it("trusts the known identity only while it is still the stored one", async () => {
    h.vault.set(CFG.httpUrl, id("own"));
    const { result } = render();
    await act(async () => {
      await result.current.readIdentity(CFG);
    });
    expect(result.current.trustedIdentity(CFG)?.ownerId).toBe("own");
    h.vault.set(CFG.httpUrl, id("other-tab"));
    expect(result.current.trustedIdentity(CFG)).toBeNull();
  });

  it("a write creates an identity on first use", async () => {
    const { result } = render();
    let created: unknown;
    await act(async () => {
      created = await result.current.writeIdentity(CFG);
    });
    expect((created as { ownerId: string }).ownerId).toBe("minted");
    expect(result.current.knownOwnerId).toBe("minted");
  });

  it("a write against a locked entry throws and reads as identity-locked", async () => {
    h.locked.add(CFG.httpUrl);
    const { result } = render();
    await act(async () => {
      await expect(result.current.writeIdentity(CFG)).rejects.toThrow("chat identity unavailable");
    });
    expect(result.current.persistence).toBe("identity-locked");
  });

  it("a vault read that fails for another reason saves nothing, offers no new identity and is retried by the next write", async () => {
    h.vault.set(CFG.httpUrl, id("own"));
    h.transient.add(CFG.httpUrl);
    const { result } = render();
    await act(async () => {
      expect(await result.current.readIdentity(CFG)).toBeNull();
    });
    expect(result.current.persistence).toBe("identity-retry");
    await act(async () => {
      await expect(result.current.writeIdentity(CFG)).rejects.toThrow();
    });
    expect(result.current.persistence).toBe("identity-retry");
    expect(h.vault.get(CFG.httpUrl)?.ownerId).toBe("own");
    h.transient.delete(CFG.httpUrl);
    await act(async () => {
      expect((await result.current.writeIdentity(CFG)).ownerId).toBe("own");
    });
    expect(result.current.persistence).toBe("on");
  });

  it("starting a new identity replaces a locked one; a failure leaves the state", async () => {
    h.locked.add(CFG.httpUrl);
    const { result } = render();
    await act(async () => {
      await result.current.readIdentity(CFG);
    });
    expect(result.current.persistence).toBe("identity-locked");
    h.failStart.value = true;
    await act(async () => {
      await result.current.startNewIdentity();
    });
    expect(result.current.persistence).toBe("identity-locked");
    h.failStart.value = false;
    await act(async () => {
      await result.current.startNewIdentity();
    });
    expect(result.current.persistence).toBe("on");
    expect(result.current.knownOwnerId).toBe("fresh");
  });

  it("the stored identity is read without creating one", async () => {
    const { result } = render();
    await expect(result.current.storedIdentity(CFG)).resolves.toBeNull();
    expect(h.vault.size).toBe(0);
  });

  it("another tab changing the identity bumps the reload count", async () => {
    h.vault.set(CFG.httpUrl, id("own"));
    const { result } = render();
    await act(async () => {
      await result.current.readIdentity(CFG);
    });
    h.vault.set(CFG.httpUrl, id("other-tab"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "aipm-cockpit:chat-identity" }));
    });
    await waitFor(() => expect(result.current.identityReloads).toBe(1));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });
    expect(result.current.identityReloads).toBe(1);
  });
});
