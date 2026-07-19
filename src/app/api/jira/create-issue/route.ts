import {
  callJira,
  forwardJsonResponse,
  parseIssueFields,
  parseJiraRequest,
} from "../_helpers";

export const runtime = "nodejs";

// POST /rest/api/3/issue — creates a new issue under the configured project &
// issue type. The client is expected to have already mapped Task fields to
// the Jira `fields` payload (summary, description as ADF, priority, labels,
// duedate); we just attach project + issuetype + Basic auth and forward.
export async function POST(request: Request) {
  const parsed = await parseJiraRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds } = parsed;
  const b = parsed.body;
  const projectKey =
    typeof b.projectKey === "string" ? b.projectKey.trim() : "";
  const issueType =
    typeof b.issueType === "string" ? b.issueType.trim() : "";
  if (!projectKey) {
    return Response.json({ error: "missing-project-key" }, { status: 400 });
  }
  if (!issueType) {
    return Response.json({ error: "missing-issue-type" }, { status: 400 });
  }
  const parsedFields = parseIssueFields(b);
  if ("error" in parsedFields) return parsedFields.error;
  const { fields } = parsedFields;

  // Attach project + issuetype on the server side so the caller can't pick
  // arbitrary projects or types beyond the configured scope.
  fields.project = { key: projectKey };
  fields.issuetype = { name: issueType };

  const upstream = await callJira(creds, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return forwardJsonResponse(upstream);
}
