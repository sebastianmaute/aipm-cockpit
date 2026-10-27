// Client-safe record of how this deployment reaches the AI provider. The root layout
// computes it per request (`aiDeploymentStateFrom` in `ai-gateway-config.ts`, server
// side) and `IntegrationSwitchesSync` records it here before any child renders.
// It carries no URL and no token, only these three facts.

export type AiRoute = "direct" | "gateway";
export type AiDeploymentState = { off: boolean; route: AiRoute; invalid: boolean };

let state: AiDeploymentState = { off: false, route: "direct", invalid: false };

export function setAiDeploymentState(s: AiDeploymentState): void {
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
