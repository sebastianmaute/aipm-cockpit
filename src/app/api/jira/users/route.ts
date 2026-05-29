import {
  callJira,
  forwardJsonResponse,
  parseJiraRequest,
} from "../_helpers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJiraRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds } = parsed;
  const b = parsed.body;
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
