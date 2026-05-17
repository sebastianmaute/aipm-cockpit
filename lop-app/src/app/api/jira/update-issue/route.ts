import {
  callJira,
  forwardJsonResponse,
  parseCreds,
  sanitizeIssueFields,
} from "../_helpers";
import { rateLimit } from "../_rate-limit";

export const runtime = "nodejs";

// PUT /rest/api/3/issue/{key} with a body of { fields: { ... } }.
// 204 No Content on success — we forward that as JSON `{ ok: true }`.
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
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!key || !/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) {
    return Response.json({ error: "missing-or-bad-key" }, { status: 400 });
  }
  const rawFields =
    b.fields && typeof b.fields === "object" && !Array.isArray(b.fields)
      ? (b.fields as Record<string, unknown>)
      : null;
  if (!rawFields) {
    return Response.json({ error: "missing-fields" }, { status: 400 });
  }
  const fields = sanitizeIssueFields(rawFields);
  if (!fields) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }

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
