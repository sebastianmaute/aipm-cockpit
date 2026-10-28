// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as route from "./route";

const URL_SETTING = "https://gateway.example.com/acct/gw/anthropic";
const TOKEN = "gateway-secret-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function status(env: Record<string, string>): Promise<{ res: Response; text: string }> {
  vi.stubEnv("AIPM_AI_GATEWAY_URL", "");
  vi.stubEnv("AIPM_AI_GATEWAY_TOKEN", "");
  vi.stubEnv("AIPM_DISABLED_INTEGRATIONS", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const res = await route.GET();
  return { res, text: await res.text() };
}

describe("GET /api/ai/status", () => {
  it("runs on node and is never prerendered", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it.each([
    ["direct", {}, { off: false, route: "direct", invalid: false }],
    [
      "gateway",
      { AIPM_AI_GATEWAY_URL: URL_SETTING, AIPM_AI_GATEWAY_TOKEN: TOKEN },
      { off: false, route: "gateway", invalid: false },
    ],
    [
      "off",
      { AIPM_DISABLED_INTEGRATIONS: "ai", AIPM_AI_GATEWAY_URL: URL_SETTING },
      { off: true, route: "gateway", invalid: false },
    ],
    [
      "invalid (token without URL)",
      { AIPM_AI_GATEWAY_TOKEN: TOKEN },
      { off: false, route: "direct", invalid: true, invalidReason: "token-without-url" },
    ],
    [
      "invalid (URL)",
      { AIPM_AI_GATEWAY_URL: "http://gateway.example.com/gw", AIPM_AI_GATEWAY_TOKEN: TOKEN },
      { off: false, route: "gateway", invalid: true, invalidReason: "url" },
    ],
  ])("%s → 200 with the state, no-store", async (_name, env, expected) => {
    const { res, text } = await status(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual(expected);
    expect(text).not.toContain("gateway.example.com");
    expect(text).not.toContain(TOKEN);
  });
});
