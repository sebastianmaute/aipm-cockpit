// Client-safe record of how this deployment reaches the AI provider. The root layout
// computes it per request (`aiDeploymentStateFrom` in `ai-gateway-config.ts`, server
// side) and `IntegrationSwitchesSync` records it here before any child renders.
// It carries no URL and no token, only these three facts.

import { logDiag } from "./diagnostics";

export type AiRoute = "direct" | "gateway";
export type AiDeploymentState = { off: boolean; route: AiRoute; invalid: boolean };

let state: AiDeploymentState = { off: false, route: "direct", invalid: false };

let invalidLogged = false;

export function setAiDeploymentState(s: AiDeploymentState): void {
  // Once per page load; the code only, never the setting itself.
  if (s.invalid && !invalidLogged) {
    invalidLogged = true;
    logDiag("warn", "ai.gateway.invalid");
  }
  state = { off: s.off, route: s.route, invalid: s.invalid };
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
