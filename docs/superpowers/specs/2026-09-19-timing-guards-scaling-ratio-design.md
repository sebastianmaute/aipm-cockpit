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

23 call sites, 35 executions once fixture-row loops are counted; the sweep of `src/` and `scripts/`
found no timing ceiling outside these 9 files:

| File | Call sites → executions |
|---|---|
| `src/app/tag-pair-walk.test.ts` | 4 → 4 |
| `src/app/html-extract.test.ts` | 2 → 5 |
| `src/app/document-asset-patterns.differential.test.ts` | 2 → 7 |
| `src/app/docx-extract.test.ts` | 2 → 2 |
| `src/app/office-xml.test.ts` | 1 → 1 |
| `src/app/pptx-extract.test.ts` | 1 → 1 |
| `src/app/raid-escalation.test.ts` | 1 → 1 |
| `src/app/rich-text-plain.test.ts` | 4 → 6 |
| `src/app/xlsx-extract.test.ts` | 6 → 8 |

22 of the 23 guard against super-linear behaviour — a quadratic walk, regex backtracking, or DoS on
attacker-supplied bytes. None is a plain latency check. The 23rd is `xlsx-extract`'s "drops a cell
whose column is past Excel's last (XFD)" case: its fixture is a fixed four-cell row with no size to
scale, and the regression it guards (padding a row out to column ~8e9) exhausts memory rather than
growing with an N. That site DROPS its timing assertion and keeps its exact output assertion, which
the regression fails by running out of memory or by rendering a wrong row. So **22 sites and 34
executions convert** to a ratio, and one site loses a timing line.

Only a few sites also assert on the output today (`html-extract`'s two via its `timeExtract` helper,
`raid-escalation`, and the `xlsx-extract` XFD case above). No timing or ratio helper exists anywhere in
the repo. `vitest.config.ts` sets `testTimeout` to 20 s.

Constraints the inventory surfaced:

- **`html-extract`** — `extractHtmlMarkdown` truncates input to `MAX_HTML_INPUT_CHARS` (500,000)
  before any walk runs, and the fixtures sit exactly at that clamp, so a size above it measures the
  same truncated input twice. The green cost at the clamp is also high (865 ms per call for the
  heading and list-item rows, per the MARGIN docstring), so this file scales well BELOW the clamp:
  large 125,000, `n` 31,250.
- **`raid-escalation`** — the name is clamped to `RAID_ESCALATION_NAME_MAX` (200) before
  `stripBreakTags` runs, but the shipped path is still LINEAR in N, not flat. `stripBreakTagsWithin`
  (`src/app/raid-escalation.ts`) searches the sliced head for `TRAILING_BREAK_PREFIX`; on the
  `"<br ".repeat(N)` fixture that finds a cut at 0, and the sticky `BREAK_TAG_AT` (`/<br\b[^>]*>/iy`)
  then runs from that one position over the FULL raw value. With no `>` anywhere, its `[^>]*` scans
  to the end once. One anchored scan is linear, so the green ratio is about 4: node replicas of
  the function measured 3.88 (plan review) and 3.4–3.6 (revision, 2026-09-19) at 20k → 80k repeats,
  min of 5, 200 loops. This site uses the default limit, not an override.
- **`document-asset-patterns.differential`** — one row is sized to `MAX_HTML_TEXT_CHARS` (20,000)
  on purpose, as "the app's real exposure"; that row keeps 20,000 as its LARGE size. The timed code
  runs the regexes on the raw input, so there is no clamp to cross here; the size pin exists to keep
  the row at its stated exposure, not to stop the guard going vacuous. The other rows have no such tie.
- **`rich-text-plain`, `xlsx-extract`, `docx-extract`, `pptx-extract`, `office-xml`** — their comments
  record that smaller sizes let a mutant pass or were unreliable (for example, 128 KB and 256 KB were
  too small for two `rich-text-plain` mutants). Those notes size a CEILING margin: the mutant had to
  exceed a fixed number of milliseconds. They do not size a ratio. The same comments' own tables show
  the mutant quadratic dominating at far smaller sizes — the `rich-text-plain` `<img>` mutant is 216 ms
  against 0.3 ms at 32 KB and grows ×4 per doubling; the `xlsx-extract` no-cache mutant is 195 / 785 /
  3783 ms at 80k / 160k / 320k. So today's N becomes the LARGE size here too.

## Section 1 — the helper: `src/test/scaling.ts`

```ts
expectLinearScaling({
  build: (n) => input,          // fixture builder — NOT timed
  run: (input) => output,       // the code under test — timed
  check: (output, n) => void,   // REQUIRED output assertion, run at both sizes
  n,                            // small size
  factor = 4,                   // large size = n * factor
  repeats = 3,
  maxRatio = factor ** 1.5,     // 8 at factor 4 — linear ≈ 4, quadratic ≈ 16
  now = performance.now,        // injectable clock, for the helper's own tests
})
```

- **Build first, time only the call.** Both inputs are built before any timing starts.
- **Warm up before calibrating.** One untimed small run goes first, and its output is the small-size
  check. A cold first call carries JIT compilation and the flattening of a `repeat()` string; timed,
  a cold probe of 20 ms or more would lock the loop count at 1 while the steady state is a few ms.
- **Interleave, then take the minimum.** Each repeat times small then large, and each size keeps its
  fastest run. A load spike therefore lands on both sizes, and the minimum discards the runs a spike
  hit. Load that arrives mid-run and stays still leaves the first pair clean, which a helper that ran
  every small repeat before any large one would not.
  > **As shipped (2026-09-19):** the ratio is the MEDIAN of the per-pair ratios (large_i / small_i),
  > not the fastest large run over the fastest small run. The minima are taken independently, so a
  > load step that starts after the first small run and stays paired a clean small run with a loaded
  > large one and failed a correct build (pre-merge review I1). Per pair, both sides share the load in
  > force, so a step or a spike spoils one pair, the median of 3 outvotes it, and a real quadratic still
  > pushes every pair to about 16. `smallMs`/`largeMs` remain as the per-size minima, for the message
  > only; the result gains `pairRatios`, and the failure message prints them.
- **Timer-floor guard.** If one small run takes under 20 ms, the helper calibrates a loop count that
  brings the small side to at least 20 ms and uses the SAME count for the large side. Otherwise a
  5 ms measurement makes the ratio mostly timer noise. The count is measured each run, never a
  hard-coded number, so no fixed ceiling comes back through it.
- **`run` must be stateless across calls.** It is called many times on the same input, so a global or
  sticky regex whose `lastIndex` carries over, or a cache keyed on the input, would time different
  work on later calls. None of today's sites is affected; the helper's docstring says so.
- **Output check is mandatory.** `check` is a required property and runs on the output of both
  sizes, so an early bail that made the input trivial fails the check.
  > **As shipped (2026-09-19):** that holds only where the correct output shows how far the code got —
  > the sentinel sites (`xlsx-extract`, `docx-extract`) and the identity-output sites. Where the correct
  > output is itself the trivial one (the no-`>` walks in `tag-pair-walk` and `office-xml`, the
  > non-attribute `document-asset-patterns` rows and its pattern-level test, `degradeToPlain`), a
  > sentinel would change the fixture the mutant depends on, so those sites rely on the ratio alone and
  > each site's comment says why.
- **Self-describing failure.** The failure message states the small and large minima, the ratio,
  `maxRatio`, and the loop count — reverting a fix prints the real numbers, so no separate probe is
  needed to record a red ratio.
- **`maxRatio` override** for a guard whose expected curve is flatter than linear. No converted site
  passes one: `raid-escalation` was planned to, and turned out to be linear (see the inventory).
- **Hang backstop, not a guard.** Every converted test passes `{ timeout: 120_000 }` as its options
  argument, with a comment saying so. vitest cannot interrupt synchronous code: `withTimeout` in
  `@vitest/runner` wraps the test in `runWithTimeout`, whose `setTimeout` timer cannot fire while a
  synchronous test holds the thread, so the elapsed time is checked only when the test RETURNS, in
  that function's inner `resolve()` (`now - startTime >= timeout`). A test that throws takes the
  `reject()` path instead, which never checks elapsed time. So the default 20 s `testTimeout` is itself
  a wall-clock ceiling on any passing converted test, and 120 s moves it far out of reach of a slowed
  machine while still ending a real hang. A red ratio is reported as the ratio, however long it took.

Helper tests, `src/test/scaling.test.ts`, run entirely on a fake clock:

- a linear curve passes, in exactly 1 warm-up + 1 probe + 3 small/large pairs = 8 runs;
- a quadratic curve fails, and the message carries both minima and the ratio;
- one injected spike does not fail a linear curve — on the first small run, the first large run, and
  the LAST large run (the last kills a "take the last measurement" mutant, the first two a "take the
  first measurement" one);
- load that starts mid-run and stays does not fail a linear curve (pins interleaving);
- a sub-floor small side is looped up to the floor, with the same count on the large side;
- a throwing `check` fails the call.

## Section 2 — converting the call sites

Rules for every site:

1. **Keep the fixture's shape.** Only N changes; the fixture keeps hitting the same input pattern
   and code path.
2. **Start small, and require a red margin.** The starting size never scales up: today's N becomes
   the LARGE size everywhere, or something smaller, and `n` is a quarter of the large size.
   `html-extract` starts smaller still (large 125,000, `n` 31,250) to fit the time budget in rule 7.
   Each site is verified by the ratio its mutant produces at the committed sizes, and that ratio must
   be **at least 12** — 1.5× the limit of 8. A mutant ratio between 8 and 12 is a survivor to
   investigate, never a pass. A quadratic mutant's ratio rises with `n`, so a site short of 12 raises
   `n` until it gets there, even past today's N / 4. **The red margin wins over the time budget:** the
   implementer records the resulting green time and flags the site in the task report. If raising `n`
   cannot reach 12, that is a finding to report, never a reason to loosen the limit.

   > **As shipped (2026-09-19):** a second exception to "never scales up" applies alongside the red
   > margin above — a site whose calibrated loop count would exceed 4,096 (1/16 of the 65,536-loop
   > cap) also raises `n`, so a CI machine 2–4x faster does not throw below the timer floor on a
   > correct build (office-xml's own proof-time limit set its ceiling at 8,192 instead). Three
   > `tag-pair-walk` sites and `office-xml` run above their former fixed size as a result. See
   > `src/test/scaling.ts`'s `MAX_LOOPS` docstring.
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
7. **Budget about 1.5 s green per converted `it`,** or less. This is a target, not a gate; rule 2's red
   margin overrides it. A fixture-row loop whose rows together would exceed it becomes `it.each`, one
   row per test, named by the row label. A loop whose rows share a mutant also splits whatever its
   time, so the mutant proof can select one row (Section 3).
8. **Pass the hang backstop.** Every converted test takes `{ timeout: 120_000 }` as its options
   argument, with a one-line comment calling it a hang backstop, not the guard. In vitest 4.1.11 the
   options object is the SECOND argument (`it(name, { timeout }, fn)`, and likewise for
   `it.each(cases)(name, { timeout }, fn)`); the third-argument form accepts only a bare number
   (`TestCollectorCallable` / `EachFunctionReturn` in `@vitest/runner`'s types).

Special cases:

- **`raid-escalation`** — the default limit (`factor ** 1.5`, 8). Green is linear (ratio ≈ 4, see the
  inventory). The mutant is the exact pre-fix code from `ee584d716`: strip the full value, THEN
  slice — `stripBreakTags(raw).slice(0, max)`. The slice matters. Without it the output keeps ~80,000
  characters and fails `check` on the untimed warm-up, so no ratio is ever measured. With it, `check`
  passes and only the ratio can fail. `BREAK_TAG`'s nested runs make the mutant quadratic ("~4x per
  doubling" in the test's own comment), for an expected red ratio of about 16. A node replica measured
  15.6–15.9 (revision, 2026-09-19).
- **`xlsx-extract`'s XFD case** — no ratio. Its timing lines go; its exact output assertion stays, and
  the mutant (removing the column cap) is proved against that assertion.
- **`tag-pair-walk`'s 50 ms site** — the green side at `n` = 20,000 is a millisecond or two, so it is
  looped up to the timer floor. The three 250 ms sites convert normally.
- **`html-extract`'s 4-row test** becomes `it.each`, one row per test: the heading and list-item rows
  each cost about 0.9 s green at the new sizes.

Cost: a converted site runs 1 warm-up + at least 1 probe + 3 × (small + large). With the large size
at today's N and `n` = N / 4 that is about 0.25 + 0.25 + 3 × 1.25 ≈ 4.25 of today's single timed run
for a site that needs no looping; `html-extract`, scaled to a quarter of today's size, lands near
today's cost (~0.9 s for its dearest rows, from the MARGIN docstring's 865 ms at 500,000 scaled to
216 ms at 125,000 and 54 ms at 31,250). A looped site costs about `repeats` × 5 × the 20 ms floor plus
calibration, well under 1 s. The budget is about 1.5 s green per `it`; at §593's recorded 9.6×
slowdown that is about 14 s, far inside the 120 s hang backstop.

> **As shipped (2026-09-19):** three of the five `html-extract` rows (heading, list-item, table
> cells) were raised from n 31,250 to n 62,500 by judgement, not by the red-margin rule — each
> measured ratio sat within a single run's noise of the 12 floor. Green cost rose to about 1.9 s
> (heading) and 2.3 s (list-item), over the 1.5 s target, which the red-margin rule allows; the
> table-cells row's green cost is 701 ms, under the target.

On the red side a mutant runs to completion — vitest cannot interrupt it — so mutant proofs run
under an outer 120 s kill, and a kill counts as red (Section 3).

## Section 3 — verification and task split

**Mutation proof, per site.** Reintroduce the regression each site guards — the reverted linear walk,
the swapped check order, the restored backtracking regex, the removed clamp — and see the site go red.
Because vitest cannot interrupt a synchronous test (Section 1, "Hang backstop"), a mutant runs to
completion. Every mutant run therefore goes through a wrapper that starts vitest on the one file,
selects the ONE site under proof with `-t "<escaped exact test title>$"`, and kills that process tree
by its PID (`/T`) after 120 s. `-t` is needed because several mutants slow more than one site in a
file. Run whole-file, a kill could not be pinned on the site under proof. With `-t`, a kill is
attributed only to the selected test, and the file's other tests do not run (the module is still
collected). The log must show exactly one test run; zero means the pattern matched nothing. A kill
counts as red. Record the printed red ratio (or "killed at 120 s") in the site's comment and the task
report. A mutant that survives — green, or red with a ratio below 12 (Section 2, rule 2) — is a
question to investigate, never a reason to loosen a ratio. Mutants run one at a time and are reverted before the
next; each report ends with `git diff --stat` showing only the intended files.

**Peer protocol.** Only one vitest run at a time on this machine — never two, so the load check below
does not use a second vitest run as its load. Send "starting vitest" / "vitest done" to the peer
session, and take no timing measurement while the peer's vitest is running. The CPU burn saturates the
whole machine, so it gets its own pair of messages ("starting load burn" / "load burn done"), and the
peer runs nothing timing-sensitive in that window.

**Load check — the property this slice exists for.** Run each converted file with the machine
deliberately saturated: a background burn of 2 × the logical core count in worker threads, plus the
converted files under vitest `--maxWorkers=1`. Measure the slowdown the burn actually caused: time one
fixed reference loop on the idle machine and again under the burn, and record the ratio of the two
alongside the green result. Every site must stay green. A green run with no recorded slowdown factor
does not count. On a C-core machine the burn leaves a single thread about C / (2C + 1) of a core, so
expect a factor near 2, below §593's recorded 9.6×. The load check shows the ratios survive real
contention; the 120 s backstop covers a §593-sized slowdown by arithmetic (Section 2, "Cost").

**Gates per task:** the targeted vitest files (`--maxWorkers=1 --reporter=dot`), `npx tsc --noEmit`,
`npx eslint --max-warnings=0` on the touched files. Register task adds `followups:index:check`,
`followups:status:check`, `followups:workitems:check`, `docs:claims:check`, `docs:symbols:check`. No
full suite.

**Tasks** (subagent-driven, each reviewed):

1. The helper and its fake-clock tests.
2. §592 and §593 — `tag-pair-walk`, `html-extract`.
3. Office extractors — `docx-extract`, `xlsx-extract`, `pptx-extract`, `office-xml`.
4. `rich-text-plain`, `document-asset-patterns.differential`, `raid-escalation`.
5. Docs and register — close §592 (#376) and §593 (#377) with dated closure notes, removing their
   `**Work item:**` lines (a closed entry must not carry one) and setting both index rows' status cell
   to `**CLOSED** 2026-09-19`, the form §567's row uses. §592's closure note restates its "~80x
   ordering gap" as the ratio pair (green ≈ 4 against a mutant ratio of at least 12). Add one line to
   `CONTRIBUTING.md`'s
   testing section saying new timing guards use `expectLinearScaling`.

## Out of scope

- Changing any production code. If a mutant proof shows a guard was already vacuous, file it in the
  register instead of fixing the code here.
- The full suite, which runs only on the user's say.
- `e2e/` — the inventory swept `src/` and `scripts/` only.
