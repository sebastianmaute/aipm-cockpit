import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffHeadingsAgainstIndex } from "./followup-index-lib.mjs";

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
