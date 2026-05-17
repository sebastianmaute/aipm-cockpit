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
  const query = typeof b.query === "string" ? b.query.trim() : "";
  if (!projectKey) {
    return Response.json({ error: "missing-project-key" }, { status: 400 });
  }
  const params = new URLSearchParams({ project: projectKey, maxResults: "20" });
  if (query) params.set("query", query);
  const upstream = await callJira(
    creds,
    `/rest/api/3/user/assignable/search?${params.toString()}`,
  );
  return forwardJsonResponse(upstream);
}
