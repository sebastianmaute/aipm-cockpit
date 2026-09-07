/** The heading ⟺ index-row contract for docs/open-followups.md.
 *
 *  The register carries a numbered entry per `## <n>. <title>` heading and an
 *  index table, between `<!-- INDEX:BEGIN -->` and `<!-- INDEX:END -->`, with
 *  one `| [§<n>](#<slug>) | …` row per entry. NOTHING compared the two sets
 *  before this file, and on the day it was written they disagreed: 413 headings
 *  against 405 rows.
 *
 *  ★★ Pure by design — no file I/O lives here, so both vacuity guards below are
 *  reachable from a unit test. `check-followup-index.mjs` is the only reader of
 *  the register. Same split as `followup-status-lib.mjs` / its CLI.
 *
 *  ★★ The heading regex is NOT re-spelled here. `ENTRY_RE` comes from
 *  `followup-claims-lib.mjs` — a second, differently-spelled heading parser is a
 *  second thing to drift out of agreement with the first, and this gate's whole
 *  job is to notice disagreement. */
import { ENTRY_RE } from "./followup-claims-lib.mjs";

export const INDEX_BEGIN = "<!-- INDEX:BEGIN -->";
export const INDEX_END = "<!-- INDEX:END -->";

/** `| [§42](#42-title) | … ` opens an index row. Anchored at line start so a
 *  citation to `[§42](#…)` in prose can never be counted as a row. */
export const INDEX_ROW_RE = /^\|\s*\[§(\d+)\]\(#/;

/** ★★★ WHOLE-LINE MATCHING IS LOAD-BEARING AND `indexOf` IS SILENTLY
 *  CATASTROPHIC HERE. The marker strings occur FOUR times in the real register:
 *  twice inside fenced code samples that show a reader how to slice the table
 *  (`l.trim() === "<!-- INDEX:BEGIN -->"`), and twice as the actual markers
 *  several hundred lines below. A `src.indexOf(INDEX_BEGIN)` therefore slices
 *  the two-line code sample, which holds ZERO rows — and the gate then reports
 *  every heading in the file as missing an index row. Measured against the real
 *  register, not reasoned: the sample span contains 0 rows, against 405 in the
 *  real span at merge-base 9219cbda. ★ The 405 is anchored to that sha on
 *  purpose — the live figure moves on every entry filed or closed, so a bare
 *  present-tense number here would be wrong by the next commit. Read today's
 *  off the gate's own summary line.
 *
 *  ★★ Several whole-line matches is a SCAN FAILURE, never a pick-the-first: a
 *  second pair of real markers means the file's shape is not what this parser
 *  believes, and guessing which pair is "the" table is how a gate quietly
 *  measures the wrong thing. */
function findMarker(lines, marker) {
  const hits = [];
  lines.forEach((line, i) => {
    if (line.trim() === marker) hits.push(i);
  });
  if (hits.length === 0) throw new Error(`CANNOT SCAN: no whole-line \`${marker}\` marker found.`);
  if (hits.length > 1) {
    throw new Error(
      `CANNOT SCAN: ${hits.length} whole-line \`${marker}\` markers found` +
        ` (lines ${hits.map((i) => i + 1).join(", ")}); the index table is ambiguous.`,
    );
  }
  return hits[0];
}

/** The line indices strictly BETWEEN the two markers. */
export function indexTableBounds(lines) {
  const begin = findMarker(lines, INDEX_BEGIN);
  const end = findMarker(lines, INDEX_END);
  if (end < begin) {
    throw new Error(
      `CANNOT SCAN: \`${INDEX_END}\` (line ${end + 1}) precedes` +
        ` \`${INDEX_BEGIN}\` (line ${begin + 1}).`,
    );
  }
  return { begin, end };
}

/**
 * Compare the register's `## <n>.` headings against its index table.
 *
 * @param {string} src Raw register text.
 * @returns {{missingRows: number[], orphanRows: number[], duplicateHeadings: number[], duplicateRows: number[], headingCount: number, rowCount: number}}
 *   `missingRows` = headings with no index row (write the row).
 *   `orphanRows`  = index rows with no heading (the row points at nothing).
 *   `duplicateHeadings` / `duplicateRows` = numbers appearing twice on that axis.
 *   All numerically sorted. The two counts are the sets that were COMPARED, so
 *   a caller can prove neither side was empty.
 * @throws when the file cannot be scanned — see the vacuity guard below.
 *
 * ★★★ THE SET DIFFERENCE ALONE IS BLIND TO A DUPLICATE, WHICH IS WHY BOTH
 * DUPLICATE AXES ARE REPORTED SEPARATELY. Paste one index row twice and the
 * difference is empty on both sides while `rowCount` and `headingCount`
 * disagree — so without this the gate exits 0 and quietly prints two different
 * numbers that nothing compares. That is not hypothetical for this file: the
 * eight rows that closed the original 413-vs-405 gap were hand-authored, and
 * hand-authoring is the input that produces a paste twice. A duplicate HEADING
 * is the worse half — two entries sharing a permanent §number that other docs
 * cite, so a cross-reference silently resolves to whichever renders first.
 * Added after cold review, 2026-09-07; there were none at the time.
 */
export function diffHeadingsAgainstIndex(src) {
  const lines = src.split(/\r?\n/);
  const { begin, end } = indexTableBounds(lines);

  const headings = [];
  for (const line of lines) {
    const m = ENTRY_RE.exec(line);
    if (m) headings.push(Number(m[1]));
  }

  const rows = [];
  for (const line of lines.slice(begin + 1, end)) {
    const m = INDEX_ROW_RE.exec(line);
    if (m) rows.push(Number(m[1]));
  }

  /** ★★★ GUARD BOTH AXES. A gate that scans nothing passes everything, and the
   *  ROW axis is exactly the axis the `indexOf` defect above travels on — with a
   *  headings-only guard, a run that had sliced the code sample would report
   *  every heading as missing at exit 1, reading as an ordinary red rather than
   *  as a broken scan, and the eventual "fix" would be to write 413 duplicate
   *  rows into the register. */
  if (headings.length === 0) {
    throw new Error("CANNOT SCAN: no `## <n>.` headings found.");
  }
  if (rows.length === 0) {
    throw new Error(
      `CANNOT SCAN: no \`| [§<n>](#…)\` rows found between the markers` +
        ` (lines ${begin + 1}–${end + 1}).`,
    );
  }

  const headingSet = new Set(headings);
  const rowSet = new Set(rows);
  const asc = (a, b) => a - b;

  /** Numbers that appear more than once on one axis. Derived from the ARRAYS,
   *  never the Sets — the Sets are exactly what erases this. */
  const duplicatesIn = (nums) => {
    const seen = new Set();
    const dup = new Set();
    for (const n of nums) {
      if (seen.has(n)) dup.add(n);
      else seen.add(n);
    }
    return [...dup].sort(asc);
  };

  return {
    missingRows: [...headingSet].filter((n) => !rowSet.has(n)).sort(asc),
    orphanRows: [...rowSet].filter((n) => !headingSet.has(n)).sort(asc),
    duplicateHeadings: duplicatesIn(headings),
    duplicateRows: duplicatesIn(rows),
    headingCount: headings.length,
    rowCount: rows.length,
  };
}
