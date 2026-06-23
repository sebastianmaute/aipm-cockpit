import { parseTimelogRequest, callTimelog, forwardJsonResponse } from "./_helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseTimelogRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds, path, query } = parsed;
  const qs = Object.entries(query)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const upstream = await callTimelog(creds, qs ? `${path}?${qs}` : path, { method: "GET" });
  return forwardJsonResponse(upstream);
}
