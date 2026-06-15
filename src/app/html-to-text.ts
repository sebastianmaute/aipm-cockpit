// src/app/html-to-text.ts — basic HTML -> plain text for the mailto body (SP1).
const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    // List items render as dash bullets; the opening tag carries the marker so
    // the closing </li> is just stripped (no extra blank line between items).
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (e) => ENT[e]);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
