import { afterEach, describe, expect, it } from "vitest";
import { setAiDeploymentState } from "./ai-deployment";
import {
  AI_DISCLOSURE_VERSION,
  AiConsentRevokedError,
  assertAiConsentLive,
  assertBackgroundConsentLive,
  assertInteractiveConsentLive,
  isInteractiveConsentLive,
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
    publishAiConsentState({ ...defaultAiConfig, enabled: true, consent: newConsent(D) });
    expect(() => assertInteractiveConsentLive()).not.toThrow();
    publishAiConsentState({ ...defaultAiConfig, enabled: true, consent: undefined });
    expect(() => assertInteractiveConsentLive()).toThrow(AiConsentRevokedError);
  });
  it("throws while AI is switched off, the consent kept (AI-01)", () => {
    publishAiConsentState({ ...defaultAiConfig, enabled: false, consent: newConsent(D) });
    expect(() => assertInteractiveConsentLive()).toThrow(AiConsentRevokedError);
    expect(isInteractiveConsentLive()).toBe(false);
  });
  it("does not need a key: the flag is the switch and the consent only", () => {
    publishAiConsentState({ ...defaultAiConfig, enabled: true, apiKey: "", consent: newConsent(D) });
    expect(isInteractiveConsentLive()).toBe(true);
  });
});

describe("assertBackgroundConsentLive (AI-01)", () => {
  const live = { ...defaultAiConfig, enabled: true, consent: newConsent(D), backgroundConsent: newConsent(D) };
  it("passes with the switch on and both consents current", () => {
    publishAiConsentState(live);
    expect(() => assertBackgroundConsentLive()).not.toThrow();
    expect(() => assertAiConsentLive("background")).not.toThrow();
  });
  it.each([
    ["the background consent withdrawn", { ...live, backgroundConsent: undefined }],
    ["the interactive consent withdrawn", { ...live, consent: undefined }],
    ["AI switched off", { ...live, enabled: false }],
  ])("throws with %s", (_name, ai) => {
    publishAiConsentState(ai);
    expect(() => assertBackgroundConsentLive()).toThrow(AiConsentRevokedError);
    expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
  });
  it("a withdrawn background consent leaves the interactive level live", () => {
    publishAiConsentState({ ...live, backgroundConsent: undefined });
    expect(() => assertAiConsentLive("interactive")).not.toThrow();
  });
});

const GATEWAY = { off: false, route: "gateway", invalid: false } as const;
const DIRECT = { off: false, route: "direct", invalid: false } as const;

describe("route-bound consent", () => {
  afterEach(() => { setAiDeploymentState(DIRECT); publishAiConsentState(undefined); });
  it("a record without a route is current for direct only", () => {
    const c = { acceptedAt: D.toISOString(), disclosureVersion: AI_DISCLOSURE_VERSION };
    expect(isConsentCurrent(c)).toBe(true);
    setAiDeploymentState(GATEWAY);
    expect(isConsentCurrent(c)).toBe(false);
  });
  it("a gateway record is current only in gateway mode, at both levels", () => {
    setAiDeploymentState(GATEWAY);
    const g = newConsent(D);
    expect(g.route).toBe("gateway");
    const ai = { ...defaultAiConfig, enabled: true, consent: g, backgroundConsent: g };
    publishAiConsentState(ai);
    expect(() => assertAiConsentLive("background")).not.toThrow();
    setAiDeploymentState(DIRECT);
    expect(isConsentCurrent(g)).toBe(false);
    publishAiConsentState(ai);
    expect(() => assertAiConsentLive("interactive")).toThrow(AiConsentRevokedError);
    expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
  });
  it("sanitizeConsent keeps a valid route and drops an invalid one", () => {
    expect(sanitizeConsent({ acceptedAt: D.toISOString(), disclosureVersion: 1, route: "gateway" })?.route).toBe("gateway");
    const bad = sanitizeConsent({ acceptedAt: D.toISOString(), disclosureVersion: 1, route: "x" });
    expect(bad).toEqual({ acceptedAt: D.toISOString(), disclosureVersion: 1 });
  });
  it.each([["off", { off: true, route: "direct", invalid: false }], ["invalid", { off: false, route: "direct", invalid: true }]] as const)(
    "a deployment that is %s blocks the published state", (_n, st) => {
      const ai = { ...defaultAiConfig, enabled: true, consent: newConsent(D), backgroundConsent: newConsent(D) };
      publishAiConsentState(ai);
      expect(() => assertAiConsentLive("interactive")).not.toThrow();
      setAiDeploymentState(st);
      publishAiConsentState(ai);
      expect(() => assertAiConsentLive("interactive")).toThrow(AiConsentRevokedError);
      expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
    });
});
