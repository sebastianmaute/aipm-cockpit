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
import { ENTRY_RE, isClosed } from "./followup-claims-lib.mjs";

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
 *  ★ The fenced rebuild recipe that carried the in-file copies was replaced by
 *  `rebuildIndex` (§319, §382), so the register may no longer quote a marker
 *  at all — the guard stays, because the next code sample can reintroduce one.
 *  Count today's with `grep -c "<!-- INDEX:BEGIN -->" docs/open-followups.md`.
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

/** The two header lines every rebuilt table starts with. */
export const INDEX_HEAD = ["| # | Item | Origin | Size | State |", "|---|---|---|---|---|"];

/** A heading's trailing STATUS suffix — ` — CLOSED <date/reason>`, ` — OPEN`,
 *  ` — open`, ` — ACCEPTED COST`. It belongs in the State column, never in the
 *  Item cell. ★ `CLOSED` swallows the rest of the heading because that rest
 *  (a date, "in 0.211.1", ", not a defect") is exactly what State carries.
 *  ★ `**fork open**` (§1) and `— HALF FIXED …` (§64) are NOT matched: they are
 *  part of what the entry is called, and a closed-set list is the only way to
 *  keep a status word from eating a title. */
const STATUS_SUFFIX_RE = / — (?:CLOSED\b.*|OPEN|open|ACCEPTED COST)$/;

const CLOSED_MARK = " — CLOSED";

/** The anchor GitHub renders for `## <n>. <title>`: lowercase, every character
 *  outside `[a-z0-9 _-]` dropped, spaces to hyphens. ★ An em dash between two
 *  spaces therefore becomes TWO hyphens, which is correct, not a bug. */
export function headingSlug(n, title) {
  return `${n}. ${title}`
    .replace(/`|~~|\*\*/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

/** Item text for a heading: the status suffix and any `~~` removed. Whether the
 *  ROW is struck through is the row's own decoration, decided in
 *  `rebuildIndex`, not something the heading dictates. */
export function headingItem(title) {
  return title.replace(STATUS_SUFFIX_RE, "").replace(/~~/g, "").trim();
}

/** The State cell a heading implies on its own — used only for a NEW row, or
 *  when the heading's open/closed status no longer agrees with the row's. */
export function headingState(title) {
  if (!isClosed(title)) return "open";
  const at = title.indexOf(CLOSED_MARK);
  return at < 0 ? "**CLOSED**" : `**CLOSED**${title.slice(at + CLOSED_MARK.length)}`;
}

/** Whether a State CELL reads as closed, judged on its LEADING token only.
 *  ★★ Not a substring test: an open row whose qualifier mentions the word —
 *  `open (half closed by §9)` — would read as closed, count as a status flip,
 *  and have its qualifier silently reset to `open` (review M3).
 *  ★ The anchor is chosen from the data, not from a list of synonyms. Every
 *  State cell in the table (measured 2026-09-26, 604 rows) starts with one of
 *  `open`, `**OPEN**`, `**CLOSED**`, `CLOSED` or `closed`, so `closed` after
 *  an optional `**` is the whole closed vocabulary. `fixed`/`resolved`/
 *  `accepted` are deliberately NOT closed words: none occurs, and `accepted`
 *  would call §413's ACCEPTED COST entry closed while `isClosed` calls its
 *  heading open — a permanent false flip. Reproduce the leading-token tally
 *  (the `State` line it also prints is the header row):
 *  `sed -n '/<!-- INDEX:BEGIN -->/,/<!-- INDEX:END -->/p' docs/open-followups.md | grep -oE '\| (\*\*)?[A-Za-z]+[^|]* \|$' | grep -oE '^\| (\*\*)?[A-Za-z]+' | sort | uniq -c` */
export function stateIsClosed(state) {
  return /^\s*(\*\*)?closed\b/i.test(state);
}

const FULL_ROW_RE = /^\|\s*\[§(\d+)\]\(#[^)]*\)\s*\|(.*)\|\s*$/;

/** Text compared when deciding whether a row's Item still says what its
 *  heading says. Strike, bold and code-span markers are decoration, not text:
 *  a row that backticks a name its heading leaves bare (§539) still says the
 *  same thing, and keeps its formatting. */
export const itemText = (s) => s.replace(/~~|\*\*|`/g, "").trim();

/** Harvest the existing table: §n → { item, origin, size, state }.
 *  ★★ A row that does not split into exactly four cells THROWS. Guessing which
 *  cell is the State of a five-cell row is how a rebuild would silently move a
 *  closure reason into the Size column. */
function harvestRows(tableLines) {
  const rows = new Map();
  for (const line of tableLines) {
    if (!INDEX_ROW_RE.test(line)) continue;
    const m = FULL_ROW_RE.exec(line);
    const cells = m ? m[2].trim().split(" | ") : [];
    if (cells.length !== 4) {
      throw new Error(`CANNOT REBUILD: index row is not four cells: ${line.slice(0, 80)}`);
    }
    const n = Number(m[1]);
    if (rows.has(n)) throw new Error(`CANNOT REBUILD: §${n} has two index rows.`);
    const [item, origin, size, state] = cells;
    rows.set(n, { item, origin, size, state });
  }
  return rows;
}

/** One rebuilt row. See `rebuildIndex` for which cell comes from where. */
function rebuildRow(n, title, old) {
  const closed = isClosed(title);
  const fresh = headingItem(title);
  if (!old) {
    return `| [§${n}](#${headingSlug(n, title)}) | ${fresh} | — | — | ${headingState(title)} |`;
  }
  const flipped = stateIsClosed(old.state) !== closed;
  // ★ On a flip TO open the strike comes off; on a flip to closed none is
  // added — see `rebuildIndex` for the measured convention.
  const reopened = flipped && !closed;
  // ★★ ORDER MATTERS: cut a leaked status suffix FIRST, then look for a strike
  // wrapping the WHOLE remainder. Unwrapping first turned `~~X~~ — CLOSED d`
  // into `X~~` (only the leading `~~` sat at an edge), which then re-wrapped
  // to the malformed fixed point `~~X~~~~`.
  const body = old.item.replace(STATUS_SUFFIX_RE, "");
  const wrapped = /^~~[\s\S]*~~$/.test(body);
  const inner = wrapped ? body.slice(2, -2) : body;
  let item;
  if (itemText(inner) === itemText(fresh)) {
    // The row's own text and decoration survive. A PARTIAL strike (`~~X~~ Y`)
    // is not re-wrapped — it is already exactly as the row had it.
    if (reopened) item = inner.replace(/~~/g, "");
    else item = wrapped ? `~~${inner}~~` : inner;
  } else {
    // Retitled: text from the heading, and the row keeps being struck if it
    // was (§307's `~~…~~ — not a defect` is this branch).
    item = old.item.startsWith("~~") && !reopened ? `~~${fresh}~~` : fresh;
  }
  const state = flipped ? headingState(title) : old.state;
  return `| [§${n}](#${headingSlug(n, title)}) | ${item} | ${old.origin} | ${old.size} | ${state} |`;
}

/**
 * Rebuild the index table from the register's `## <n>.` headings (§319, §382).
 *
 * @param {string} src Raw register text.
 * @returns {string} The register with ONLY the lines between the two `INDEX:`
 *   markers replaced; every other byte is returned unchanged.
 * @throws when the table cannot be scanned (see `indexTableBounds`), a row is
 *   not four cells, or a §number is used twice on either axis.
 *
 * Per heading, one row, in ascending §order:
 * - **anchor** — derived from the heading (`headingSlug`).
 * - **Item** — the heading with its status suffix stripped (`headingItem`).
 *   ★ The EXISTING cell is kept verbatim, bold, code spans and strike
 *   included, whenever its text (`itemText`) still equals that. A status
 *   suffix that leaked into the cell is cut off and the rest kept. The cell is
 *   replaced from the heading only when its text has drifted — a retitle.
 * - **Origin, Size** — harvested verbatim. They are hand triage data with no
 *   machine source; a new entry starts at `—`.
 * - **State** — harvested verbatim, closure reason and all, while the row's
 *   open/closed status agrees with the heading's (`isClosed`, the same test the
 *   workitems gate uses). ★★ The HEADING decides closure: when the two
 *   disagree, State is regenerated from the heading (`headingState`), which
 *   drops the stale reason on purpose.
 * - **`~~`** — kept as the row has it. A flip to OPEN removes it. A flip to
 *   CLOSED does NOT add it: the table's own convention since §400 is an
 *   unstruck closed row (1 struck of the 150 closed rows from §400 on,
 *   measured 2026-09-26), and older struck rows keep theirs.
 *
 * Rows whose heading is gone are dropped. The result is a fixed point:
 * `rebuildIndex(rebuildIndex(x)) === rebuildIndex(x)`.
 *
 * ★★★ THIS REPLACES A FENCED `node -` RECIPE THAT HARVESTED ONLY Origin AND
 * Size, rebuilt Item and State from the heading, and called itself idempotent.
 * It stripped every hand-written closure reason and `~~` on each run, and a
 * second run agreeing with the first was the only sense in which it was
 * idempotent — after the damage.
 */
export function rebuildIndex(src) {
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const { begin, end } = indexTableBounds(lines);

  const headings = new Map();
  for (const line of lines) {
    const m = ENTRY_RE.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (headings.has(n)) throw new Error(`CANNOT REBUILD: §${n} has two headings.`);
    headings.set(n, m[2].trim());
  }
  if (headings.size === 0) throw new Error("CANNOT REBUILD: no `## <n>.` headings found.");

  const old = harvestRows(lines.slice(begin + 1, end));
  const rows = [...headings.keys()]
    .sort((a, b) => a - b)
    .map((n) => rebuildRow(n, headings.get(n), old.get(n)));

  return [...lines.slice(0, begin + 1), ...INDEX_HEAD, ...rows, ...lines.slice(end)].join(eol);
}
