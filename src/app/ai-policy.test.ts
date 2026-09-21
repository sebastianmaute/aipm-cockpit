import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_POLICY_ORG,
  DEFAULT_AI_POLICY_URL,
  isSafePolicyUrl,
  resolveAiPolicy,
} from "./ai-policy";

const NO_ENV = { org: undefined, url: undefined };

describe("isSafePolicyUrl", () => {
  it("accepts an https URL", () => {
    expect(isSafePolicyUrl("https://example.com/ai-policy")).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["plain http", "http://example.com/policy"],
    ["no scheme", "example.com/policy"],
    ["blank", "   "],
    ["unparseable", "https://"],
  ])("rejects %s", (_label, value) => {
    expect(isSafePolicyUrl(value)).toBe(false);
  });
});

describe("resolveAiPolicy", () => {
  it("falls back to the built-in owner and link when nothing is configured", () => {
    const p = resolveAiPolicy({}, NO_ENV);
    expect(p).toMatchObject({ org: DEFAULT_AI_POLICY_ORG, url: DEFAULT_AI_POLICY_URL, orgFromEnv: false, urlFromEnv: false });
  });

  it("uses the Settings values when no environment value is set", () => {
    const p = resolveAiPolicy({ policyOrgName: " Acme GmbH ", policyUrl: "https://acme.example/ai" }, NO_ENV);
    expect(p.org).toBe("Acme GmbH");
    expect(p.url).toBe("https://acme.example/ai");
  });

  it("lets the deployment environment override Settings", () => {
    const p = resolveAiPolicy(
      { policyOrgName: "Acme GmbH", policyUrl: "https://acme.example/ai" },
      { org: "Globex", url: "https://globex.example/policy" },
    );
    expect(p).toMatchObject({ org: "Globex", url: "https://globex.example/policy", orgFromEnv: true, urlFromEnv: true });
  });

  it("ignores a blank environment value", () => {
    const p = resolveAiPolicy({ policyOrgName: "Acme GmbH" }, { org: "  ", url: "" });
    expect(p).toMatchObject({ org: "Acme GmbH", orgFromEnv: false, urlFromEnv: false });
  });

  it("ignores an unsafe environment URL rather than rendering it", () => {
    const p = resolveAiPolicy({ policyUrl: "https://acme.example/ai" }, { org: undefined, url: "javascript:alert(1)" });
    expect(p.url).toBe("https://acme.example/ai");
    expect(p.urlFromEnv).toBe(false);
  });

  it("a cleared link means there is no policy", () => {
    expect(resolveAiPolicy({ policyUrl: "" }, NO_ENV).url).toBeNull();
  });

  it("an unsafe Settings link means there is no policy, never a live href", () => {
    expect(resolveAiPolicy({ policyUrl: "javascript:alert(1)" }, NO_ENV).url).toBeNull();
  });

  it("a cleared owner name resolves to null, so callers use their neutral wording", () => {
    expect(resolveAiPolicy({ policyOrgName: "" }, NO_ENV).org).toBeNull();
  });
});
