# CSV Section Split Quoting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `splitCsvSections` from switching section mid-row when a quoted cell contains a line beginning with a section marker, which today silently destroys every subsequent row in that section.

**Architecture:** A new pure leaf module `csv-line-scan.ts` provides a quote-aware line splitter. `splitCsvSections` swaps one line to use it. Sections stay text, so all 27 section outputs and every `csvTo*` decoder are untouched. The splitter also reports whether the document ended inside an unterminated quote, which becomes the "loud" signal, published through the existing `truncationOps.reportFor` channel.

**Tech Stack:** TypeScript, vitest, fast-check (property tests), Next.js app under `src/app/`.

**Spec:** `docs/superpowers/specs/2026-08-16-csv-section-split-quoting-design.md`

---

## Background the engineer needs

**The defect.** `splitCsvSections` (`src/app/csv-codecs-decode.ts`) splits the CSV on raw physical lines *before* tokenizing, then tests each line with `startsWith` against 27 `# UPPERCASE` section markers. A quoted cell may legally contain newlines, so its continuation lands on its own physical line — and if that line starts with a marker, the parser switches section mid-row.

**Measured damage** (four tasks, one carrying `blockers: "step one\n# RAID\nstep two"`):

```
tasks in  : 4
tasks out : 1
blockers  : "step one"
diag      : {"droppedRows":0}
```

**Why the existing counter is blind.** The split leaves an orphan `"` at the head of the next buffer, and `parseCsv` treats it as an opening quote that absorbs the whole rest of the section into ONE cell. `decodeCsvSection` takes that cell as its header row, finds zero data rows, and never calls `build` — so nothing is ever *rejected*. Rows are **absorbed, not rejected**. Do not build any detector on reject-counting.

**The trap that will bite you (read this twice).** Today's code does `csv.split(/\r?\n/)` and later `join("\r\n")`. That round trip converts a newline *inside a quoted cell* from LF to CRLF. It is an accident of breaking the cell apart and reassembling it — but it is **pinned behaviour**: `codec-roundtrip.property.test.ts` defines `csvNewlines(s) = s.replace(/\r\n|\n/g, "\r\n")` and the **live** task round-trip property asserts `taskName: csvNewlines(v.taskName)`. A naive quote-aware splitter keeps the cell intact, the inner LF survives as LF, and those live tests go red. **Task 1 preserves the artifact deliberately** by normalizing break points before scanning.

**A bare `\r` must be left alone.** `split(/\r?\n/)` does not split on it, so neither may we. Normalizing it would collide with open-followups §106 (Markdown bare-CR erosion), which is out of scope.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/csv-line-scan.ts` | **Create** | Pure, DOM-free, zero imports. `quoteStep` (character-level quote state) + `splitCsvLines` (quote-aware line splitter reporting `unterminatedQuote`). |
| `src/app/csv-line-scan.test.ts` | **Create** | Unit tests for both exports. |
| `src/app/csv-section-split.test.ts` | **Create** | Multi-row regression at the `csvToWorkspace` level. |
| `src/app/csv-codecs-decode.ts` | Modify | `splitCsvSections` uses `splitCsvLines`; gains an optional `diag`; `ImportDiag` gains `unterminatedQuote`. |
| `src/app/csv-codecs-core.ts` | Modify | `parseCsv` routes its quote transitions through `quoteStep`. **776 of 800 lines — net growth must stay under 24 lines.** |
| `src/app/codec-roundtrip.property.test.ts` | Modify | Unskip the §105 block; add the differential property. |
| `src/app/workspace.ts` | Modify | `StorageBackend` gains optional `lastImportUnterminatedQuote`. |
| `src/app/local-file-backend.ts` | Modify | Publish the new flag. |
| `src/app/sharepoint-backend.ts` | Modify | Publish the new flag. |
| `src/app/use-load-truncation.ts` | Modify | `reportFor` widens to carry import diagnostics. |
| `src/app/use-storage-file-ops.ts` | Modify | Delete the now-duplicate dropped-rows toast. |
| `src/app/use-storage-backend.ts` | Modify | Extend the deliberate non-`reportFor` comment. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | Modify | One new key pair. |
| `docs/open-followups.md` | Modify | Correct §105's stale facts; close it. |

---

### Task 1: The quote-aware line scanner

**Files:**
- Create: `src/app/csv-line-scan.ts`
- Test: `src/app/csv-line-scan.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/csv-line-scan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { quoteStep, splitCsvLines } from "./csv-line-scan";

describe("quoteStep", () => {
  it("returns null on a character that is not a quote", () => {
    expect(quoteStep("abc", 0, false)).toBeNull();
    expect(quoteStep("abc", 0, true)).toBeNull();
  });

  it("opens a quote from outside", () => {
    expect(quoteStep('"a', 0, false)).toEqual({ inQuotes: true, next: 1 });
  });

  it("closes a quote from inside", () => {
    expect(quoteStep('a"b', 1, true)).toEqual({ inQuotes: false, next: 2 });
  });

  it("treats a doubled quote inside quotes as an escape and stays inside", () => {
    expect(quoteStep('a""b', 1, true)).toEqual({ inQuotes: true, next: 3 });
  });
});

describe("splitCsvLines", () => {
  it("splits on CRLF outside quotes", () => {
    expect(splitCsvLines("a\r\nb").lines).toEqual(["a", "b"]);
  });

  it("normalizes a bare LF break to the same split", () => {
    expect(splitCsvLines("a\nb").lines).toEqual(["a", "b"]);
  });

  it("does NOT split on a newline inside a quoted cell", () => {
    expect(splitCsvLines('x,"one\ntwo",y').lines).toEqual(['x,"one\r\ntwo",y']);
  });

  it("does NOT split on a marker-shaped line inside a quoted cell", () => {
    const text = '1,T,"step one\n# RAID\nstep two"\r\n2,U,';
    expect(splitCsvLines(text).lines).toEqual([
      '1,T,"step one\r\n# RAID\r\nstep two"',
      "2,U,",
    ]);
  });

  it("leaves a BARE CR untouched — split(/\\r?\\n/) does not break on it either", () => {
    expect(splitCsvLines("a\rb").lines).toEqual(["a\rb"]);
  });

  it("keeps the trailing empty element a trailing break produces", () => {
    expect(splitCsvLines("a\r\n").lines).toEqual(["a", ""]);
  });

  it("reports a balanced document as terminated", () => {
    expect(splitCsvLines('a,"b"\r\nc').unterminatedQuote).toBe(false);
  });

  it("reports an unterminated quote", () => {
    expect(splitCsvLines('a,"b\r\nc').unterminatedQuote).toBe(true);
  });

  // ★ THE LOSSLESS INVARIANT. Equivalence with the old regex is NOT at the
  // line-array level (the old split breaks inside quotes and we must not), it
  // is that rejoining reproduces the normalized input exactly. This is what
  // makes the one-line swap in Task 3 safe for all 27 sections.
  it("is lossless: rejoining reproduces the normalized input", () => {
    for (const text of ['a,"b\nc",d\r\ne', "plain\r\nrows\r\n", 'q,"""esc""",z', "a\rb\nc"]) {
      const expected = text.replace(/\r?\n/g, "\r\n");
      expect(splitCsvLines(text).lines.join("\r\n")).toBe(expected);
    }
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/app/csv-line-scan.test.ts --reporter=dot`
Expected: FAIL — `Failed to resolve import "./csv-line-scan"`.

★ If you instead see `Test Files no tests` / `Tests no tests` with a non-zero exit and a `Failed to start forks worker` line, that is a **worker-startup timeout, not a result**. Re-run, adding `--pool=threads` if it recurs.

- [ ] **Step 3: Write the implementation**

Create `src/app/csv-line-scan.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/app/csv-line-scan.test.ts --reporter=dot`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (vitest never typechecks — a test-only type error passes the suite and fails CI.)

- [ ] **Step 6: Commit**

```bash
git add src/app/csv-line-scan.ts src/app/csv-line-scan.test.ts
git commit -m "feat(csv): add a quote-aware line scanner"
```

---

### Task 2: Route `parseCsv` through the shared quote step

**Files:**
- Modify: `src/app/csv-codecs-core.ts` (`parseCsv`, currently at line 717)

★ **Budget check first.** `csv-codecs-core.ts` is at 776 of the 800-line cap and is NOT baselined, so it must stay under 800. `size:check` counts `readFileSync().split("\n").length`, which is `wc -l` + 1. Measure with:
`node -e "console.log(require('fs').readFileSync('src/app/csv-codecs-core.ts','utf8').split('\n').length)"`
This task must not grow the file by more than ~20 lines.

- [ ] **Step 1: Add the import**

At the top of `src/app/csv-codecs-core.ts`, with the other imports:

```ts
import { quoteStep } from "./csv-line-scan";
```

- [ ] **Step 2: Replace the four quote branches in `parseCsv`**

In `parseCsv`, replace the `if (inQuotes) { ... }` quote handling and the `if (c === '"')` branch in the else-arm with a single leading call. The loop body becomes:

```ts
  while (i < text.length) {
    const c = text[i];
    const step = quoteStep(text, i, inQuotes);
    if (step) {
      // A doubled quote inside quotes is the only case that CONTRIBUTES a
      // character; opening and closing contribute nothing to the cell.
      if (inQuotes && step.inQuotes) buf += '"';
      inQuotes = step.inQuotes;
      i = step.next;
      continue;
    }
    if (inQuotes) {
      buf += c;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(buf);
      buf = "";
      i++;
      continue;
    }
    if (c === "\r" && text[i + 1] === "\n") {
      row.push(buf);
      rows.push(row);
      row = [];
      buf = "";
      i += 2;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(buf);
      rows.push(row);
      row = [];
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
```

- [ ] **Step 3: Run the full codec suite to prove behaviour is unchanged**

Run: `npx vitest run src/app/csv-codecs --reporter=dot`
Expected: PASS, no change in counts.

Also run the byte-stability goldens, which are the strongest witness here:

Run: `npx vitest run src/app/golden-workspace.test.ts --reporter=dot`
Expected: PASS. **Any failure means the refactor changed the tokenizer — revert, do not regenerate fixtures.**

- [ ] **Step 4: Re-measure the file size**

Run: `node -e "console.log(require('fs').readFileSync('src/app/csv-codecs-core.ts','utf8').split('\n').length)"`
Expected: under 800. If it is not, move `parseCsv` itself into `csv-line-scan.ts` and re-export it rather than shrinking comments.

- [ ] **Step 5: Commit**

```bash
git add src/app/csv-codecs-core.ts
git commit -m "refactor(csv): route parseCsv quote transitions through quoteStep"
```

★ **If `quoteStep` does not fit `parseCsv` cleanly, abandon this task.** The spec says so explicitly: the differential property in Task 4 is what actually guarantees the two scanners agree. Do not bend `parseCsv` around a helper that does not suit it — revert and move on.

---

### Task 3: Swap the splitter and pin the multi-row regression

**Files:**
- Modify: `src/app/csv-codecs-decode.ts` (`splitCsvSections`, the `const lines =` line)
- Test: `src/app/csv-section-split.test.ts` (create)

- [ ] **Step 1: Write the failing regression test**

Create `src/app/csv-section-split.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { emptyWorkspace } from "./workspace";
import type { Task } from "./types";

function mkTask(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `T${id}`,
    status: "To Do",
    createdDate: "2026-01-01",
    ...over,
  } as Task;
}

describe("CSV section splitting is quote-aware", () => {
  // ★★★ THE FIXTURE IS FOUR TASKS ON PURPOSE. open-followups §105 carried a
  // ONE-task fixture, which showed only `blockers` truncating and hid the real
  // damage: every row after the hostile cell dies too. A single-task fixture
  // passes against a fix that still misroutes the remaining rows.
  it("keeps every later row when a cell contains a line starting with a marker", () => {
    const tasks = [
      mkTask(1, { blockers: "step one\n# RAID\nstep two" }),
      mkTask(2),
      mkTask(3),
      mkTask(4),
    ];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));

    expect(back.tasks.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    // LF→CRLF inside a quoted cell is accepted, pinned codec behaviour.
    expect(back.tasks[0].blockers).toBe("step one\r\n# RAID\r\nstep two");
  });

  it("survives a marker-shaped line in a cell of the LAST section too", () => {
    const tasks = [mkTask(1, { blockers: "a\n# TASKS\nb" }), mkTask(2)];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/app/csv-section-split.test.ts --reporter=dot`
Expected: FAIL — `expected [ 1 ] to deeply equal [ 1, 2, 3, 4 ]`.

★ Confirm you see exactly that. A different failure means the fixture is wrong, not the code.

- [ ] **Step 3: Make the one-line change**

In `src/app/csv-codecs-decode.ts`, add to the imports:

```ts
import { splitCsvLines } from "./csv-line-scan";
```

Then in `splitCsvSections`, replace:

```ts
  const lines = csv.split(/\r?\n/);
```

with:

```ts
  // ★★★ QUOTE-AWARE, NOT `csv.split(/\r?\n/)`. A raw split breaks a quoted
  // cell across physical lines, and a continuation that begins with a section
  // marker then switched `mode` MID-ROW — silently destroying every later row
  // in the section (open-followups §105). Do not "simplify" this back.
  const { lines } = splitCsvLines(csv);
```

- [ ] **Step 4: Run the regression and the whole codec suite**

Run: `npx vitest run src/app/csv-section-split.test.ts --reporter=dot`
Expected: PASS, 2 tests.

Run: `npx vitest run src/app/csv-codecs src/app/golden-workspace.test.ts src/app/codec-roundtrip --reporter=dot`
Expected: PASS. The live `csvNewlines` property must stay green — if it fails, the normalization in `splitCsvLines` step 1 is wrong, not the test.

- [ ] **Step 5: Mutation-check the guard**

Two mutations, each reverted before the next. **Confirm each mutation actually LANDED in the file before trusting its result** — a mutation that never applied looks exactly like a test that cannot fail.

*Mutation A — drop the normalization.* Change `splitCsvLines`'s first line to `const normalized = text;` and run `npx vitest run src/app/codec-roundtrip --reporter=dot`.
Expected: RED, proving the normalization is load-bearing rather than cosmetic. Revert; re-run; confirm green.

*Mutation B — drop the quote-awareness.* Change the break condition from `if (!inQuotes && normalized[i] === "\r" ...)` to `if (normalized[i] === "\r" ...)` and run `npx vitest run src/app/csv-section-split.test.ts --reporter=dot`.
Expected: RED with `expected [ 1 ] to deeply equal [ 1, 2, 3, 4 ]` — the original defect, proving the regression test detects it rather than passing for some unrelated reason. Revert; re-run; confirm green.

★ Sweep for live mutants before committing: `git diff src/app/csv-line-scan.ts` must show no leftover edit.

- [ ] **Step 6: Commit**

```bash
git add src/app/csv-codecs-decode.ts src/app/csv-section-split.test.ts
git commit -m "fix(csv): stop section markers matching inside a quoted cell"
```

---

### Task 4: Unskip §105 and add the differential property

**Files:**
- Modify: `src/app/codec-roundtrip.property.test.ts`

- [ ] **Step 1: Unskip the §105 block**

Change `describe.skip("CSV codec — section markers must not be matched inside a quoted cell"` to `describe(`. Leave the §106 markdown block (`describe.skip("Markdown codec — one pass must be a fixed point on any string"`) **skipped** — it is a different, out-of-scope defect.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/codec-roundtrip --reporter=dot`
Expected: PASS. The block's expectation is `blockers: csvNewlines(t.blockers)`, which Task 1's normalization preserves.

- [ ] **Step 3: Add the differential property**

Append to `src/app/codec-roundtrip.property.test.ts`:

```ts
describe("csv-line-scan and parseCsv agree about quoting", () => {
  // ★ The scanner and the tokenizer are separate loops. THIS is what
  // guarantees they cannot drift — not the shared `quoteStep` helper, which is
  // only a mitigation.
  it("splitCsvLines is lossless on any string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const expected = s.replace(/\r?\n/g, "\r\n");
        expect(splitCsvLines(s).lines.join("\r\n")).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  // ★★★ DO NOT write this one as `parseCsv(rejoined) === parseCsv(normalized)`.
  // That is VACUOUS: the property above says rejoining REPRODUCES the
  // normalized input, so such a test compares a value with itself and cannot
  // fail for any implementation. It was written that way first and caught in
  // review. The real invariant is that a line never ENDS mid-quote when the
  // document as a whole is balanced — which is precisely what a naive splitter
  // violates.
  it("never ends a line inside a quote when the document is balanced", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const { lines, unterminatedQuote } = splitCsvLines(s);
        fc.pre(!unterminatedQuote);
        for (const line of lines) {
          let inQuotes = false;
          let i = 0;
          while (i < line.length) {
            const step = quoteStep(line, i, inQuotes);
            if (step) {
              inQuotes = step.inQuotes;
              i = step.next;
            } else i++;
          }
          expect(inQuotes).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });
});
```

Add to that file's imports:

```ts
import { splitCsvLines, quoteStep } from "./csv-line-scan";
```

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run src/app/codec-roundtrip --reporter=dot`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/codec-roundtrip.property.test.ts
git commit -m "test(csv): unskip the section-marker property and pin scanner/tokenizer agreement"
```

---

### Task 5: Carry the unterminated-quote flag on `ImportDiag`

**Files:**
- Modify: `src/app/csv-codecs-decode.ts` (`ImportDiag`, `splitCsvSections`, `csvToWorkspace`)
- Test: `src/app/csv-section-split.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/csv-section-split.test.ts`:

```ts
import type { ImportDiag } from "./csv-codecs";

describe("unbalanced quoting is reported, not silent", () => {
  it("flags a document that ends inside a quote", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace('# TASKS\r\nid,taskName,blockers\r\n1,T1,"never closed', diag);
    expect(diag.unterminatedQuote).toBe(true);
  });

  it("leaves the flag false on a well-formed document", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(workspaceToCsv({ ...emptyWorkspace(), tasks: [mkTask(1)] }), diag);
    expect(diag.unterminatedQuote).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/app/csv-section-split.test.ts --reporter=dot`
Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 3: Implement**

In `src/app/csv-codecs-decode.ts`, extend the interface:

```ts
export interface ImportDiag extends DocTruncationDiag {
  droppedRows: number;
  /** True when the document ended INSIDE a quoted cell. Our own encoder always
   *  balances quotes, so this can only fire on a hand-edited, truncated or
   *  foreign file — which is the remaining silent-loss vector now that §105's
   *  mid-row section switch is fixed. Rows there are ABSORBED into one giant
   *  cell rather than rejected, so `droppedRows` cannot see them. */
  unterminatedQuote?: boolean;
}
```

Give `splitCsvSections` an optional diag parameter — change its signature line from `function splitCsvSections(csv: string): {` to:

```ts
function splitCsvSections(csv: string, diag?: ImportDiag): {
```

and set the flag where the lines are produced:

```ts
  const { lines, unterminatedQuote } = splitCsvLines(csv);
  if (diag) diag.unterminatedQuote = unterminatedQuote;
```

Then in `csvToWorkspace`, pass the diag through — find the `splitCsvSections(csv)` call and make it `splitCsvSections(csv, diag)`.

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run src/app/csv-section-split.test.ts --reporter=dot`
Expected: PASS, 4 tests.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/csv-codecs-decode.ts src/app/csv-section-split.test.ts
git commit -m "feat(csv): report an unterminated quote on ImportDiag"
```

---

### Task 6: The i18n pair

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

★ **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Write it with a node UTF-8 write against `\r\n` anchors, as below. An anchor using `\n` silently matches nothing.

- [ ] **Step 1: Add the EN string**

In `src/app/i18n.ts`, immediately after the `importDroppedRowsWarning` line:

```ts
  importUnbalancedQuotesWarning: "The file has an unclosed quotation mark, so some rows may be missing. Check the file before saving over it.",
```

- [ ] **Step 2: Add the DE string via a node write**

```bash
node -e "
const fs=require('fs');
const p='src/app/i18n.de.ts';
let s=fs.readFileSync(p,'utf8');
const anchor='  importDroppedRowsWarning: \"{0} ungültige Zeile(n) in der Datei wurden beim Import übersprungen.\",\r\n';
if(!s.includes(anchor)) throw new Error('anchor not found — check CRLF');
s=s.replace(anchor, anchor+'  importUnbalancedQuotesWarning: \"Die Datei enthält ein nicht geschlossenes Anführungszeichen, daher fehlen möglicherweise Zeilen. Prüfen Sie die Datei, bevor Sie sie überschreiben.\",\r\n');
fs.writeFileSync(p,s,'utf8');
console.log('written');
"
```

- [ ] **Step 3: Verify the encoding survived**

```bash
node -e "
const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
const line=s.split(/\r?\n/).find(l=>l.includes('importUnbalancedQuotesWarning'));
console.log(line);
console.log('FFFD:', (line.match(/�/g)||[]).length, 'umlauts:', (line.match(/[äöüÄÖÜß]/g)||[]).join(''));
"
```
Expected: `FFFD: 0` and a non-empty umlaut list. There must be no `fuer`/`ueber`-style ASCII substitutions — the `i18n-encoding` test bans them.

- [ ] **Step 4: Typecheck (this is what enforces EN/DE key parity)**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add the unbalanced-quotes import warning"
```

---

### Task 7: Backends publish the flag

**Files:**
- Modify: `src/app/workspace.ts` (`StorageBackend`)
- Modify: `src/app/local-file-backend.ts`
- Modify: `src/app/sharepoint-backend.ts`

- [ ] **Step 1: Add the interface field**

In `src/app/workspace.ts`, immediately after the `lastImportDroppedRows?: number;` declaration:

```ts
  /**
   * Optional: whether the LAST {@link load} hit an unterminated quote while
   * decoding a CSV/Markdown import. Distinct from
   * {@link StorageBackend.lastImportDroppedRows} — a dropped row was malformed
   * and rejected, whereas unbalanced quoting ABSORBS rows into one cell so they
   * are never counted at all.
   */
  lastImportUnterminatedQuote?: boolean;
```

- [ ] **Step 2: Publish it from `local-file-backend.ts`**

Add the field beside the existing `lastImportDroppedRows` declaration on the class:

```ts
  lastImportUnterminatedQuote = false;
```

In `load()`, beside `this.lastImportDroppedRows = diag.droppedRows;`:

```ts
      this.lastImportUnterminatedQuote = diag.unterminatedQuote ?? false;
```

★ Also reset it where `this.lastImportDroppedRows = 0;` is set near the top of `load()`, so a clean load lowers a stale flag:

```ts
      this.lastImportUnterminatedQuote = false;
```

- [ ] **Step 3: Publish it from `sharepoint-backend.ts`**

Make the identical three edits (declaration, reset, publish) against that file's existing `lastImportDroppedRows` sites.

- [ ] **Step 4: Typecheck and run the backend suites**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run src/app/local-file-backend src/app/sharepoint-backend src/app/backend-truncation-registry --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace.ts src/app/local-file-backend.ts src/app/sharepoint-backend.ts
git commit -m "feat(storage): publish the unterminated-quote flag from the CSV backends"
```

---

### Task 8: Widen `reportFor` and delete the duplicate toast

**Files:**
- Modify: `src/app/use-load-truncation.ts`
- Modify: `src/app/use-storage-file-ops.ts`
- Modify: `src/app/use-storage-backend.ts` (comment only)

**Why:** `lastImportDroppedRows` has exactly ONE reader today (`use-storage-file-ops.ts`), while `truncationOps.reportFor` has FIVE call sites. Moving the reporting into `reportFor` takes import diagnostics from 1 load path to 5, makes the two signals travel together so they cannot drift, and inherits the existing completeness net in `use-load-truncation.test.ts` (`it.each(OPS_FILES)("%s reports every load it performs")`, which asserts `reportFor` calls equal `.load()` calls).

- [ ] **Step 1: Widen the interface**

In `src/app/use-load-truncation.ts`, change the `reportFor` declaration on `TruncationOps`:

```ts
  /** Record the outcome of a just-finished load. Call after EVERY
   *  `backend.load()` whose workspace is APPLIED to render scope — including
   *  clean ones, because this both raises AND lowers the flag.
   *
   *  ★★ IT ALSO CARRIES IMPORT DIAGNOSTICS. `lastImportDroppedRows` used to be
   *  read at ONE call site while this channel had five, so four load paths
   *  reported nothing however many rows vanished. Both signals ride one call so
   *  they cannot drift apart, and the `reportFor`-per-`load()` census in this
   *  file's test is what catches a new path that forgets. */
  reportFor: (
    backend: Pick<
      StorageBackend,
      "lastLoadTruncation" | "lastImportDroppedRows" | "lastImportUnterminatedQuote"
    >,
  ) => void;
```

- [ ] **Step 2: Report both signals in the implementation**

Replace the `truncationOps` `reportFor` line:

```ts
    reportFor: (backend) => {
      reportLoadTruncation(backend.lastLoadTruncation);
      reportImportDiagnostics(backend);
    },
```

and add the reporter beside `reportLoadTruncation`:

```ts
  const reportImportDiagnostics = (
    backend: Pick<StorageBackend, "lastImportDroppedRows" | "lastImportUnterminatedQuote">,
  ) => {
    const dropped = backend.lastImportDroppedRows ?? 0;
    if (dropped > 0) {
      showToast("error", t(langRef.current, "importDroppedRowsWarning", dropped));
    }
    // ★ Separate toast, not an `else`: a file can both drop malformed rows AND
    // end mid-quote, and they are different losses with different remedies.
    if (backend.lastImportUnterminatedQuote) {
      showToast("error", t(langRef.current, "importUnbalancedQuotesWarning"));
    }
  };
```

- [ ] **Step 3: Delete the now-duplicate toast**

In `src/app/use-storage-file-ops.ts`, delete these three lines (they sit just after the `projectLoadedToast` call):

```ts
      const droppedRows = targetBackend.lastImportDroppedRows ?? 0;
      if (droppedRows > 0) {
        deps.showToast("error", t(deps.langRef.current, "importDroppedRowsWarning", droppedRows));
      }
```

The `deps.truncationOps.reportFor(targetBackend)` call a few lines above now covers it.

- [ ] **Step 4: Extend the deliberate non-call comment**

In `src/app/use-storage-backend.ts`, the `await backend.load()` around line 538 carries a `★ NO reportFor:` comment whose stated reason is document-specific. Append to it:

```
// ★★ THAT NOW ALSO SUPPRESSES IMPORT DIAGNOSTICS (dropped rows, unbalanced
// quotes), because both ride `reportFor`. Deliberate and unchanged in intent:
// this path applies tasks+raid ONLY, so it is not the load whose losses the
// user is being asked about.
```

- [ ] **Step 5: Run the storage suites**

Run: `npx vitest run src/app/use-load-truncation src/app/use-storage-file-ops src/app/use-storage-backend src/app/use-storage-turso-ops --reporter=dot`
Expected: PASS. If the `reports every load it performs` census fails, a `.load()` was added without a `reportFor` — fix the call site, never the census.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-load-truncation.ts src/app/use-storage-file-ops.ts src/app/use-storage-backend.ts
git commit -m "feat(storage): report import diagnostics on every load path, not one"
```

---

### Task 9: Correct and close §105

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Rewrite the §105 heading and status**

Change the heading to:

```markdown
## 105. CSV section markers are matched on RAW LINES, so a newline inside a quoted cell can switch the parser's section mid-row — CLOSED 2026-08-16
```

- [ ] **Step 2: Correct the two stale facts inside the entry**

The entry's count reproduce line says **26**; the answer is now **27** (`# ACTIVITY LOG` landed after it was written). Update the number and leave the command.

Replace the measured-damage block with the real blast radius:

```markdown
**Measured, not reasoned** (four tasks, one carrying the hostile value):

```
tasks in  : 4      tasks out : 1      ids out : [1]
blockers  : "step one"              droppedRows : 0
```

★★ THE ORIGINAL ENTRY'S FIXTURE HAD ONE TASK AND THAT HID THE REAL DAMAGE. It
reported only `blockers` truncating. Tasks 2–4 are destroyed outright, and a
one-task fixture passes against a fix that still misroutes the rest.

★★★ THE ROWS ARE ABSORBED, NOT REJECTED, which is why `droppedRows` was 0
despite `decodeCsvSection` counting every reject. The split leaves an orphan `"`
at the head of the next buffer; `parseCsv` reads it as an opening quote and
swallows the entire rest of the section into ONE cell, which `decodeCsvSection`
then takes as its header row — so `build` is never called and nothing is ever
rejected. Any detector built on reject-counting, or on "rows found vs entities
produced", is structurally blind to this class. Two such detectors were designed
and discarded before the unterminated-quote signal was measured.
```

- [ ] **Step 3: Record the fix and the reachability trace**

Append to the entry:

```markdown
**Fixed** by `splitCsvLines` (`csv-line-scan.ts`), which splits on a break only
when outside a quoted cell. ★★ Its `text.replace(/\r?\n/g, "\r\n")` first step
is LOAD-BEARING: the old raw-split/rejoin turned a newline inside a quoted cell
into CRLF by accident, and the live round-trip property pins that
(`taskName: csvNewlines(v.taskName)`), so a splitter that keeps the cell intact
without normalizing first turns those tests red. ★ A bare `\r` is deliberately
untouched — `split(/\r?\n/)` did not break on one either, and normalizing it
would collide with §106.

**Reachability, now traced** (the entry previously flagged this as argued):
`blockers` is a `<textarea>` in `task-form-fields.tsx`, an inline textarea in
`task-row.tsx` (`renderInlineTextarea`), and an AI-writable field via
`use-chat-dispatcher.ts`. Pressing Enter is sufficient.
```

- [ ] **Step 4: Run the doc gates**

```bash
npm run docs:claims:check; echo "CLAIMS=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
```
Expected: both exit 0. Do NOT re-baseline to pass — the ratchet only tolerates citations being REMOVED.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: close open-followups §105 and correct its two stale facts"
```

---

### Task 10: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

★ **Fetch before bumping** — the number moves under you. Two prior branches were forced to renumber at merge time.

- [ ] **Step 1: Determine the next version**

```bash
git fetch origin
git show origin/main:src/app/version.ts | grep -E "APP_VERSION|APP_MILESTONE"
```
Bump the MINOR (this is a user-visible data-loss fix, not a refactor) and pick the next unused codename.

- [ ] **Step 2: Update `src/app/version.ts`**

Set `APP_VERSION`, `APP_BUILD_DATE` (`2026-08-16` or later), `APP_MILESTONE`; prepend the codename-history line; append `"versionHighlightCsvQuoting"` to `APP_HIGHLIGHT_KEYS`.

★ `version.ts` is CRLF — an LF-anchored node replace silently no-ops. Match `\r\n`.

- [ ] **Step 3: Add the highlight strings**

EN, in `src/app/i18n.ts`:

```ts
  versionHighlightCsvQuoting: "Fixed a CSV import defect where a note containing a line like \"# RAID\" could silently discard later rows; imports now warn when a file has an unclosed quotation mark",
```

DE, via the same node-write pattern as Task 6 step 2 (anchor on the EN-adjacent DE key with `\r\n`), with real umlauts.

- [ ] **Step 4: Add the CHANGELOG entry**

A `## [<version>] - 2026-08-16 "<Codename>"` section with a **Fixed** entry in user-facing voice. **No `[session link removed]...` URL** — that is banned in `CHANGELOG.md` and MR descriptions.

- [ ] **Step 5: Bump the five ungated sites**

`package.json` `version`; `package-lock.json` (**two** occurrences — root `version` and `packages[""]`); the README shields badge (version **and** codename); the `<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.

Verify none are missed:

```bash
grep -rn "<previous-version>" package.json package-lock.json README.md docs/CODEMAPS/ src/app/version.ts
```
Expected: no output.

- [ ] **Step 6: Full gate run**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
```

★★★ **Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect, check unpiped, then read the file.
★ The full suite can exceed the 10-minute Bash cap. If it does, shard it foreground (`npm run test:shuffle -- --shard=N/3`) and reconcile the totals; a backgrounded run is KILLED and its notification reports the trailing `echo`'s status, not vitest's.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(release): <version> \"<Codename>\""
```

---

## Definition of done

- `npm run test:shuffle` green (the only local reproduction of `unit-tests-shuffled`).
- The §105 property block runs unskipped; the §106 markdown block is still skipped.
- `golden-workspace.test` green with **no regenerated fixtures** — the encode path was never touched, so any movement means the fix leaked.
- `csv-codecs-core.ts` under 800 lines.
- §105 closed in `docs/open-followups.md` with its two stale facts corrected.

## Carried in from before the slice

This branch also carries three doc fixes made before §105 was chosen, at the user's direction: `AGENTS.md` ×2 and `README.md` ×1 still described the dashboard as masonry, and §64's `VarianceSummary` citation named a file the symbol had left. They are already in the working tree — commit them separately with `docs: correct stale dashboard-masonry claims` before starting Task 1.
