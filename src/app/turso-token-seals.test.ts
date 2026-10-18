import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetTursoTokenState,
  hasUnsealedPassphraseToken,
  markUnsealedPassphraseToken,
  noteTokenSealed,
} from "./turso-token-marker";
import { probeOwnSeal, tokenSealsSettled, trackTokenSeal, useHasUnsealedPassphraseToken } from "./turso-token-seals";
import { beginSealedWrite, loadSealed } from "./secrets-store";
import { sealDevice } from "./secrets";

// §715 — both halves of the token state are module scope, so `vitest.setup.ts` resets them after
// every test. A seal left in flight would otherwise make every later reload path in the same file
// wait out `SECRET_MERGE_TIMEOUT_MS` (5 s).
describe("__resetTursoTokenState", () => {
  it("drops seals in flight, so nothing is left to wait for", () => {
    trackTokenSeal(new Promise<void>(() => {})); // never settles
    expect(tokenSealsSettled()).not.toBeNull(); // control: the seal is tracked
    __resetTursoTokenState();
    expect(tokenSealsSettled()).toBeNull();
  });

  it("forgets the unsealed passphrase token", () => {
    markUnsealedPassphraseToken("tok");
    __resetTursoTokenState();
    expect(hasUnsealedPassphraseToken("tok")).toBe(false);
  });
});

// MU23 — the wait covers only the seals in flight when it starts → goes red (it settles before B).
describe("tokenSealsSettled", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("also waits for a seal that starts while it waits", async () => {
    let landA: () => void = () => {};
    let landB: () => void = () => {};
    trackTokenSeal(new Promise<void>((resolve) => { landA = resolve; }));
    let settled = false;
    void tokenSealsSettled()?.then(() => { settled = true; });
    trackTokenSeal(new Promise<void>((resolve) => { landB = resolve; })); // a keystroke during the wait
    landA();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toBe(false);
    landB();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toBe(true);
  });

  // MU28 — each batch gets its own bound → goes red (still waiting at 5 s for the late seal).
  it("gives up after one SECRET_MERGE_TIMEOUT_MS in total, however many seals start meanwhile", async () => {
    vi.useFakeTimers();
    trackTokenSeal(new Promise<void>((resolve) => { setTimeout(resolve, 3_000); })); // lands at 3 s
    let settled = false;
    void tokenSealsSettled()?.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    trackTokenSeal(new Promise<void>(() => {})); // starts at 1 s, never settles
    await vi.advanceTimersByTimeAsync(4_001); // 5 s in: a per-batch bound would wait until 8 s
    expect(settled).toBe(true);
  });
});

// The setup wizard's Finish reads this hook; its own test mocks it, so the subscription is pinned here.
// MU24 — the hook reads the marker without subscribing → goes red (still true after the seal).
describe("useHasUnsealedPassphraseToken", () => {
  it("re-renders when a seal clears the marker", () => {
    markUnsealedPassphraseToken("tok");
    const { result } = renderHook(() => useHasUnsealedPassphraseToken("tok"));
    expect(result.current).toBe(true);
    act(() => { noteTokenSealed("tok"); });
    expect(result.current).toBe(false);
  });
});

// The put-back's restore must count only writes that began after the switch's OWN seal began. A write
// that lands between the own commit and the probe noticing the landing is not ours.
// MU45 — the restore is snapshotted when the landing is noticed → goes red (the newer write is undone).
describe("probeOwnSeal", () => {
  it("hands back a restore that yields to a write begun after its seal began", async () => {
    const before = await sealDevice("tursoAuthToken", "before");
    const own = await sealDevice("tursoAuthToken", "own");
    const newer = await sealDevice("tursoAuthToken", "newer");
    const commitOwn = beginSealedWrite("tursoAuthToken"); // the own seal begins, synchronously
    let landSeal: (ok: boolean) => void = () => {};
    const probe = probeOwnSeal(new Promise<boolean>((r) => { landSeal = r; }), false, () => "own");
    commitOwn(own); // the own commit
    beginSealedWrite("tursoAuthToken")(newer); // another write, before the probe sees the landing
    landSeal(true);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    let restored: boolean | undefined;
    probe.whenLanded((restore) => { restored = restore(before); });
    expect(restored).toBe(false);
    expect(loadSealed("tursoAuthToken")).toEqual(newer);
  });
});
