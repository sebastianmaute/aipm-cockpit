# Rich-Text Boundary Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the work and the bytes of the DOM-free rich-text boundary, and stop it silently deleting an image — closing `docs/open-followups.md` §251, §253, §31 and §208.

**Architecture:** Three units. (a) Every tag matcher in `rich-text-plain.ts` and `document-asset-patterns.ts` is bounded so a scan cannot cross a tag boundary. (b) A new DOM-free `degradeToPlain(html, max)` becomes the single overflow path and carries asset images across it. (c) `sanitizeRichText` gains a raw-byte ceiling, evaluated **before** anything projects.

**Tech Stack:** TypeScript, vitest, no new dependencies. Every unit is DOM-free engine code — no React, no DOM, no i18n.

**Spec:** `docs/superpowers/specs/2026-08-27-rich-text-boundary-bounds-design.md`

---

## Before you start

**Read these first. They are not optional context — each records a defect this plan can re-create.**

1. `src/app/rich-text-plain.ts` header (lines 1–20) — why this module must never call DOMPurify.
2. The `TAG` docstring (lines 52–95) — three stars on making it quote-aware, and the retraction that makes the `<`-exclusion the cheap option.
3. `src/app/document-asset-patterns.ts` `ASSET_IMG_TEST_RE` docstring — the four spellings, three of which were defective.
4. `src/app/document-asset-patterns.differential.test.ts` header — why that file exists.

**House rules that bite on this branch:**

- Every `src/app/*.ts` is **CRLF**. The `Write` tool re-lines a file to LF and `git diff` will not show it. Use `Edit` on existing source files. Verify with `git ls-files --eol src/app/rich-text-plain.ts` → expect `i/lf w/crlf`.
- Never read a gate's exit code through a pipe. Redirect, `echo "EXIT=$?"` unpiped, then read the file.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1.
- Never run two vitest processes at once.
- Do not commit with `--amend`; this worktree is shared. Use `git commit --only <paths>`.

**Baseline the suite before touching anything**, so a pre-existing red is not attributed to this work:

```bash
L="$TMPDIR/rtb"; mkdir -p "$L"
npx vitest run src/app/rich-text-plain.test.ts src/app/document-asset-patterns.test.ts src/app/document-asset-patterns.differential.test.ts src/app/document-model.test.ts src/app/rich-text-projection.test.ts --maxWorkers=2 > "$L/baseline.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/baseline.log"
```

Expected: EXIT=0. If it is not, stop and report — nothing below is interpretable against a red baseline.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/rich-text-plain.ts` | modify | `BLOCK_TAG`, `TAG`, `markTaskItems` bounded; `degradeToPlain` added; `capHtmlText` delegates; `sanitizeRichText` gains the ceiling |
| `src/app/document-asset-patterns.ts` | modify | `IMG_TAG_ASSET_ID_RE` made non-backtracking |
| `src/app/rich-text-plain.test.ts` | modify | differential corpus, `degradeToPlain`, ceiling, complexity budget |
| `src/app/rich-text-projection.test.ts` | modify | the export-path proof obligation |
| `src/app/document-asset-patterns.differential.test.ts` | modify | pattern-level complexity row; corrects one false comment |
| `docs/open-followups.md` | modify | close §251 §253 §31 §208 |
| `CHANGELOG.md`, `src/app/version.ts` | modify | release |

`degradeToPlain` lives in `rich-text-plain.ts` rather than a new file: it needs `htmlPlainProjection`, the surrogate handling and the asset matcher, all of which are module-private or would form an import cycle if split. The file is 343 lines; the 800-line ratchet has room.

---

### Task 1: Prove the export path cannot see a raw `<`

The design's central risk-reduction claim was derived by **reading**, not measured. Everything after this depends on it, so it is proved first. If it turns out false, stop and re-plan — the `<`-exclusion would then need a per-caller decision.

**Files:**
- Test: `src/app/rich-text-projection.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/rich-text-projection.test.ts`:

```ts
// ★★★ THE PROOF OBLIGATION THE `[^<>]*` CHANGE RESTS ON. `htmlToText` runs
// DOMPurify with ALLOWED_TAGS: [] and ALLOWED_ATTR: [], and both projections
// here call htmlPlainProjection on its OUTPUT — so no tag and no attribute
// value survives to that point, and a `<` can only arrive as `&lt;`. That makes
// bounding TAG/BLOCK_TAG a provable no-op for search, exports, the AI digests,
// Jira and dedup, which is why those callers need no per-site audit.
//
// ★★ THE POSITIVE CONTROL IS THE HALF THAT MATTERS. Asserting only "no raw <"
// passes just as well if descriptionText returned "" for everything — the
// control proves the pipeline actually carried text through.
describe("the export path never hands htmlPlainProjection a raw <", () => {
  const HOSTILE = [
    '<p>a<b</p>',
    '<img alt="a<b" data-asset-id="real">',
    '<p title="x<y">visible</p>',
    "<p>" + "<a".repeat(50) + "</p>",
    '<p>cost < 5k and rising</p>',
  ];

  it("leaves no bare < in the projected text, and still carries text through", () => {
    // Positive control FIRST: an ordinary value must survive with its text.
    expect(descriptionText("<p>ordinary <strong>text</strong> here</p>")).toBe(
      "ordinary text here",
    );

    for (const html of HOSTILE) {
      for (const out of [descriptionText(html), descriptionTextWithBreaks(html)]) {
        // A `<` may legitimately appear as literal prose ("cost < 5k"), which is
        // the whole point of the last fixture — what must never appear is a `<`
        // that is still acting as a TAG OPENER, i.e. followed by a letter or /.
        expect(/<[a-zA-Z/]/.test(out)).toBe(false);
      }
    }
  });
});
```

Ensure the file's import list includes `descriptionText` and `descriptionTextWithBreaks` from `./rich-text-projection`.

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/rich-text-projection.test.ts --maxWorkers=2 > "$L/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |✓|×" "$L/t1.log" | head -20
```

Expected: **PASS**. This test documents an existing property; it is not red-first.

- [ ] **Step 3: Prove it is not vacuous**

Temporarily change the assertion to `expect(/</.test(out)).toBe(false);` (matching *any* `<`, not just a tag opener) and re-run. Expected: **FAIL** on the `cost < 5k` fixture. This proves the regex discriminates rather than matching nothing. Revert the change with an anchored edit and confirm:

```bash
git diff --stat src/app/rich-text-projection.test.ts   # expect only the intended addition
```

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/rich-text-projection.test.ts -m "test: prove the export path never sees a raw tag opener

The [^<>]* bound in the next commit rests on this. htmlToText runs DOMPurify
with ALLOWED_TAGS: [] and both projections call htmlPlainProjection on its
OUTPUT, so no tag or attribute value survives that far. Asserted with a positive
control, because 'no raw <' also passes against a pipeline returning nothing."
```

---

### Task 2: Bound `TAG` and `BLOCK_TAG`

**Files:**
- Modify: `src/app/rich-text-plain.ts` (`BLOCK_TAG` line 51, `TAG` line 95)
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing differential + complexity tests**

Append to `src/app/rich-text-plain.test.ts`:

```ts
// ★★★ THE ONE SHAPE THIS CHANGE MOVES, PINNED DELIBERATELY. Excluding `<` from
// the attribute run alters exactly one input: an attribute value containing a
// bare `<`. The projection goes 0 -> 11, i.e. the value stops reading as
// "invisible" — the SAFE direction for sanitizeBlock's drop condition, which
// deletes a block only when the projection is zero AND no asset id is present.
// The cost is that those 11 characters are raw markup surfacing as prose.
describe("htmlPlainProjection — the bounded attribute run", () => {
  it("moves the quoted-attribute shape, in the safe direction", () => {
    // Today this projects "" — the unbounded run swallows from the first `<`
    // through to the final `>`. Bounded, the first opener no longer matches at
    // all (there is no `>` before the next `<`), the SECOND one does, and what
    // is left is the 11 characters of the first tag's head.
    expect(htmlPlainProjection('<img alt="a<b" data-asset-id="real">')).toBe('<img alt="a');
  });

  // ★★★ THE SECOND MOVED SHAPE, found by document-model.test.ts rather than by
  // planning — the bound applies to UNQUOTED attributes too. This one matters
  // more than the quoted case: the block carries a REAL data-asset-id and was
  // being DELETED on every load path as a pinned "accepted loss". See the TAG
  // docstring for why that loss stopped being acceptable.
  it("moves the unquoted-attribute shape too, keeping a real asset block", () => {
    expect(htmlPlainProjection('<img alt=a<b data-asset-id="real">')).toBe("<img alt=a");
  });

  // ★★★ THESE ARE THE PRE-CHANGE VALUES, MEASURED, AND THEY ARE THE POINT OF
  // THE TEST: everything except the one shape above must come out byte-identical
  // after the bound. Measured 2026-08-27 against the UNFIXED matchers. Do NOT
  // write this as `expect(htmlPlainProjection(h)).toBe(htmlPlainProjection(h))`
  // — a self-comparison passes against ANY implementation and pins nothing.
  it("leaves every other shape byte-identical", () => {
    const BEFORE: ReadonlyArray<readonly [string, string]> = [
      // A `>` inside an attribute ALREADY terminates the run today, so this row
      // surfaces markup as prose before and after. It is here to prove the
      // change does not alter that, not to endorse it.
      ['<img alt="a>b" data-asset-id="real">', 'b" data-asset-id="real">'],
      ['<img alt="><c d" data-asset-id="real">', ""],
      ['<img data-asset-id="real" alt="><c d">', ""],
      ["<p>plain</p>", "plain"],
      ["<p>a &lt; b</p>", "a < b"],
      ["<ul><li><p>one</p></li><li><p>two</p></li></ul>", "one two"],
    ];
    for (const [html, expected] of BEFORE) {
      expect(htmlPlainProjection(html)).toBe(expected);
    }
  });
});

// ★★★ THE BUDGET IS ~1000x THE MEASURED LINEAR COST AND THAT IS DELIBERATE,
// copied from document-asset-patterns.differential.test.ts's rationale: the
// loosest threshold that still separates linear from quadratic cannot flake on
// a loaded machine while still failing instantly on a regression. Measured
// 2026-08-27 on the UNFIXED patterns: 128 KB cost 6617 ms (TAG) and 7226 ms
// (BLOCK_TAG) against 8.4 ms for the same byte count with tags CLOSED.
// ★★ 128 KB, not 1 MB: the unfixed cost at 1 MB would blow vitest's 20 s test
// timeout before the assertion ran, turning a precise number into a bare
// timeout that names neither figure.
describe("htmlPlainProjection — complexity", () => {
  const CEILING_MS = 2000;
  const BYTES = 128 * 1024;

  for (const [label, unit] of [
    ["unterminated inline openers", "<a"],
    ["unterminated block openers", "<p"],
    ["unterminated task items", "<li"],
  ] as const) {
    it(`stays bounded on ${label}`, () => {
      const input = unit.repeat(Math.round(BYTES / unit.length));
      const started = performance.now();
      htmlPlainProjection(input);
      expect(performance.now() - started).toBeLessThan(CEILING_MS);
    });
  }
});
```

- [ ] **Step 2: Run to verify the complexity tests FAIL and the shape test fails**

```bash
npx vitest run src/app/rich-text-plain.test.ts --maxWorkers=2 > "$L/t2-red.log" 2>&1; echo "EXIT=$?"
grep -E "stays bounded|moves exactly one|Tests " "$L/t2-red.log"
```

Expected: **EXIT=1**, with exactly three failures:

- `stays bounded on unterminated inline openers` and `... block openers` — a measured value in the thousands of ms.
- `moves exactly one shape` — today the unbounded run swallows through to the final `>` and projects `""`, so the assertion sees `""` against `'<img alt="a'`.

`leaves every other shape byte-identical` must **PASS in the red phase** — those are the pre-change values. If it is red here, the measurement in the plan is wrong; report before going further.

Record the actual failing numbers in the task notes — they are the evidence the budget is not vacuous.

★★ **If `moves exactly one shape` is still red AFTER Step 3, do NOT edit the source to match the literal.** That literal was derived by reading the pipeline, not measured against the bounded matcher. A mismatch means the derivation is wrong — report the actual value and stop.

- [ ] **Step 3: Bound both matchers**

In `src/app/rich-text-plain.ts`, change line 51:

```ts
const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|pre|h[1-6]|blockquote|tr|td|th)\b[^<>]*>/gi;
```

and line 95:

```ts
const TAG = /<\/?[a-zA-Z][^<>]*>/g;
```

Then update the `TAG` docstring. Replace the two-star paragraph beginning `★★ IT IS ALSO QUADRATIC` and the three-star `★★★ SO IS BLOCK_TAG` paragraph and the `★★ §251 also RETRACTS` paragraph with:

```
 *  ★★★ BOTH RUNS EXCLUDE `<` AND MUST KEEP EXCLUDING IT. `[^>]*` let a single
 *  opener scan to end of input looking for a `>` that is not there, which is
 *  quadratic: measured 2026-08-27 at 128 KB, TAG 6617 ms and BLOCK_TAG 7226 ms
 *  against 8.4 ms for the same bytes with the tags CLOSED. Bounding the run to
 *  one tag is the same fix ASSET_IMG_TEST_RE took for the same reason, and the
 *  principle is stated in ANY_TAG_ASSET_ID_RE's docstring: not crossing a tag
 *  boundary is the property that matters. Pinned by the complexity family in
 *  rich-text-plain.test.ts — a budget test, so re-measure rather than trusting
 *  these cells.
 *  ★★★ IT MOVES TWO SHAPES, NOT ONE, and the second was found by a gate rather
 *  than by planning. (1) A QUOTED attribute value carrying a bare `<`
 *  (`<img alt="a<b" …>`) projects 11 characters instead of 0. (2) An UNQUOTED
 *  one (`<img alt=a<b data-asset-id="real">`) projects 10 instead of 0, because
 *  the `<img alt=a` opener can no longer match and the strip takes
 *  `<b data-asset-id="real">` as a tag in its own right, leaving the head.
 *  ★★ BOTH ARE THE SAFE DIRECTION for sanitizeBlock's drop condition — a
 *  non-zero projection KEEPS the block — and (2) is the more valuable: that
 *  block carries a REAL `data-asset-id` and was DELETED on every load path.
 *  `document-model.test.ts` pinned that deletion as a KNOWN, ACCEPTED LOSS,
 *  accepted ONLY because recovering it needed a predicate branch scanning past
 *  `<`, which is quadratic. This recovers it the opposite way — by bounding the
 *  projection — so the adversarial shape that docstring names,
 *  `"<img ".repeat(n) + ">"`, measures 0.5 / 1.1 / 2.9 ms at 41 / 82 / 164 KB.
 *  Its own comment set that as the acceptance test ("if a future change makes
 *  this block survive, check what it did to the adversarial timing"), so the
 *  test now asserts SURVIVAL.
 *  ★ The cost of both is that the unmatched tag's head is raw markup read as
 *  prose. Neither can reach the EXPORT projections: htmlToText runs DOMPurify
 *  at ALLOWED_TAGS: [] and both of them project its OUTPUT, so no attribute
 *  value survives that far (pinned with a positive control in
 *  rich-text-projection.test.ts).
 *  ★ This does NOT make the run quote-aware, which remains the change the three
 *  stars above forbid: `<` exclusion and quote-awareness are two independent
 *  narrowings with different blast radii, and conflating them is what produced
 *  §250.
```

- [ ] **Step 4: Run to verify PASS**

```bash
npx vitest run src/app/rich-text-plain.test.ts --maxWorkers=2 > "$L/t2-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t2-green.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Run the documents load-path suite — §251 requires this by name**

```bash
npx vitest run src/app/document-model.test.ts src/app/document-asset-patterns.test.ts src/app/document-asset-patterns.differential.test.ts --maxWorkers=2 > "$L/t2-docs.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t2-docs.log"
```

This is the suite that would catch a repeat of §250.

★★★ **ONE TEST HERE IS EXPECTED TO GO RED, AND IT MUST BE FLIPPED, NOT SILENCED.**
`document-model.test.ts` → `sanitizeProjectDocuments` → **"drops an image paragraph whose attribute value contains a bare `` ` ``<`` ` ``"**. It pins a KNOWN, ACCEPTED LOSS: `<p><img alt=a<b data-asset-id="real"></p>` was DELETED on load. The bound makes it survive, because the projection now returns `"<img alt=a"` (10 chars) instead of `""`, so `sanitizeBlock`'s `htmlTextLength(html) === 0` term is false.

**That is a fix, not a regression, and the test's own docstring is what authorises it:** *"If a future change makes this block survive, check what it did to the adversarial timing before calling it a fix."* The loss was accepted ONLY because recovering the block needed a predicate branch scanning past `<`, which is quadratic. This recovers it the opposite way — by bounding the projection — and the adversarial shape that docstring names measures **0.5 / 1.1 / 2.9 ms at 41 / 82 / 164 KB**. The block carries a REAL `data-asset-id`, so keeping it is the whole point of §208.

Flip it:

- Rename to `"keeps an image paragraph whose attribute value contains a bare \`<\`"`.
- Expect BOTH paragraphs to survive, unchanged: the fixture block and `<p>Kept</p>`.
- Replace the docstring with one recording that the loss was accepted for a timing reason that no longer applies, quoting the three measurements above and naming `"<img ".repeat(n) + ">"` as the shape they came from.

Any OTHER red in this suite is a genuine regression — report it and stop.

- [ ] **Step 6: Verify line endings survived**

```bash
git ls-files --eol src/app/rich-text-plain.ts   # expect: i/lf w/crlf
```

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts src/app/document-model.test.ts -m "fix: bound TAG and BLOCK_TAG to a single tag (§251)

[^>]* let one opener scan to end of input for a > that is not there. Measured
at 128 KB: TAG 6617 ms, BLOCK_TAG 7226 ms, against 8.4 ms for the same bytes
with tags closed. Both now exclude <.

It moves two shapes, not one, and the second was found by document-model.test.ts
rather than by planning. A quoted attribute carrying a bare < projects 11 chars
instead of 0; an unquoted one projects 10. Both keep a block that was previously
dropped, which is the safe direction for sanitizeBlock, and neither is reachable
from the export projections.

The unquoted case flips a pinned accepted loss: <img alt=a<b data-asset-id=real>
carries a REAL asset id and was deleted on every load path. That loss was
accepted only because recovering it needed a predicate branch scanning past <,
which is quadratic. This recovers it by bounding the projection instead, so the
adversarial shape its docstring named now measures 0.5/1.1/2.9 ms at 41/82/164
KB. The test asserts survival, as its own comment invited."
```

---

### Task 3: Bound `markTaskItems`

Found while planning; not in the first cut of the spec. Same defect class, same file, and it is on both projection paths.

**Files:**
- Modify: `src/app/rich-text-plain.ts` (`markTaskItems`, line 221)
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/rich-text-plain.test.ts`:

```ts
// ★ markTaskItems carries THREE unbounded runs in one pattern and runs on both
// projection paths. Same defect as TAG/BLOCK_TAG, found separately.
describe("markTaskItems — complexity", () => {
  it("stays bounded on unterminated list-item openers", () => {
    const input = "<li".repeat(Math.round((128 * 1024) / 3));
    const started = performance.now();
    markTaskItems(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // The pattern consumes the `<li …>` opener and the OPTIONAL `<p>` that
  // follows it — nothing else. The `</p>` and `</li>` are left in place for the
  // tag strip downstream to remove, so they belong in these expectations.
  // Measured 2026-08-27 against the unfixed pattern; the bound must not move
  // either value.
  it("still marks a real task item, checked and unchecked", () => {
    expect(markTaskItems('<li data-type="taskItem" data-checked="true"><p>done</p></li>')).toBe(
      "[x] done</p></li>",
    );
    expect(markTaskItems('<li data-type="taskItem" data-checked="false"><p>open</p></li>')).toBe(
      "[ ] open</p></li>",
    );
  });
});
```

Add `markTaskItems` to the import list at the top of the file.

- [ ] **Step 2: Run to verify the complexity test FAILS**

```bash
npx vitest run src/app/rich-text-plain.test.ts -t "markTaskItems" --maxWorkers=2 > "$L/t3-red.log" 2>&1; echo "EXIT=$?"
grep -E "stays bounded|still marks|Tests " "$L/t3-red.log"
```

Expected: EXIT=1, `stays bounded on unterminated list-item openers` over budget. `still marks a real task item` passes — it is the control proving the pattern still works.

- [ ] **Step 3: Bound all three runs**

In `src/app/rich-text-plain.ts`, `markTaskItems`:

```ts
export function markTaskItems(html: string): string {
  return html.replace(
    /<li\b[^<>]*\bdata-type\s*=\s*"taskItem"[^<>]*>\s*(?:<p\b[^<>]*>)?/gi,
    (tag) => (/\bdata-checked\s*=\s*"true"/i.test(tag) ? TASK_MARK_CHECKED : TASK_MARK_UNCHECKED),
  );
}
```

Add above the function, inside its existing docstring, after the `★★ DOM-FREE` paragraph:

```
 *  ★★ ALL THREE ATTRIBUTE RUNS EXCLUDE `<`, for the reason TAG's docstring
 *  gives: an unterminated `<li` otherwise scans to end of input three times
 *  over. Pinned by the complexity family in rich-text-plain.test.ts.
```

- [ ] **Step 4: Run to verify PASS**

```bash
npx vitest run src/app/rich-text-plain.test.ts src/app/rich-text-projection.test.ts --maxWorkers=2 > "$L/t3-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t3-green.log"
```

Expected: EXIT=0. `rich-text-projection.test.ts` is included because `markTaskItems` is on both export projections.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts -m "fix: bound markTaskItems' three attribute runs (§251)

Same defect as TAG/BLOCK_TAG, in a third pattern the entry did not name — and
it is on both projection paths. Found while planning, not by a gate."
```

---

### Task 4: Make `IMG_TAG_ASSET_ID_RE` non-backtracking

`<` is already excluded here, so a character class cannot help: the cost is the two greedy runs **nested** around the id, re-splitting within one unterminated tag region. The fix is a **guard lookahead** asserting the tag actually closes, placed immediately after `<img\b`. If there is no `>`, the guard fails once in linear time and the match aborts before either run starts; if there is one, the runs are bounded by the tag and the guard costs a single extra scan of it.

★★★ **THIS TASK WAS RE-DERIVED ON 2026-08-27 AND THE FIRST VERSION WAS DANGEROUS.** The plan originally prescribed atomic-group emulation, `(?=(X*))\1`, on both runs. Measured: **it matches nothing at all.** The atomic run swallows the whole attribute list and then refuses to give any of it back, so the `data-asset-id="` that must follow can never match — `<img data-asset-id="x">` yields zero matches. Shipping it would have silently stopped every asset image from being recognised, which is §250's exact class of defect. Verified against the shipped pattern on nine fixtures: shipped `["x"]`, atomic `[]`. **Do not reintroduce the atomic form.**

★★ The guard also keeps the **capture numbering unchanged** — the id stays group **1**. The atomic version moved it to group 2, and a reader left on `m[1]` would have got the whole attribute run: a non-empty string, so a truthiness check passes and it fails silently. That whole hazard is now absent, which is a second reason to prefer this form.

**Files:**
- Modify: `src/app/document-asset-patterns.ts` (`IMG_TAG_ASSET_ID_RE`, line 159)
- Test: `src/app/document-asset-patterns.differential.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("document-asset-patterns — complexity", ...)` block in `src/app/document-asset-patterns.differential.test.ts`:

```ts
  // ★★★ A PATTERN-LEVEL BOUND, DELIBERATELY SEPARATE FROM THE ROWS ABOVE. The
  // ADVERSARIAL family is sized to MAX_HTML_TEXT_CHARS because that is the
  // app's real exposure, and at that size the quadratic still fits the ceiling
  // with a ~50x margin — so it cannot pin the pattern's own complexity. This
  // one asserts the MATCHER is linear, at a size no stored block can reach, and
  // it is the only thing that goes red if the quadratic returns. Measured on
  // the shipped pattern 2026-08-27: 143 ms at 32 KB, 529 at 64, 1961 at 128,
  // 16098 at 256 — an exponent above 2. The guarded pattern is 0.2 / 0.4 / 0.6
  // / 2.5 ms across the same four sizes. These are BUDGET numbers off one
  // machine under load: re-measure rather than trusting the cells.
  it("IMG_TAG_ASSET_ID_RE is linear on an unterminated <img carrying repeated ids", () => {
    const unit = 'data-asset-id="x" ';
    const input = "<img " + unit.repeat(Math.round((256 * 1024) / unit.length));
    const started = performance.now();
    Array.from(input.matchAll(IMG_TAG_ASSET_ID_RE));
    expect(performance.now() - started).toBeLessThan(CEILING_MS);
  });
```

- [ ] **Step 2: Run to verify it FAILS**

```bash
npx vitest run src/app/document-asset-patterns.differential.test.ts -t "linear on an unterminated" --maxWorkers=2 > "$L/t4-red.log" 2>&1; echo "EXIT=$?"
grep -E "linear on an unterminated|Tests " "$L/t4-red.log"
```

Expected: EXIT=1, measured value in the many thousands of ms against a 2000 ms ceiling. Record the number.

- [ ] **Step 3: Add the guard lookahead**

In `src/app/document-asset-patterns.ts`:

```ts
export const IMG_TAG_ASSET_ID_RE =
  /<img\b(?=(?:[^<>"']|"[^"]*"|'[^']*')*>)(?:[^<>"']|"[^"]*"|'[^']*')*(?<![-\w])data-asset-id="([^"]*)"(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
```

The only change is the inserted `(?=(?:[^<>"']|"[^"]*"|'[^']*')*>)`. Both runs, the lookbehind and the capture are untouched, so **the id remains capture group 1 and no call site changes.** Confirm that is still true rather than assuming it — the readers should need no edit:

```bash
grep -rn "IMG_TAG_ASSET_ID_RE" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Add to the pattern's docstring, above the existing `★ The quantifier stays GREEDY` paragraph:

```
 * ★★★ THE GUARD LOOKAHEAD IS WHAT MAKES THIS LINEAR. Excluding `<` (which the
 * runs already do) bounds a scan to one tag REGION; it does nothing about the
 * two runs NESTED around the id re-splitting inside that region when the closing
 * `>` never arrives. Measured 2026-08-27: 143 ms at 32 KB rising to 16098 at
 * 256 KB, against 2.5 ms for the guarded form at the same size. The guard fails
 * once, in linear time, on a tag that never closes — so neither run ever starts.
 * ★★★ ATOMIC-GROUP EMULATION — `(?=(X*))\1` — WAS TRIED HERE AND MATCHES
 * NOTHING. The atomic run swallows the attribute list and will not give it back,
 * so the `data-asset-id="` that must follow can never match: `<img
 * data-asset-id="x">` yields zero matches, i.e. every asset image silently stops
 * being recognised. Do NOT reintroduce it.
 * ★ The id is capture group 1 and the guard is deliberately non-capturing so it
 * stays that way. A renumbering here fails SILENTLY — a reader left on `m[1]`
 * would get the whole attribute run, which is a non-empty string, so a
 * truthiness check still passes.
```

- [ ] **Step 4: Run the full asset-pattern suites**

```bash
npx vitest run src/app/document-asset-patterns.test.ts src/app/document-asset-patterns.differential.test.ts src/app/document-model.test.ts --maxWorkers=2 > "$L/t4-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t4-green.log"
```

Expected: EXIT=0. The differential suite's parser-ground-truth tests are the check that the rewrite did not change *what* is matched, only how fast.

- [ ] **Step 5: Correct the false comment on the cap-sized row**

Still in `src/app/document-asset-patterns.differential.test.ts`, the cap-sized ADVERSARIAL row's comment claims the payload "projects to zero visible text" and that `capHtmlText` truncates "by HTML length rather than by visible text". Both are false. Replace those two sentences with:

```
  //   ★★★ AND THE MECHANISM RECORDED HERE WAS INVERTED UNTIL 2026-08-27. It said
  //    the payload "projects to zero visible text, so a visible-text cap would
  //    not have touched it", and that capHtmlText caps "by HTML length rather
  //    than by visible text". Both are false, measured: the payload contains no
  //    `>` at all, so neither TAG nor BLOCK_TAG matches and the projection
  //    returns essentially the whole string — 18958 visible chars at 18959
  //    bytes. capHtmlText measures htmlPlainProjection(html).length, i.e. it IS
  //    a visible-text cap, and that is precisely why it bites here. The row's
  //    OUTCOME was right and its reason was upside down, which is the dangerous
  //    shape: it told the next reader this row is protected by a mechanism that
  //    is not the one protecting it.
```

- [ ] **Step 6: Re-run and commit**

```bash
npx vitest run src/app/document-asset-patterns.differential.test.ts --maxWorkers=2 > "$L/t4-final.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t4-final.log"
git ls-files --eol src/app/document-asset-patterns.ts   # expect i/lf w/crlf
git commit --only src/app/document-asset-patterns.ts src/app/document-asset-patterns.differential.test.ts -m "fix: guard IMG_TAG_ASSET_ID_RE against an unterminated tag (§253)

Excluding < already bounded the scan to one tag region; the residual quadratic
was the two runs nested around the id re-splitting INSIDE that region when the
closing > never arrives. 16098 ms at 256 KB, against 2.5 ms guarded.

The fix is a non-capturing lookahead asserting the tag closes, so the match
aborts before either run starts. Capture numbering is unchanged and no call
site moves. Atomic-group emulation was tried first and matches nothing at all,
because the atomic run will not give back the attribute list the id sits in.

Also corrects the cap-sized row's comment, whose stated mechanism was the
inverse of the real one."
```

---

### Task 5: `degradeToPlain`

**Files:**
- Modify: `src/app/rich-text-plain.ts`
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/rich-text-plain.test.ts`:

```ts
// ★★★ THE SINGLE OVERFLOW PATH. Both capHtmlText's cap branch and
// sanitizeRichText's byte ceiling route through here, so an asset image
// survives an overflow on every path at once — §208 was the same code emitting
// plainToHtml(slice) and discarding every tag, image included.
describe("degradeToPlain", () => {
  it("flattens to text and truncates", () => {
    expect(degradeToPlain("<p><strong>abcdefghij</strong></p>", 4)).toBe("<p>abcd</p>");
  });

  it("carries an asset image across the degrade — §208", () => {
    const img = '<img data-asset-id="a1" alt="chart">';
    const out = degradeToPlain(`<p>${img}${"x".repeat(50)}</p>`, 10);
    expect(out).toContain('data-asset-id="a1"');
    expect(out).toContain("xxxxxxxxxx");
  });

  it("keeps every image when a paragraph carries several", () => {
    const html = `<p><img data-asset-id="a1"><img data-asset-id="a2">${"x".repeat(50)}</p>`;
    const out = degradeToPlain(html, 5);
    expect(out).toContain('data-asset-id="a1"');
    expect(out).toContain('data-asset-id="a2"');
  });

  // ★★ THE BOUND IS INSIDE THIS FUNCTION, not at its callers. A caller-side cap
  // is a bound this unit cannot see, and it stops holding the moment someone
  // adds a caller.
  it("stops extracting images at its own cap", () => {
    const many = '<img data-asset-id="a">'.repeat(200);
    const out = degradeToPlain(`<p>${many}text</p>`, 4);
    expect((out.match(/data-asset-id/g) ?? []).length).toBeLessThanOrEqual(20);
  });

  // ★★ These two guards MOVED here from capHtmlText — they are not duplicated.
  it("drops a character straddling the cap whole, never half of it", () => {
    const out = degradeToPlain("<p>ab\u{1F600}cd</p>", 3);
    expect(out).toBe("<p>ab</p>");
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(
      false,
    );
  });

  it("returns empty for a cap of zero or less", () => {
    expect(degradeToPlain("<p>abc</p>", 0)).toBe("");
    expect(degradeToPlain("<p>abc</p>", -1)).toBe("");
  });

  // ★★★ THIS IS THE OVERFLOW PATH, so the one input guaranteed to reach it is an
  // oversized one. ASSET_IMG_TAG's two runs sit nested around the id, which is
  // quadratic on an <img that never closes unless the guard lookahead is there.
  // Measured 2026-08-27 without the guard: 57 ms at 32 KB, 226 at 64, 1062 at
  // 128. Deleting `(?=[^<>]*>)` from the pattern turns this red.
  it("stays bounded on an unterminated <img carrying repeated ids", () => {
    const unit = 'data-asset-id="x" ';
    const input = "<img " + unit.repeat(Math.round((128 * 1024) / unit.length));
    const started = performance.now();
    degradeToPlain(input, 100);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
```

Add `degradeToPlain` to the import list at the top of the file.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/rich-text-plain.test.ts -t "degradeToPlain" --maxWorkers=2 > "$L/t5-red.log" 2>&1; echo "EXIT=$?"
grep -E "degradeToPlain|is not a function|Tests " "$L/t5-red.log" | head
```

Expected: EXIT=1, `degradeToPlain is not a function`.

- [ ] **Step 3: Implement**

Add to `src/app/rich-text-plain.ts`, immediately above `capHtmlText`:

```ts
/** How many asset images one degrade carries across.
 *
 *  ★★ THE BOUND LIVES HERE, NOT AT THE CALLERS. A caller-side cap is a bound
 *  this function cannot see, so it stops holding the moment someone adds a
 *  caller — and the whole point of this function is to be the one overflow path
 *  every caller shares. 20 matches the document image cap; exceeding it means
 *  the input was already outside what the app can hold. */
const DEGRADE_IMG_CAP = 20;

/** An `<img>` carrying a `data-asset-id`, for carrying images across a degrade.
 *
 *  ★ Bounded like every other matcher in this file — `[^<>]*`, so a scan cannot
 *  cross a tag boundary. See TAG's docstring for the measurement.
 *
 *  ★★★ THE GUARD LOOKAHEAD IS LOAD-BEARING AND WAS ADDED BEFORE THIS PATTERN
 *  EVER SHIPPED. Bounding the runs to one tag REGION is not enough on its own:
 *  the two `[^<>]*` runs sit NESTED around the id, so on an `<img` that never
 *  closes, run 2 re-scans to end of input at every position run 1 gives back —
 *  the same quadratic IMG_TAG_ASSET_ID_RE carries, in a new pattern. Measured
 *  2026-08-27 without the guard: 57 ms at 32 KB, 226 at 64, 1062 at 128, i.e.
 *  4x per doubling. With it: 0.0 / 0.1 / 0.2 ms, and identical matches on every
 *  fixture. This matters more here than anywhere else in the file, because this
 *  is the OVERFLOW path — the one input that reaches it is by definition
 *  oversized. Pinned by the complexity test in rich-text-plain.test.ts. */
const ASSET_IMG_TAG =
  /<img\b(?=[^<>]*>)[^<>]*(?<![-\w])data-asset-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*)[^<>]*>/gi;

/** The SINGLE overflow path: flatten to text, truncate, carry the images.
 *
 *  ★★★ IT EXISTS BECAUSE THE OLD OVERFLOW BRANCH DELETED IMAGES SILENTLY (§208).
 *  `capHtmlText` used to end in `plainToHtml(text.slice(0, cut))`, which builds
 *  `<p>` + escaped text + `</p>` and therefore discards ALL markup — an
 *  `<img data-asset-id>` in an over-cap paragraph was gone on load, with nothing
 *  in the truncation diag.
 *
 *  ★★★ MARKUP-AWARE TRUNCATION IS NOT AN OPTION HERE AND THAT IS STRUCTURAL, not
 *  a preference: this module is DOM-FREE by contract (see the file header — a
 *  DOMPurify call here makes jsonToWorkspace silently produce an EMPTY
 *  workspace under bare node). Anything that has to understand tree structure to
 *  truncate correctly cannot live in this file. Carrying the images across a
 *  flatten is the most that can be done without a DOM.
 *
 *  ★★ THE SURROGATE AND `max <= 0` GUARDS LIVE HERE NOW, moved from capHtmlText
 *  rather than copied. `slice` counts UTF-16 CODE UNITS, so a cap landing inside
 *  an astral character kept its LONE HIGH SURROGATE — which UTF-8 encoding
 *  replaces with U+FFFD permanently, so CSV and Markdown corrupted while JSON
 *  and IndexedDB did not. And at a NEGATIVE max, `slice`'s end index counts from
 *  the END, so the guard is `max <= 0`, not `max === 0`. `clipText`
 *  (sanitize-core.ts) carries the identical fix and the two are documented as
 *  agreeing at the boundary — a second copy in capHtmlText would quietly turn
 *  that two-way claim into a three-way one. */
export function degradeToPlain(html: string, max: number): string {
  if (!html) return "";
  if (max <= 0) return "";
  ASSET_IMG_TAG.lastIndex = 0;
  const images = Array.from(html.matchAll(ASSET_IMG_TAG))
    .slice(0, DEGRADE_IMG_CAP)
    .map((m) => m[0]);
  const text = htmlPlainProjection(html);
  const last = text.charCodeAt(max - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  const body = plainToHtml(text.slice(0, cut));
  return images.length === 0 ? body : `${body}${images.join("")}`;
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
npx vitest run src/app/rich-text-plain.test.ts --maxWorkers=2 > "$L/t5-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t5-green.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts -m "feat: add degradeToPlain, the single overflow path (§208)

Flattens to text, truncates, and carries asset images across — the old overflow
branch was plainToHtml(slice), which discards all markup and therefore deleted
an <img data-asset-id> from any over-cap paragraph, silently, on load.

Markup-aware truncation is structurally unavailable here: the module is DOM-free
by contract. Carrying the images across a flatten is the most that can be done.

The image cap lives inside the function, not at its callers — a caller-side
bound is one this unit cannot see."
```

---

### Task 6: `capHtmlText` delegates

**Files:**
- Modify: `src/app/rich-text-plain.ts` (`capHtmlText`)
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe("capHtmlText", ...)` block:

```ts
  // §208: the same overflow that used to discard markup now preserves images.
  it("keeps an asset image when the paragraph overflows the cap", () => {
    const img = '<img data-asset-id="a1" alt="chart">';
    const out = capHtmlText(`<p>${img}${"x".repeat(30)}</p>`, 10);
    expect(out).toContain('data-asset-id="a1"');
  });

  // ★ The under-cap path must stay byte-identical — it returns the input
  // untouched and never reaches degradeToPlain.
  it("still returns an image-bearing paragraph untouched when it fits", () => {
    const html = '<p><img data-asset-id="a1" alt="chart"> short</p>';
    expect(capHtmlText(html, 5000)).toBe(html);
  });
```

- [ ] **Step 2: Run to verify the first fails**

```bash
npx vitest run src/app/rich-text-plain.test.ts -t "capHtmlText" --maxWorkers=2 > "$L/t6-red.log" 2>&1; echo "EXIT=$?"
grep -E "keeps an asset image|still returns an image|Tests " "$L/t6-red.log"
```

Expected: EXIT=1 — `keeps an asset image when the paragraph overflows the cap` fails; the untouched-when-it-fits control passes.

- [ ] **Step 3: Delegate**

Replace the whole body of `capHtmlText` in `src/app/rich-text-plain.ts` with:

```ts
export function capHtmlText(html: string, max: number): string {
  if (!html) return "";
  const text = htmlPlainProjection(html);
  if (text.length <= max) return html;
  return degradeToPlain(html, max);
}
```

Delete the surrogate/`max <= 0` comment block from `capHtmlText` — it has moved to `degradeToPlain` — and replace the function's docstring tail with:

```
 *  ★★ THE OVERFLOW BRANCH IS degradeToPlain, WHICH IS THE ONLY PLACE THAT
 *  TRUNCATES. The surrogate-pair and `max <= 0` guards moved there with it;
 *  they are not duplicated here, deliberately, because `clipText`
 *  (sanitize-core.ts) is documented as carrying the identical fix and agreeing
 *  with it at the boundary — a third copy makes that claim unverifiable.
```

- [ ] **Step 4: Run to verify PASS**

```bash
npx vitest run src/app/rich-text-plain.test.ts src/app/document-model.test.ts --maxWorkers=2 > "$L/t6-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t6-green.log"
```

Expected: EXIT=0. `document-model.test.ts` is included because `sanitizeBlock` is `capHtmlText`'s heaviest caller.

- [ ] **Step 5: Verify the guards MOVED rather than being duplicated**

The surrogate and `max <= 0` guards must exist in `degradeToPlain` and NOT in `capHtmlText` — moved, not copied — because `clipText` (`sanitize-core.ts:52`, verified: `max <= 0` at :62, lone-surrogate back-off at :58) is documented as carrying the identical fix and agreeing with it at the boundary. A third copy makes that two-way claim unverifiable.

★★★ **DO NOT USE A WHOLE-FILE `grep -c "0xd800"` FOR THIS — it cannot answer the question.** The claim is about ONE FUNCTION and the file contains an unrelated, pre-existing surrogate guard in `decodeNumericEntities`, so the honest whole-file count is **2** both before and after a correct move, and **2** after an incorrect duplication as well. It returns the same number in the state the claim denies. Scope the check to the function body instead:

```bash
node -e "
const s=require('fs').readFileSync('src/app/rich-text-plain.ts','utf8');
const body=(n)=>{const i=s.indexOf('export function '+n+'(');return s.slice(i,s.indexOf('\n}',i)+2);};
for(const fn of ['capHtmlText','degradeToPlain'])
  console.log(fn, '0xd800:', (body(fn).match(/0xd800/g)||[]).length,
              'max<=0:', (body(fn).match(/if \(max <= 0\)/g)||[]).length);
"
```

Expected: `capHtmlText 0xd800: 0 max<=0: 0` and `degradeToPlain 0xd800: 1 max<=0: 1`.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts -m "fix: route capHtmlText's overflow through degradeToPlain (§208)

An over-cap paragraph carrying an <img data-asset-id> keeps its image instead of
losing it silently. The under-cap path is unchanged and still returns the input
untouched, which the added control asserts."
```

---

### Task 7: The raw-byte ceiling

**Files:**
- Modify: `src/app/rich-text-plain.ts` (`sanitizeRichText`)
- Test: `src/app/rich-text-plain.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe("sanitizeRichText", ...)` block:

```ts
  // ★★★ §31: the cap measures VISIBLE TEXT, so markup bytes were unbounded —
  // one visible character stored 1,800,008 bytes, on all six backends. Measured
  // ratios of real formatting: worst legitimate shape is 8.3x (a highlight with
  // an inline style on every word), against 500,000x and 1,800,000x for these.
  // K = 32 sits between them with ~4x headroom over the legitimate worst case.
  it("bounds stored bytes when markup dwarfs the visible text", () => {
    const abusive = `<p>${"<em></em>".repeat(200000)}a</p>`;
    expect(abusive.length).toBeGreaterThan(1_000_000);
    const out = sanitizeRichText(abusive, 5000, "rich");
    expect(out.length).toBeLessThanOrEqual(5000 * 32 + 1024);
  });

  it("bounds a single enormous attribute value too", () => {
    const out = sanitizeRichText(`<p data-x="${"A".repeat(500000)}">a</p>`, 5000, "rich");
    expect(out.length).toBeLessThanOrEqual(5000 * 32 + 1024);
  });

  // ★★ THE HEADROOM ASSERTION, and it is the half that stops the ceiling being
  // set too tight. Heavily but LEGITIMATELY formatted text — every word wrapped
  // in a highlight with an inline style, measured at 8.3x — must pass through
  // untouched.
  it("leaves worst-case legitimate formatting untouched", () => {
    const word = "delivery ";
    const heavy = `<p>${`<mark data-color="yellow" style="background-color: yellow">${word}</mark>`.repeat(400)}</p>`;
    expect(heavy.length / htmlTextLength(heavy)).toBeGreaterThan(8);
    expect(sanitizeRichText(heavy, 5000, "rich")).toBe(heavy);
  });
```

**No new imports.** This file's existing `sanitizeRichText` tests pass the cap and sink as the
literals `5000, "rich"` — match that convention rather than importing `TEXTAREA_MAX`/`RICH_SINK`,
which it deliberately does not import (see the DOM-free guard's import allowlist, which the test file
mirrors). `htmlTextLength` is already in the import list.

- [ ] **Step 2: Run to verify the first two fail**

```bash
npx vitest run src/app/rich-text-plain.test.ts -t "sanitizeRichText" --maxWorkers=2 > "$L/t7-red.log" 2>&1; echo "EXIT=$?"
grep -E "bounds stored bytes|bounds a single enormous|leaves worst-case|Tests " "$L/t7-red.log"
```

Expected: EXIT=1. The two `bounds …` tests fail; `leaves worst-case legitimate formatting untouched` passes — it is the control proving the assertion is not simply "everything gets clipped".

- [ ] **Step 3: Implement the ceiling**

In `src/app/rich-text-plain.ts`, add above `sanitizeRichText`:

```ts
/** Raw-byte ceiling, as a multiple of the VISIBLE-text cap it accompanies.
 *
 *  ★★★ IT EXISTS BECAUSE THE VISIBLE-TEXT CAP BOUNDS THE WRONG THING (§31).
 *  `capHtmlText` measures projected text and returns the html untouched when it
 *  fits, so markup carried no limit at all: `<p>` + `<em></em>` x200000 + `a</p>`
 *  is ONE visible character and 1,800,008 stored bytes, and that value lands in
 *  a Turso row, a CSV cell and a Markdown cell on all six backends.
 *
 *  ★★ K = 32 IS DERIVED, NOT PICKED. Measured html:visible ratios for real
 *  formatting: plain 1.0x, bold-per-word 2.9x, list items 2.8x, links 6.3x,
 *  table cells 6.5x, and the worst legitimate shape found — a highlight with an
 *  inline style on every word — 8.3x. The abuse shapes above are 500,000x and
 *  1,800,000x. Three orders of magnitude of clear air is what makes a ratio
 *  safe; 32 leaves ~4x headroom over the worst legitimate case. The corpus
 *  itself tops out at 1.38x, and is too thin to set a constant from (29 rich
 *  fields, 5 of them html).
 *  ★ The +1024 keeps a small `max` from rejecting its own wrapper markup. */
const RICH_BYTE_K = 32;
const RICH_BYTE_FLOOR = 1024;
export const richByteCeiling = (max: number): number => max * RICH_BYTE_K + RICH_BYTE_FLOOR;
```

Then replace `sanitizeRichText`:

```ts
export function sanitizeRichText(raw: unknown, max: number, sink: RichTextSink): string {
  const s =
    typeof raw === "string" ? raw.replace(WS_CONTROL, " ").replace(CONTROL_CHARS, "") : "";
  const upgraded = descriptionHtml(s, sink);
  // ★★★ THE CEILING IS CHECKED BEFORE ANYTHING PROJECTS, AND THE ORDER IS THE
  // WHOLE POINT. capHtmlText measures htmlPlainProjection(html) — it projects
  // the FULL raw input before deciding anything, and that projection is the
  // work §251 bounds. A ceiling placed after it would bound what is STORED and
  // bound nothing about what is DONE. So this is a raw `.length` comparison,
  // O(1), and must never call the projection to decide.
  // ★★ The hard clip may cut mid-tag. That is safe ONLY because its output goes
  // straight to degradeToPlain, which flattens to text and cannot re-emit the
  // severed markup — do not reorder these two lines.
  const ceiling = richByteCeiling(max);
  const bounded =
    upgraded.length > ceiling ? degradeToPlain(upgraded.slice(0, ceiling), max) : upgraded;
  const html = capHtmlText(bounded, max);
  return htmlTextLength(html) === 0 ? "" : html;
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
npx vitest run src/app/rich-text-plain.test.ts --maxWorkers=2 > "$L/t7-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t7-green.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Run every consumer of the write boundary**

The ceiling applies on **load**, via `sanitize-records.ts`, so the entity and codec suites are the real check:

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/document-model.test.ts src/app/workspace.test.ts src/app/golden-workspace.test.ts --maxWorkers=2 > "$L/t7-consumers.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t7-consumers.log"
```

Expected: EXIT=0. **`golden-workspace.test.ts` is the one that matters** — it pins exact stored CSV/Markdown bytes. If it goes red, the ceiling has changed the stored form of a sample record, which means the constant is too tight. Do **not** regenerate the fixtures to make it pass; report instead.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts -m "fix: bound raw markup bytes in sanitizeRichText (§31)

The cap measured visible text and returned the html untouched when it fit, so
markup carried no limit: one visible character stored 1,800,008 bytes on all six
backends.

Ceiling is max * 32 + 1024, checked BEFORE anything projects — capHtmlText
projects the full raw input to decide, so a ceiling downstream of it would bound
what is stored and nothing about what is done.

K = 32 derived from measured ratios: worst legitimate formatting 8.3x, abuse
shapes 500,000x and 1,800,000x. A test pins the legitimate case passing through
untouched, so the ceiling cannot be quietly tightened into one that clips real
documents."
```

---

### Task 8: Add the diagnostic

**Files:**
- Modify: `src/app/rich-text-plain.ts`
- Test: `src/app/rich-text-plain.test.ts`

★★★ **READ THIS BEFORE WRITING ANY CODE — THIS TASK DELIBERATELY WIDENS A GUARD.**

`rich-text-plain.test.ts` pins **"imports exactly the two modules it is allowed to import"**. Adding
`import { logDiag } from "./diagnostics"` FAILS that assertion. The guard is not incidental: its own
comment records that 0.210.0 briefly removed a sibling ban and opened the likelier hole.

So this task has to widen an allowlist, and AGENTS.md's rule is *never widen a gate to make a
pipeline pass — a defeated gate reports success.* The widening is only defensible because it comes
with a **new, stronger** assertion, not merely a bigger allowlist:

- `diagnostics.ts` imports only `./version` and `./diagnostics-redact`, neither DOM-dependent.
- `logDiag` returns immediately when `typeof window === "undefined"`, so under bare node it is inert
  rather than throwing — which is the exact failure mode the guard exists to prevent.

**If either of those stops being true, this task must be abandoned rather than repaired.** The
fallback is to drop the diagnostic and file it: per-call-site logging is explicitly NOT the
alternative, because `use-load-truncation.ts` records that per-call-site patching is what broke the
truncation reporting in the first place.

Verify both facts before editing anything:

```bash
grep -n '^import' src/app/diagnostics.ts src/app/diagnostics-redact.ts
sed -n '/export function logDiag/,/^}/p' src/app/diagnostics.ts | head -5
```

Expected: no import reaching `dompurify`, `sanitize-html`, or any DOM API, and `logDiag`'s first
statement inside the `try` being the `typeof window === "undefined"` early return. If either differs,
**stop and report** — do not widen the allowlist.

- [ ] **Step 1: Write the failing test**

```ts
// ★★ The degrade is REPORTED, not silent. logDiag is a no-op when `window` is
// undefined, which is what makes it legal in this DOM-free module — the sample
// generator runs here under bare node and must not throw.
describe("sanitizeRichText — the degrade is reported", () => {
  it("does not throw under bare node, where logDiag is inert", () => {
    const abusive = `<p>${"<em></em>".repeat(200000)}a</p>`;
    // Literals, not TEXTAREA_MAX/RICH_SINK — this file deliberately does not
    // import them, and adding an import here is the very thing the DOM-free
    // guard below is about. Matches the convention in Task 7.
    expect(() => sanitizeRichText(abusive, 5000, "rich")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/rich-text-plain.test.ts -t "the degrade is reported" --maxWorkers=2 > "$L/t8-red.log" 2>&1; echo "EXIT=$?"
```

Expected: PASS before the change too — this is a guard against the change *introducing* a throw, so it is written first and must stay green through step 3.

- [ ] **Step 3: Add the call**

In `sanitizeRichText`, replace the `bounded` assignment with:

```ts
  let bounded = upgraded;
  if (upgraded.length > ceiling) {
    bounded = degradeToPlain(upgraded.slice(0, ceiling), max);
    // ★★ logDiag, DELIBERATELY NOT lastLoadTruncation. That channel blocks
    // writes through mayCommitAfterTruncation, on the premise that the SOURCE
    // still holds what was not loaded — true for a document whose blocks were
    // dropped, false here. A degrade is idempotent and already committed, so
    // blocking the flush would strand the user with a workspace the app refuses
    // to save, protecting data that exists nowhere else.
    logDiag("warn", "rich-text-bytes-degraded", {
      before: upgraded.length,
      after: bounded.length,
      ceiling,
    });
  }
```

Add the import at the top of `src/app/rich-text-plain.ts`:

```ts
import { logDiag } from "./diagnostics";
```

- [ ] **Step 3b: Widen the allowlist, and strengthen it in the same edit**

In `src/app/rich-text-plain.test.ts`, the `"imports exactly the two modules it is allowed to import"`
test now needs a third entry. Rename it to `"imports exactly the three modules it is allowed to
import"`, add `./diagnostics` to the allowed set, and add this assertion **beside** it — the widening
is only legitimate if it carries a new bound:

```ts
  // ★★★ `./diagnostics` WAS ADDED TO THIS ALLOWLIST DELIBERATELY, AND IT IS THE
  // ONLY WIDENING THIS GUARD HAS EVER TAKEN. It carries an obligation the other
  // two do not, because the whole point of the allowlist is that a NEW module
  // can reach a DOM. So the reachable closure is asserted here rather than
  // assumed: diagnostics imports only ./version and ./diagnostics-redact, and
  // NEITHER may reach a sanitiser. If this assertion ever has to be relaxed,
  // remove the import instead — the diagnostic is observability, and it is not
  // worth the guard.
  it("keeps the newly allowed diagnostics import DOM-free transitively", () => {
    for (const mod of ["diagnostics.ts", "diagnostics-redact.ts", "version.ts"]) {
      const src = readFileSync(join(import.meta.dirname, mod), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/dompurify/i);
      expect(src).not.toMatch(/from "\.\/sanitize-html"/);
    }
  });
```

Run it and prove it is not vacuous by temporarily pointing one entry at `sanitize-html.ts`, which
does contain `dompurify` — expect FAIL — then revert that edit and confirm `git diff --stat` shows
only the intended change.

- [ ] **Step 4: Run the DOM-free contract test**

`rich-text-plain.test.ts` contains a source-scanning test that enforces the DOM-free contract. Run the whole file plus the sample generator's own path:

```bash
npx vitest run src/app/rich-text-plain.test.ts src/app/sanitize-records.test.ts --maxWorkers=2 > "$L/t8-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/t8-green.log"
npx vite-node scripts/generate-sample-workspace.ts > "$L/t8-gen.log" 2>&1; echo "GEN_EXIT=$?"
git diff --stat sample-workspace-*.json
```

Expected: EXIT=0, GEN_EXIT=0, and **no diff** in the generated samples. A non-empty diff means the ceiling changed sample data — report rather than committing it.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/rich-text-plain.ts src/app/rich-text-plain.test.ts -m "feat: report a byte degrade via logDiag

Deliberately not lastLoadTruncation: that channel blocks writes on the premise
the source still holds what was not loaded, which is false for an idempotent
already-committed degrade. Blocking there would strand the user with a workspace
the app refuses to save."
```

---

### Task 9: Full gate run

- [ ] **Step 1: Typecheck and lint**

```bash
npx tsc --noEmit > "$L/tsc.log" 2>&1; echo "TSC=$?"   # 2 means diagnostics, not 1
npx eslint --max-warnings=0 src; echo "LINT=$?"
```

Expected: TSC=0, LINT=0.

- [ ] **Step 2: Full unit suite**

```bash
npm run test:run > "$L/full.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/full.log"
```

Expected: EXIT=0. If it reports `Failed to start forks worker` or `Test Files no tests` at EXIT=1, that is machine saturation, not failure — re-run with `npx vitest run --maxWorkers=1`.

- [ ] **Step 3: Shuffled suite — the only local reproduction of that CI gate**

```bash
npm run test:shuffle > "$L/shuffle.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$L/shuffle.log"
```

Expected: EXIT=0.

- [ ] **Step 4: The ratchets**

```bash
npm run size:check;    echo "SIZE=$?"
npm run dup:check;     echo "DUP=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run docs:symbols:check; echo "SYM=$?"
```

Expected: all 0. `size:check` counts `wc -l` **+ 1** — read the real number with
`node -e "console.log(require('fs').readFileSync('src/app/rich-text-plain.ts','utf8').split('\n').length)"` if it fails.

- [ ] **Step 5: Commit any fixes, then report**

Report the measured before/after numbers from Tasks 2, 3 and 4 — they are the evidence the budgets are not vacuous.

---

### Task 10: Close the register entries and release

**Files:**
- Modify: `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts`

- [ ] **Step 1: Close the four entries**

For each of §251, §253, §31, §208, append `— CLOSED 2026-08-27` to the `##` heading and add a short body paragraph naming what landed and which test pins it. Do not move the entries; a closed entry stays where it is.

**§208 and §31 carry a disclosed residual** and must say so without un-closing:

```
**Residual (still open):** a degrade preserves the asset image and the visible
text, and loses every other tag — bold, links, list structure. That is inherent
to a DOM-free flatten, not a gap in this fix: markup-aware truncation needs a
tree, and this module cannot have one.
```

- [ ] **Step 2: Verify the counts still agree**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md
grep -E  "^## [0-9]+\." docs/open-followups.md | grep -c  "— CLOSED"
grep -E  "^## [0-9]+\." docs/open-followups.md | grep -cv "— CLOSED"
```

Expected: total unchanged, closed **+4** (87 → 91), open **−4** (177 → 173). A divergence between these three means a heading was written with the wrong marker.

- [ ] **Step 3: Bump the version**

This is a bug-fix slice with no new feature and no i18n key, so it is a **patch**: `0.262.1` → `0.262.2`, keeping the `0.262.x` codename **"Swainston"**. In `src/app/version.ts` set `APP_VERSION = "0.262.2"`, leave `APP_MILESTONE = "Swainston"`, and update `APP_BUILD_DATE` with a comment naming the slice.

```bash
npm run version:sync; echo "SYNC=$?"
npm run version:check; echo "VER=$?"   # 1 = drift, 2 = the gate could not run
```

- [ ] **Step 4: Add the CHANGELOG entry**

Add `## [0.262.2] - 2026-08-27 "Swainston"` above the `0.262.1` heading, with one bullet per entry closed. **No session URL in this file.** Leave a blank line above the previous heading — a merge has eaten that break before.

- [ ] **Step 5: Commit**

```bash
git commit --only docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS -m "chore(release): 0.262.2 — bound the rich-text boundary (§251 §253 §31 §208)"
```

- [ ] **Step 6: Stop**

Do **not** push, open an MR, or merge. Those need an explicit instruction from the user.

---

## Self-review notes

**Spec coverage.** Every section maps to a task: bounded matchers → Tasks 2–4; `degradeToPlain` → Task 5; `capHtmlText` delegation → Task 6; byte ceiling with the corrected ordering → Task 7; `logDiag` rather than the truncation channel → Task 8; the export-path proof obligation → Task 1; the false comment → Task 4 Step 5; §252 and §250 stay out of scope and no task touches them.

**Two things the spec did not cover, added here.** `markTaskItems` (Task 3), found by grepping for the real sites rather than trusting the entry's list. And the second moved shape in Task 2 — the bound applies to UNQUOTED attributes too, which flips a pinned accepted-loss test in `document-model.test.ts`. That one was found by the gate, not by planning.

**Three plan defects caught by this review and fixed inline.** Task 7's test code imported
`TEXTAREA_MAX` and `RICH_SINK`, which `rich-text-plain.test.ts` deliberately does not import — its
convention is the literals `5000, "rich"`, and the plan now matches it. Task 8 would have failed the
`"imports exactly the two modules it is allowed to import"` guard outright; it now widens that
allowlist explicitly, carries a new transitive assertion to pay for the widening, and names the
condition under which the task must be abandoned rather than repaired. Task 4's capture-group
renumbering had no caller-audit step; it now has one.

**The one guard this plan knowingly weakens.** Task 8 widens the DOM-free import allowlist from two
modules to three, for observability. That is the sort of change AGENTS.md warns about, so it is
isolated in its own task, at the end, after every defect is already fixed — if it is dropped, the
slice still closes all four entries. Treat it as optional.

**Known risk this plan does not remove.** Task 4's guard lookahead is the least mechanical change here. If the differential suite's parser-ground-truth tests go red at Step 4, it changed *what* matches, not just how fast — revert and re-plan rather than adjusting expectations, because those tests are the only thing standing between this and a fifth defective spelling of that pattern. The first version of Task 4 WAS such a spelling: atomic-group emulation, which matches nothing at all and would have silently unhooked every asset image. It was caught by measuring the candidate against the shipped pattern on nine fixtures before dispatching, not by any gate.
