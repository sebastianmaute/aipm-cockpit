import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiDeploymentStateFrom } from "./ai-gateway-config";
import {
  currentAiRoute,
  getAiDeploymentState,
  isAiDeploymentOn,
  setAiDeploymentState,
} from "./ai-deployment";

const URL_ = "https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic";

describe("aiDeploymentStateFrom", () => {
  it("is direct, on, valid for an empty environment", () => {
    expect(aiDeploymentStateFrom({})).toEqual({ off: false, route: "direct", invalid: false });
  });

  it("reads the ai switch from the disabled list", () => {
    expect(aiDeploymentStateFrom({ AIPM_DISABLED_INTEGRATIONS: "jira, AI" }).off).toBe(true);
    expect(aiDeploymentStateFrom({ AIPM_DISABLED_INTEGRATIONS: "jira" }).off).toBe(false);
  });

  it("routes through the gateway when a valid URL is set", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_ })).toEqual({ off: false, route: "gateway", invalid: false });
  });

  it("marks an invalid setting invalid, never gateway", () => {
    const bad = aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: "http://x" });
    expect(bad).toEqual({ off: false, route: "direct", invalid: true });
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_TOKEN: "t" }).invalid).toBe(true);
  });

  it("combines off and gateway", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_DISABLED_INTEGRATIONS: "ai" })).toEqual({
      off: true,
      route: "gateway",
      invalid: false,
    });
  });

  it("never carries the URL or the token", () => {
    const json = JSON.stringify(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: URL_, AIPM_AI_GATEWAY_TOKEN: "sekret-token" }));
    expect(json).not.toContain("cloudflare");
    expect(json).not.toContain("sekret-token");
  });
});

describe("the client store", () => {
  beforeEach(() => setAiDeploymentState({ off: false, route: "direct", invalid: false }));

  it("defaults to direct and on", () => {
    expect(getAiDeploymentState()).toEqual({ off: false, route: "direct", invalid: false });
    expect(currentAiRoute()).toBe("direct");
    expect(isAiDeploymentOn()).toBe(true);
  });

  it("records the route", () => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: false });
    expect(currentAiRoute()).toBe("gateway");
  });

  it("is off when switched off or invalid", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    expect(isAiDeploymentOn()).toBe(false);
    setAiDeploymentState({ off: false, route: "direct", invalid: true });
    expect(isAiDeploymentOn()).toBe(false);
  });
});

describe("invalid state diagnostics", () => {
  it("logs ai.gateway.invalid once per page load, with no fields", async () => {
    vi.resetModules();
    localStorage.clear();
    const dep = await import("./ai-deployment");
    const diag = await import("./diagnostics");
    dep.setAiDeploymentState({ off: false, route: "direct", invalid: true });
    dep.setAiDeploymentState({ off: false, route: "direct", invalid: true });
    const hits = diag.readDiagLog().filter((e) => e.code === "ai.gateway.invalid");
    expect(hits).toHaveLength(1);
    expect(hits[0].level).toBe("warn");
    expect(hits[0].fields ?? {}).toEqual({});
    dep.setAiDeploymentState({ off: false, route: "direct", invalid: false });
  });
});
