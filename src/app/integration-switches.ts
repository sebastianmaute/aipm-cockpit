// §762 — integrations a deployment switched off. One server setting,
// AIPM_DISABLED_INTEGRATIONS (a comma list of the ids below), read at run time:
//   - the API routes read it themselves on every request
//     (`api/_shared/integration-switch.ts`) and refuse a switched-off one;
//   - the root layout reads it per request and hands it to the client
//     (`IntegrationSwitchesSync`), which records it here once, before any child
//     renders, so plain functions (`isViewEnabled`, `isJiraOn`, …) can ask without
//     a prop being threaded through.
// Unset or empty: nothing is switched off, which is every deployment that does not
// set it (the desktop app, `npm start`, any container).
//
// ★ Gates ask here; STORED settings are never rewritten. A user's Jira token or
// TimeLog setup survives a switch-off and works again once the integration is back.

export const INTEGRATION_IDS = ["jira", "confluence", "timelog", "ecb", "stt", "ai", "ai-people"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const DISABLED_INTEGRATIONS_ENV = "AIPM_DISABLED_INTEGRATIONS";

/** The known ids named in `raw`, in registry order, each once. Unknown names are ignored. */
export function parseDisabledIntegrations(raw: string | undefined): IntegrationId[] {
  if (!raw) return [];
  const named = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  return INTEGRATION_IDS.filter((id) => named.has(id));
}

let disabled: ReadonlySet<IntegrationId> = new Set();

/** Records this deployment's switched-off integrations (the client, once per page load). */
export function setDisabledIntegrations(ids: readonly IntegrationId[]): void {
  disabled = new Set(ids);
}

/** Records one more switched-off integration learned AFTER page load: the AI transport's per-send status
 *  reporting a people lock the server added since (review 4, M3). Only ever adds; a lock the server lifts
 *  applies at the next page load. */
export function addDisabledIntegration(id: IntegrationId): void {
  if (!disabled.has(id)) disabled = new Set([...disabled, id]);
}

export function isIntegrationDisabled(id: IntegrationId): boolean {
  return disabled.has(id);
}

/** Jira is usable: the user switched it on AND this deployment allows it. */
export function isJiraOn(jira: { enabled?: boolean } | undefined): boolean {
  return !!jira?.enabled && !disabled.has("jira");
}
