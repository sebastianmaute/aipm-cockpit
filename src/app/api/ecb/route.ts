import { parseEcbDailyXml } from "../../ecb";

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export const runtime = "nodejs";

/** GET /api/ecb — fetch ECB daily EUR reference rates, return an FxRates table.
 *  The client caches the result in the workspace; this route holds no state. */
export async function GET() {
  try {
    const res = await fetch(ECB_DAILY_URL, { headers: { Accept: "application/xml" }, cache: "no-store" });
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
    return Response.json({ error: `ECB fetch failed: ${String(err)}` }, { status: 502 });
  }
}
