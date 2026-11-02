// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_RECOVERY_KEY_ENV,
  CHAT_RETENTION_DAYS_ENV,
  DEFAULT_CHAT_RETENTION_DAYS,
  MAX_CHAT_RETENTION_DAYS,
  parseChatSettings,
  readChatSettings,
} from "./ai-chat-retention-config";

function spki(type: "rsa" | "ec", bits = 3072): string {
  const { publicKey } =
    type === "rsa"
      ? generateKeyPairSync("rsa", { modulusLength: bits })
      : generateKeyPairSync("ec", { namedCurve: "P-256" });
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

const KEY_3072 = spki("rsa", 3072);
const KEY_2048 = spki("rsa", 2048);
const KEY_EC = spki("ec");

const DEFAULTS = { retentionDays: 30, retentionInvalid: false, recoveryKey: null, recoveryKeyInvalid: false };

describe("parseChatSettings", () => {
  it("names the settings and limits", () => {
    expect(CHAT_RETENTION_DAYS_ENV).toBe("AIPM_AI_CHAT_RETENTION_DAYS");
    expect(CHAT_RECOVERY_KEY_ENV).toBe("AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY");
    expect(DEFAULT_CHAT_RETENTION_DAYS).toBe(30);
    expect(MAX_CHAT_RETENTION_DAYS).toBe(3650);
  });

  it("answers the defaults when nothing is set", () => {
    expect(parseChatSettings({})).toEqual(DEFAULTS);
  });

  it.each([["1", 1], ["3650", 3650], [" 90 ", 90]])("reads retention %j as %i days", (raw, days) => {
    expect(parseChatSettings({ [CHAT_RETENTION_DAYS_ENV]: raw })).toEqual({ ...DEFAULTS, retentionDays: days });
  });

  it.each(["0", "3651", "-5", "30.5", "30d", "abc"])("flags retention %j as invalid and keeps the default", (raw) => {
    expect(parseChatSettings({ [CHAT_RETENTION_DAYS_ENV]: raw })).toEqual({ ...DEFAULTS, retentionInvalid: true });
  });

  it("treats a blank retention as unset", () => {
    expect(parseChatSettings({ [CHAT_RETENTION_DAYS_ENV]: "  " })).toEqual(DEFAULTS);
  });

  it("accepts an RSA 3072 recovery key and keeps its text trimmed", () => {
    expect(parseChatSettings({ [CHAT_RECOVERY_KEY_ENV]: `  ${KEY_3072}\n` })).toEqual({ ...DEFAULTS, recoveryKey: KEY_3072 });
  });

  it("accepts a key wrapped over several lines and reports it without whitespace", () => {
    const wrapped = KEY_3072.replace(/(.{64})/g, "$1\n");
    expect(parseChatSettings({ [CHAT_RECOVERY_KEY_ENV]: wrapped })).toEqual({ ...DEFAULTS, recoveryKey: KEY_3072 });
  });

  it.each([["a 2048-bit RSA key", KEY_2048], ["text that is not a key", "xyz"], ["an EC key", KEY_EC]])(
    "rejects %s",
    (_name, raw) => {
      expect(parseChatSettings({ [CHAT_RECOVERY_KEY_ENV]: raw })).toEqual({ ...DEFAULTS, recoveryKeyInvalid: true });
    },
  );

  it("treats a blank recovery key as unset", () => {
    expect(parseChatSettings({ [CHAT_RECOVERY_KEY_ENV]: " " })).toEqual(DEFAULTS);
  });
});

describe("readChatSettings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the parsed settings", () => {
    expect(readChatSettings({ [CHAT_RETENTION_DAYS_ENV]: "7" }).retentionDays).toBe(7);
  });

  it("warns once per process per problem and never prints the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { [CHAT_RETENTION_DAYS_ENV]: "secret-days", [CHAT_RECOVERY_KEY_ENV]: "secret-key" };
    readChatSettings(env);
    readChatSettings(env);
    expect(warn).toHaveBeenCalledTimes(2);
    const text = warn.mock.calls.map((c) => String(c[0])).join("|");
    expect(text).not.toContain("secret-days");
    expect(text).not.toContain("secret-key");
  });
});
