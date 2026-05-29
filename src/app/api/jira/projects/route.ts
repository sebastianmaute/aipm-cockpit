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
  // Cloud paginated endpoint; 50 is fine for most use cases.
  const upstream = await callJira(
    creds,
    "/rest/api/3/project/search?maxResults=50&orderBy=name",
  );
  return forwardJsonResponse(upstream);
}
