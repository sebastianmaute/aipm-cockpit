# Timing Guards: Scaling Ratio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every unit-test wall-clock ceiling with a load-independent scaling-ratio check, so machine load can no longer fail a correct build while each guard still goes red on the regression it exists for.

**Architecture:** One helper, `expectLinearScaling` in `src/test/scaling.ts`, times the code under test at `n` and `n * factor` after one untimed warm-up, interleaved, keeps each size's minimum, and asserts the ratio is below `maxRatio`. It requires an output check at both sizes. Nine test files move onto it: 22 call sites (34 executions) convert to a ratio, and one site (`xlsx-extract`'s XFD case, which has no size axis) drops its timing and keeps its exact output assertion. No production code changes.

> **As shipped (2026-09-19):** the helper judges the MEDIAN of the per-pair ratios (large_i / small_i),
> not "each size's minimum". Independent minima let a load step that starts after the first small run
> pair a clean small run with a loaded large one and fail a correct build (pre-merge review I1); per
> pair, a step or spike spoils one pair and the median of 3 outvotes it. The Task 1 code below is the
> original min/min version; `src/test/scaling.ts` is the shipped one.

**Tech Stack:** TypeScript, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-09-19-timing-guards-scaling-ratio-design.md`

## Global Constraints

- No production code changes. A guard found vacuous by its mutant proof is filed in the register, not fixed here.
- Defaults: `factor = 4`, `repeats = 3`, `maxRatio = factor ** 1.5` (8 at factor 4). Timer floor 20 ms. No converted site passes `maxRatio`.
- The output `check` is mandatory at every call site, and it must be specific to the fixture — "is non-empty" does not count.
- Sizes: the STARTING size never scales up. Today's N becomes the LARGE size everywhere, or something smaller; `n` is a quarter of the large size (the per-site table in each task gives the starting `n`). `html-extract` starts further down: large 125,000, `n` 31,250. The "smaller sizes were unsafe" notes in `rich-text-plain`, `xlsx-extract`, `docx-extract`, `pptx-extract` and `office-xml` sized a CEILING margin, not a ratio — their own tables show the mutant quadratic dominating at a quarter of today's size. The one exception to "never above today's size" is the red-margin rule below.
  > **As shipped (2026-09-19):** a second exception applies alongside the red-margin rule — a site
  > whose calibrated loop count would exceed 4,096 (1/16 of the 65,536-loop cap) also raises `n`, so a
  > CI machine 2–4x faster does not throw below the timer floor on a correct build (office-xml's own
  > proof-time limit set its ceiling at 8,192 instead). Three `tag-pair-walk` sites and `office-xml`
  > run above their former fixed size as a result. See `src/test/scaling.ts`'s `MAX_LOOPS` docstring.
- **Red margin — a mutant ratio of at least 12 (1.5× the limit of 8).** Every site is verified by the ratio its mutant produces at the committed sizes, and that ratio must be at least 12. A ratio between 8 and 12 is NOT a pass: it is a survivor to investigate, exactly like a green mutant. A quadratic mutant's ratio rises with `n`, so the remedy is to raise `n`, never to accept the thin margin or to loosen the limit.
- **The red margin wins over the time budget.** Budget about 1.5 s green per converted `it`, or less, on the development machine — a TARGET, not a gate. If a site cannot reach a mutant ratio of 12 inside 1.5 s, raise `n` until it does (even past today's N / 4, if that is what it takes), record the resulting green time and the reason in the site's comment, and flag the site in the task report. If raising `n` does not bring the ratio to 12 either, stop and report `DONE_WITH_CONCERNS`. A fixture-row loop whose rows together would exceed the budget becomes `it.each`, one row per test, named by the row label.
- Every converted test passes `{ timeout: 120_000 }` as its OPTIONS argument — in vitest 4.1.11 that is the second argument, `it(name, { timeout: 120_000 }, fn)` or `it.each(cases)(name, { timeout: 120_000 }, fn)`; the third-argument slot takes only a bare number. Put this comment on the line above: `// Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).`
- Comments record the green and red RATIOS measured during conversion, with the date (2026-09-19 or the day measured). Old ms figures are removed. "DoS guard, not a benchmark" banners stay.
- vitest: `npx vitest run <files> --maxWorkers=1 --reporter=dot`. Never two vitest processes at once. Never read an exit code through a pipe: redirect to a log, `echo "EXIT=$?"`, then read the log. Mutant runs use the 120 s kill wrapper in "Mutant procedure".
- Keep each existing file's line endings. Check with `git ls-files --eol <file>` before and after editing: a file that is `w/crlf` stays CRLF, a file that is `w/lf` stays LF. The two NEW files in Task 1 come out of the Write tool as LF; leave them so — the committed blob is LF either way and no gate reads the working-tree ending.
- Git: never `git add -A` or `git add .`; commit with `git commit --only <paths> -F <msgfile>`. Never `--amend`, never a bare `git stash`, never `npm ci`. `git checkout --` and `git restore` are blocked; revert a mutant by writing the original bytes back and proving `git diff --stat` is empty for that file.
- Commit messages cite §N, never `#NN` or "Closes". End every commit message with the line the session trailer.
- Never open, print or stage any `.env*` file.
- Implementers never dispatch subagents.

## Review Focus

1. **A fast CI machine makes the small side sub-millisecond.** Expected: the helper loops the call up to the 20 ms floor and still produces a meaningful ratio, not a noise ratio. Pinned in Task 1 ("loops a sub-floor small side...").
2. **Fixture building is slow compared with the call.** Expected: build time never enters the ratio. Pinned in Task 1 ("does not time build").
3. **A load spike lands on one measurement.** Expected: a linear curve still passes, wherever the spike lands — first small run, first large run, or last large run. Pinned in Task 1 (the three "ignores one spike" tests).
4. **Load arrives mid-run and stays.** Expected: interleaving leaves the first small/large pair clean, so a linear curve passes. Pinned in Task 1 ("keeps sizes interleaved").
5. **A regression bails early at the large size only.** Expected: `check` at the large size fails the test. Pinned in Task 1 ("fails when check throws at the large size only").
6. **A large size that crosses a clamp makes the guard vacuous** (both sizes do the same work, ratio ≈ 1, passes whatever the code does). Expected: the one clamp-bound site, `html-extract`, asserts its large input does not exceed `CLAMP_CHARS`. Pinned in Task 2. (`document-asset-patterns`' `MAX_HTML_TEXT_CHARS` row carries a size pin too, but its timed regexes run on the raw input with no clamp, so that pin keeps the row at its stated "real exposure" size; it is not a vacuity guard.)
7. **A passing converted test takes longer than vitest's timeout on a loaded machine.** vitest checks a synchronous test's elapsed time only after it returns, so the default 20 s `testTimeout` would be a wall-clock ceiling in its own right. Expected: every converted test passes `{ timeout: 120_000 }`, and each `it` costs about 1.5 s green or less.

## Peer protocol and load check (all tasks that run vitest)

The controller sends "starting vitest" to the peer session before dispatching a task that runs vitest, and "vitest done" after the task reports. An implementer takes timing measurements (mutant ratios, load check) only inside that window. Never two vitest runs at once — including as a way to create load.

The CPU burn below saturates the WHOLE machine and can fail a peer's own timing tests or full-suite run. The controller therefore also sends "starting load burn (about 4 minutes)" before a load check and "load burn done" after it, and the peer runs nothing timing-sensitive in between.

Create two scripts once in the SDD workspace (NOT in the repo).

`burn.mjs` — saturates the machine with 2 × the logical core count of worker threads for N seconds, then exits by itself:

```js
import { Worker } from "node:worker_threads";
import os from "node:os";
const secs = Number(process.argv[2] ?? 240);
const code = `const end = Date.now() + ${secs} * 1000; while (Date.now() < end) {}`;
for (let i = 0; i < 2 * os.cpus().length; i++) new Worker(code, { eval: true });
console.log(`burn: ${2 * os.cpus().length} threads for ${secs} s, pid ${process.pid}`);
```

`ref.mjs` — a fixed single-threaded reference loop, used to measure how much the burn actually slowed the machine:

```js
const started = performance.now();
let x = 0;
for (let i = 0; i < 200_000_000; i++) x = (x + i) % 1_000_003;
console.log(`ref ${(performance.now() - started).toFixed(0)} ms (x=${x})`);
```

Load check, in PowerShell, from the repo root (replace `<workspace>`, `<files>` and `<log>`):

```powershell
node <workspace>\ref.mjs                                   # idle: record the ms
$burn = Start-Process -FilePath node -ArgumentList @("<workspace>\burn.mjs", "240") -NoNewWindow -PassThru
node <workspace>\ref.mjs                                   # under the burn: record the ms
npx vitest run <files> --maxWorkers=1 --reporter=dot > <log> 2>&1; "EXIT=$LASTEXITCODE"
node <workspace>\ref.mjs                                   # still under the burn: confirms it covered the run
if (-not $burn.HasExited) { Stop-Process -Id $burn.Id }    # by PID only, never a blanket node kill
```

Record in the report: the idle ms, the two under-burn ms, the slowdown factor (under-burn ÷ idle, taking the smaller under-burn figure), and the vitest EXIT with its `Test Files` line. If the third `ref` line runs after the burn has exited (its ms is back near idle), the burn did not cover the vitest run: raise the seconds and repeat. A green result with no recorded factor does not count. With 2C burners on C cores a single thread gets about C / (2C + 1) of a core, so expect a factor near 2; record what you measure, not this estimate.

## Mutant procedure (Tasks 2–4)

vitest cannot interrupt a synchronous test (see the "Hang backstop" docstring in `src/test/scaling.ts`), so a mutant runs to completion however long it takes. Every mutant run therefore goes through this wrapper, which runs vitest on ONE file, selects ONE test with `-t`, and kills that process tree by its PID after 120 s. In PowerShell, from the repo root:

```powershell
$file = "src/app/<name>.test.ts"; $log = "<workspace>\mutant-<site>.log"
$name = '<the exact test name, as vitest prints it>'   # single-quoted; double any ' inside it
$pattern = [regex]::Escape($name) + '$'
$sp = @{ FilePath = "npx.cmd"; ArgumentList = @("vitest", "run", $file, "-t", "`"$pattern`"", "--maxWorkers=1", "--reporter=dot"); RedirectStandardOutput = $log; RedirectStandardError = "$log.err"; NoNewWindow = $true; PassThru = $true }
$p = Start-Process @sp
$null = $p.Handle   # keeps ExitCode readable once the process exits
if ($p.WaitForExit(120000)) { "EXIT=$($p.ExitCode)" } else { taskkill /PID $p.Id /T /F | Out-Null; "KILLED after 120 s - counts as RED" }
Select-String -Path $log -Pattern "Tests "
```

- **Why `-t`.** Several mutants slow more than one converted site in the same file (the `xlsx-extract` sheet-name read backs three sites; the `rich-text-plain` TAG mutant hits three rows). Run whole-file, a 120 s kill could not be pinned on the site under proof, and a site whose own mutant ratio is thin would be recorded red by its neighbour's slowness. With `-t`, a kill is attributed to the one selected test and to nothing else.
- **The pattern.** vitest compiles `-t` with `new RegExp(pattern)` (no flags) and matches it against the test's FULL name — the describe titles and the test title joined by spaces (`getTaskFullName` in `@vitest/runner`). So the test title alone is enough, `[regex]::Escape` neutralises `(`, `)`, `.`, `?`, `*`, `+`, `[`, `$` and friends (its `\ ` for a space is a harmless identity escape in a non-unicode JS regex), and the trailing `$` stops a title from also selecting a longer title that begins with it. The embedded quotes keep a title with spaces as ONE argument through `npx.cmd`.
- **Selecting a row.** A looped row is its own `it` with its own title, so select it by that title: an `it.each` row by its formatted name (`…quadratically: heading, no '>' at all`), a `for`-generated row by its interpolated name (`stays bounded on <img repeated`). The anchoring `$` is what separates `stays bounded on <img repeated` from `stays bounded on <img SP repeated, closed`.
- **Prove the selection.** The `Tests` line in the log must show exactly one test run (1 failed or 1 passed, the rest skipped). `0` run means the pattern matched nothing, which reads as a green run and proves nothing: fix the pattern and rerun. On a kill the log may be cut off; a kill is red either way.
- **Exit code.** Read `$p.ExitCode` as printed, never through a pipe (the only pipe above is `taskkill … | Out-Null`, whose status is not used).

`taskkill /PID <id> /T` ends only the tree rooted at the vitest process this wrapper started. Never kill node processes by name.

For each converted call site:

1. Find the regression it guards. First from the site's own comment. If the comment does not name it, run `git log -S '<a distinctive fixture string>' --oneline -- <test file>` to find the commit that added the guard, and read that commit's change to the SOURCE file — the mutant is reverting that source hunk.
2. Apply the mutant to the source file, run the wrapper on that ONE test (`-t`), and record: red or green; if red, the ratio printed in the failure message, or "killed at 120 s". A ratio failure is reported as the ratio even when the run took longer than the test's own timeout, because a test that throws never reaches vitest's elapsed-time check. A kill is red but prints no ratio; since the red margin below needs a number, a killed site gets a smaller `n` if one still reaches 12 inside the kill, and otherwise is recorded as "killed at 120 s" and flagged.
3. Write the original bytes back and confirm `git diff --stat -- <source file>` prints nothing.
4. A mutant that survives is NOT a reason to loosen the ratio. "Survives" means green OR red with a ratio below 12 (Global Constraints, red margin). Raise `n` per Global Constraints and re-prove; if the ratio still cannot reach 12, stop and report `DONE_WITH_CONCERNS`, with the ratio numbers.
5. Budget each mutant run as vitest startup + collecting the file (its top-level code still runs — `document-asset-patterns.differential` builds its whole corpus at module level) + the selected test alone. `-t` skips every other test's body, so the file's other tests cost nothing. Allow a few seconds for startup and collection on top of the per-site estimates in the tasks.

Mutants run one at a time. The report ends with `git diff --stat` showing only the intended files.

---

### Task 1: The scaling helper

**Files:**
- Create: `src/test/scaling.ts`
- Test: `src/test/scaling.test.ts`

**Interfaces:**
- Produces:
  - `export const TIMER_FLOOR_MS = 20`
  - `export interface ScalingOptions<I, O> { label: string; build: (n: number) => I; run: (input: I) => O; check: (output: O, n: number) => void; n: number; factor?: number; repeats?: number; maxRatio?: number; now?: () => number }`
  - `export interface ScalingResult { smallMs: number; largeMs: number; ratio: number; loops: number; nLarge: number }`
  - `export function measureScaling<I, O>(opts: ScalingOptions<I, O>): ScalingResult`
  - `export function expectLinearScaling<I, O>(opts: ScalingOptions<I, O>): ScalingResult`

- [ ] **Step 1: Write the failing tests**

`src/test/scaling.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { expectLinearScaling, measureScaling, TIMER_FLOOR_MS } from "./scaling";

/**
 * A fake clock the fake workload advances. `cost(n, call)` is the ms one run
 * costs at size n; `call` counts every `run` from 1.
 */
function fakeWorkload(cost: (n: number, call: number) => number) {
  const clock = { t: 0, calls: 0 };
  return {
    now: () => clock.t,
    build: (n: number) => n,
    run: (n: number) => {
      clock.calls += 1;
      clock.t += cost(n, clock.calls);
      return n;
    },
  };
}

// Call order at the default repeats (3), for a run of 100 ms or more at n, so
// calibration needs exactly one probe:
//   call 1 = untimed warm-up (small), call 2 = calibration probe (small),
//   then repeat r times small at call 3 + 2r and large at call 4 + 2r.
const FIRST_SMALL_CALL = 3;
const FIRST_LARGE_CALL = 4;
const LAST_LARGE_CALL = 2 * 3 + 2; // 8
const slow = (n: number) => (n / 1000) * 50;

describe("measureScaling", () => {
  it("passes a linear curve, in 1 warm-up + 1 probe + 3 small/large pairs", () => {
    let lastCall = 0;
    const w = fakeWorkload((n, call) => {
      lastCall = call;
      return n / 1000;
    });
    const r = expectLinearScaling({ label: "linear", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
    expect(r.nLarge).toBe(400_000);
    expect(lastCall).toBe(LAST_LARGE_CALL);
  });

  it("fails a quadratic curve, naming both minima and the ratio", () => {
    const w = fakeWorkload((n) => (n / 1000) ** 2 / 100);
    expect(() =>
      expectLinearScaling({ label: "quad", ...w, check: () => {}, n: 100_000 }),
    ).toThrow(/quad: small n=100000 .*ms, large n=400000 .*ms, ratio 16\.00 \(max 8\)/);
  });

  it("ignores one spike on the first small run", () => {
    const w = fakeWorkload((n, call) => (call === FIRST_SMALL_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("ignores one spike on the first large run", () => {
    const w = fakeWorkload((n, call) => (call === FIRST_LARGE_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("ignores one spike on the LAST large run", () => {
    // A helper that kept the last measurement instead of the minimum would
    // see 20,000 ms against 100 ms here: ratio 200.
    const w = fakeWorkload((n, call) => (call === LAST_LARGE_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("keeps sizes interleaved, so load that arrives mid-run and stays does not fail", () => {
    // From call 5 (repeat 1's small run) on, every run is 50x slower. Interleaved,
    // repeat 0's pair (calls 3 and 4) is clean. A helper that ran every small
    // repeat before any large one would time all three large runs under load.
    const w = fakeWorkload((n, call) => (call >= FIRST_SMALL_CALL + 2 ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "sustained", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("loops a sub-floor small side up to the floor, with the same count on the large side", () => {
    const w = fakeWorkload((n) => n / 1_000_000); // 0.1 ms at n=100_000
    const r = measureScaling({ label: "tiny", ...w, check: () => {}, n: 100_000 });
    expect(r.loops).toBeGreaterThan(1);
    expect(r.smallMs).toBeGreaterThanOrEqual(TIMER_FLOOR_MS);
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("does not time build", () => {
    const clock = { t: 0 };
    const r = measureScaling({
      label: "build",
      now: () => clock.t,
      build: (n: number) => {
        clock.t += 10_000; // an expensive build must never enter the ratio
        return n;
      },
      run: (n: number) => {
        clock.t += n / 1000;
        return n;
      },
      check: () => {},
      n: 100_000,
    });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("runs check at both sizes", () => {
    const w = fakeWorkload((n) => n / 1000);
    const seen: number[] = [];
    // The fake run returns its input, so `out` IS the size it was checked at.
    measureScaling({ label: "check", ...w, check: (out) => seen.push(out), n: 100_000 });
    expect(seen).toContain(100_000);
    expect(seen).toContain(400_000);
  });

  it("fails when check throws at the large size only", () => {
    const w = fakeWorkload((n) => n / 1000);
    expect(() =>
      expectLinearScaling({
        label: "bail",
        ...w,
        check: (out, n) => {
          if (n === 400_000) throw new Error(`early bail at ${out}`);
        },
        n: 100_000,
      }),
    ).toThrow(/early bail at 400000/);
  });

  it("honours a maxRatio override", () => {
    // No converted site passes maxRatio today; this pins the option for a
    // future guard whose expected curve is flatter than linear.
    const w = fakeWorkload(() => 25); // a flat curve
    const r = expectLinearScaling({ label: "flat", ...w, check: () => {}, n: 1000, maxRatio: 2 });
    expect(r.ratio).toBeCloseTo(1, 5);
    const g = fakeWorkload((n) => n / 40); // linear against a flat expectation
    expect(() =>
      expectLinearScaling({ label: "grows", ...g, check: () => {}, n: 1000, maxRatio: 2 }),
    ).toThrow(/ratio 4\.00 \(max 2\)/);
  });

  it("rejects options that cannot measure scaling", () => {
    const w = fakeWorkload((n) => n / 1000);
    expect(() => measureScaling({ label: "x", ...w, check: () => {}, n: 0 })).toThrow(/n must be/);
    expect(() => measureScaling({ label: "x", ...w, check: () => {}, n: 10, factor: 1 })).toThrow(/factor must be/);
    expect(() => measureScaling({ label: "x", ...w, check: () => {}, n: 10, repeats: 0 })).toThrow(/repeats must be/);
  });

  it("refuses a run too cheap to reach the floor within the loop cap", () => {
    const w = fakeWorkload(() => 0);
    expect(() => measureScaling({ label: "free", ...w, check: () => {}, n: 10 })).toThrow(/free: .*below the 20 ms floor/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/scaling.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"`
Expected: EXIT=1, failing on the missing module `./scaling`.

- [ ] **Step 3: Write the implementation**

`src/test/scaling.ts`:

```ts
// Load-independent complexity guard for unit tests.
//
// ★ Replaces "elapsed < CEILING_MS". A fixed ceiling fails a CORRECT build
//   when the machine is saturated (register §592, §593). This times the code
//   at n and n * factor, interleaved so a load spike lands on both sizes, keeps
//   each size's MINIMUM, and asserts on the RATIO. Linear code gives ≈ factor,
//   quadratic ≈ factor²; the default maxRatio factor^1.5 sits between them on a
//   log scale.
// ★ `check` is mandatory and runs at BOTH sizes: an early bail that made the
//   input trivial would otherwise pass a ratio check exactly as it passed a
//   ceiling.
// ★ One untimed warm-up run precedes calibration. A cold first call carries
//   JIT compilation and the flattening of a `repeat()` string; timed, a cold
//   probe of 20 ms or more would lock the loop count at 1 while the steady
//   state is a few ms.
// ★ HANG BACKSTOP. Give every test that calls this `{ timeout: 120_000 }` as
//   its options argument (`it(name, { timeout: 120_000 }, fn)` in vitest 4).
//   vitest cannot interrupt synchronous code: `withTimeout` in @vitest/runner
//   wraps the test in `runWithTimeout`, whose setTimeout timer cannot fire
//   while a synchronous test holds the thread, so elapsed time is checked
//   only once the test RETURNS, in that function's inner `resolve()`. A
//   passing test is then failed if it took longer than its timeout, so the
//   default 20 s testTimeout would itself be a wall-clock ceiling on a slowed
//   machine. A throwing test takes the `reject()` path, which never checks
//   elapsed time, so a red ratio is always reported as the ratio.
import { expect } from "vitest";

/** A small side cheaper than this is looped until it reaches it, so the ratio is not timer noise. */
export const TIMER_FLOOR_MS = 20;
const MAX_LOOPS = 1 << 16;

export interface ScalingOptions<I, O> {
  /** Names the site in the failure message. */
  label: string;
  /** Builds the fixture at size n. Never timed. */
  build: (n: number) => I;
  /**
   * The code under test. Timed. Called many times on the SAME input, so it
   * must be stateless across calls: no global or sticky regex whose
   * `lastIndex` carries over, no cache keyed on the input.
   */
  run: (input: I) => O;
  /** Asserts on the output. Runs once at each size. */
  check: (output: O, n: number) => void;
  /** The small size. */
  n: number;
  factor?: number;
  repeats?: number;
  maxRatio?: number;
  /** Injectable clock, for this helper's own tests. */
  now?: () => number;
}

export interface ScalingResult {
  smallMs: number;
  largeMs: number;
  ratio: number;
  loops: number;
  nLarge: number;
}

export function measureScaling<I, O>(opts: ScalingOptions<I, O>): ScalingResult {
  const factor = opts.factor ?? 4;
  const repeats = opts.repeats ?? 3;
  const now = opts.now ?? (() => performance.now());
  if (!Number.isInteger(opts.n) || opts.n < 1) throw new Error(`${opts.label}: n must be a positive integer`);
  if (!(factor > 1)) throw new Error(`${opts.label}: factor must be greater than 1`);
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`${opts.label}: repeats must be a positive integer`);

  const nLarge = Math.round(opts.n * factor);
  const small = opts.build(opts.n);
  const large = opts.build(nLarge);

  const time = (input: I, loops: number): { ms: number; out: O } => {
    const started = now();
    let out = opts.run(input);
    for (let i = 1; i < loops; i++) out = opts.run(input);
    return { ms: now() - started, out };
  };

  // Untimed warm-up at the small size; its output is the small-size check.
  opts.check(opts.run(small), opts.n);

  // Calibrate the loop count on the small side.
  let loops = 1;
  let probeMs = time(small, loops).ms;
  while (probeMs < TIMER_FLOOR_MS) {
    if (loops >= MAX_LOOPS) {
      throw new Error(
        `${opts.label}: ${loops} runs at n=${opts.n} took ${probeMs.toFixed(3)}ms, below the ${TIMER_FLOOR_MS} ms floor — use a larger n`,
      );
    }
    loops *= 2;
    probeMs = time(small, loops).ms;
  }

  // Interleave: each repeat times small, then large, and each size keeps its
  // fastest run, so load that arrives mid-run leaves the first pair clean.
  let smallMs = Infinity;
  let largeMs = Infinity;
  for (let r = 0; r < repeats; r++) {
    smallMs = Math.min(smallMs, time(small, loops).ms);
    const l = time(large, loops);
    if (r === 0) opts.check(l.out, nLarge);
    largeMs = Math.min(largeMs, l.ms);
  }
  return { smallMs, largeMs, ratio: largeMs / smallMs, loops, nLarge };
}

export function expectLinearScaling<I, O>(opts: ScalingOptions<I, O>): ScalingResult {
  const factor = opts.factor ?? 4;
  const maxRatio = opts.maxRatio ?? factor ** 1.5;
  const r = measureScaling(opts);
  expect(
    r.ratio,
    `${opts.label}: small n=${opts.n} ${r.smallMs.toFixed(1)}ms, large n=${r.nLarge} ${r.largeMs.toFixed(1)}ms, ` +
      `ratio ${r.ratio.toFixed(2)} (max ${Number(maxRatio.toFixed(2))}), loops ${r.loops}`,
  ).toBeLessThan(maxRatio);
  return r;
}
```

Call order the spike and interleaving tests depend on (every `run` counts, whether timed or not): call 1 is the untimed warm-up; call 2 is the calibration probe (at `n/1000` = 100 ms it is already above the floor, so there is no further calibration call); then repeat `r` runs small at call `3 + 2r` and large at call `4 + 2r`. At the default `repeats` of 3 the first small run is call 3, the first large run call 4, and the last large run call `2 * repeats + 2` = 8. (Without the warm-up the last large run would be call `2 * repeats + 1`; the warm-up shifts every index by one.) The linear test pins the total of 8 calls, so a changed default or a changed order goes red there first; update the constants at the top of the test file to match.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/test/scaling.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 1 passed`, 13 tests passed.

- [ ] **Step 5: Mutation-prove the helper**

Apply each mutant alone, run the file, confirm red, restore, confirm `git diff --stat -- src/test/scaling.ts` is empty. Each edit is exact:
1. **Take the last measurement.** Replace `smallMs = Math.min(smallMs, time(small, loops).ms);` with `smallMs = time(small, loops).ms;` and `largeMs = Math.min(largeMs, l.ms);` with `largeMs = l.ms;` → "ignores one spike on the LAST large run" goes red (ratio 200).
2. **Take the first measurement.** Replace `smallMs = Math.min(smallMs, time(small, loops).ms);` with `const s = time(small, loops).ms; if (r === 0) smallMs = s;` and `largeMs = Math.min(largeMs, l.ms);` with `if (r === 0) largeMs = l.ms;` → "ignores one spike on the first large run" goes red (ratio 200), and "ignores one spike on the first small run" goes red on `toBeCloseTo(4)` (ratio 0.08).
3. **Run sizes in sequence, not interleaved.** Replace the whole `for (let r = 0; r < repeats; r++) { … }` repeat loop with `for (let r = 0; r < repeats; r++) smallMs = Math.min(smallMs, time(small, loops).ms);` followed by `for (let r = 0; r < repeats; r++) { const l = time(large, loops); if (r === 0) opts.check(l.out, nLarge); largeMs = Math.min(largeMs, l.ms); }` → "keeps sizes interleaved" goes red (ratio 200).
4. **Skip the large-size check.** Delete the `if (r === 0) opts.check(l.out, nLarge);` line → "fails when check throws at the large size only" goes red (and "runs check at both sizes").
5. **Skip calibration.** Change `while (probeMs < TIMER_FLOOR_MS)` to `while (false)` → the sub-floor test goes red (and "refuses a run too cheap…").
6. **Time the build.** Inside `time`, replace `const started = now();` with `const started = now(); opts.build(input === small ? opts.n : nLarge);` → "does not time build" goes red (each timed call now carries the fake build's 10,000 ms, so the ratio falls to about 1.03).

The warm-up itself has no mutant: on a fake clock there is no JIT, so deleting the warm-up line changes no timing. (Deleting it DOES turn "runs check at both sizes" red, but through the small-size check it carries, not through the warm-up.) Say so in the report rather than claiming it is pinned.

These six outcomes, and the 13 green tests, were checked while revising this plan against a tsc-transpiled copy of the two code blocks run under a minimal stand-in for vitest's `describe`/`it`/`expect` — not under vitest itself. Re-prove them under vitest here; that check is evidence the blocks are consistent, not a substitute.

- [ ] **Step 6: Gates**

`npx tsc --noEmit > <log> 2>&1; echo "EXIT=$?"` → 0 total errors. `npx eslint --max-warnings=0 src/test/scaling.ts src/test/scaling.test.ts; echo "EXIT=$?"` → 0. `git ls-files --eol src/test/scaling.ts src/test/scaling.test.ts` after `git add` → `i/lf` for both (the working-tree column may read `w/lf`; that is fine, see Global Constraints).

- [ ] **Step 7: Commit**

Message file:
```
test: add expectLinearScaling, a load-independent timing guard (§592, §593)
```
`git add -- src/test/scaling.ts src/test/scaling.test.ts && git commit --only src/test/scaling.ts src/test/scaling.test.ts -F <msgfile>`

---

### Task 2: §592 and §593 — `tag-pair-walk` and `html-extract`

**Files:**
- Modify: `src/app/tag-pair-walk.test.ts` (4 call sites: the tests at the three `toBeLessThan(250)` assertions and the one `toBeLessThan(50)` assertion — "keeps retired-name lookups cheap, so a missing close stays linear")
- Modify: `src/app/html-extract.test.ts` (2 tests: "bounds processing time on unterminated tags that the pair-regex steps walked quadratically" with its 4 fixture rows, and "bounds processing time on a trailing unterminated tag far from any '>'"; the `DOS_BUDGET_MS` docstring; the `timeExtract` helper)

**Interfaces:**
- Consumes: `expectLinearScaling` from `../test/scaling` (Task 1).

- [ ] **Step 1: Convert `tag-pair-walk.test.ts`**

Add `import { expectLinearScaling } from "../test/scaling";`. For each of the 4 sites, replace the `performance.now()` pair and the ceiling with `expectLinearScaling`, and pass the hang backstop. Today's N becomes the LARGE size, so the starting `n` is today's repetition count divided by 4:

| Site (test name) | Today's N | Starting `n` |
|---|---|---|
| "stays linear when the input has no '>' anywhere at all" (`forEachTagPair`) | 20,000 | 5,000 |
| "keeps retired-name lookups cheap, so a missing close stays linear" | 80,000 | 20,000 |
| "stays linear on opens with no '>' anywhere at all" (`forEachOpenTag` via `tagsOf`) | 200,000 | 50,000 |
| "stays linear on opens with no '>' before the end of a long input" | 80,000 | 20,000 |

The retired-name site becomes (the callback receives a `TagPair`, whose `inner` is a string):

```ts
  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("keeps retired-name lookups cheap, so a missing close stays linear", { timeout: 120_000 }, () => {
    // (keep the WHY of the ordering from today's comment; the ms figures
    // become the green and red ratios measured in Step 3)
    expectLinearScaling({
      label: "retired-name lookups",
      build: (n) => "<w:tbl".repeat(n) + ">",
      run: (input) => {
        const seen: string[] = [];
        forEachTagPair(input, SPEC, (pair) => {
          seen.push(pair.inner);
          return true;
        });
        return seen;
      },
      // No open ever finds its close, so nothing is yielded.
      check: (seen) => expect(seen).toEqual([]),
      n: 20_000,
    });
  });
```

Adapt `run`/`check` to each other site's callback and to what that fixture really yields, and run the site once on green code to learn the true output before pinning it. The two `forEachOpenTag` sites already pin their output (`toEqual([])`, `toHaveLength(1)`); move those into `check`. Rewrite each site's measurement comment: keep the explanation of WHY the ordering matters, and replace the ms figures with the green and red ratios you measure (Step 3). The green side of the smaller sites is a millisecond or two, so the helper loops it up to the 20 ms floor; that is expected.

- [ ] **Step 2: Convert `html-extract.test.ts`**

- Add `import { expectLinearScaling } from "../test/scaling";`. Delete `DOS_BUDGET_MS` and `timeExtract` once nothing reads them. Keep `CLAMP_CHARS` and `repeatTo`. Keep the ★★★ banner above the tests. Rewrite the MARGIN docstring as a ratio table (green → red per fixture, with the date), keeping its ★★ note about `TAG_STRIP_RE`'s constant. Its last ★ note ("a per-fixture probe is needed to get all five") no longer applies once each row is its own test; replace it with that fact.
- Sizes: well BELOW the clamp, for time rather than correctness. The heading and list-item rows cost 865 ms green per call at 500,000 (the MARGIN docstring), so keeping the clamp as the large size would cost about 3.7 s per row. Use large 125,000 and `n` 31,250 for all five fixtures. Expected red ratios, from the docstring's own green/red columns, taking red as a quadratic term on top of the green linear cost: about 12 for the heading and list-item rows, about 16 for the two table rows (their green cost is 8–12 ms at 500,000), and about 13 for the trailing-tag test. Verify each by its mutant (Step 3). The heading and list-item estimates (12.2 and 11.9) sit ON the red-margin floor of 12, so expect those two rows to need a larger `n`: by the same arithmetic, `n` 62,500 (large 250,000) gives about 13.7 for the heading row at about 1.8 s green — over the 1.5 s target, which the red-margin rule allows (record the green time and flag it). Measure rather than trusting this estimate. Keep `n` a multiple of 5, since the trailing-tag fixture divides it by 5; if you raise it, keep every row's large size at or under `CLAMP_CHARS` (the `underClamp` pin enforces it).
- The 4-row test becomes `it.each`, one row per test: the heading and list-item rows each cost about 0.9 s green at these sizes, so the four together would exceed the 1.5 s budget. The code, complete:

  > **As shipped (2026-09-19):** three of the five rows (heading, list-item, table cells) were raised
  > from n 31,250 to n 62,500 by judgement, not by the red-margin rule — each measured ratio sat
  > within a single run's noise of the 12 floor. Green cost rose to about 1.9 s (heading) and 2.3 s
  > (list-item), over the 1.5 s target, which the red-margin rule allows; the table-cells row's green
  > cost is 701 ms, under the target.

  ```ts
  /** Pins a fixture under the clamp, so a later edit cannot push the large
   *  size past it and make both sizes measure the same truncated input. */
  const underClamp = (input: string): string => {
    expect(input.length).toBeLessThanOrEqual(CLAMP_CHARS);
    return input;
  };

  const emptyDoc = (out: string) =>
    expect(out).toBe("_(document contained no extractable text)_");

  const QUADRATIC_ROWS: Array<[string, (n: number) => string]> = [
    // No ">" ANYWHERE, so `[^>]*` backtracked to end of input from every start.
    ["heading, no '>' at all", (n) => underClamp(repeatTo("<h1", n))],
    ["list item, no '>' at all", (n) => underClamp(repeatTo("<li", n))],
    // The adversarial case for the walks NESTED inside one rendered table.
    ["table rows, never closed", (n) => underClamp(`<table>${repeatTo("<tr", n - 15)}</table>`)],
    ["table cells, never closed", (n) => underClamp(`<table><tr>${repeatTo("<td", n - 24)}</tr></table>`)],
  ];

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it.each(QUADRATIC_ROWS)(
    "bounds processing time on unterminated tags that the pair-regex steps walked quadratically: %s",
    { timeout: 120_000 },
    (label, build) => {
      expectLinearScaling({ label, build, run: extractHtmlMarkdown, check: emptyDoc, n: 31_250 });
    },
  );

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("bounds processing time on a trailing unterminated tag far from any '>'", { timeout: 120_000 }, () => {
    // (keep today's explanation of `<[^>]*$` here)
    expectLinearScaling({
      label: "trailing open tag",
      // Today's 100,000 opens over 500,000 chars is one fifth; keep that
      // proportion at both sizes.
      build: (n) => {
        const opens = "<".repeat(n / 5);
        return underClamp(`${opens}${"x".repeat(n - opens.length - 1)}>`);
      },
      run: extractHtmlMarkdown,
      // Nothing is strippable here, so the run survives as text; the point is
      // only that the function got far enough to return it. Half of the size
      // being checked, not of CLAMP_CHARS.
      check: (out, n) => expect(out.length).toBeGreaterThan(n / 2),
      n: 31_250,
    });
  });
  ```

  The test NAME of the 4-row test keeps today's text as its prefix, so §593's quotation of it still finds it.

- [ ] **Step 3: Run green, measure, then mutation-prove**

Run: `npx vitest run src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 2 passed`. Record each site's green ratio (temporarily log `expectLinearScaling`'s return value, then remove the log). Check the 1.5 s budget with one extra run using `--reporter=json --outputFile=<workspace>/durations.json` in place of `--reporter=dot`, and read each converted test's `duration`. The budget is a target: a test over it may take a smaller `n` only if its mutant ratio stays at least 12 there; otherwise it keeps the `n` the red margin needs, and you record the green time and flag it (Global Constraints).

Mutants (follow the Mutant procedure section, with its 120 s kill wrapper):
- `tag-pair-walk` retired-name site: swap the two checks inside `forEachTagPair` so the `indexOf(">", ...)` scan runs before the `closeRe === null` check. Expected red on the ratio, near 16 and at least 12 (today's comment measured ~5.4 ms vs ~433 ms between the orderings at 80,000; the swapped ordering is the O(n^2) walk).
- the three 250 ms sites: the mutant each site's comment names.
- `html-extract`, each of the 5 fixtures: revert the linear walk it guards to the regex it replaced (the MARGIN docstring says each was taken by reverting a fix; `git log -S 'repeatTo("<li"' -- src/app/html-extract.test.ts` finds the commit). Expected red on the ratio, at roughly the ratios given in Step 2, and at least 12 (red margin). At `n` 31,250 each mutant test costs about 7–10 s (warm-up and probe at `n`, then 3 × (small + large)), plus a few seconds of vitest startup and collection; with `-t` the file's other tests do not run.

Record every green and red ratio in the site comments.

- [ ] **Step 4: Load check**

Run the two files under the burn (see "Peer protocol and load check"). Expected: EXIT=0, and the report records the idle and under-burn reference times and the slowdown factor.

- [ ] **Step 5: Gates**

`npx tsc --noEmit` → 0 total errors; `npx eslint --max-warnings=0 src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts` → 0; line endings unchanged (`git ls-files --eol` matches the pre-edit value).

- [ ] **Step 6: Commit**

```
test: §592 §593 — tag-pair-walk and html-extract timing guards use a scaling ratio
```
`git commit --only src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts -F <msgfile>` (after `git add` of those two paths).

---

### Task 3: Office extractors — `docx`, `xlsx`, `pptx`, `office-xml`

**Files:**
- Modify: `src/app/docx-extract.test.ts` (2 sites, both `toBeLessThan(1000)`)
- Modify: `src/app/xlsx-extract.test.ts` (6 sites / 8 executions today, all `toBeLessThan(1000)`: 5 sites / 7 executions convert to a ratio; the XFD site drops its timing and keeps its exact output assertion)
- Modify: `src/app/pptx-extract.test.ts` (1 site)
- Modify: `src/app/office-xml.test.ts` (1 site)

**Interfaces:**
- Consumes: `expectLinearScaling` from `../test/scaling`.

- [ ] **Step 1: Convert each site**

Add `import { expectLinearScaling } from "../test/scaling";` to each file. The pattern, shown complete for `docx-extract`'s `<w:pStyle` site (its file already has the `entries(documentXml)` helper); every other site follows the same shape with its own fixture, function and output:

```ts
  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on unclosed <w:pStyle opens inside one paragraph", { timeout: 120_000 }, () => {
    // (keep the WHY from today's comment; the ms figures become the green and
    // red ratios measured in Step 3)
    expectLinearScaling({
      label: "unclosed <w:pStyle opens",
      // Untimed: the fixture INCLUDING its TextEncoder step and entries Map.
      build: (n) =>
        entries(
          "<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r>" +
            "<w:pStyle ".repeat(n) +
            "</w:p></w:body></w:document>",
        ),
      run: extractDocx,
      // The paragraph's one run survives the unclosed opens. Confirm this
      // literal on green code first and pin whatever the true output is.
      check: (out) => expect(out).toBe("x"),
      n: 10_000,
    });
  });
```

`docx-extract.test.ts`'s `<w:tbl` site is declared `async` today, though its body awaits nothing; the converted test can drop `async`. Read the body first and keep `async` if anything is awaited.

Sizes — today's N becomes the LARGE size; the starting `n` is N / 4:

| File | Site (test name) | Today's N | Starting `n` |
|---|---|---|---|
| `docx-extract` | "does not blow up on repetitive unclosed markup" (`<w:tbl ` opens) | 120,000 | 30,000 |
| `docx-extract` | "does not blow up on unclosed <w:pStyle opens inside one paragraph" | 40,000 | 10,000 |
| `xlsx-extract` | "does not blow up on repetitive unclosed markup" (`<c ` opens) | 320,000 | 80,000 |
| `xlsx-extract` | "does not blow up on unclosed <sheet opens in workbook.xml" | 80,000 | 20,000 |
| `xlsx-extract` | "does not blow up on unclosed <sheet and <Relationship opens with no '>' at all" (both files scale together) | 40,000 | 10,000 |
| `xlsx-extract` | "does not blow up on many unclosed <v> inside one cell" | 160,000 | 40,000 |
| `xlsx-extract` | "stays linear on quoted names, unclosed quotes and opens inside one tag" (3 rows) | 80,000 each | 20,000 each |
| `pptx-extract` | "does not blow up on repetitive unclosed markup" (`<a:p ` opens) | 120,000 | 30,000 |
| `office-xml` | "does not blow up on repetitive unclosed markup" (`<t ` opens, `extractRuns`) | 100,000 | 25,000 |

The "smaller sizes were unreliable" notes in these files sized a margin over a 1000 ms CEILING, not a ratio. Their own measurements show the mutant quadratic already dominating at these starting sizes — for example the `xlsx-extract` no-cache mutant is 195 ms at 80,000 against 3783 ms at 320,000, a ratio near 19 — so they do not forbid a smaller `n`. The mutant ratio at the new sizes is what decides (Global Constraints).

**The XFD site** ("drops a cell whose column is past Excel's last (XFD) instead of padding out to it") has no size axis: its fixture is a fixed four-cell row, and the regression it guards exhausts memory rather than growing with an N. Delete its `start` line and its `toBeLessThan(1000)` line, keep `expect(out).toBe("## Sheet: Sheet1\n\n| 1 | 2 |\n| --- | --- |")` unchanged, and replace the timing wording in its comment with the mutant results below. Do not invent an N for it. It gets no `{ timeout }`, since it is no longer a timing test.

`check`: run each converted site once on green code to learn its true output, then pin something specific to the fixture. "Is truthy" and "length > 0" do not count. The one looped site here, "stays linear on quoted names, unclosed quotes and opens inside one tag", ALWAYS splits into `it.each`, one row per test, whatever its green time: its three rows share one mutant family (the sheet-name read), so the mutant procedure's `-t` must be able to select one row, and a kill must be attributable to that row. Give each row a short label and name the test `"stays linear on quoted names, unclosed quotes and opens inside one tag: %s"`. (This is stricter than the Global Constraints rule, which splits a loop only when it would exceed the budget; the `-t` need decides it here.)

`run` must be stateless across calls (see the `run` docstring in `src/test/scaling.ts`): the extractors take a `Map` they only read, which is fine; confirm it for each function by reading it once.

Rewrite each measurement comment: ms figures out, green and red ratios in, with the date. The "N-doubling" series in `docx-extract`/`xlsx-extract` comments can stay as historical evidence, marked as measured on the date it was, but the assertion text must describe the ratio.

- [ ] **Step 2: Run green and measure**

`npx vitest run src/app/docx-extract.test.ts src/app/xlsx-extract.test.ts src/app/pptx-extract.test.ts src/app/office-xml.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 4 passed`. Record each green ratio. Check the 1.5 s-per-`it` budget with the JSON-reporter run described in Task 2 Step 3.

- [ ] **Step 3: Mutation-prove each site** (Mutant procedure, with its 120 s kill wrapper). Record red ratios, or "killed at 120 s", in the comments. The lazy-regex mutants are the slowest: `docx-extract`'s measured ~24.4 s at 120,000 and `xlsx-extract`'s ~24 s at 320,000, so at the starting sizes the selected test alone costs roughly 80 s (warm-up and probe at `n`, then 3 × (small + large)), plus a few seconds of vitest startup and collection — `-t` keeps the file's other tests from running. That still finishes inside the kill, but with little room; a kill is red, and the site then follows Mutant procedure step 2 (a smaller `n` if it still reaches 12, else record "killed at 120 s" and flag it). For the XFD site, run two mutants against the unchanged output assertion: (a) change `if (idx >= MAX_XLSX_COLUMNS) return true;` in `src/app/xlsx-extract.ts` to `if (idx > MAX_XLSX_COLUMNS) return true;` — `XFE1` (index 16,384) is then padded out to and kept, so the row renders 16,385 cells and the assertion goes red at once; (b) delete that line — the `ZZZZZZZ1` cell pads toward ~8e9 columns and the run dies of memory or is killed at 120 s. Both count as red; record which happened.

- [ ] **Step 4: Load check** — the four files under the burn (see "Peer protocol and load check"). EXIT=0, with the reference times and slowdown factor recorded.

- [ ] **Step 5: Gates** — `npx tsc --noEmit` → 0 total errors; `npx eslint --max-warnings=0` on the four files → 0; line endings unchanged.

- [ ] **Step 6: Commit**

```
test: office extractor timing guards use a scaling ratio (§592, §593 class)
```
`git commit --only` the four files.

---

### Task 4: `rich-text-plain`, `document-asset-patterns.differential`, `raid-escalation`

**Files:**
- Modify: `src/app/rich-text-plain.test.ts` (4 sites / 6 executions: one looped over rows under `CEILING_MS`, three `toBeLessThan(2000)`)
- Modify: `src/app/document-asset-patterns.differential.test.ts` (2 sites / 7 executions under `CEILING_MS`; one row sized to `MAX_HTML_TEXT_CHARS`)
- Modify: `src/app/raid-escalation.test.ts` (1 site, `toBeLessThan(1000)`; default limit, no `maxRatio`)

**Interfaces:**
- Consumes: `expectLinearScaling` from `../test/scaling`.

- [ ] **Step 1: Convert `rich-text-plain.test.ts`**

Add `import { expectLinearScaling } from "../test/scaling";`. Today's size becomes the LARGE size; the starting `n` is a quarter of it:

| Site | Today's size | Starting `n` |
|---|---|---|
| `htmlPlainProjection` — complexity, 3 looped rows (`<a`, `<p`, `<li`), one `it` per row already | 128 KB | 32 KB |
| `markTaskItems` — "stays bounded on unterminated list-item openers" | 128 KB | 32 KB |
| `markTaskItems` — "stays bounded on unterminated openers that carry the taskItem attribute" | 512 KB | 128 KB |
| `degradeToPlain` — "stays bounded on an unterminated <img carrying repeated ids" | 256 KB | 64 KB |

The ★★★ notes that 128 KB and 256 KB were "not enough" measured the mutant against a 2000 ms CEILING. Their own tables settle the ratio question: the guard-deleted `<img>` pattern is 844 ms at 64 KB against 18,321 ms at 256 KB (ratio about 22) while the guarded one is 0.6 → 1.4 ms, and the taskItem mutant is 303 ms at 131 KB against 10–15 s at 512 KB. Rewrite those notes to say what the sizes now rest on — the mutant's RATIO at the new sizes — keeping the lesson they record ("size a guard by the mutant's margin, never by the shipped column"), which still holds. Delete `CEILING_MS` once nothing reads it. Output checks: specific to each fixture (for example, the exact plain text a fixture reduces to), learned by running on green code once. Each site passes the hang backstop.

- [ ] **Step 2: Convert `document-asset-patterns.differential.test.ts`**

Add `import { expectLinearScaling } from "../test/scaling";`. The ADVERSARIAL rows already run one `it` per row; keep that. Sizes: the five rows sized by `BYTES` (256 KB today) start at `n` = 64 KB; the "<img with N data-asset-id, unterminated" row keeps `MAX_HTML_TEXT_CHARS` (20,000) as its LARGE size, so `n` = 5,000; the separate "IMG_TAG_ASSET_ID_RE is linear on an unterminated <img carrying repeated ids" test (256 KB today) starts at `n` = 64 KB. The `MAX_HTML_TEXT_CHARS` row's `build` asserts `input.length <= MAX_HTML_TEXT_CHARS` — not a vacuity guard (the timed regexes run on the raw input; there is no clamp to cross), but a pin that keeps the row at the "real exposure" size its comment names. Keep the "A PATTERN-LEVEL BOUND, DELIBERATELY SEPARATE FROM THE ROWS" explanation, and replace its ms series with ratios. Delete `CEILING_MS` once unused, and rewrite the `BYTES` ★★ note (it argued for 256 KB over 1 MB on failure legibility against the 20 s timeout, which the ratio and the 120 s backstop now carry). Each row passes the hang backstop (`it(\`stays bounded on ${label}\`, { timeout: 120_000 }, () => …)`). **`run` must be stateless (M4):** today's timed block for the rows calls `ASSET_IMG_TEST_RE.test(input)`, then resets `ANY_TAG_ASSET_ID_RE.lastIndex = 0` and runs `matchAll` over `ANY_TAG_ASSET_ID_RE` and `IMG_TAG_ASSET_ID_RE`. Move all four statements into `run` unchanged, the `lastIndex` reset included, since `ANY_TAG_ASSET_ID_RE` is a global (`/g`) regex and `run` now executes many times on one input. `ASSET_IMG_TEST_RE` is non-global (`/i`), so its `.test` leaves no state behind, and `matchAll` clones the regex it is given.

- [ ] **Step 3: Convert `raid-escalation.test.ts`**

Add `import { expectLinearScaling } from "../test/scaling";`. The shipped path is LINEAR in the name's length, not flat: `stripBreakTagsWithin` searches the 200-character head for `TRAILING_BREAK_PREFIX`, finds a cut at 0 on this fixture, and the sticky `BREAK_TAG_AT` then scans the FULL raw value once from that position. So this site takes the DEFAULT limit (8), with no `maxRatio`:

```ts
  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on a huge stored toName full of unclosed <br opens", { timeout: 120_000 }, () => {
    // BREAK_TAG's `\s*` and `[^>]*` backtrack to the end of the value from
    // every start, so stripping BEFORE the length cap was quadratic. The
    // shipped code clamps first; the one anchored scan left over the full
    // value keeps it linear. (Green and red ratios, with the date, go here.)
    expectLinearScaling({
      label: "unclosed <br opens in toName",
      build: (n) => "<br ".repeat(n),
      run: (toName) => sanitizeRaidEscalations([{ ...NOTIFY, toName }]),
      check: (out) => {
        expect(out).toHaveLength(1);
        expect(out[0].toName!.length).toBeLessThanOrEqual(RAID_ESCALATION_NAME_MAX);
      },
      n: 20_000,
    });
  });
```

Today's N (80,000 repeats) is the large size. The green side is well under the floor and is looped up to it. `run` is stateless: `BREAK_TAG_AT.lastIndex` is set before every use. The mutant is the exact pre-fix code from `ee584d716` ("fix(raid): bound stripBreakTags by NAME_MAX on the load path"), which changed `sanitizeEntry`'s `stripBreakTags(o.toName).slice(0, NAME_MAX)` into `stripBreakTagsWithin(o.toName, NAME_MAX)`: in `stripBreakTagsWithin` (`src/app/raid-escalation.ts`), replace its body with `return stripBreakTags(raw).slice(0, max);` — strip the full value, then slice. Keep the slice: without it the output `toName` stays ~80,000 characters, `check` fails on the untimed warm-up, and the test goes red without ever measuring a ratio. With it, `check` passes (`BREAK_TAG` never matches a `<br` with no `>`, so the stripped value is the trimmed input, cut to exactly 200 characters) and only the ratio can fail. `BREAK_TAG`'s `\s*` and `[^>]*` backtrack to the end of the value from every start, so the mutant is quadratic: expect a red ratio of about 16 (a node replica of the mutant measured 15.6 at 2,500 → 10,000 repeats and 15.9 at 5,000 → 20,000, revision 2026-09-19; today's comment says "~4x per doubling"). At `n` = 20,000 the mutant's small run costs about 1 s and its large run about 15.6 s (today's comment), so the selected test takes roughly 50 s, plus a few seconds of vitest startup and collection, and finishes inside the kill.

- [ ] **Step 4: Run green, measure, mutation-prove, load check**

`npx vitest run src/app/rich-text-plain.test.ts src/app/document-asset-patterns.differential.test.ts src/app/raid-escalation.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 3 passed`. Check the 1.5 s budget with the JSON-reporter run from Task 2 Step 3. Then mutants per the Mutant procedure, with its 120 s kill wrapper (the `rich-text-plain` and `document-asset-patterns` comments name theirs), then the three files under the burn, recording the reference times and slowdown factor.

- [ ] **Step 5: Gates** — `npx tsc --noEmit` → 0 total errors; eslint on the three files → 0; line endings unchanged. Then confirm no ceiling is left anywhere:

```bash
git grep -nE "performance\.now\(\)|Date\.now\(\)" -- "src/**/*.test.ts" "src/**/*.test.tsx"
```
Expected: no hit that compares a duration against a fixed number. This pathspec cannot match `src/test/scaling.ts` (not a `.test.ts` file); `src/test/scaling.test.ts` matches but uses a fake clock. The known non-ceiling hits today are `reminder-snooze.test.ts`, `use-reminder-snooze.test.tsx` and `use-toast.test.ts` (`Date.now()` as a timestamp or in a comment), `view-ai-digest.test.ts` (comments), and `use-drag-autoscroll.test.tsx` (`performance.now()` passed as a frame timestamp). List every hit in the report and say why each is not a ceiling.

- [ ] **Step 6: Commit**

```
test: rich-text-plain, document-asset-patterns and raid-escalation timing guards use a scaling ratio (§592, §593 class)
```
`git commit --only` the three files.

---

### Task 5: Register and CONTRIBUTING

**Files:**
- Modify: `docs/open-followups.md` (LF) — §592, §593 entries and their two index rows
- Modify: `CONTRIBUTING.md` — the "Unit + component tests — Vitest" subsection of "## Testing"

- [ ] **Step 1: Close §592 and §593**

For each entry, following the closed-entry format §567 uses:
- Heading: replace `— OPEN` with `— CLOSED 2026-09-19`.
- Replace the `**Status:**` paragraph with: `**Status:** CLOSED 2026-09-19 by \`docs/timing-flake-592-593\`: ` followed by one or two sentences saying what now holds — the site uses `expectLinearScaling` (`src/test/scaling.ts`), its green and red ratios as recorded in the test comment, that it carries a 120 s hang backstop in place of the 20 s default, and that it stayed green under the burn with the MEASURED slowdown factor from the task report (quote the factor; do not write "saturated" without it).
- **§592 only — correct the "~80x gap" framing in its Status.** §592's fix shape says the fix "must not shrink the ~80x ordering gap". That gap was an ABSOLUTE-time gap between the two orderings at one size (~5.4 ms vs ~433 ms at 80,000), which is what a ceiling needed. The ratio guard does not use it: it separates the orderings by how their cost GROWS from 20,000 to 80,000, about 4× for the shipped ordering against the measured mutant ratio for the swapped one, which must be at least 12. The Status says this in one sentence with the two measured ratios, so no reader takes the unchanged "~80x" line in the original body as the property the test now holds. Leave the original body itself untouched.
- Delete the `**Work item:** #376` / `#377` line. A closed entry must not carry one.
- Insert, directly after the Status paragraph: `_Original finding, as filed 2026-09-19. Preserved as the dated record; see Status._`
- Leave the original body untouched.
- §593's body links to §592 by anchor. Update that link to §592's new anchor: `#592-the-50-ms-wall-clock-ceiling-in-tag-pair-walktestts-can-fail-a-correct-build-under-load--closed-2026-09-19`.

Index rows (between the real INDEX markers, not the fenced sample): each row has five cells, and three of them change, matching the §567 row (`| [§567](#567-…--closed-2026-09-19) | … — CLOSED 2026-09-19 | slice (2026-09) | M | **CLOSED** 2026-09-19 |`):
- the anchor ends `--closed-2026-09-19` in place of `--open`: §592's becomes `#592-the-50-ms-wall-clock-ceiling-in-tag-pair-walktestts-can-fail-a-correct-build-under-load--closed-2026-09-19`, §593's becomes `#593-html-extracts-8000-ms-dos-budget-test-failed-at-8301-ms-under-a-saturated-full-suite-run--closed-2026-09-19`;
- the title cell ends `— CLOSED 2026-09-19` in place of `— OPEN`;
- the LAST cell, today `open`, becomes `**CLOSED** 2026-09-19`. No gate compares this cell (`followups:index:check` compares §-number sets only), so a stale `open` would ship silently — check it by hand in Step 3.

- [ ] **Step 2: CONTRIBUTING line**

In "Unit + component tests — Vitest", add one bullet:

```markdown
- Timing guards (a test that fails when code turns quadratic or backtracks) use `expectLinearScaling` from `src/test/scaling.ts`, never `elapsed < CEILING_MS` — a fixed ceiling fails a correct build on a loaded machine. It requires an output `check` at both sizes, and the test passes `{ timeout: 120_000 }` as a hang backstop, because vitest checks a synchronous test's timeout only after it returns.
```

- [ ] **Step 3: Gates**

Each redirected to a log, then `echo "EXIT=$?"`, all EXIT=0:
`npm run followups:index:check`, `npm run followups:status:check`, `npm run followups:workitems:check`, `npm run docs:claims:check`, `npm run docs:symbols:check`, `npm run docs:scripts:check`. Then:
- `git ls-files --eol docs/open-followups.md` stays `w/lf`;
- `grep -c "#592-.*--open\|#593-.*--open" docs/open-followups.md` prints 0;
- `grep -cE '^\| \[§59[23]\].*\| \*\*CLOSED\*\* 2026-09-19 \|$' docs/open-followups.md` prints 2 — both index rows end with the CLOSED status cell. (Before the edit it prints 0, and the same pattern with `§567` prints 1, so it can match.)

- [ ] **Step 4: Commit**

```
docs(register): close §592 and §593 — timing guards use a scaling ratio
```
`git commit --only docs/open-followups.md CONTRIBUTING.md -F <msgfile>`. No "Closes" line and no `#376`/`#377` in the commit message — those go only in the MR description.

The GitLab issues #376 and #377 are closed by the MR description's `Closes` lines at release, and verified closed after merge. Not in this task.

---

## Review dispositions

The plan review (2026-09-19) raised ten Minors. All ten were verified against the tree and applied; none was rejected.

- M1 (tag-pair-walk sample pushed a `TagPair` into `string[]`) — applied: Task 2 Step 1 pushes `pair.inner`.
- M2 (html-extract is 2 sites → 5 executions, total 35) — applied in the spec inventory, with the XFD change giving 22 sites / 34 executions converted.
- M3 (cold first call calibrates) — applied: one untimed warm-up run, which also carries the small-size check.
- M4 (`run` must be stateless) — applied: `run` docstring, and per-task notes in Task 4 (Step 3: raid's sticky regex resets `lastIndex`; Step 2: the `ANY_TAG_ASSET_ID_RE.lastIndex = 0` reset moves into `run`, and `ASSET_IMG_TEST_RE` is non-global). The Step 2 note was missing in the first revision and was added after the re-review.

## Re-review dispositions (scoped re-review of 81a161bda)

- N1 — applied: the raid mutant is the exact pre-fix hunk from `ee584d716`, `stripBreakTags(raw).slice(0, max)`; it passes `check`, and the expected red ratio is about 16.
- N2 — applied: the kill wrapper passes `-t` with an escaped, `$`-anchored exact title, and requires a one-test `Tests` line.
- N-m2 — applied: the 3-row `xlsx-extract` site always splits into `it.each`, because of `-t`.
- N-m3 — applied as ruled: a mutant ratio of at least 12 wins over the 1.5 s budget, and `n` is raised until it gets there. Stated once in Global Constraints.
- N-m4 — applied: a mutant ratio under 12 is a survivor, and §592's Status reframes the "~80x" gap.
- N-m5 — applied: the mutant run-time estimates add vitest startup and collection, and state that `-t` skips the other tests.
- N-m1 — applied (see M4 above).
- M5 (the `MAX_HTML_TEXT_CHARS` row has no clamp in the timed code) — applied: Review Focus 6 and Task 4 Step 2 give that pin its real purpose.
- M6 (new `src/test` files will not come out CRLF) — applied: the CRLF requirement for the two new files is dropped.
- M7 (Task 4 Step 5 pathspec cannot match `src/test/scaling.ts`) — applied, with the known non-ceiling hits listed.
- M8 (helper mutant 4 ambiguous) — applied: every helper mutant is now an exact edit.
- M9 (the burn can fail a peer's run) — applied: "starting load burn" / "load burn done" messages.
- M10 (suite runtime grows) — applied through the scale-down and `repeats` 3; the spec's Cost paragraph gives the arithmetic.
