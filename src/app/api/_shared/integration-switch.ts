// §762 — the server half of the integration switch: a route of an integration the
// deployment switched off (AIPM_DISABLED_INTEGRATIONS) refuses with 403 before it
// rate-limits, parses or calls anything. Read on every request, so changing the
// setting needs only a restart, never a rebuild. Same `Response | null` shape as
// `rateLimit`. The client half (`integration-switches.ts`) hides the controls.
import {
  DISABLED_INTEGRATIONS_ENV,
  parseDisabledIntegrations,
  type IntegrationId,
} from "../../integration-switches";

export const INTEGRATION_DISABLED = "integration-disabled";

export function refuseIfDisabled(
  id: IntegrationId,
  env: Record<string, string | undefined> = process.env,
): Response | null {
  if (!parseDisabledIntegrations(env[DISABLED_INTEGRATIONS_ENV]).includes(id)) return null;
  return Response.json({ error: INTEGRATION_DISABLED }, { status: 403 });
}
