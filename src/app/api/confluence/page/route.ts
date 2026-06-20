// Same-origin proxy for fetching a Confluence Cloud page. Reuses the hardened
// /api/jira helpers (SSRF allowlist to *.atlassian.net, Basic auth, 10s timeout,
// status-only error envelope). Credentials are sent per-request, never persisted.
import { parseJiraRequest, callJira, forwardJsonResponse } from "../../jira/_helpers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJiraRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds, body } = parsed;
  const pageId = typeof body.pageId === "string" ? body.pageId : "";
  if (!/^\d+$/.test(pageId)) {
    return Response.json({ error: "invalid-page-id" }, { status: 400 });
  }
  const upstream = await callJira(creds, `/wiki/rest/api/content/${pageId}?expand=body.view`);
  return forwardJsonResponse(upstream);
}
