import {
  callJira,
  forwardJsonResponse,
  parseIssueFields,
  parseJiraRequest,
} from "../_helpers";

export const runtime = "nodejs";

// PUT /rest/api/3/issue/{key} with a body of { fields: { ... } }.
// 204 No Content on success — we forward that as JSON `{ ok: true }`.
export async function POST(request: Request) {
  const parsed = await parseJiraRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds } = parsed;
  const b = parsed.body;
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!key || !/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) {
    return Response.json({ error: "missing-or-bad-key" }, { status: 400 });
  }
  const parsedFields = parseIssueFields(b);
  if ("error" in parsedFields) return parsedFields.error;
  const { fields } = parsedFields;

  const upstream = await callJira(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      body: JSON.stringify({ fields }),
    },
  );
  if (upstream.status === 204) {
    return Response.json({ ok: true });
  }
  return forwardJsonResponse(upstream);
}
