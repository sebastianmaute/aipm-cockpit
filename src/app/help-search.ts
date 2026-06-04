export type HighlightSegment = { text: string; match: boolean };

/** Case-insensitive substring test across a section's title and body. */
export function matchesQuery(title: string, body: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q) || body.toLowerCase().includes(q);
}

/** Split `text` into segments, flagging case-insensitive matches of `query`. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: HighlightSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(needle, i);
    if (hit === -1) {
      out.push({ text: text.slice(i), match: false });
      break;
    }
    if (hit > i) out.push({ text: text.slice(i, hit), match: false });
    out.push({ text: text.slice(hit, hit + needle.length), match: true });
    i = hit + needle.length;
  }
  return out;
}
