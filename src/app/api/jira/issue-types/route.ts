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
