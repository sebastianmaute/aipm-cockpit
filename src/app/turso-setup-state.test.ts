import { describe, expect, it } from "vitest";
import { tursoSetupState } from "./turso-setup-state";

const base = { url: "", token: "", urlFromEnv: false, tokenFromEnv: false, testConfirmed: false };

describe("tursoSetupState", () => {
  it("is all open for an empty setup", () => {
    expect(tursoSetupState(base)).toEqual({ urlDone: false, tokenDone: false, testDone: false });
  });

  it("counts a usable typed URL as done", () => {
    expect(tursoSetupState({ ...base, url: "libsql://acme-org.turso.io" }).urlDone).toBe(true);
  });

  it("does not count an unusable typed URL", () => {
    expect(tursoSetupState({ ...base, url: "not a url" }).urlDone).toBe(false);
    expect(tursoSetupState({ ...base, url: "http://example.com" }).urlDone).toBe(false);
  });

  it("counts a URL supplied by the environment even when the typed one is empty", () => {
    expect(tursoSetupState({ ...base, urlFromEnv: true }).urlDone).toBe(true);
  });

  it("counts a non-blank token as done", () => {
    expect(tursoSetupState({ ...base, token: "tok" }).tokenDone).toBe(true);
  });

  it("does not count a whitespace-only token", () => {
    expect(tursoSetupState({ ...base, token: "   " }).tokenDone).toBe(false);
  });

  it("counts a token supplied by the environment", () => {
    expect(tursoSetupState({ ...base, tokenFromEnv: true }).tokenDone).toBe(true);
  });

  it("passes the confirmed test through independently of the fields", () => {
    expect(tursoSetupState({ ...base, testConfirmed: true })).toEqual({
      urlDone: false,
      tokenDone: false,
      testDone: true,
    });
  });
});
