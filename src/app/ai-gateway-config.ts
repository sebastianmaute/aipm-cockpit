// SERVER-ONLY. Reads the deployment's AI transport settings from the environment
// (AIPM_AI_GATEWAY_URL, AIPM_AI_GATEWAY_TOKEN) on every call, so a restart applies a
// change and no rebuild is needed. Import this from the root layout, `src/proxy.ts`
// and API routes only; a test pins that no client module imports it. (The
// `server-only` package is not a dependency, so the rule is enforced by that test.)
//
// The URL and the token never reach a browser: the client receives only the
// `AiDeploymentState` below ({ off, route, invalid, invalidReason }). An invalid setting is
// logged on the server once per process per reason, naming the reason code only.

import { DISABLED_INTEGRATIONS_ENV, parseDisabledIntegrations } from "./integration-switches";
import type { AiDeploymentState, AiGatewayInvalidReason } from "./ai-deployment";
import { readAiKeyRestriction } from "./ai-key-restriction-config";

export const AI_GATEWAY_URL_ENV = "AIPM_AI_GATEWAY_URL";
export const AI_GATEWAY_TOKEN_ENV = "AIPM_AI_GATEWAY_TOKEN";

export type AiGatewayConfig =
  | { kind: "direct" }
  | { kind: "gateway"; baseUrl: string; token: string | null }
  | { kind: "invalid"; reason: AiGatewayInvalidReason };

type Env = Record<string, string | undefined>;

/** Visible ASCII only (0x21–0x7E): anything else, a space included, is a character the token's header cannot carry. */
const HEADER_SAFE_TOKEN = /^[\x21-\x7e]+$/;

/** The base URL the Messages path is appended to: https, no credentials/query/fragment, no API path. */
function normalizeGatewayUrl(raw: string): string | null {
  if (/[?#@\s]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  if (/\/v1(\/messages|\/models)?$/i.test(path)) return null;
  return parsed.origin + path;
}

/** Reasons already reported by this server process: each is logged once, not on every request. */
const reportedInvalid = new Set<AiGatewayInvalidReason>();

/** The setting, parsed, with no side effect. `src/proxy.ts` uses this one: it needs only the kind
 *  for the CSP, and the layout or API route serving the same request reports an invalid setting. */
export function parseAiGatewayConfig(env: Env): AiGatewayConfig {
  const url = env[AI_GATEWAY_URL_ENV]?.trim() ?? "";
  const token = env[AI_GATEWAY_TOKEN_ENV]?.trim() || null;
  if (!url) return token ? { kind: "invalid", reason: "token-without-url" } : { kind: "direct" };
  const baseUrl = normalizeGatewayUrl(url);
  if (!baseUrl) return { kind: "invalid", reason: "url" };
  if (token !== null && !HEADER_SAFE_TOKEN.test(token)) return { kind: "invalid", reason: "token" };
  return { kind: "gateway", baseUrl, token };
}

/** `parseAiGatewayConfig`, and an invalid setting tells the operator, once per process per reason,
 *  which part is invalid: the reason code only, never the URL or the token. */
export function readAiGatewayConfig(env: Env): AiGatewayConfig {
  const config = parseAiGatewayConfig(env);
  if (config.kind === "invalid" && !reportedInvalid.has(config.reason)) {
    reportedInvalid.add(config.reason);
    console.warn(`ai gateway setting invalid: ${config.reason}`);
  }
  return config;
}

/** What the browser may know: switched off, which route, whether the setting is invalid and why
 *  (a reason code), and whether a key restriction exists. An invalid gateway setting with a URL set
 *  reports the gateway route the operator meant; a token without a URL names no gateway and stays
 *  direct. A key restriction (valid or not) with no gateway URL is the relay route; its own invalid
 *  reason wins over the gateway's. */
export function aiDeploymentStateFrom(env: Env): AiDeploymentState {
  const config = readAiGatewayConfig(env);
  const restriction = readAiKeyRestriction(env);
  const off = parseDisabledIntegrations(env[DISABLED_INTEGRATIONS_ENV]).includes("ai");
  const keyRestricted = restriction.kind !== "none";
  const hasGateway = config.kind === "gateway" || (config.kind === "invalid" && config.reason !== "token-without-url");
  const route = hasGateway ? "gateway" : keyRestricted ? "relay" : "direct";
  if (restriction.kind === "invalid") return { off, route, invalid: true, invalidReason: restriction.reason, keyRestricted };
  if (config.kind === "invalid") return { off, route, invalid: true, invalidReason: config.reason, keyRestricted };
  return { off, route, invalid: false, keyRestricted };
}
