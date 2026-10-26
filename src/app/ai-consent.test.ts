import { describe, expect, it } from "vitest";
import {
  AI_DISCLOSURE_VERSION,
  AiConsentRevokedError,
  assertInteractiveConsentLive,
  isConsentCurrent,
  newConsent,
  publishAiConsentState,
  sanitizeConsent,
} from "./ai-consent";
import { defaultAiConfig } from "./settings-types";

const D = new Date(0);

describe("isConsentCurrent", () => {
  it("is true for a fresh consent", () => {
    expect(isConsentCurrent(newConsent(D))).toBe(true);
  });
  it("is false when absent", () => {
    expect(isConsentCurrent(undefined)).toBe(false);
  });
  it("is false for another disclosure version", () => {
    expect(isConsentCurrent({ acceptedAt: D.toISOString(), disclosureVersion: 0 })).toBe(false);
    expect(isConsentCurrent({ acceptedAt: D.toISOString(), disclosureVersion: AI_DISCLOSURE_VERSION + 1 })).toBe(false);
  });
});

describe("sanitizeConsent", () => {
  it("round-trips a fresh consent", () => {
    expect(sanitizeConsent(newConsent(D))).toEqual(newConsent(D));
  });
  it.each([
    ["true", true],
    ["empty object", {}],
    ["unparseable date", { acceptedAt: "x", disclosureVersion: 1 }],
    ["fractional version", { acceptedAt: D.toISOString(), disclosureVersion: 1.5 }],
    ["zero version", { acceptedAt: D.toISOString(), disclosureVersion: 0 }],
    ["overlong date", { acceptedAt: "2020-01-01T00:00:00.000Z" + " ".repeat(30), disclosureVersion: 1 }],
    ["null", null],
    ["array", []],
  ])("rejects %s", (_name, v) => {
    expect(sanitizeConsent(v)).toBeUndefined();
  });
});

describe("assertInteractiveConsentLive", () => {
  it("throws AiConsentRevokedError once consent is published as absent", () => {
    publishAiConsentState({ ...defaultAiConfig, consent: undefined });
    expect(() => assertInteractiveConsentLive()).toThrow(AiConsentRevokedError);
    expect(() => assertInteractiveConsentLive()).toThrow("AI consent was revoked");
  });
  it("does not throw after a current consent is published, and throws again on revoke", () => {
    publishAiConsentState({ ...defaultAiConfig, consent: newConsent(D) });
    expect(() => assertInteractiveConsentLive()).not.toThrow();
    publishAiConsentState({ ...defaultAiConfig, consent: undefined });
    expect(() => assertInteractiveConsentLive()).toThrow(AiConsentRevokedError);
  });
});
