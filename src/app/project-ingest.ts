// src/app/project-ingest.ts - pure, i18n-free ingestion helpers for SP-D.
import { htmlToPlainText } from "./html-to-text";

export const MAX_INGEST_TEXT = 60_000; // cap text sent to the proposal call (token-bounding)

/** Extract a numeric Confluence page id from the common Cloud URL shapes.
 *  Supported: /wiki/spaces/<KEY>/pages/<id>/..., /pages/<id>, ?pageId=<id>.
 *  Tiny-links (/wiki/x/...) and anything without an extractable id -> null. */
export function parseConfluencePageId(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const byQuery = parsed.searchParams.get("pageId");
  if (byQuery && /^\d+$/.test(byQuery)) return byQuery;
  const m = parsed.pathname.match(/\/pages\/(\d+)(?:\/|$)/);
  return m ? m[1] : null;
}

interface ConfluencePayload { title?: unknown; body?: { view?: { value?: unknown } } }

/** Turn a Confluence content REST payload (expand=body.view) into capped plain text.
 *  Never throws; malformed -> "". */
export function confluenceJsonToText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as ConfluencePayload;
  const title = typeof p.title === "string" ? p.title : "";
  const html = typeof p.body?.view?.value === "string" ? p.body.view.value : "";
  if (!title && !html) return "";
  const body = html ? htmlToPlainText(html) : "";
  return `${title ? `# ${title}\n\n` : ""}${body}`.slice(0, MAX_INGEST_TEXT).trim();
}
