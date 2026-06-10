import { parseEcbDailyXml } from "../../ecb";
import { rateLimit } from "../jira/_rate-limit";

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

// Bound the upstream call so a hung ECB endpoint cannot hold the serverless
// function for the platform timeout. A timeout rejects the fetch, which the
// catch below turns into the route's existing generic 502.
const ECB_UPSTREAM_TIMEOUT_MS = 8_000;

export const runtime = "nodejs";

/** GET /api/ecb — fetch ECB daily EUR reference rates, return an FxRates table.
 *  The client caches the result in the workspace; this route holds no state.
 *  `request` feeds the shared per-IP rate limiter (429 + Retry-After on excess). */
export async function GET(request: Request) {
  // Same per-IP limiter as the Jira proxy routes, namespaced so the two
  // route families do not drain each other's quota.
  const limited = rateLimit(request, "ecb");
  if (limited) return limited;

  try {
    const res = await fetch(ECB_DAILY_URL, {
      headers: { Accept: "application/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(ECB_UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      return Response.json({ error: `ECB responded ${res.status}` }, { status: 502 });
    }
    const xml = await res.text();
    const fx = parseEcbDailyXml(xml, new Date().toISOString());
    if (!fx) {
      return Response.json({ error: "Could not parse ECB rates" }, { status: 502 });
    }
    return Response.json(fx, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    // Log the detail server-side; return a generic message so internal error
    // text (hostnames, stack frames) never reaches the client.
    console.error("ECB fetch failed:", err);
    return Response.json({ error: "ECB fetch failed" }, { status: 502 });
  }
}
