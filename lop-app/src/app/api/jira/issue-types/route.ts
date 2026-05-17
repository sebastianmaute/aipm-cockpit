import {
  callJira,
  forwardJsonResponse,
  parseCreds,
} from "../_helpers";
import { rateLimit } from "../_rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const creds = parseCreds(body);
  if (!creds) {
    return Response.json({ error: "missing-credentials" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const projectKey =
    typeof b.projectKey === "string" ? b.projectKey.trim() : "";
  if (!projectKey) {
    return Response.json({ error: "missing-project-key" }, { status: 400 });
  }
  // Encoded to be safe against unusual project keys.
  const upstream = await callJira(
    creds,
    `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`,
  );
  return forwardJsonResponse(upstream);
}
