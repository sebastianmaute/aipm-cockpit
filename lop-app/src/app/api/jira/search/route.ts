import {
  callJira,
  forwardJsonResponse,
  parseCreds,
} from "../_helpers";
import { rateLimit } from "../_rate-limit";

export const runtime = "nodejs";

// JQL search via the Cloud `/search/jql` POST endpoint (the older `/search`
// path is being deprecated). Pagination is intentionally one-shot for now —
// up to 100 issues per click. Add nextPageToken handling when needed.
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
  const jql = typeof b.jql === "string" ? b.jql.trim() : "";
  if (!jql) {
    return Response.json({ error: "missing-jql" }, { status: 400 });
  }
  const nextPageToken =
    typeof b.nextPageToken === "string" && b.nextPageToken
      ? b.nextPageToken
      : undefined;
  const payload: Record<string, unknown> = {
    jql,
    fields: [
      "summary",
      "status",
      "priority",
      "assignee",
      "duedate",
      "updated",
      "labels",
      "issuetype",
      "resolutiondate",
      "description",
    ],
    maxResults: 100,
  };
  if (nextPageToken) payload.nextPageToken = nextPageToken;
  const upstream = await callJira(creds, "/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return forwardJsonResponse(upstream);
}
