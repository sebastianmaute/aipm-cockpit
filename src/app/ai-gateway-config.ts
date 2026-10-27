// SERVER-ONLY. Reads the deployment's AI transport settings from the environment
// (AIPM_AI_GATEWAY_URL, AIPM_AI_GATEWAY_TOKEN) on every call, so a restart applies a
// change and no rebuild is needed. Import this from the root layout, `src/proxy.ts`
// and API routes only; a test pins that no client module imports it. (The
// `server-only` package is not a dependency, so the rule is enforced by that test.)
//
// The URL and the token never reach a browser: the client receives only the
// `AiDeploymentState` below ({ off, route, invalid }).

import { DISABLED_INTEGRATIONS_ENV, parseDisabledIntegrations } from "./integration-switches";
import type { AiDeploymentState } from "./ai-deployment";

export const AI_GATEWAY_URL_ENV = "AIPM_AI_GATEWAY_URL";
export const AI_GATEWAY_TOKEN_ENV = "AIPM_AI_GATEWAY_TOKEN";

export type AiGatewayConfig =
  | { kind: "direct" }
  | { kind: "gateway"; baseUrl: string; token: string | null }
  | { kind: "invalid"; reason: "url" | "token-without-url" };

type Env = Record<string, string | undefined>;

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

export function readAiGatewayConfig(env: Env): AiGatewayConfig {
  const url = env[AI_GATEWAY_URL_ENV]?.trim() ?? "";
  const token = env[AI_GATEWAY_TOKEN_ENV]?.trim() || null;
  if (!url) return token ? { kind: "invalid", reason: "token-without-url" } : { kind: "direct" };
  const baseUrl = normalizeGatewayUrl(url);
  if (!baseUrl) return { kind: "invalid", reason: "url" };
  return { kind: "gateway", baseUrl, token };
}

/** What the browser may know: switched off, which route, whether the setting is invalid. */
export function aiDeploymentStateFrom(env: Env): AiDeploymentState {
  const config = readAiGatewayConfig(env);
  return {
    off: parseDisabledIntegrations(env[DISABLED_INTEGRATIONS_ENV]).includes("ai"),
    route: config.kind === "gateway" ? "gateway" : "direct",
    invalid: config.kind === "invalid",
  };
}
