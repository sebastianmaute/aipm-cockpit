// src/app/confluence-api.ts - browser client for the same-origin Confluence proxy.
import { parseConfluencePageId, confluenceJsonToText } from "./project-ingest";

export interface AtlassianCreds { siteUrl: string; email: string; apiToken: string; }

/** Resolve a Confluence page URL to its capped plain text via the /api/confluence/page proxy.
 *  Throws Error(<status>) on a non-OK proxy response, Error("page-id") on an unparseable URL,
 *  Error("parse") on empty content. The apiToken goes only to the SAME-ORIGIN proxy; never logged. */
export async function fetchConfluencePage(url: string, creds: AtlassianCreds): Promise<{ title: string; text: string }> {
  const pageId = parseConfluencePageId(url);
  if (!pageId) throw new Error("page-id");
  const res = await fetch("/api/confluence/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageId, ...creds }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { title?: string };
  const text = confluenceJsonToText(json);
  if (!text) throw new Error("parse");
  return { title: typeof json.title === "string" ? json.title : "", text };
}
