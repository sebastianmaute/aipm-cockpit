import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetTursoTokenState,
  hasUnsealedPassphraseToken,
  markUnsealedPassphraseToken,
  noteTokenSealed,
} from "./turso-token-marker";
import { tokenSealsSettled, trackTokenSeal, useHasUnsealedPassphraseToken } from "./turso-token-seals";

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
