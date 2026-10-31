import { afterEach, describe, expect, it } from "vitest";
import { setAiDeploymentState } from "./ai-deployment";
import {
  AI_DISCLOSURE_VERSION,
  AiConsentRevokedError,
  AiWeeklyCapReachedError,
  assertAiConsentLive,
  isBackgroundCapReached,
  publishBackgroundCapState,
  assertBackgroundConsentLive,
  assertInteractiveConsentLive,
  isInteractiveConsentLive,
  isConsentCurrent,
  newConsent,
  publishAiConsentState,
  sanitizeConsent,
} from "./ai-consent";
import { defaultAiConfig, isAiEnabled } from "./settings-types";

const D = new Date(0);

describe("a consent given before AI people protection (disclosure version 1)", () => {
  afterEach(() => setAiDeploymentState({ off: false, route: "direct", invalid: false, keyRestricted: false }));
  it("is not current, so AI stays off until the user consents again", () => {
    const v1 = { acceptedAt: D.toISOString(), disclosureVersion: 1 };
    expect(AI_DISCLOSURE_VERSION).toBeGreaterThan(1);
    expect(isConsentCurrent(v1)).toBe(false);
    const ai = { ...defaultAiConfig, enabled: true, apiKey: "sk-ant-test-key", consent: v1 };
    expect(isAiEnabled(ai)).toBe(false);
    expect(isAiEnabled({ ...ai, consent: newConsent(D) })).toBe(true); // control: the same config with a fresh consent
  });
});

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

describe("the weekly hard cap (AI-03)", () => {
  const live = { ...defaultAiConfig, enabled: true, consent: newConsent(D), backgroundConsent: newConsent(D) };
  afterEach(() => { publishBackgroundCapState(false); publishAiConsentState(undefined); });
  it("blocks the background level with AiWeeklyCapReachedError and leaves the interactive level live", () => {
    publishAiConsentState(live);
    publishBackgroundCapState(true);
    expect(isBackgroundCapReached()).toBe(true);
    expect(() => assertAiConsentLive("background")).toThrow(AiWeeklyCapReachedError);
    expect(() => assertAiConsentLive("interactive")).not.toThrow();
  });
  it("names the error", () => {
    expect(new AiWeeklyCapReachedError().name).toBe("AiWeeklyCapReachedError");
  });
  it("passes again once the cap state is cleared", () => {
    publishAiConsentState(live);
    publishBackgroundCapState(true);
    publishBackgroundCapState(false);
    expect(() => assertAiConsentLive("background")).not.toThrow();
  });
  it("a revoked consent throws AiConsentRevokedError whatever the cap", () => {
    publishAiConsentState({ ...live, backgroundConsent: undefined });
    for (const reached of [true, false]) {
      publishBackgroundCapState(reached);
      expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
    }
  });
});

const GATEWAY = { off: false, route: "gateway", invalid: false, keyRestricted: false } as const;
const RELAY = { off: false, route: "relay", invalid: false, keyRestricted: true } as const;
const DIRECT = { off: false, route: "direct", invalid: false, keyRestricted: false } as const;
const GATEWAY_RESTRICTED = { off: false, route: "gateway", invalid: false, keyRestricted: true } as const;

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
  it("a direct background consent is not live after the interactive consent is given again on the gateway", () => {
    setAiDeploymentState(DIRECT);
    const d = newConsent(D);
    expect(d.route).toBe("direct");
    setAiDeploymentState(GATEWAY);
    const g = newConsent(D);
    publishAiConsentState({ ...defaultAiConfig, enabled: true, consent: g, backgroundConsent: d });
    expect(() => assertAiConsentLive("interactive")).not.toThrow();
    expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
  });
  it("a legacy background record without a route is not live on the gateway either", () => {
    setAiDeploymentState(GATEWAY);
    const g = newConsent(D);
    const legacy = { acceptedAt: D.toISOString(), disclosureVersion: AI_DISCLOSURE_VERSION };
    publishAiConsentState({ ...defaultAiConfig, enabled: true, consent: g, backgroundConsent: legacy });
    expect(() => assertAiConsentLive("interactive")).not.toThrow();
    expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
  });
  it("a direct or gateway record is stale under relay; a new consent records relay and is current", () => {
    const d = newConsent(D);
    setAiDeploymentState(GATEWAY);
    const g = newConsent(D);
    setAiDeploymentState(RELAY);
    expect(isConsentCurrent(d)).toBe(false);
    expect(isConsentCurrent(g)).toBe(false);
    const r = newConsent(D);
    expect(r.route).toBe("relay");
    expect(isConsentCurrent(r)).toBe(true);
    setAiDeploymentState(DIRECT);
    expect(isConsentCurrent(r)).toBe(false);
  });
  it("a gateway consent given without the key restriction is stale once the restriction is on, and a new one is current", () => {
    setAiDeploymentState(GATEWAY);
    const unrestricted = newConsent(D);
    expect(isConsentCurrent(unrestricted)).toBe(true);
    setAiDeploymentState(GATEWAY_RESTRICTED);
    expect(isConsentCurrent(unrestricted)).toBe(false);
    const restricted = newConsent(D);
    expect(restricted.keyRestricted).toBe(true);
    expect(isConsentCurrent(restricted)).toBe(true);
  });
  it("a gateway consent given with the key restriction is stale once the restriction is off", () => {
    setAiDeploymentState(GATEWAY_RESTRICTED);
    const restricted = newConsent(D);
    setAiDeploymentState(GATEWAY);
    expect(isConsentCurrent(restricted)).toBe(false);
    expect(isConsentCurrent(newConsent(D))).toBe(true);
  });
  it("a record without keyRestricted counts as unrestricted", () => {
    const legacy = { acceptedAt: D.toISOString(), disclosureVersion: AI_DISCLOSURE_VERSION, route: "gateway" as const };
    setAiDeploymentState(GATEWAY);
    expect(isConsentCurrent(legacy)).toBe(true);
    setAiDeploymentState(GATEWAY_RESTRICTED);
    expect(isConsentCurrent(legacy)).toBe(false);
  });
  it("sanitizeConsent keeps a boolean keyRestricted and drops anything else", () => {
    const base = { acceptedAt: D.toISOString(), disclosureVersion: 1, route: "gateway" };
    expect(sanitizeConsent({ ...base, keyRestricted: true })?.keyRestricted).toBe(true);
    expect(sanitizeConsent({ ...base, keyRestricted: "yes" })).toEqual(base);
  });
  it("a stored relay route parses", () => {
    expect(sanitizeConsent({ acceptedAt: D.toISOString(), disclosureVersion: 1, route: "relay" })?.route).toBe("relay");
  });
  it("sanitizeConsent keeps a valid route and drops an invalid one", () => {
    expect(sanitizeConsent({ acceptedAt: D.toISOString(), disclosureVersion: 1, route: "gateway" })?.route).toBe("gateway");
    const bad = sanitizeConsent({ acceptedAt: D.toISOString(), disclosureVersion: 1, route: "x" });
    expect(bad).toEqual({ acceptedAt: D.toISOString(), disclosureVersion: 1 });
  });
  it.each([["off", { off: true, route: "direct", invalid: false, keyRestricted: false }], ["invalid", { off: false, route: "direct", invalid: true, keyRestricted: false }]] as const)(
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
