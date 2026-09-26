import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffHeadingsAgainstIndex, rebuildIndex } from "./followup-index-lib.mjs";

// ★ `import.meta.url` is NOT a file: URL under vitest — `readFileSync` on one
// throws "The URL must be of scheme file". The sibling script tests all resolve
// from `process.cwd()`; follow them.
const REGISTER = path.join(process.cwd(), "docs/open-followups.md");

/** A register-shaped fixture: `headings` are `## <n>. …`, `rows` are index rows. */
function register({ headings, rows, table = true }) {
  const body = headings.map((n) => `## ${n}. Entry ${n}\n\nSome body.\n`).join("\n");
  const cells = rows.map((n) => `| [§${n}](#${n}-entry-${n}) | Entry ${n} | x | S | open |`);
  const index = table
    ? ["<!-- INDEX:BEGIN -->", "| # | Item | Origin | Size | State |", "|---|---|---|---|---|", ...cells, "<!-- INDEX:END -->"]
    : [];
  return ["# Open follow-ups", "", body, ...index, ""].join("\n");
}

describe("diffHeadingsAgainstIndex", () => {
  it("names a heading that has no index row", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [1, 2], rows: [1] }));
    expect(out.missingRows).toEqual([2]);
    expect(out.orphanRows).toEqual([]);
  });

  /** ★★★ THE ORPHAN CASE NEEDS A ROW WITHOUT A HEADING, NOT A HEADING WITHOUT A
   *  ROW. The obvious spelling — delete the `## 2.` heading and assert
   *  `orphanRows` is `[]` — compares empty against empty and passes whether
   *  orphan detection works or not. This matters more than it looks: the real
   *  register has ZERO orphans, so this test is the only coverage that code path
   *  will ever have. */
  it("names an index row that has no heading", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [1, 2], rows: [1, 2, 3] }));
    expect(out.orphanRows).toEqual([3]);
    expect(out.missingRows).toEqual([]);
  });

  it("reports both counts, so a caller can prove neither set was empty", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [1, 2, 3], rows: [1, 2] }));
    expect(out.headingCount).toBe(3);
    expect(out.rowCount).toBe(2);
  });

  /** ★★★ THE SET DIFFERENCE CANNOT SEE A DUPLICATE — BOTH LISTS COME BACK
   *  EMPTY. That is the whole reason these three tests exist: without them the
   *  gate exits 0 on a register whose two halves are visibly different lengths,
   *  and the only tell is a summary line printing two numbers nothing compares.
   *  A pasted row is the realistic input — the eight rows that closed this
   *  register's original gap were hand-authored. */
  it("names a §number carrying two index rows, which the set difference cannot", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [1, 2], rows: [1, 2, 2] }));
    expect(out.duplicateRows).toEqual([2]);
    // The negative control, and the point of the test: the differences are
    // BLIND here, so asserting them empty is what proves the new check is
    // carrying the detection rather than riding on an existing one.
    expect(out.missingRows).toEqual([]);
    expect(out.orphanRows).toEqual([]);
  });

  it("names a §number used by two headings", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [1, 2, 2], rows: [1, 2] }));
    expect(out.duplicateHeadings).toEqual([2]);
    expect(out.duplicateRows).toEqual([]);
    expect(out.missingRows).toEqual([]);
    expect(out.orphanRows).toEqual([]);
  });

  /** ★★ The dup-free fixture in "reports both counts" above cannot tell
   *  `headings.length` from `headingSet.size`, so a mutant swapping one for the
   *  other survives it — and that mutant is exactly what makes the counts stop
   *  reporting the disagreement a duplicate creates. This fixture separates
   *  them: 3 headings, 2 distinct. */
  it("counts every heading and row, not every distinct one", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [1, 2, 2], rows: [1, 2] }));
    expect(out.headingCount).toBe(3);
    expect(out.rowCount).toBe(2);
  });

  it("sorts both lists numerically, not lexicographically", () => {
    const out = diffHeadingsAgainstIndex(register({ headings: [2, 9, 10, 11], rows: [2, 3, 30] }));
    expect(out.missingRows).toEqual([9, 10, 11]);
    expect(out.orphanRows).toEqual([3, 30]);
  });

  /** ★★★ THE REGRESSION TEST FOR `indexOf`. The real register embeds both marker
   *  strings inside a fenced code sample that shows a reader how to slice the
   *  table — so the FIRST occurrence of each is hundreds of lines above the real
   *  table. `src.indexOf(INDEX_BEGIN)` slices that sample, which holds zero
   *  rows, and the gate then calls every heading missing. Whole-line matching is
   *  what makes this fixture parse; without this test the bug returns the moment
   *  someone "simplifies" the parser. */
  it("ignores marker strings embedded in a code sample above the real table", () => {
    const src = [
      "# Open follow-ups",
      "",
      "How to slice the table:",
      "",
      "```js",
      'const B = L.findIndex(l => l.trim() === "<!-- INDEX:BEGIN -->");',
      'const E = L.findIndex(l => l.trim() === "<!-- INDEX:END -->");',
      "```",
      "",
      register({ headings: [1, 2], rows: [1, 2] }),
    ].join("\n");
    const out = diffHeadingsAgainstIndex(src);
    expect(out.rowCount).toBe(2);
    expect(out.headingCount).toBe(2);
    expect(out.missingRows).toEqual([]);
  });

  /** Vacuity control A. */
  it("throws when the text carries no headings at all", () => {
    expect(() => diffHeadingsAgainstIndex(register({ headings: [], rows: [1, 2] }))).toThrow(
      /no `## <n>\.` headings/,
    );
  });

  /** Vacuity control B — the axis the `indexOf` defect travels on. */
  it("throws when the index table carries no rows", () => {
    expect(() => diffHeadingsAgainstIndex(register({ headings: [1, 2], rows: [] }))).toThrow(
      /no `\| \[§<n>\]\(#…\)` rows/,
    );
  });

  it("throws when the markers are missing entirely", () => {
    expect(() =>
      diffHeadingsAgainstIndex(register({ headings: [1, 2], rows: [], table: false })),
    ).toThrow(/no whole-line/);
  });

  it("throws rather than picking one when the markers are duplicated", () => {
    const src = register({ headings: [1], rows: [1] }) + "\n<!-- INDEX:BEGIN -->\n";
    expect(() => diffHeadingsAgainstIndex(src)).toThrow(/2 whole-line .* markers found/);
  });

  it("throws when the end marker precedes the begin marker", () => {
    const src = ["# R", "<!-- INDEX:END -->", "## 1. Entry 1", "<!-- INDEX:BEGIN -->", ""].join("\n");
    expect(() => diffHeadingsAgainstIndex(src)).toThrow(/precedes/);
  });

  /** ★★ Deliberately asserts SCANNABILITY, never today's eight missing numbers:
   *  a later task writes those rows, and a test pinned to the drift would go red
   *  on the fix. What must never regress is that both sides parse non-empty. */
  it("scans the real register and compares two non-empty sets", () => {
    const out = diffHeadingsAgainstIndex(readFileSync(REGISTER, "utf8"));
    expect(out.headingCount).toBeGreaterThan(400);
    expect(out.rowCount).toBeGreaterThan(400);
  });
});

// ── rebuildIndex (§319, §382) ───────────────────────────────────────────────

const HEAD = "| # | Item | Origin | Size | State |\n|---|---|---|---|---|";

/** A register with the given `## ` heading lines and index row lines. */
function doc(headings, rows) {
  return [
    "# Open follow-ups",
    "",
    "<!-- INDEX:BEGIN -->",
    HEAD,
    ...rows,
    "<!-- INDEX:END -->",
    "",
    ...headings.flatMap((h) => [h, "", "Body.", ""]),
  ].join("\n");
}

/** The index row lines of a register, in order. */
const rowsOf = (src) => src.split("\n").filter((l) => l.startsWith("| [§"));

describe("rebuildIndex", () => {
  // Mutation: regenerate State from the heading on every row (drop the
  // `flipped ? … : old.state` harvest) → the "(reason)" is lost; drop the
  // `strike` re-wrap → the `~~` is lost. Either turns this red.
  it("★★★ keeps a closed row's strike and closure reason byte-identical", () => {
    const row = "| [§1](#1-x--closed-2026-01-01) | ~~X~~ | o | S | **CLOSED** 2026-01-01 (reason) |";
    const src = doc(["## 1. X — CLOSED 2026-01-01"], [row]);
    expect(rowsOf(rebuildIndex(src))).toEqual([row]);
  });

  // Mutation: same State-harvest mutant → "open".
  it("★★★ keeps an open row's hand-written qualifier", () => {
    const row = "| [§2](#2-y) | Y | o | M | open (narrowed 2026-08-30 — only the modal half) |";
    expect(rowsOf(rebuildIndex(doc(["## 2. Y"], [row])))).toEqual([row]);
  });

  it("keeps Origin and Size verbatim, and bold / code-span decoration while the text matches", () => {
    // Mutation: build Item from the heading unconditionally (`item = fresh`) →
    // the backticks and bold the heading does not carry are lost.
    const row = "| [§3](#3-the-foo-helper--fork-open) | The `foo` helper — **fork open** | R5 (0.202.0) | S–M | open |";
    expect(rowsOf(rebuildIndex(doc(["## 3. The foo helper — fork open"], [row])))).toEqual([row]);
  });

  // Mutation: delete the `OPEN|open` alternatives from STATUS_SUFFIX_RE → the
  // new rows read "Y — OPEN" / "Z — open"; delete `ACCEPTED COST` → "W — ACCEPTED COST".
  it("strips a status suffix from a NEW row's Item", () => {
    const out = rowsOf(
      rebuildIndex(doc(["## 1. Y — OPEN", "## 2. Z — open", "## 3. W — ACCEPTED COST"], [])),
    );
    expect(out).toEqual([
      "| [§1](#1-y--open) | Y | — | — | open |",
      "| [§2](#2-z--open) | Z | — | — | open |",
      "| [§3](#3-w--accepted-cost) | W | — | — | open |",
    ]);
  });

  // Mutation: drop the `.replace(STATUS_SUFFIX_RE, "")` on the EXISTING cell →
  // its text no longer matches, so Item is rebuilt from the bare heading and
  // the row's backticks are lost ("Y", not "`Y`").
  it("cuts a status suffix that leaked into an existing Item cell, keeping its decoration", () => {
    const src = doc(
      ["## 1. Y — OPEN", "## 2. X — CLOSED 2026-01-01"],
      [
        "| [§1](#1-y--open) | `Y` — OPEN | o | S | open |",
        "| [§2](#2-x--closed-2026-01-01) | `X` — CLOSED 2026-01-01 | o | S | closed |",
      ],
    );
    expect(rowsOf(rebuildIndex(src))).toEqual([
      "| [§1](#1-y--open) | `Y` | o | S | open |",
      "| [§2](#2-x--closed-2026-01-01) | `X` | o | S | closed |",
    ]);
  });

  // Review I1. Mutation: unwrap the strike BEFORE cutting the suffix (the
  // first cut's order) → "~~X~~~~", a malformed cell that is its own fixed point.
  it("★★ a struck Item with a leaked CLOSED suffix rebuilds to a clean strike, twice", () => {
    const src = doc(
      ["## 1. X — CLOSED 2026-01-01"],
      ["| [§1](#1-x--closed-2026-01-01) | ~~X~~ — CLOSED 2026-01-01 | o | S | **CLOSED** 2026-01-01 |"],
    );
    const once = rebuildIndex(src);
    expect(rowsOf(once)).toEqual([
      "| [§1](#1-x--closed-2026-01-01) | ~~X~~ | o | S | **CLOSED** 2026-01-01 |",
    ]);
    expect(rebuildIndex(once)).toBe(once);
  });

  // Mutation: re-wrap whenever the cell STARTS with `~~` (`old.item.startsWith`
  // in the kept branch) → "~~~~X~~ Y~~".
  it("keeps a partial strike verbatim rather than wrapping it again", () => {
    const row = "| [§1](#1-x-y) | ~~X~~ Y | o | S | open |";
    expect(rowsOf(rebuildIndex(doc(["## 1. X Y"], [row])))).toEqual([row]);
  });

  // Mutation: keep `old.state` on a flip (drop `flipped ?`) → the stale
  // "open (narrowed …)" survives beside a CLOSED heading.
  it("★★ regenerates State from the heading when an open row's entry is closed", () => {
    const src = doc(
      ["## 1. Y — CLOSED 2026-02-02"],
      ["| [§1](#1-y) | Y | o | S | open (narrowed 2026-01-05) |"],
    );
    expect(rowsOf(rebuildIndex(src))).toEqual([
      "| [§1](#1-y--closed-2026-02-02) | Y | o | S | **CLOSED** 2026-02-02 |",
    ]);
  });

  // Mutation: `const strike = struck` (ignore the flip) → "~~X~~" stays on a
  // reopened entry; the State-flip mutant above → the closure reason stays.
  it("★★ removes the strike and the closure reason when a closed entry is reopened", () => {
    const src = doc(
      ["## 1. X"],
      ["| [§1](#1-x--closed-2026-01-01) | ~~X~~ | o | S | **CLOSED** 2026-01-01 (reason) |"],
    );
    expect(rowsOf(rebuildIndex(src))).toEqual(["| [§1](#1-x) | X | o | S | open |"]);
  });

  // Mutation: `item = inner` unconditionally → the stale title survives.
  it("rewrites an Item cell whose heading was retitled", () => {
    const src = doc(["## 1. New title"], ["| [§1](#1-old-title) | Old title | o | S | open |"]);
    expect(rowsOf(rebuildIndex(src))).toEqual(["| [§1](#1-new-title) | New title | o | S | open |"]);
  });

  // Mutation: drop the `.sort` → §10 lands before §2 (heading order).
  it("adds a row for a new heading, drops one whose heading is gone, and sorts by §number", () => {
    const src = doc(
      ["## 10. Ten", "## 2. Two"],
      ["| [§2](#2-two) | Two | o | S | open |", "| [§5](#5-five) | Five | o | S | open |"],
    );
    expect(rowsOf(rebuildIndex(src))).toEqual([
      "| [§2](#2-two) | Two | o | S | open |",
      "| [§10](#10-ten) | Ten | — | — | open |",
    ]);
  });

  it("★★ is a fixed point: a second rebuild changes nothing", () => {
    const src = doc(
      ["## 1. Y — CLOSED 2026-02-02", "## 2. X", "## 3. Z — OPEN", "## 4. New title", "## 7. Fresh — open"],
      [
        "| [§1](#1-y) | Y — open | o | S | open (narrowed) |",
        "| [§2](#2-x--closed-2026-01-01) | ~~X~~ | o | S | **CLOSED** 2026-01-01 (r) |",
        "| [§3](#3-z--open) | `Z` — OPEN | o | S | **OPEN** |",
        "| [§4](#4-old) | Old | o | S | open |",
        "| [§6](#6-gone) | Gone | o | S | open |",
      ],
    );
    const once = rebuildIndex(src);
    expect(once).not.toBe(src);
    expect(rebuildIndex(once)).toBe(once);
  });

  it("returns every byte outside the table unchanged, and ignores markers in a code sample", () => {
    const sample = ["```js", 'L.findIndex(l => l.trim() === "<!-- INDEX:BEGIN -->");', "```"];
    const src = [...sample, doc(["## 1. X"], ["| [§1](#1-x) | Old | o | S | open |"])].join("\n");
    const out = rebuildIndex(src);
    const strip = (s) => s.split("\n").filter((l) => !l.startsWith("| [§")).join("\n");
    expect(strip(out)).toBe(strip(src));
    expect(rowsOf(out)).toEqual(["| [§1](#1-x) | X | o | S | open |"]);
  });

  it("throws rather than guessing on a row that is not four cells", () => {
    const src = doc(["## 1. X"], ["| [§1](#1-x) | X | o | S | open | extra |"]);
    expect(() => rebuildIndex(src)).toThrow(/not four cells/);
  });

  it("throws on a §number with two headings", () => {
    expect(() => rebuildIndex(doc(["## 1. X", "## 1. Y"], []))).toThrow(/two headings/);
  });

  /** ★★★ THE REAL REGISTER IS A FIXED POINT OF ITS OWN REBUILD, AND THIS IS
   *  BLOCKING (it runs in the `unit` job). The index table is GENERATED:
   *  `rebuildIndex(real)` must return the file byte for byte. `rebuildIndex`
   *  leaves every byte outside the two markers untouched, so whole-file
   *  equality IS table-region equality. A heading added, closed, reopened or
   *  retitled without a rebuild turns this red, and the message names the
   *  command and the §numbers whose rows differ.
   *  ★ No allowlist and no tolerance: an earlier cut accepted named retitles
   *  and leaked status suffixes, which is exactly the drift this pins out. */
  it("★★★ the real register's index table is exactly what a rebuild produces", () => {
    const src = readFileSync(REGISTER, "utf8");
    const out = rebuildIndex(src);

    const byNumber = (text) =>
      new Map(rowsOf(text).map((l) => [Number(/^\| \[§(\d+)\]/.exec(l)[1]), l]));
    const before = byNumber(src);
    const after = byNumber(out);
    const differing = [...new Set([...before.keys(), ...after.keys()])]
      .filter((n) => before.get(n) !== after.get(n))
      .sort((a, b) => a - b);
    const message =
      `docs/open-followups.md's index table is not what the rebuild produces` +
      ` (${differing.length} row(s) differ: ${differing.map((n) => `§${n}`).join(" ")}).` +
      " Run `node scripts/rebuild-followup-index.mjs` and commit the result.";

    expect(differing, message).toEqual([]);
    // Byte equality catches what a per-row compare cannot: row ORDER, the
    // header lines, and a line-ending change inside the table.
    expect(out === src, message).toBe(true);
    // Anti-vacuity: a parser that matched no rows would compare empty to empty.
    expect(before.size).toBeGreaterThan(400);
  });
});
