import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiDeploymentStateFrom } from "./ai-gateway-config";
import {
  aiDeploymentBlockedMessageKey,
  currentAiRoute,
  getAiDeploymentState,
  isAiDeploymentOn,
  setAiDeploymentState,
} from "./ai-deployment";

const URL_ = "https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic";

describe("aiDeploymentStateFrom", () => {
  it("is direct, on, valid for an empty environment", () => {
    expect(aiDeploymentStateFrom({})).toEqual({ off: false, route: "direct", invalid: false, keyRestricted: false });
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
      keyRestricted: false,
    });
  });

  it("marks an invalid setting invalid; a set URL keeps the gateway route the operator meant", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: "http://x" })).toEqual({
      off: false,
      route: "gateway",
      invalid: true,
      invalidReason: "url",
      keyRestricted: false,
    });
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_AI_GATEWAY_TOKEN: "a b" })).toEqual({
      off: false,
      route: "gateway",
      invalid: true,
      invalidReason: "token",
      keyRestricted: false,
    });
    // A token with no URL names no gateway: the route stays direct.
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_TOKEN: "t" })).toEqual({
      off: false,
      route: "direct",
      invalid: true,
      invalidReason: "token-without-url",
      keyRestricted: false,
    });
  });

  it("combines off and gateway", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_DISABLED_INTEGRATIONS: "ai" })).toEqual({
      off: true,
      route: "gateway",
      invalid: false,
      keyRestricted: false,
    });
  });

  it("never carries the URL or the token", () => {
    const json = JSON.stringify(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_AI_GATEWAY_TOKEN: "sekret-token" }));
    expect(json).not.toContain("cloudflare");
    expect(json).not.toContain("sekret-token");
  });
});

describe("the client store", () => {
  beforeEach(() => setAiDeploymentState({ off: false, route: "direct", invalid: false, keyRestricted: false }));

  it("defaults to direct and on", () => {
    expect(getAiDeploymentState()).toEqual({ off: false, route: "direct", invalid: false, keyRestricted: false });
    expect(currentAiRoute()).toBe("direct");
    expect(isAiDeploymentOn()).toBe(true);
  });

  it("records the route", () => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: false, keyRestricted: false });
    expect(currentAiRoute()).toBe("gateway");
  });

  it("names the block: invalid before off, null while AI is usable", () => {
    expect(aiDeploymentBlockedMessageKey()).toBeNull();
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false });
    expect(aiDeploymentBlockedMessageKey()).toBe("aiDeploymentOff");
    setAiDeploymentState({ off: true, route: "gateway", invalid: true, invalidReason: "url", keyRestricted: false });
    expect(aiDeploymentBlockedMessageKey()).toBe("aiDeploymentInvalid");
    setAiDeploymentState({ off: false, route: "gateway", invalid: true, invalidReason: "token", keyRestricted: false });
    expect(aiDeploymentBlockedMessageKey()).toBe("aiDeploymentInvalid");
  });

  it("is off when switched off or invalid", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false });
    expect(isAiDeploymentOn()).toBe(false);
    setAiDeploymentState({ off: false, route: "direct", invalid: true, keyRestricted: false });
    expect(isAiDeploymentOn()).toBe(false);
  });
});

describe("invalid state diagnostics", () => {
  it("logs ai.gateway.invalid once per page load, with the reason code only", async () => {
    vi.resetModules();
    localStorage.clear();
    const dep = await import("./ai-deployment");
    const diag = await import("./diagnostics");
    dep.setAiDeploymentState({ off: false, route: "gateway", invalid: true, invalidReason: "token", keyRestricted: false });
    dep.setAiDeploymentState({ off: false, route: "gateway", invalid: true, invalidReason: "token", keyRestricted: false });
    const hits = diag.readDiagLog().filter((e) => e.code === "ai.gateway.invalid");
    expect(hits).toHaveLength(1);
    expect(hits[0].level).toBe("warn");
    expect(hits[0].fields).toEqual({ reason: "token" });
    expect(dep.getAiDeploymentState().invalidReason).toBe("token");
    dep.setAiDeploymentState({ off: false, route: "direct", invalid: false, keyRestricted: false });
    expect(dep.getAiDeploymentState().invalidReason).toBeUndefined();
  });
});
