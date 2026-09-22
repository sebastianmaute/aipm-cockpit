import { describe, expect, it } from "vitest";
import { isSafePolicyUrl, resolveAiPolicy } from "./ai-policy";

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
  it("resolves to no policy when neither env nor Settings supplies one", () => {
    const p = resolveAiPolicy({}, { org: undefined, url: undefined });
    expect(p).toMatchObject({ org: null, url: null, orgFromEnv: false, urlFromEnv: false });
  });

  // Stand-in for a stored owner equal to a retired built-in default: no code may
  // know that name, so a stored owner is kept verbatim and given no link.
  it("keeps a stored owner verbatim and gives it no link when none is stored", () => {
    const p = resolveAiPolicy({ policyOrgName: "Globex" }, { org: undefined, url: undefined });
    expect(p.org).toBe("Globex");
    expect(p.url).toBeNull();
  });

  it("still honours both build variables", () => {
    const p = resolveAiPolicy({}, { org: "Globex", url: "https://globex.example/policy" });
    expect(p).toMatchObject({ org: "Globex", url: "https://globex.example/policy" });
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

  // ★★ There is no built-in link. A configured owner never gets a link it did not
  //    itself supply, from Settings or from the environment.
  it("a custom owner with no link configured gets NO link", () => {
    expect(resolveAiPolicy({ policyOrgName: "Acme GmbH" }, NO_ENV).url).toBeNull();
    expect(resolveAiPolicy({}, { org: "Acme GmbH", url: undefined }).url).toBeNull();
    expect(resolveAiPolicy({ policyOrgName: "" }, NO_ENV).url).toBeNull();
  });

  it("a custom owner WITH its own link keeps that link", () => {
    expect(resolveAiPolicy({ policyOrgName: "Acme GmbH", policyUrl: "https://acme.example/ai" }, NO_ENV).url)
      .toBe("https://acme.example/ai");
  });

  it("reports a deployment link it had to reject, so Settings can say so", () => {
    const p = resolveAiPolicy({}, { org: undefined, url: "http://intranet/policy" });
    expect(p.urlEnvRejected).toBe(true);
    expect(p.urlFromEnv).toBe(false);
    expect(resolveAiPolicy({}, NO_ENV).urlEnvRejected).toBe(false);
  });

  it("a cleared owner name resolves to null, so callers use their neutral wording", () => {
    expect(resolveAiPolicy({ policyOrgName: "" }, NO_ENV).org).toBeNull();
  });
});
