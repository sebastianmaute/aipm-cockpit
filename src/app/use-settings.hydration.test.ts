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

/** A stored settings blob, so the mount effect takes the secret-merge path (no blob skips it). */
function storeSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ layout: "classic", expertMode: true }));
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

  it("hydrates when the secret merge THROWS, keeping the stored non-secret settings", async () => {
    secretMode.mode = "throw";
    storeSettings();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.settings.layout).toBe("classic");
    expect(result.current.settings.expertMode).toBe(true);
  });

  it("hydrates when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    storeSettings();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.settings.layout).toBe("classic");
  });

  it("hydrates at SECRET_MERGE_TIMEOUT_MS when the merge NEVER settles, and not before", async () => {
    vi.useFakeTimers();
    secretMode.mode = "hang";
    storeSettings();
    const { result } = renderHook(() => useSettings());
    await act(async () => { await vi.advanceTimersByTimeAsync(SECRET_MERGE_TIMEOUT_MS - 1); });
    expect(result.current.hydrated).toBe(false); // control: the merge really is hanging
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.hydrated).toBe(true);
    expect(result.current.settings.layout).toBe("classic");
  });
});
