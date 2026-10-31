import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  AI_GATEWAY_TOKEN_ENV,
  AI_GATEWAY_URL_ENV,
  aiDeploymentStateFrom,
  readAiGatewayConfig,
} from "./ai-gateway-config";

const GW = "https://gateway.ai.cloudflare.com/v1/acc/gw/anthropic";

describe("readAiGatewayConfig", () => {
  it("names the two settings", () => {
    expect(AI_GATEWAY_URL_ENV).toBe("AIPM_AI_GATEWAY_URL");
    expect(AI_GATEWAY_TOKEN_ENV).toBe("AIPM_AI_GATEWAY_TOKEN");
  });

  it("is direct when neither setting is set or both are empty", () => {
    expect(readAiGatewayConfig({})).toEqual({ kind: "direct" });
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: "", AIPM_AI_GATEWAY_TOKEN: "" })).toEqual({ kind: "direct" });
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: "  ", AIPM_AI_GATEWAY_TOKEN: " " })).toEqual({ kind: "direct" });
  });

  it("accepts a gateway URL unchanged, without a token", () => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: GW })).toEqual({ kind: "gateway", baseUrl: GW, token: null });
  });

  it("drops a trailing slash", () => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: GW + "/" })).toEqual({ kind: "gateway", baseUrl: GW, token: null });
  });

  it("builds the base URL from the parsed URL", () => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: "https://Gateway.Example.com/x/" })).toEqual({
      kind: "gateway",
      baseUrl: "https://gateway.example.com/x",
      token: null,
    });
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: "https://host" })).toEqual({
      kind: "gateway",
      baseUrl: "https://host",
      token: null,
    });
  });

  it("carries the token, and treats a whitespace-only token as none", () => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: GW, AIPM_AI_GATEWAY_TOKEN: "t" })).toEqual({
      kind: "gateway",
      baseUrl: GW,
      token: "t",
    });
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: GW, AIPM_AI_GATEWAY_TOKEN: "   " })).toEqual({
      kind: "gateway",
      baseUrl: GW,
      token: null,
    });
  });

  it.each([
    "http://gateway.example/x",
    "not a url",
    "https://u:p@host/x",
    "https://host/x?a=1",
    "https://host/x#f",
    "https://host/x/v1",
    "https://host/x/v1/messages",
    "https://host/x/v1/models",
    "https://host/x/V1/Models/",
    "https://host/x/V1",
    "https://@host/x",
    "https://host/x y",
  ])("fails closed on an invalid URL: %s", (url) => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: url })).toEqual({ kind: "invalid", reason: "url" });
  });

  it("fails closed on a token without a URL", () => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_TOKEN: "t" })).toEqual({ kind: "invalid", reason: "token-without-url" });
  });

  // KILLED BY: dropping the token character check (the relay would build a header Node refuses to send).
  it.each([
    ["a space inside", "abc def"],
    ["a tab inside", "abc\tdef"],
    ["a line break inside", "abc\r\nX-Injected: 1"],
    ["a non-ASCII character", "t\u00f6ken"],
    ["a control character", "abc\u0007"],
    ["DEL", "abc\u007f"],
  ])("fails closed on a token a header cannot carry: %s", (_name, token) => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: GW, AIPM_AI_GATEWAY_TOKEN: token })).toEqual({ kind: "invalid", reason: "token" });
  });

  it("accepts every visible ASCII character in a token, and trims the ends", () => {
    const visible = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: GW, AIPM_AI_GATEWAY_TOKEN: ` ${visible}\n` })).toEqual({
      kind: "gateway",
      baseUrl: GW,
      token: visible,
    });
  });
});

describe("an invalid setting is reported on the server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns once per reason per process, naming only the reason code", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readAiGatewayConfig: read, parseAiGatewayConfig: parse } = await import("./ai-gateway-config");
    const badUrl = "http://secret-host.example/gw";
    const badToken = "sekret token";
    // The proxy's side-effect-free parse logs nothing and does not use up the once.
    expect(parse({ AIPM_AI_GATEWAY_URL: badUrl })).toEqual({ kind: "invalid", reason: "url" });
    expect(warn).not.toHaveBeenCalled();
    read({ AIPM_AI_GATEWAY_URL: badUrl });
    read({ AIPM_AI_GATEWAY_URL: badUrl });
    read({ AIPM_AI_GATEWAY_URL: GW, AIPM_AI_GATEWAY_TOKEN: badToken });
    read({ AIPM_AI_GATEWAY_URL: GW, AIPM_AI_GATEWAY_TOKEN: badToken });
    read({ AIPM_AI_GATEWAY_TOKEN: "only-a-token" });
    read({ AIPM_AI_GATEWAY_URL: GW });
    read({});
    const lines = warn.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines).toEqual([
      "ai gateway setting invalid: url",
      "ai gateway setting invalid: token",
      "ai gateway setting invalid: token-without-url",
    ]);
    const all = lines.join(" | ");
    for (const value of ["secret-host", "sekret", "only-a-token", "cloudflare"]) expect(all).not.toContain(value);
  });
});

describe("aiDeploymentStateFrom with a key restriction", () => {
  const ORG = "11111111-2222-3333-4444-555555555555";

  it("a restriction alone takes the relay route", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_ORGANIZATION_ID: ORG })).toEqual({
      off: false,
      route: "relay",
      invalid: false,
      keyRestricted: true,
    });
  });

  it("a restriction with a gateway keeps the gateway route", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_GATEWAY_URL: GW })).toEqual({
      off: false,
      route: "gateway",
      invalid: false,
      keyRestricted: true,
    });
  });

  it("an invalid restriction without a gateway is relay, invalid, with its reason", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_ORGANIZATION_ID: "nope" })).toEqual({
      off: false,
      route: "relay",
      invalid: true,
      invalidReason: "org-id",
      keyRestricted: true,
    });
    expect(aiDeploymentStateFrom({ AIPM_AI_WORKSPACE_IDS: ORG })).toMatchObject({ invalidReason: "workspaces-without-org" });
  });

  it("an invalid restriction beside an invalid gateway reports the restriction's reason", () => {
    expect(aiDeploymentStateFrom({ AIPM_AI_ORGANIZATION_ID: "nope", AIPM_AI_GATEWAY_URL: "http://x" })).toEqual({
      off: false,
      route: "gateway",
      invalid: true,
      invalidReason: "org-id",
      keyRestricted: true,
    });
  });

  it("with no restriction keyRestricted is false and nothing else changes", () => {
    expect(aiDeploymentStateFrom({})).toEqual({ off: false, route: "direct", invalid: false, keyRestricted: false });
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_URL: GW })).toEqual({ off: false, route: "gateway", invalid: false, keyRestricted: false });
    expect(aiDeploymentStateFrom({ AIPM_AI_GATEWAY_TOKEN: "t" })).toEqual({
      off: false,
      route: "direct",
      invalid: true,
      invalidReason: "token-without-url",
      keyRestricted: false,
    });
  });

  it("never carries the ids", () => {
    expect(JSON.stringify(aiDeploymentStateFrom({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: ORG }))).not.toContain(ORG);
  });
});

describe("ai-key-restriction-config stays on the server", () => {
  const ALLOWED = [`proxy.ts`, `app${sep}api${sep}`, `app${sep}layout.tsx`];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it("is imported only by the proxy, the layout, API routes and the gateway config", () => {
    const src = join(process.cwd(), "src");
    const offenders = walk(src)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'][^"']*ai-key-restriction-config["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f))
      .filter((rel) => rel !== `app${sep}ai-gateway-config.ts`)
      .filter((rel) => !ALLOWED.some((a) => rel === a || (a.endsWith(sep) && rel.startsWith(a))));
    expect(offenders).toEqual([]);
  });
});

describe("ai-gateway-config stays on the server", () => {
  const ALLOWED = [`app${sep}layout.tsx`, `proxy.ts`, `app${sep}api${sep}`];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it("is imported only by the layout, the proxy and API routes", () => {
    const src = join(process.cwd(), "src");
    const offenders = walk(src)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'][^"']*ai-gateway-config["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f))
      .filter((rel) => !ALLOWED.some((a) => rel === a || (a.endsWith(sep) && rel.startsWith(a))));
    expect(offenders).toEqual([]);
  });
});
