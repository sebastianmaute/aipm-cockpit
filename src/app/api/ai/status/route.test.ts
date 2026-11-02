// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import * as route from "./route";

const URL_SETTING = "https://gateway.example.com/acct/gw/anthropic";
const TOKEN = "gateway-secret-token";
const CHAT_DEFAULTS = { retentionDays: 30, retentionInvalid: false, recoveryKey: null, recoveryKeyInvalid: false };

afterEach(() => {
  vi.unstubAllEnvs();
});

async function status(env: Record<string, string>): Promise<{ res: Response; text: string }> {
  vi.stubEnv("AIPM_AI_GATEWAY_URL", "");
  vi.stubEnv("AIPM_AI_GATEWAY_TOKEN", "");
  vi.stubEnv("AIPM_DISABLED_INTEGRATIONS", "");
  vi.stubEnv("AIPM_AI_ORGANIZATION_ID", "");
  vi.stubEnv("AIPM_AI_WORKSPACE_IDS", "");
  vi.stubEnv("AIPM_AI_CHAT_RETENTION_DAYS", "");
  vi.stubEnv("AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY", "");
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
    ["direct", {}, { off: false, route: "direct", invalid: false, keyRestricted: false, chat: CHAT_DEFAULTS, peopleForced: false }],
    [
      "gateway",
      { AIPM_AI_GATEWAY_URL: URL_SETTING, AIPM_AI_GATEWAY_TOKEN: TOKEN },
      { off: false, route: "gateway", invalid: false, keyRestricted: false, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
    [
      "off",
      { AIPM_DISABLED_INTEGRATIONS: "ai", AIPM_AI_GATEWAY_URL: URL_SETTING },
      { off: true, route: "gateway", invalid: false, keyRestricted: false, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
    [
      "people forced (review 4, M3)",
      { AIPM_DISABLED_INTEGRATIONS: "jira, ai-people" },
      { off: false, route: "direct", invalid: false, keyRestricted: false, chat: CHAT_DEFAULTS, peopleForced: true },
    ],
    [
      "invalid (token without URL)",
      { AIPM_AI_GATEWAY_TOKEN: TOKEN },
      { off: false, route: "direct", invalid: true, invalidReason: "token-without-url", keyRestricted: false, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
    [
      "invalid (URL)",
      { AIPM_AI_GATEWAY_URL: "http://gateway.example.com/gw", AIPM_AI_GATEWAY_TOKEN: TOKEN },
      { off: false, route: "gateway", invalid: true, invalidReason: "url", keyRestricted: false, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
    [
      "key restricted (relay)",
      { AIPM_AI_ORGANIZATION_ID: "11111111-2222-3333-4444-555555555555" },
      { off: false, route: "relay", invalid: false, keyRestricted: true, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
    [
      "key restriction invalid",
      { AIPM_AI_WORKSPACE_IDS: "11111111-2222-3333-4444-555555555555" },
      { off: false, route: "relay", invalid: true, invalidReason: "workspaces-without-org", keyRestricted: true, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
    [
      "key restriction setting misspelled",
      { AIPM_AI_ORGANISATION_ID: "11111111-2222-3333-4444-555555555555" },
      { off: false, route: "relay", invalid: true, invalidReason: "misspelled-setting", keyRestricted: true, chat: CHAT_DEFAULTS, peopleForced: false },
    ],
  ])("%s → 200 with the state, no-store", async (_name, env, expected) => {
    const { res, text } = await status(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual(expected);
    expect(text).not.toContain("gateway.example.com");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("11111111-2222");
  });
});

describe("GET /api/ai/status chat settings", () => {
  it("reports the retention and a valid recovery key", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const { text } = await status({ AIPM_AI_CHAT_RETENTION_DAYS: "90", AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY: key });
    expect(JSON.parse(text).chat).toEqual({ retentionDays: 90, retentionInvalid: false, recoveryKey: key, recoveryKeyInvalid: false });
  });

  it("flags invalid settings and never echoes their text", async () => {
    const { text } = await status({ AIPM_AI_CHAT_RETENTION_DAYS: "soon-ish", AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY: "not-a-key-at-all" });
    expect(JSON.parse(text).chat).toEqual({ retentionDays: 30, retentionInvalid: true, recoveryKey: null, recoveryKeyInvalid: true });
    expect(text).not.toContain("soon-ish");
    expect(text).not.toContain("not-a-key-at-all");
  });
});
