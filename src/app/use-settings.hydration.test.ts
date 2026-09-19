// §548 (spec revision 2026-09-19) — the load hold is up while `hydrated` is false, so `hydrated` MUST
// always become true. Every THROW on the secret-merge path already falls back and reaches
// `setHydrated(true)` in a `finally` — pinned here so it stays that way. The one path that could leave it
// false is a merge that NEVER settles (an IndexedDB open queued behind another connection, a stalled
// WebCrypto call), now bounded by `SECRET_MERGE_TIMEOUT_MS`.
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secretMode = vi.hoisted(() => ({ mode: "real" as "real" | "throw" | "hang" }));

vi.mock("./secrets-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./secrets-store")>();
  return {
    ...actual,
    migratePlaintextSecrets: (input: Parameters<typeof actual.migratePlaintextSecrets>[0]) =>
      secretMode.mode === "hang" ? new Promise<never>(() => {})
        : secretMode.mode === "throw" ? Promise.reject(new Error("secret store down"))
          : actual.migratePlaintextSecrets(input),
  };
});

import { SECRET_MERGE_TIMEOUT_MS, SETTINGS_KEY, useSettings } from "./use-settings";
import { sealDevice as primeSealDevice } from "./secrets";
import { readDiagLog } from "./diagnostics";

/** A stored settings blob, so the mount effect takes the secret-merge path (no blob skips it).
 *  `extra` merges in on top of the base fields — used to add a plaintext secret to a blob so
 *  the fallback under test actually has something to preserve. */
function storeSettings(extra: Record<string, unknown> = {}) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ layout: "classic", expertMode: true, ...extra }));
}

beforeEach(() => {
  localStorage.clear();
  secretMode.mode = "real";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSettings — hydration always completes (§548)", () => {
  it("control: the real merge hydrates with the stored settings", async () => {
    storeSettings();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.settings.layout).toBe("classic");
  });

  it("hydrates when the secret merge THROWS, keeping the stored non-secret settings AND the still-unmigrated plaintext secrets", async () => {
    secretMode.mode = "throw";
    // §548 fix round 2 — the earlier version of this test only asserted the
    // NON-secret fields, so a mutant that blanks apiKey inside the fallback
    // (`catch { return merged; }` in the mount effect) survived. `merged` is
    // the whole parsed-and-sanitized blob, secrets included, so the fallback
    // must carry them too.
    storeSettings({
      ai: { apiKey: "sk-plaintext-throw" },
      integrations: { turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tok-plaintext-throw" } },
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.settings.layout).toBe("classic");
    expect(result.current.settings.expertMode).toBe(true);
    expect(result.current.settings.ai.apiKey).toBe("sk-plaintext-throw");
    expect(result.current.settings.integrations?.turso?.authToken).toBe("tok-plaintext-throw");
  });

  it("clears the merge timer on a normal (throw-path) finish — no dangling timer, no late diagnostic", async () => {
    // §548 fix round 2 — pins the OTHER half of the race: on a normal finish
    // (the merge settles well inside the window), `clearTimeout(mergeTimer)`
    // must actually cancel the timer rather than leave it scheduled to fire
    // `resolve(null)` — and therefore the timeout diagnostic — later.
    // Real timers throughout: React's own scheduler can hold a pending timer
    // of its own under jsdom, so a bare `vi.getTimerCount() === 0` check can't
    // tell OUR timer apart from one of React's — spy on setTimeout/clearTimeout
    // instead and pin the specific SECRET_MERGE_TIMEOUT_MS-delayed timer by id.
    secretMode.mode = "throw";
    storeSettings();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    const mergeTimerCallIndex = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === SECRET_MERGE_TIMEOUT_MS);
    expect(mergeTimerCallIndex).toBeGreaterThanOrEqual(0); // control: the merge timer really was armed
    const mergeTimerId = setTimeoutSpy.mock.results[mergeTimerCallIndex]?.value;
    expect(clearTimeoutSpy.mock.calls.some((call) => call[0] === mergeTimerId)).toBe(true);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    expect(readDiagLog().filter((e) => e.code === "settings.secretMergeTimedOut")).toHaveLength(0);
  });

  it("hydrates when IndexedDB is unavailable, falling back to the in-memory plaintext secret", async () => {
    // §548 fix round 2 — `getDeviceKey()` (secrets.ts) caches its promise at
    // module level, so a warm cache from earlier secret activity in this
    // module instance would let `sealDevice` succeed even with `indexedDB`
    // stubbed away, making this test pass whichever way the real IndexedDB
    // path behaves. Prime that cache deliberately (the shape a real prior
    // secret operation this session would leave behind), THEN reset the
    // module graph so `useSettings` runs against a FRESH secrets.ts whose
    // `deviceKeyPromise` is null again — the only way this test can tell its
    // own path apart from the warm-cache one.
    await primeSealDevice("anthropicApiKey", "prime");
    vi.stubGlobal("indexedDB", undefined);
    storeSettings({ ai: { apiKey: "sk-plaintext-noidb" } });
    // `vi.resetModules()` alone is not enough: the top-of-file `vi.mock("./secrets-store", ...)`
    // factory captures `importOriginal()`'s result once, so a reimport of the MOCKED specifier
    // keeps riding that same (warm) "./secrets" underneath. Unmock it for this one dynamic
    // reimport so the fresh module graph is genuinely fresh all the way down; `secretMode.mode`
    // stays "real" so behaviour is unchanged either way.
    vi.doUnmock("./secrets-store");
    vi.resetModules();
    const fresh = await import("./use-settings");
    const { result } = renderHook(() => fresh.useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.settings.layout).toBe("classic");
    expect(result.current.settings.ai.apiKey).toBe("sk-plaintext-noidb");
    // Positive observable that the seal genuinely FAILED (real IndexedDB
    // unavailability), not merely that the visible apiKey happens to match —
    // a successful seal via a warm cache would produce the identical apiKey
    // value, so asserting on it alone cannot tell the two paths apart.
    const secretsRaw = localStorage.getItem("aipm-cockpit:secrets");
    const persisted: Record<string, unknown> = secretsRaw ? JSON.parse(secretsRaw) : {};
    expect(persisted.anthropicApiKey).toBeUndefined();
  });

  it("hydrates at SECRET_MERGE_TIMEOUT_MS when the merge NEVER settles, and not before", async () => {
    vi.useFakeTimers();
    secretMode.mode = "hang";
    storeSettings({
      ai: { apiKey: "sk-plaintext-hang" },
      integrations: { turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tok-plaintext-hang" } },
    });
    const { result } = renderHook(() => useSettings());
    await act(async () => { await vi.advanceTimersByTimeAsync(SECRET_MERGE_TIMEOUT_MS - 1); });
    expect(result.current.hydrated).toBe(false); // control: the merge really is hanging
    expect(readDiagLog().filter((e) => e.code === "settings.secretMergeTimedOut")).toHaveLength(0); // not yet
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.hydrated).toBe(true);
    expect(result.current.settings.layout).toBe("classic");
    // §548 fix round 2 — the earlier version of this test only asserted
    // `hydrated`/`layout`, so a mutant that blanks apiKey in the timeout
    // fallback (`mergeOutcome ?? merged`) survived, and the
    // `settings.secretMergeTimedOut` diagnostic itself was unpinned.
    expect(result.current.settings.ai.apiKey).toBe("sk-plaintext-hang");
    expect(result.current.settings.integrations?.turso?.authToken).toBe("tok-plaintext-hang");
    expect(readDiagLog().filter((e) => e.code === "settings.secretMergeTimedOut")).toHaveLength(1);
  });
});
