// What the browser may know about this deployment's AI transport: switched off, the
// route (direct or gateway) and whether the setting is invalid. Never the URL or the
// token. Answers 200 in every state, including switched off, so the client can
// always learn why AI is unavailable.
import { aiDeploymentStateFrom } from "../../../ai-gateway-config";

export const runtime = "nodejs";
// Read per request: a restart applies a changed setting, so this must never be
// prerendered at build time.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(aiDeploymentStateFrom(process.env), { headers: { "cache-control": "no-store" } });
}
