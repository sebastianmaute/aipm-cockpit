import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  AI_GATEWAY_TOKEN_ENV,
  AI_GATEWAY_URL_ENV,
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
    "https://host/x/V1",
    "https://@host/x",
    "https://host/x y",
  ])("fails closed on an invalid URL: %s", (url) => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_URL: url })).toEqual({ kind: "invalid", reason: "url" });
  });

  it("fails closed on a token without a URL", () => {
    expect(readAiGatewayConfig({ AIPM_AI_GATEWAY_TOKEN: "t" })).toEqual({ kind: "invalid", reason: "token-without-url" });
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
