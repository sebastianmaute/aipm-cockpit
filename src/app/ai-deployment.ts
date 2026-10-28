// Client-safe record of how this deployment reaches the AI provider. The root layout
// computes it per request (`aiDeploymentStateFrom` in `ai-gateway-config.ts`, server
// side) and `IntegrationSwitchesSync` records it here before any child renders.
// It carries no URL and no token, only these facts.
//
// An invalid setting whose URL is set keeps `route: "gateway"`: that is the route the operator
// meant, so the disclosure texts and a stored consent follow it. Only a token without a URL names
// no gateway and stays "direct". Nothing is sent either way while `invalid` is true.

import { logDiag } from "./diagnostics";

export type AiRoute = "direct" | "gateway";
/** Which part of the gateway setting is invalid. A code, never the value; not secret. */
export type AiGatewayInvalidReason = "url" | "token-without-url" | "token";
export type AiDeploymentState = {
  off: boolean;
  route: AiRoute;
  invalid: boolean;
  /** Set only while `invalid`. */
  invalidReason?: AiGatewayInvalidReason;
};

let state: AiDeploymentState = { off: false, route: "direct", invalid: false };

let invalidLogged = false;

export function setAiDeploymentState(s: AiDeploymentState): void {
  // Once per page load; the reason code only, never the setting itself.
  if (s.invalid && !invalidLogged) {
    invalidLogged = true;
    logDiag("warn", "ai.gateway.invalid", s.invalidReason !== undefined ? { reason: s.invalidReason } : undefined);
  }
  state = s.invalid && s.invalidReason !== undefined
    ? { off: s.off, route: s.route, invalid: true, invalidReason: s.invalidReason }
    : { off: s.off, route: s.route, invalid: s.invalid };
}

export function getAiDeploymentState(): AiDeploymentState {
  return state;
}

export function currentAiRoute(): AiRoute {
  return state.route;
}

/** AI is usable on this deployment: not switched off and not misconfigured. */
export function isAiDeploymentOn(): boolean {
  return !state.off && !state.invalid;
}
