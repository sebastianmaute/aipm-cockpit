// What the browser may know about this deployment's AI transport: switched off, the
// route (direct or gateway), whether the setting is invalid, and whether people
// protection is forced (`ai-people` switched off; review 4, M3). Never the URL or the
// token. Answers 200 in every state, including switched off, so the client can
// always learn why AI is unavailable.
import { aiDeploymentStateFrom } from "../../../ai-gateway-config";
import type { AiStatus } from "../../../ai-deployment";
import { DISABLED_INTEGRATIONS_ENV, parseDisabledIntegrations } from "../../../integration-switches";

export const runtime = "nodejs";
// Read per request: a restart applies a changed setting, so this must never be
// prerendered at build time.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const peopleForced = parseDisabledIntegrations(process.env[DISABLED_INTEGRATIONS_ENV]).includes("ai-people");
  const status: AiStatus = { ...aiDeploymentStateFrom(process.env), peopleForced };
  return Response.json(status, { headers: { "cache-control": "no-store" } });
}
