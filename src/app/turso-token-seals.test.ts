import { describe, expect, it } from "vitest";
import { __resetTursoTokenState, hasUnsealedPassphraseToken, markUnsealedPassphraseToken } from "./turso-token-marker";
import { tokenSealsSettled, trackTokenSeal } from "./turso-token-seals";

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
