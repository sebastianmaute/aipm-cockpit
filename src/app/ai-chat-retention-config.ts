// SERVER-ONLY. Reads the deployment's saved-chat settings from the environment on every call, like
// the gateway setting, so a restart applies a change and no rebuild is needed:
//   AIPM_AI_CHAT_RETENTION_DAYS        days a saved chat is kept (whole number, 1 to 3650; default 30)
//   AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY   the operator's recovery PUBLIC key: base64 DER SPKI of an
//                                      RSA-OAEP key of at least 3072 bits
// Import this from `ai-gateway-config.ts` and API routes only; client modules may import its TYPES
// only (`import type`), never the functions, which use `node:crypto`.
//
// A public key is not secret and reaches the browser through `AiDeploymentState.chat`. An invalid
// setting is logged on the server once per process per problem, naming the setting only, never its
// value.

import { createPublicKey } from "node:crypto";

export const CHAT_RETENTION_DAYS_ENV = "AIPM_AI_CHAT_RETENTION_DAYS";
export const CHAT_RECOVERY_KEY_ENV = "AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY";
export const DEFAULT_CHAT_RETENTION_DAYS = 30;
export const MAX_CHAT_RETENTION_DAYS = 3650;
const MIN_RECOVERY_KEY_BITS = 3072;

export type ChatSettings = {
  /** The retention in force: the default while the setting is unset or invalid. */
  retentionDays: number;
  /** The retention setting is set but unusable. */
  retentionInvalid: boolean;
  /** The recovery public key as set (base64 SPKI, whitespace removed), or null when unset or invalid. */
  recoveryKey: string | null;
  /** The recovery key setting is set but unusable. */
  recoveryKeyInvalid: boolean;
};

type Env = Record<string, string | undefined>;

const WHOLE_NUMBER = /^[0-9]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseRetention(raw: string): { days: number; invalid: boolean } {
  if (raw === "") return { days: DEFAULT_CHAT_RETENTION_DAYS, invalid: false };
  const days = WHOLE_NUMBER.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_CHAT_RETENTION_DAYS) {
    return { days: DEFAULT_CHAT_RETENTION_DAYS, invalid: true };
  }
  return { days, invalid: false };
}

function isUsableRecoveryKey(base64: string): boolean {
  if (!BASE64.test(base64)) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(base64, "base64"), type: "spki", format: "der" });
    return key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= MIN_RECOVERY_KEY_BITS;
  } catch {
    return false;
  }
}

/** The settings, parsed, with no side effect. */
export function parseChatSettings(env: Env): ChatSettings {
  const retention = parseRetention(env[CHAT_RETENTION_DAYS_ENV]?.trim() ?? "");
  const rawKey = (env[CHAT_RECOVERY_KEY_ENV] ?? "").replace(/\s+/g, "");
  const keyUsable = rawKey !== "" && isUsableRecoveryKey(rawKey);
  return {
    retentionDays: retention.days,
    retentionInvalid: retention.invalid,
    recoveryKey: keyUsable ? rawKey : null,
    recoveryKeyInvalid: rawKey !== "" && !keyUsable,
  };
}

/** Problems already reported by this server process: each is logged once, not on every request. */
const reported = new Set<string>();

function reportOnce(setting: string): void {
  if (reported.has(setting)) return;
  reported.add(setting);
  console.warn(`ai chat setting invalid: ${setting}`);
}

/** `parseChatSettings`, and an invalid setting tells the operator once per process which one. */
export function readChatSettings(env: Env): ChatSettings {
  const settings = parseChatSettings(env);
  if (settings.retentionInvalid) reportOnce(CHAT_RETENTION_DAYS_ENV);
  if (settings.recoveryKeyInvalid) reportOnce(CHAT_RECOVERY_KEY_ENV);
  return settings;
}
