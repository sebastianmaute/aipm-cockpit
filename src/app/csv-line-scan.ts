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
 * fourth came to be derived from scratch). Do NOT go delete the remaining
 * assertions on the strength of this comment: a rule with a false rationale can
 * still be a correct rule, and each site needs its own probe. The cluster is
 * indexed as §151 — read it before writing a fifth retraction.
 *
 * ★★ THE SITE LIST THAT USED TO SIT HERE IS GONE BECAUSE IT ROTTED TWICE OVER.
 * It said the claim was asserted "in AGENTS.md at four sites" — AGENTS.md now
 * matches ZERO times, because `68de7e7f` (2026-08-19) moved the whole rich-text
 * cluster to `docs/AGENTS/rich-text.md`. It also named §36(a) as the stated
 * REASON a sanitizer boundary cannot be added; that was corrected 2026-08-28,
 * along with the `templates.ts` comment and the `rich-text.md` mention. Read
 * §151's posture table for today's set rather than any list in a source header:
 * a list here cannot be gated and goes stale on someone else's commit.
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
 *
 * ★★★ `malformedQuotes` COUNTS RFC 4180 VIOLATIONS, NOT SUSPICION, and the
 * distinction is the whole reason it can exist. §150 proves the question
 * everyone reaches for first — "was a section marker swallowed by a quoted
 * cell?" — is UNDECIDABLE: a swallowed marker and a legitimately quoted
 * marker-shaped cell are byte-identical, so a detector comparing a quote-aware
 * split against a naive one fires on every correct import that happens to
 * contain such a cell. §150 rejects that detector for exactly this reason.
 * MALFORMEDNESS is a different question and is locally decidable: an opening
 * quote that is not at a field start, or a closing quote not followed by a
 * delimiter, is a violation no matter what the author meant.
 *
 * ★★ THE FALSE-POSITIVE GUARANTEE IS WHAT MAKES IT SAFE TO SURFACE. `csvEscape`
 * wraps and doubles, so no file this app writes can trip either check — stated
 * as a law by the round-trip property in the test file, not merely asserted
 * here. The §105 legitimate case (a marker-shaped line inside a properly quoted
 * cell) is well-formed and does not fire, and there is a pinned control test
 * for precisely that input. Without that control the suite cannot tell this
 * detector from the one §150 rejected.
 */
export function splitCsvLines(text: string): {
  lines: string[];
  unterminatedQuote: boolean;
  malformedQuotes: number;
} {
  const normalized = text.replace(/\r?\n/g, "\r\n");
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  let i = 0;
  // A field starts at a line start, or immediately after an unquoted comma.
  let atFieldStart = true;
  let malformedQuotes = 0;
  const isDelimiterAt = (n: number): boolean =>
    n >= normalized.length ||
    normalized[n] === "," ||
    (normalized[n] === "\r" && normalized[n + 1] === "\n");
  while (i < normalized.length) {
    const step = quoteStep(normalized, i, inQuotes);
    if (step) {
      // ★ An OPENING quote is only well-formed at a field start; a CLOSING one
      // only when a delimiter follows. Both are local, syntactic checks — see
      // the malformedQuotes note in the docstring for why that matters.
      if (!inQuotes && !atFieldStart) malformedQuotes++;
      else if (inQuotes && !step.inQuotes && !isDelimiterAt(step.next)) malformedQuotes++;
      // Keep the raw characters: sections are re-joined and re-parsed
      // downstream, so this must stay a lossless view of the input.
      buf += normalized.slice(i, step.next);
      inQuotes = step.inQuotes;
      i = step.next;
      atFieldStart = false;
      continue;
    }
    if (!inQuotes && normalized[i] === "\r" && normalized[i + 1] === "\n") {
      lines.push(buf);
      buf = "";
      i += 2;
      atFieldStart = true;
      continue;
    }
    if (!inQuotes && normalized[i] === ",") atFieldStart = true;
    else atFieldStart = false;
    buf += normalized[i];
    i++;
  }
  lines.push(buf);
  return { lines, unterminatedQuote: inQuotes, malformedQuotes };
}
