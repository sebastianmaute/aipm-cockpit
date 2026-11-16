import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiBackgroundPausedError,
  AiConsentRevokedError,
  assertAiConsentLive,
  backgroundPauseReason,
  newConsent,
  publishAiConsentState,
  publishBackgroundProjectOff,
} from "./ai-consent";
import { addDisabledIntegration, setDisabledIntegrations } from "./integration-switches";
import { defaultAiConfig } from "./settings-types";

const D = new Date("2026-01-01T00:00:00Z");
const live = { ...defaultAiConfig, enabled: true, consent: newConsent(D), backgroundConsent: newConsent(D) };

beforeEach(() => {
  publishAiConsentState(live);
  publishBackgroundProjectOff(false);
});
afterEach(() => {
  setDisabledIntegrations([]);
  publishAiConsentState(undefined);
  publishBackgroundProjectOff(false);
});

describe("the background pause", () => {
  it("refuses a background send while the open project pauses background AI", () => {
    publishBackgroundProjectOff(true);
    expect(() => assertAiConsentLive("background")).toThrow(AiBackgroundPausedError);
    try {
      assertAiConsentLive("background");
    } catch (e) {
      expect((e as AiBackgroundPausedError).reason).toBe("project");
      expect((e as Error).name).toBe("AiBackgroundPausedError");
    }
  });

  it("refuses under the ai-background deployment lock", () => {
    addDisabledIntegration("ai-background");
    expect(() => assertAiConsentLive("background")).toThrow(AiBackgroundPausedError);
    try {
      assertAiConsentLive("background");
    } catch (e) {
      expect((e as AiBackgroundPausedError).reason).toBe("deployment");
    }
    publishBackgroundProjectOff(true);
    expect(backgroundPauseReason()).toBe("deployment");
  });

  it("leaves interactive sends alone", () => {
    publishBackgroundProjectOff(true);
    expect(() => assertAiConsentLive("interactive")).not.toThrow();
  });

  it("runs when neither pauses", () => {
    expect(backgroundPauseReason()).toBeNull();
    expect(() => assertAiConsentLive("background")).not.toThrow();
  });

  it("a missing background consent still reports the consent", () => {
    publishAiConsentState({ ...live, backgroundConsent: undefined });
    publishBackgroundProjectOff(true);
    expect(() => assertAiConsentLive("background")).toThrow(AiConsentRevokedError);
  });

  it("fails closed before any project publishes", async () => {
    vi.resetModules();
    const fresh = await import("./ai-consent");
    expect(fresh.backgroundPauseReason()).toBe("project");
  });

  it("switching projects re-publishes", () => {
    publishBackgroundProjectOff(true);
    expect(backgroundPauseReason()).toBe("project");
    publishBackgroundProjectOff(false);
    expect(backgroundPauseReason()).toBeNull();
    publishBackgroundProjectOff(true);
    expect(backgroundPauseReason()).toBe("project");
  });
});

describe("the pause follows the project a run targets", () => {
  const paused = { settingsOverrides: { ai: { backgroundOff: true as const } } };
  const open = { settingsOverrides: undefined };

  it("a target with backgroundOff pauses while the published flag is false", () => {
    publishBackgroundProjectOff(false);
    expect(backgroundPauseReason(paused)).toBe("project");
    expect(() => assertAiConsentLive("background", paused)).toThrow(expect.objectContaining({ name: "AiBackgroundPausedError", reason: "project" }));
  });

  it("a target without it runs while the published flag is true", () => {
    publishBackgroundProjectOff(true);
    expect(backgroundPauseReason(open)).toBeNull();
    expect(() => assertAiConsentLive("background", open)).not.toThrow();
  });

  it("the deployment lock wins over a target that does not pause", () => {
    addDisabledIntegration("ai-background");
    expect(backgroundPauseReason(open)).toBe("deployment");
  });

  it("interactive ignores a paused target", () => {
    expect(() => assertAiConsentLive("interactive", paused)).not.toThrow();
  });
});
