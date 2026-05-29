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
  const upstream = await callJira(creds, "/rest/api/3/myself");
  return forwardJsonResponse(upstream);
}
