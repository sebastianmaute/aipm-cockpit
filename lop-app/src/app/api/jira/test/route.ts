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
  const upstream = await callJira(creds, "/rest/api/3/myself");
  return forwardJsonResponse(upstream);
}
