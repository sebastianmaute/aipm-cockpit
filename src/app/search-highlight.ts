export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into alternating non-match / match segments for every
 * case-insensitive occurrence of `query.trim()`. Original casing preserved.
 * Empty/whitespace query → a single non-match segment containing the whole text.
 *
 * Pure: uses `indexOf` scanning on lowercased copies (never builds a RegExp
 * from input), so regex metacharacters in `query` are treated literally.
 */
export function splitHighlight(
  text: string,
  query: string,
): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [{ text, match: false }];
  }

  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (
    let hit = haystack.indexOf(needle, cursor);
    hit !== -1;
    hit = haystack.indexOf(needle, cursor)
  ) {
    if (hit > cursor) {
      segments.push({ text: text.slice(cursor, hit), match: false });
    }
    const end = hit + needle.length;
    segments.push({ text: text.slice(hit, end), match: true });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }

  if (segments.length === 0) {
    return [{ text, match: false }];
  }

  return segments;
}
