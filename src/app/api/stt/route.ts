import { parseSttRequest, callStt } from "./_helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseSttRequest(request);
  if ("error" in parsed) return parsed.error;
  return callStt(parsed.fwd);
}
