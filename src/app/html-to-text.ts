// src/app/html-to-text.ts — basic HTML -> plain text for the mailto body (SP1).
import { replaceOpenTags } from "./tag-pair-walk";

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function htmlToPlainText(html: string): string {
  // ★ §578: the list-item and catch-all passes were `<\s*li[^>]*>` and
  // `<[^>]+>`, quadratic on opens with no ">" after them — `[^>]*` ran to end
  // of input from EVERY open (Confluence page HTML reaches this unbounded).
  // replaceOpenTags is the same replacement, scanned linearly. The pass ORDER
  // is load-bearing: an unterminated "<li" swallows a later "</p>", so the
  // block-close pass must stay between the two.
  let s = html.replace(/<\s*br\s*\/?>/gi, "\n");
  // List items render as dash bullets; the opening tag carries the marker so
  // the closing </li> is just stripped (no extra blank line between items).
  s = replaceOpenTags(s, "<\\s*[Ll][Ii]", "\n- ");
  s = s.replace(/<\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n");
  s = replaceOpenTags(s, "<[^>]", "");
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (e) => ENT[e]);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
