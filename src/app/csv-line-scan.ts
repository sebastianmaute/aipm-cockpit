/**
 * Quote-aware CSV line scanning.
 *
 * ★ THE RULE: pure, DOM-free, ZERO imports. This module is the shared LEAF
 * beneath BOTH CSV scanners — `quoteStep` is consumed by `parseCsv`
 * (csv-codecs-core.ts) and `splitCsvLines` by `splitCsvSections`
 * (csv-codecs-decode.ts, which itself imports csv-codecs-core) — so a
 * dependency added here is inherited by every CSV decode path, and one
 * reaching back into either sibling closes a cycle. Check the rule still
 * holds: `grep -nE "^\s*(import|require)" src/app/csv-line-scan.ts` must
 * print nothing.
 *
 * ★★ DO NOT RE-JUSTIFY IT WITH "the sample generator runs this under bare
 * node" — that justification stood here and is FALSE.
 * `scripts/generate-sample-workspace.ts` installs a jsdom `window`/`document`
 * as globals BEFORE its dynamic `await import("../src/app/storage")`, exactly
 * so the DOM-bound sanitizers downstream work; its own header explains that at
 * length. There is no bare-node consumer of this path today. The rule stands
 * on the leaf argument above — do not weaken it on the strength of the
 * retracted one.
 *
 * ★★★ THIS IS THE FOURTH INDEPENDENT RETRACTION OF THAT ONE CLAIM, and the
 * others are `document-model.ts`, `document-versions.ts` and
 * `document-rich-fields.ts` (the last two already cross-reference their
 * neighbours; this header and `document-model.ts`'s did not, which is how a
 * fourth came to be derived from scratch). Meanwhile the claim is still
 * ASSERTED as a live rationale in AGENTS.md at four sites and in
 * docs/open-followups.md §28, §36(a) and §49 — where in §36(a) it is the stated
 * REASON a sanitizer boundary cannot be added. Do NOT go delete those on the
 * strength of this comment: a rule with a false rationale can still be a
 * correct rule, and each of those sites needs its own probe. The cluster is
 * indexed as §151 — read it before writing a fifth retraction.
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
