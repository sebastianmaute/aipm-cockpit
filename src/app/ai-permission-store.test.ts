// AI-01 / M2 — the pure core of the AI-permission store, and its page state. The hook-level behaviour (re-reads,
// broadcasts, the persist and publish effects) is pinned by use-settings.consent.test.ts against the real hook.
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetConsentFailureForTests,
  aiForPublish,
  aiPermissionToWrite,
  aiToPublishOf,
  EMPTY_AI_PERMISSION_STORE,
  isOnlyStorageAiChange,
  isReportedRevoke,
  narrowingAfterFailedWrite,
  narrowOnly,
  noteConsentRevokeNotSaved,
  pageAiState,
  pageAiStateOf,
  parseStoredAiState,
  planAiPermissionWrite,
  planPageAiPermissionWrite,
  sameAiState,
  settleAiPermissionWrite,
  withAiState,
  type AiPermissionStore,
  type PersistedAiState,
} from "./ai-permission-store";
import { newConsent, type AiConsent } from "./ai-consent";
import { defaultSettings, type AiConfig, type Settings } from "./settings-types";

const C1 = newConsent(new Date("2026-10-01T00:00:00Z"));
const C2 = newConsent(new Date("2026-10-02T00:00:00Z"));
const B1 = newConsent(new Date("2026-10-03T00:00:00Z"));

const ON: PersistedAiState = { enabled: true, consent: C1, backgroundConsent: B1 };
const OFF: PersistedAiState = { enabled: false, consent: undefined, backgroundConsent: undefined };
const ai = (over: Partial<AiConfig> = {}): AiConfig => ({ ...defaultSettings.ai, enabled: true, consent: C1, backgroundConsent: B1, ...over });

afterEach(() => __resetConsentFailureForTests());

describe("parseStoredAiState", () => {
  it("reads no blob and an unreadable one as switched off with no consent", () => {
    expect(parseStoredAiState(null)).toEqual(OFF);
    expect(parseStoredAiState("{not json")).toEqual(OFF);
    expect(parseStoredAiState(JSON.stringify({ ai: "x" }))).toEqual(OFF);
  });

  it("reads the switch and both records through the load sanitizer", () => {
    expect(parseStoredAiState(JSON.stringify({ ai: { enabled: true, consent: C1, backgroundConsent: B1 } }))).toEqual(ON);
    expect(parseStoredAiState(JSON.stringify({ ai: { enabled: "yes", consent: { acceptedAt: "bad" } } }))).toEqual(OFF);
  });
});

describe("narrowOnly — an ordinary write only narrows", () => {
  it("cannot switch on or add a consent the base does not hold", () => {
    expect(narrowOnly(ai(), OFF)).toEqual({ enabled: false, consent: undefined, backgroundConsent: undefined });
  });

  it("takes a switch-off and an absent record, and keeps the base's record where the copy holds one", () => {
    expect(narrowOnly(ai({ enabled: false, consent: undefined, backgroundConsent: C2 }), ON))
      .toEqual({ enabled: false, consent: undefined, backgroundConsent: B1 });
  });

  it("keeps an unset switch unset", () => {
    expect(narrowOnly(ai({ enabled: undefined }), ON).enabled).toBeUndefined();
  });
});

describe("aiPermissionToWrite — only the named fields widen", () => {
  it("widens the switch and the consent of an accept, and nothing else", () => {
    const written = aiPermissionToWrite(ai({ consent: C2 }), ["enabled", "consent"], OFF);
    expect(written).toEqual({ enabled: true, consent: C2, backgroundConsent: undefined });
  });

  it("widens nothing for a revoke", () => {
    expect(aiPermissionToWrite(ai({ consent: undefined, backgroundConsent: undefined }), [], ON))
      .toEqual({ enabled: true, consent: undefined, backgroundConsent: undefined });
  });
});

describe("narrowingAfterFailedWrite", () => {
  it("names only where the failed write narrows storage", () => {
    expect(narrowingAfterFailedWrite(ON, { enabled: false, consent: C1, backgroundConsent: undefined }))
      .toEqual({ switchedOff: true, consent: undefined, backgroundConsent: B1 });
    expect(narrowingAfterFailedWrite(OFF, { enabled: false })).toBeNull();
  });
});

describe("planAiPermissionWrite — action → what is written and the store after it", () => {
  const reported: AiPermissionStore = { unsavedNarrowing: null, reportedRevokeAi: ai({ consent: undefined }) };

  it("a successful write clears the unsaved narrowing and the reported revoke", () => {
    const store: AiPermissionStore = { unsavedNarrowing: { switchedOff: true, consent: undefined, backgroundConsent: undefined }, reportedRevokeAi: ai() };
    expect(planAiPermissionWrite(store, ON, ai(), []).afterSuccess).toEqual(EMPTY_AI_PERMISSION_STORE);
  });

  it("a failed switch-off notes it and keeps the reported revoke", () => {
    const plan = planAiPermissionWrite(reported, ON, ai({ enabled: false }), []);
    expect(plan.permission.enabled).toBe(false);
    expect(plan.afterFailure).toEqual({ ...reported, unsavedNarrowing: { switchedOff: true, consent: undefined, backgroundConsent: undefined } });
  });

  it("a failed withdrawal of the consent notes the stored record it withdrew", () => {
    const plan = planAiPermissionWrite(EMPTY_AI_PERMISSION_STORE, ON, ai({ consent: undefined }), []);
    expect(plan.afterFailure.unsavedNarrowing).toEqual({ switchedOff: false, consent: C1, backgroundConsent: undefined });
  });

  it("a failed write that narrows nothing notes nothing, a failed widening included", () => {
    expect(planAiPermissionWrite(EMPTY_AI_PERMISSION_STORE, ON, ai(), []).afterFailure.unsavedNarrowing).toBeNull();
    expect(planAiPermissionWrite(EMPTY_AI_PERMISSION_STORE, OFF, ai(), ["enabled", "consent"]).afterFailure.unsavedNarrowing).toBeNull();
  });

  it("writes against the page's state, so an earlier unsaved switch-off is carried on", () => {
    const store: AiPermissionStore = { unsavedNarrowing: { switchedOff: true, consent: undefined, backgroundConsent: undefined }, reportedRevokeAi: null };
    const plan = planAiPermissionWrite(store, ON, ai(), []);
    expect(plan.permission.enabled).toBe(false);
    expect(plan.afterFailure.unsavedNarrowing?.switchedOff).toBe(true);
  });

  it("settings without an AI slice keep the page's state", () => {
    expect(planAiPermissionWrite(EMPTY_AI_PERMISSION_STORE, ON, undefined, []).permission).toEqual(ON);
  });
});

describe("the page's state and what is published", () => {
  const withdrewC1: AiPermissionStore = { unsavedNarrowing: { switchedOff: false, consent: C1, backgroundConsent: undefined }, reportedRevokeAi: null };

  it("narrows storage by the withdrawn record while storage still holds it", () => {
    expect(pageAiStateOf(withdrewC1, ON)).toEqual({ ...ON, consent: undefined });
  });

  it("takes a different record (a newer accept elsewhere)", () => {
    expect(pageAiStateOf(withdrewC1, { ...ON, consent: C2 })).toEqual({ ...ON, consent: C2 });
  });

  it("publishes a stale copy with the withdrawal applied", () => {
    expect(aiToPublishOf(withdrewC1, ai()).consent).toBeUndefined();
    expect(aiToPublishOf(EMPTY_AI_PERMISSION_STORE, ai()).consent).toEqual(C1);
  });
});

describe("isOnlyStorageAiChange and withAiState", () => {
  const base: Settings = { ...defaultSettings, ai: ai() };

  it("is true for a commit that changes only the three AI fields to what storage holds", () => {
    const next = withAiState(base, OFF);
    expect(isOnlyStorageAiChange(base, next, OFF)).toBe(true);
  });

  it("is false when another change rides in the same commit, or nothing was read", () => {
    const next = { ...withAiState(base, OFF), language: "de" as const };
    expect(isOnlyStorageAiChange(base, next, OFF)).toBe(false);
    expect(isOnlyStorageAiChange(base, withAiState(base, OFF), null)).toBe(false);
  });

  it("withAiState returns the same object when it already holds that state", () => {
    expect(withAiState(base, ON)).toBe(base);
  });
});

describe("the page store", () => {
  it("a noted revoke is recognised until a write succeeds, and survives a failed one", () => {
    const revoked: Settings = { ...defaultSettings, ai: ai({ consent: undefined }) };
    noteConsentRevokeNotSaved(revoked);
    expect(isReportedRevoke(revoked.ai)).toBe(true);
    expect(isReportedRevoke({ ...revoked.ai })).toBe(false);
    const failed = planPageAiPermissionWrite(ON, revoked.ai, []);
    settleAiPermissionWrite(failed, false);
    expect(isReportedRevoke(revoked.ai)).toBe(true);
    expect(pageAiState(ON).consent).toBeUndefined();
    expect(aiForPublish(ai()).consent).toBeUndefined();
    settleAiPermissionWrite(planPageAiPermissionWrite(ON, revoked.ai, []), true);
    expect(isReportedRevoke(revoked.ai)).toBe(false);
    expect(pageAiState(ON)).toEqual(ON);
  });

  it("the test seam forgets both records", () => {
    noteConsentRevokeNotSaved({ ...defaultSettings, ai: ai() });
    settleAiPermissionWrite(planPageAiPermissionWrite(ON, ai({ enabled: false }), []), false);
    __resetConsentFailureForTests();
    expect(pageAiState(ON)).toEqual(ON);
  });
});

describe("sameAiState — the route is part of a consent record", () => {
  const base = { acceptedAt: new Date(0).toISOString(), disclosureVersion: 1 };
  const state = (c: AiConsent | undefined) => ({ enabled: true, consent: c, backgroundConsent: undefined });
  it("treats an absent route as direct", () => {
    expect(sameAiState({ enabled: true, consent: { ...base, route: "direct" } }, state(base))).toBe(true);
  });
  it("tells a gateway record from a direct one", () => {
    expect(sameAiState({ enabled: true, consent: { ...base, route: "gateway" } }, state(base))).toBe(false);
    expect(sameAiState({ enabled: true, consent: base }, state({ ...base, route: "gateway" }))).toBe(false);
  });
  it("tells a consent given under the key restriction from one given without it (absent = unrestricted)", () => {
    const gw = { ...base, route: "gateway" as const };
    expect(sameAiState({ enabled: true, consent: { ...gw, keyRestricted: true } }, state(gw))).toBe(false);
    expect(sameAiState({ enabled: true, consent: { ...gw, keyRestricted: false } }, state(gw))).toBe(true);
  });
});
