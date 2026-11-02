import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiDeploymentStateFrom } from "./ai-gateway-config";
import {
  aiDeploymentBlockedMessageKey,
  currentAiRoute,
  getAiDeploymentState,
  isAiDeploymentOn,
  sanitizeChatSettings,
  setAiDeploymentState,
} from "./ai-deployment";

const CHAT_DEFAULTS = { retentionDays: 30, retentionInvalid: false, recoveryKey: null, recoveryKeyInvalid: false };
const URL_ = "https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic";

describe("aiDeploymentStateFrom", () => {
  it("is direct, on, valid for an empty environment", () => {
    expect(aiDeploymentStateFrom({})).toEqual({ off: false, route: "direct", invalid: false, keyRestricted: false, chat: CHAT_DEFAULTS });
  });

  it("reads the ai switch from the disabled list", () => {
    expect(aiDeploymentStateFrom({ AIPM_DISABLED_INTEGRATIONS: "jira, AI" }).off).toBe(true);
    expect(aiDeploymentStateFrom({ AIPM_DISABLED_INTEGRATIONS: "jira" }).off).toBe(false);
  });

  it("routes through the gateway when a valid URL is set", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_ })).toEqual({
      off: false,
      route: "gateway",
      invalid: false,
      keyRestricted: false, chat: CHAT_DEFAULTS,
    });
  });

  it("marks an invalid setting invalid; a set URL keeps the gateway route the operator meant", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: "http://x" })).toEqual({
      off: false,
      route: "gateway",
      invalid: true,
      invalidReason: "url",
      keyRestricted: false, chat: CHAT_DEFAULTS,
    });
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_AI_GATEWAY_TOKEN: "a b" })).toEqual({
      off: false,
      route: "gateway",
      invalid: true,
      invalidReason: "token",
      keyRestricted: false, chat: CHAT_DEFAULTS,
    });
    // A token with no URL names no gateway: the route stays direct.
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_TOKEN: "t" })).toEqual({
      off: false,
      route: "direct",
      invalid: true,
      invalidReason: "token-without-url",
      keyRestricted: false, chat: CHAT_DEFAULTS,
    });
  });

  it("combines off and gateway", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_DISABLED_INTEGRATIONS: "ai" })).toEqual({
      off: true,
      route: "gateway",
      invalid: false,
      keyRestricted: false, chat: CHAT_DEFAULTS,
    });
  });

  it("never carries the URL or the token", () => {
    const json = JSON.stringify(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_AI_GATEWAY_TOKEN: "sekret-token" }));
    expect(json).not.toContain("cloudflare");
    expect(json).not.toContain("sekret-token");
  });
});

describe("the client store", () => {
  beforeEach(() => setAiDeploymentState({ off: false, route: "direct", invalid: false, keyRestricted: false, chat: null }));

  it("defaults to direct and on", () => {
    expect(getAiDeploymentState()).toEqual({ off: false, route: "direct", invalid: false, keyRestricted: false, chat: null });
    expect(currentAiRoute()).toBe("direct");
    expect(isAiDeploymentOn()).toBe(true);
  });

  it("records the route", () => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: false, keyRestricted: false, chat: null });
    expect(currentAiRoute()).toBe("gateway");
  });

  it("names the block: invalid before off, null while AI is usable", () => {
    expect(aiDeploymentBlockedMessageKey()).toBeNull();
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false, chat: null });
    expect(aiDeploymentBlockedMessageKey()).toBe("aiDeploymentOff");
    setAiDeploymentState({ off: true, route: "gateway", invalid: true, invalidReason: "url", keyRestricted: false, chat: null });
    expect(aiDeploymentBlockedMessageKey()).toBe("aiDeploymentInvalid");
    setAiDeploymentState({ off: false, route: "gateway", invalid: true, invalidReason: "token", keyRestricted: false, chat: null });
    expect(aiDeploymentBlockedMessageKey()).toBe("aiDeploymentInvalid");
  });

  it("is off when switched off or invalid", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false, chat: null });
    expect(isAiDeploymentOn()).toBe(false);
    setAiDeploymentState({ off: false, route: "direct", invalid: true, keyRestricted: false, chat: null });
    expect(isAiDeploymentOn()).toBe(false);
  });
});

describe("invalid state diagnostics", () => {
  it("logs ai.gateway.invalid once per page load, with the reason code only", async () => {
    vi.resetModules();
    localStorage.clear();
    const dep = await import("./ai-deployment");
    const diag = await import("./diagnostics");
    dep.setAiDeploymentState({ off: false, route: "gateway", invalid: true, invalidReason: "token", keyRestricted: false, chat: null });
    dep.setAiDeploymentState({ off: false, route: "gateway", invalid: true, invalidReason: "token", keyRestricted: false, chat: null });
    const hits = diag.readDiagLog().filter((e) => e.code === "ai.gateway.invalid");
    expect(hits).toHaveLength(1);
    expect(hits[0].level).toBe("warn");
    expect(hits[0].fields).toEqual({ reason: "token" });
    expect(dep.getAiDeploymentState().invalidReason).toBe("token");
    dep.setAiDeploymentState({ off: false, route: "direct", invalid: false, keyRestricted: false, chat: null });
    expect(dep.getAiDeploymentState().invalidReason).toBeUndefined();
  });
});

describe("chat settings in the client store", () => {
  const CHAT = { retentionDays: 90, retentionInvalid: false, recoveryKey: "AAAA", recoveryKeyInvalid: false };
  const base = { off: false, route: "direct", invalid: false, keyRestricted: false } as const;

  it("keeps well-formed settings", () => {
    setAiDeploymentState({ ...base, chat: CHAT });
    expect(getAiDeploymentState().chat).toEqual(CHAT);
  });

  it("treats an absent or malformed chat from an older server as unknown, never as defaults", () => {
    const bad: unknown[] = [undefined, null, "x", {}, { ...CHAT, retentionDays: "90" }, { ...CHAT, retentionDays: 0 }, { ...CHAT, retentionInvalid: 1 }, { ...CHAT, recoveryKey: 5 }, { ...CHAT, recoveryKeyInvalid: undefined }];
    for (const chat of bad) {
      setAiDeploymentState({ ...base, chat } as never);
      expect(getAiDeploymentState().chat).toBeNull();
    }
  });

  it("sanitizes by shape and drops extra fields", () => {
    expect(sanitizeChatSettings({ ...CHAT, extra: 1 })).toEqual(CHAT);
    expect(sanitizeChatSettings({ ...CHAT, recoveryKey: null })?.recoveryKey).toBeNull();
  });
});
