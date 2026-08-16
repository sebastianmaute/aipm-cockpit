/**
 * Quote-aware CSV line scanning. Pure, DOM-free, ZERO imports — it sits under
 * the entity sanitizers' half of the codec and must stay runnable under bare
 * node (the sample generator imports that path).
 *
 * ★★★ WHY THIS EXISTS: `splitCsvSections` used to segment the document with
 * `csv.split(/\r?\n/)`, i.e. on PHYSICAL lines, before any tokenizing. A quoted
 * cell may legally contain newlines, so its continuation lands on its own
 * physical line — and if that line starts with a `# SECTION` marker the parser
 * switched section MID-ROW, destroying every later row in the section with no
 * throw and no diagnostic. See docs/open-followups.md §105.
 */

/**
 * One character of quote-state transition, shared with `parseCsv` so the two
 * scanners cannot disagree about escaping.
 *
 * Returns null when the character at `i` is not quote-relevant, so callers fall
 * through to their own handling. Otherwise returns the new state and the index
 * to resume from.
 */
export function quoteStep(
  text: string,
  i: number,
  inQuotes: boolean,
): { inQuotes: boolean; next: number } | null {
  if (text[i] !== '"') return null;
  // A doubled quote INSIDE quotes is a literal quote, not a close.
  if (inQuotes && text[i + 1] === '"') return { inQuotes: true, next: i + 2 };
  return { inQuotes: !inQuotes, next: i + 1 };
}

/**
 * Split `text` into physical lines, EXCEPT that a break inside a quoted cell
 * does not end a line.
 *
 * ★★★ STEP 1 IS LOAD-BEARING AND IS NOT COSMETIC. Normalizing `\r?\n` to
 * `\r\n` BEFORE scanning preserves a behaviour the old raw-split/rejoin had by
 * accident: a newline inside a quoted cell came back as CRLF, because the cell
 * was broken apart and rejoined with `join("\r\n")`. The live round-trip
 * property in `codec-roundtrip.property.test.ts` PINS that
 * (`taskName: csvNewlines(v.taskName)`), so a splitter that keeps the cell
 * intact without this normalization turns those tests red.
 *
 * ★★ A BARE `\r` IS DELIBERATELY UNTOUCHED. `split(/\r?\n/)` does not break on
 * one, so neither may this; normalizing it would also collide with §106
 * (Markdown bare-CR erosion), which is a separate defect.
 */
export function splitCsvLines(text: string): { lines: string[]; unterminatedQuote: boolean } {
  const normalized = text.replace(/\r?\n/g, "\r\n");
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  let i = 0;
  while (i < normalized.length) {
    const step = quoteStep(normalized, i, inQuotes);
    if (step) {
      // Keep the raw characters: sections are re-joined and re-parsed
      // downstream, so this must stay a lossless view of the input.
      buf += normalized.slice(i, step.next);
      inQuotes = step.inQuotes;
      i = step.next;
      continue;
    }
    if (!inQuotes && normalized[i] === "\r" && normalized[i + 1] === "\n") {
      lines.push(buf);
      buf = "";
      i += 2;
      continue;
    }
    buf += normalized[i];
    i++;
  }
  lines.push(buf);
  return { lines, unterminatedQuote: inQuotes };
}
