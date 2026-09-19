# Timing guards: scaling ratio instead of wall-clock ceilings — design

Date: 2026-09-19 · Branch: `docs/timing-flake-592-593` · Closes register §592 (#376) and §593 (#377)

## Intent

Every unit-test timing guard in the repo compares one wall-clock duration against a fixed ceiling.
A saturated machine can push a correct build past that ceiling: §593 records `html-extract`'s DoS
test failing at 8301 ms against 8000 ms during a full-suite run in which two unrelated tests also
timed out, and §592 records the same risk for `tag-pair-walk`'s 50 ms ceiling. The goal is that
machine load can no longer fail a correct build, while every guard still goes red on the regression
it exists for.

Decided with the user:

- **Scope B** — the whole class, not only §592/§593.
- **Approach 1** — time the code at two sizes and assert on the RATIO, not on an absolute duration.
- **Output assertions in scope** — a ratio guard is as blind to a trivial early bail as a ceiling
  is, so every converted site also asserts on the function's output.

Rejected: a one-size check normalised against a reference workload (assumes load slows both equally)
and raised ceilings plus vitest `retry` (hides the flake, keeps a load-breakable assertion).

## Inventory (taken 2026-09-19)

23 call sites, 36 executions once fixture-row loops are counted; the sweep of `src/` and `scripts/`
found no timing ceiling outside these 9 files:

| File | Call sites → executions |
|---|---|
| `src/app/tag-pair-walk.test.ts` | 4 → 4 |
| `src/app/html-extract.test.ts` | 2 → 6 |
| `src/app/document-asset-patterns.differential.test.ts` | 2 → 7 |
| `src/app/docx-extract.test.ts` | 2 → 2 |
| `src/app/office-xml.test.ts` | 1 → 1 |
| `src/app/pptx-extract.test.ts` | 1 → 1 |
| `src/app/raid-escalation.test.ts` | 1 → 1 |
| `src/app/rich-text-plain.test.ts` | 4 → 6 |
| `src/app/xlsx-extract.test.ts` | 6 → 8 |

All 23 guard against super-linear behaviour — a quadratic walk, regex backtracking, or DoS on
attacker-supplied bytes. None is a plain latency check. Only a few also assert on the output
(`html-extract`'s two via its `timeExtract` helper, `raid-escalation`, one `xlsx-extract` case). No
timing or ratio helper exists anywhere in the repo. `vitest.config.ts` sets `testTimeout` to 20 s.

Constraints the inventory surfaced:

- **`html-extract`** — `extractHtmlMarkdown` truncates input to `MAX_HTML_INPUT_CHARS` (500,000)
  before any walk runs, and the fixtures sit exactly at that clamp. Scaling UP measures the same
  truncated input twice; this file must scale DOWN from the clamp.
- **`raid-escalation`** — the name is clamped to `RAID_ESCALATION_NAME_MAX` (200) before the regex
  runs, so the shipped code's runtime does not depend on N. The guard here is "ratio ≈ 1".
- **`document-asset-patterns.differential`** — one row is sized to `MAX_HTML_TEXT_CHARS` (20,000)
  on purpose, as "the app's real exposure"; that row keeps 20,000 as its LARGE size. The other rows
  have no such tie.
- **`rich-text-plain`, `xlsx-extract`, `docx-extract`, `pptx-extract`** — their comments record that
  smaller sizes let a mutant pass or were unreliable (for example, 128 KB and 256 KB were too small
  for two `rich-text-plain` mutants). Shrinking these is unsafe, so they scale UP from today's N.

## Section 1 — the helper: `src/test/scaling.ts`

```ts
expectLinearScaling({
  build: (n) => input,          // fixture builder — NOT timed
  run: (input) => output,       // the code under test — timed
  check: (output, n) => void,   // REQUIRED output assertion, run at both sizes
  n,                            // small size
  factor = 4,                   // large size = n * factor
  repeats = 5,
  maxRatio = factor ** 1.5,     // 8 at factor 4 — linear ≈ 4, quadratic ≈ 16
  now = performance.now,        // injectable clock, for the helper's own tests
})
```

- **Build first, time only the call.** Both inputs are built before any timing starts.
- **Interleave, then take the minimum.** Each repeat times small then large, and each size keeps its
  fastest run. A load spike therefore lands on both sizes, and the minimum discards the runs a spike
  hit.
- **Timer-floor guard.** If one small run takes under 20 ms, the helper calibrates a loop count that
  brings the small side to at least 20 ms and uses the SAME count for the large side. Otherwise a
  5 ms measurement makes the ratio mostly timer noise. The count is measured each run, never a
  hard-coded number, so no fixed ceiling comes back through it.
- **Output check is mandatory.** `check` is a required property and runs on the output of both
  sizes, so an early bail that made the input trivial fails the check.
- **Self-describing failure.** The failure message states the small and large minima, the ratio,
  `maxRatio`, and the loop count — reverting a fix prints the real numbers, so no separate probe is
  needed to record a red ratio.
- **`maxRatio` override** for a guard whose expected curve is not linear: `raid-escalation` uses
  `factor: 4, maxRatio: 2`.

Helper tests, `src/test/scaling.test.ts`, run entirely on a fake clock:

- a linear curve passes;
- a quadratic curve fails, and the message carries both minima and the ratio;
- one injected spike does not fail a linear curve;
- a sub-floor small side is looped up to the floor, with the same count on the large side;
- a throwing `check` fails the call.

## Section 2 — converting the call sites

Rules for every site:

1. **Keep the fixture's shape.** Only N changes; the fixture keeps hitting the same input pattern
   and code path.
2. **Choose the scaling direction from the constraints above.** Down from a clamp (`html-extract`,
   the `MAX_HTML_TEXT_CHARS` row). Up from today's proven N where a comment records that smaller sizes
   were unsafe (`rich-text-plain`, `xlsx-extract`, `docx-extract`, `pptx-extract`). Elsewhere, today's
   N becomes the large size.
3. **Record ratios, not ms.** Each site's comment currently records green and red durations. It is
   rewritten to record the green and red RATIOS measured during conversion, with the date, in the
   style of the `DOS_BUDGET_MS` docstring. Old ms figures are removed, not left beside the ratios.
4. **Keep the warning banners.** "DoS guard, not a benchmark — do not tighten" banners stay; only
   the numbers under them change. `DOS_BUDGET_MS` and the other ceiling constants are deleted once
   nothing reads them.
5. **Add a specific output assertion where a site has none** — the expected empty-document string,
   an expected cell count, and so on. "Is non-empty" does not count.
6. **Keep fixture-row loops.** Looped rows call the helper once per row, and the failure message
   names the row.

Special cases:

- **`raid-escalation`** — `factor: 4, maxRatio: 2`. The mutant to prove is removing the 200-character
  clamp.
- **`tag-pair-walk`'s 50 ms site** — the ~5 ms green side is looped up to the timer floor. The three
  250 ms sites convert normally.

Cost: roughly 2–3× today's timing work per site. The largest is `html-extract` at about 4 s, well
under the 20 s timeout. On the red side, a quadratic mutant's large run may hit the 20 s timeout
before the ratio assertion is reached. That is still red; the task report records which way each red
failed.

## Section 3 — verification and task split

**Mutation proof, per site.** Reintroduce the regression each site guards — the reverted linear walk,
the swapped check order, the restored backtracking regex, the removed clamp — and see the site go red,
on the ratio or on the timeout. Record the red ratio (or "timeout") in the site's comment and the task
report. A mutant that survives is a question to investigate, never a reason to loosen a ratio.
Mutants run one at a time and are reverted before the next; each report ends with `git diff --stat`
showing only the intended files.

**Peer protocol.** Only one vitest run at a time on this machine. Send "starting vitest" / "vitest
done" to the peer session, and take no timing measurement while the peer's vitest is running.

**Load check — the property this slice exists for.** Run each converted file once with the machine
deliberately saturated: a background CPU burn with one process per core, stopped by process ID
afterwards. Every site must stay green. This, not a green run on an idle machine, is what closes §592
and §593.

**Gates per task:** the targeted vitest files (`--maxWorkers=1 --reporter=dot`), `npx tsc --noEmit`,
`npx eslint --max-warnings=0` on the touched files. Register task adds `followups:index:check`,
`followups:workitems:check`, `docs:claims:check`, `docs:symbols:check`. No full suite.

**Tasks** (subagent-driven, each reviewed):

1. The helper and its fake-clock tests.
2. §592 and §593 — `tag-pair-walk`, `html-extract`.
3. Office extractors — `docx-extract`, `xlsx-extract`, `pptx-extract`, `office-xml`.
4. `rich-text-plain`, `document-asset-patterns.differential`, `raid-escalation`.
5. Docs and register — close §592 (#376) and §593 (#377) with dated closure notes, removing their
   `**Work item:**` lines (a closed entry must not carry one); add one line to `CONTRIBUTING.md`'s
   testing section saying new timing guards use `expectLinearScaling`.

## Out of scope

- Changing any production code. If a mutant proof shows a guard was already vacuous, file it in the
  register instead of fixing the code here.
- The full suite, which runs only on the user's say.
- `e2e/` — the inventory swept `src/` and `scripts/` only.
