# Timing Guards: Scaling Ratio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every unit-test wall-clock ceiling with a load-independent scaling-ratio check, so machine load can no longer fail a correct build while each guard still goes red on the regression it exists for.

**Architecture:** One helper, `expectLinearScaling` in `src/test/scaling.ts`, times the code under test at `n` and `n * factor`, interleaved, keeps each size's minimum, and asserts the ratio is below `maxRatio`. It requires an output check at both sizes. Nine test files move onto it; no production code changes.

**Tech Stack:** TypeScript, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-09-19-timing-guards-scaling-ratio-design.md`

## Global Constraints

- No production code changes. A guard found vacuous by its mutant proof is filed in the register, not fixed here.
- Defaults: `factor = 4`, `repeats = 5`, `maxRatio = factor ** 1.5` (8 at factor 4). Timer floor 20 ms.
- The output `check` is mandatory at every call site, and it must be specific to the fixture — "is non-empty" does not count.
- Scaling direction: DOWN from a clamp (`html-extract`, the `MAX_HTML_TEXT_CHARS` row of `document-asset-patterns.differential`); UP from today's N where a comment records smaller sizes as unsafe (`rich-text-plain`, `xlsx-extract`, `docx-extract`, `pptx-extract`); elsewhere today's N becomes the LARGE size.
- `raid-escalation`: `factor: 4, maxRatio: 2`.
- Comments record the green and red RATIOS measured during conversion, with the date (2026-09-19 or the day measured). Old ms figures are removed. "DoS guard, not a benchmark" banners stay.
- Each `it` must stay under 10 s green on the development machine (half the 20 s `testTimeout`). A fixture-row loop whose rows together would exceed that becomes `it.each`, one row per test, named by the row label.
- vitest: `npx vitest run <files> --maxWorkers=1 --reporter=dot`. Never two vitest processes at once. Never read an exit code through a pipe: redirect to a log, `echo "EXIT=$?"`, then read the log.
- Keep each file's existing line endings. Check with `git ls-files --eol <file>` before and after editing: a file that is `w/crlf` stays CRLF, a file that is `w/lf` stays LF. `src/test/*.ts` is CRLF.
- Git: never `git add -A` or `git add .`; commit with `git commit --only <paths> -F <msgfile>`. Never `--amend`, never a bare `git stash`, never `npm ci`. `git checkout --` and `git restore` are blocked; revert a mutant by writing the original bytes back and proving `git diff --stat` is empty for that file.
- Commit messages cite §N, never `#NN` or "Closes". End every commit message with the line `Claude-Session: https://[session link removed]`.
- Never open, print or stage any `.env*` file.
- Implementers never dispatch subagents.

## Review Focus

1. **A fast CI machine makes the small side sub-millisecond.** Expected: the helper loops the call up to the 20 ms floor and still produces a meaningful ratio, not a noise ratio. Pinned in Task 1 ("loops a sub-floor small side...").
2. **Fixture building is slow compared with the call.** Expected: build time never enters the ratio. Pinned in Task 1 ("does not time build").
3. **A load spike lands on one measurement.** Expected: a linear curve still passes. Pinned in Task 1 ("ignores one spike").
4. **A regression bails early at the large size only.** Expected: `check` at the large size fails the test. Pinned in Task 1 ("runs check at both sizes").
5. **A large size that crosses a clamp makes the guard vacuous** (both sizes do the same work, ratio ≈ 1, passes whatever the code does). Expected: each clamp-bound site asserts its large input does not exceed the clamp. Pinned in Task 2 (`html-extract`) and Task 4 (`document-asset-patterns` row).

## Peer protocol and load check (all tasks that run vitest)

The controller sends "starting vitest" to the peer session before dispatching a task that runs vitest, and "vitest done" after the task reports. An implementer takes timing measurements (mutant ratios, load check) only inside that window.

Load check script — create it once in the SDD workspace (NOT in the repo) as `burn.mjs`:

```js
// Saturates every core for N seconds, then exits by itself.
import { Worker } from "node:worker_threads";
import os from "node:os";
const secs = Number(process.argv[2] ?? 120);
const code = `const end = Date.now() + ${secs} * 1000; while (Date.now() < end) {}`;
for (let i = 0; i < os.cpus().length; i++) new Worker(code, { eval: true });
```

Run it in the background (`node <workspace>/burn.mjs 180 &`), then run the converted file's vitest while it burns. It exits on its own; nothing needs to be killed. Record in the report that the file stayed green under the burn.

## Mutant procedure (Tasks 2–4)

For each converted call site:

1. Find the regression it guards. First from the site's own comment. If the comment does not name it, run `git log -S '<a distinctive fixture string>' --oneline -- <test file>` to find the commit that added the guard, and read that commit's change to the SOURCE file — the mutant is reverting that source hunk.
2. Apply the mutant to the source file, run only that test file, and record: red or green, and the printed ratio, or "timeout" if it hit 20 s.
3. Write the original bytes back and confirm `git diff --stat -- <source file>` prints nothing.
4. A mutant that survives (stays green) is NOT a reason to loosen the ratio. Stop and report it as `DONE_WITH_CONCERNS`, with the ratio numbers.

Mutants run one at a time. The report ends with `git diff --stat` showing only the intended files.

---

### Task 1: The scaling helper

**Files:**
- Create: `src/test/scaling.ts` (CRLF)
- Test: `src/test/scaling.test.ts` (CRLF)

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

/** A fake clock the fake workload advances. `cost(n)` is the ms one run costs at size n. */
function fakeWorkload(cost: (n: number) => number) {
  const clock = { t: 0 };
  return {
    now: () => clock.t,
    build: (n: number) => n,
    run: (n: number) => {
      clock.t += cost(n);
      return n;
    },
  };
}

describe("measureScaling", () => {
  it("passes a linear curve", () => {
    const w = fakeWorkload((n) => n / 1000);
    const r = expectLinearScaling({ label: "linear", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
    expect(r.nLarge).toBe(400_000);
  });

  it("fails a quadratic curve, naming both minima and the ratio", () => {
    const w = fakeWorkload((n) => (n / 1000) ** 2 / 100);
    expect(() =>
      expectLinearScaling({ label: "quad", ...w, check: () => {}, n: 100_000 }),
    ).toThrow(/quad: small n=100000 .*ms, large n=400000 .*ms, ratio 16\.00 \(max 8\)/);
  });

  it("ignores one spike on the small side", () => {
    let calls = 0;
    const w = fakeWorkload((n) => {
      calls += 1;
      // Call 1 is the calibration probe (100 ms, already above the floor, so no
      // extra calibration calls); call 2 is repeat 0's SMALL run. Make it 50x slower.
      return calls === 2 ? (n / 1000) * 50 : n / 1000;
    });
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("ignores one spike on the large side", () => {
    let calls = 0;
    const w = fakeWorkload((n) => {
      calls += 1;
      // Call 3 is repeat 0's LARGE run.
      return calls === 3 ? (n / 1000) * 50 : n / 1000;
    });
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
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
    const w = fakeWorkload(() => 25); // flat: clamped input
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
import { expect } from "vitest";

/** A small side cheaper than this is looped until it reaches it, so the ratio is not timer noise. */
export const TIMER_FLOOR_MS = 20;
const MAX_LOOPS = 1 << 16;

export interface ScalingOptions<I, O> {
  /** Names the site in the failure message. */
  label: string;
  /** Builds the fixture at size n. Never timed. */
  build: (n: number) => I;
  /** The code under test. Timed. */
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
  const repeats = opts.repeats ?? 5;
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

  // Calibrate the loop count on the small side; check its output once.
  let loops = 1;
  let probe = time(small, loops);
  opts.check(probe.out, opts.n);
  while (probe.ms < TIMER_FLOOR_MS) {
    if (loops >= MAX_LOOPS) {
      throw new Error(
        `${opts.label}: ${loops} runs at n=${opts.n} took ${probe.ms.toFixed(3)}ms, below the ${TIMER_FLOOR_MS} ms floor — use a larger n`,
      );
    }
    loops *= 2;
    probe = time(small, loops);
  }

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

Call order the spike tests depend on: the calibration probe is call 1 (at `n/1000` = 100 ms it is already above the floor, so no further calibration calls); then each repeat runs small, then large. Call 2 is repeat 0's small run, call 3 its large run. If you change the calibration or repeat order, update the two spike tests' indices to match.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/test/scaling.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 1 passed`, 11 tests passed.

- [ ] **Step 5: Mutation-prove the helper**

Apply each mutant alone, run the file, confirm red, restore, confirm `git diff --stat -- src/test/scaling.ts` is empty:
1. Replace `Math.min` with the LAST measurement (`smallMs = time(small, loops).ms`, same for large) → a spike test goes red.
2. Delete the `if (r === 0) opts.check(l.out, nLarge);` line → "fails when check throws at the large size only" goes red.
3. Change `while (probe.ms < TIMER_FLOOR_MS)` to `while (false)` → the sub-floor test goes red.
4. Move `const small = opts.build(opts.n);` inside `time` so build is timed → "does not time build" goes red.

- [ ] **Step 6: Gates**

`npx tsc --noEmit > <log> 2>&1; echo "EXIT=$?"` → 0 total errors. `npx eslint --max-warnings=0 src/test/scaling.ts src/test/scaling.test.ts; echo "EXIT=$?"` → 0. `git ls-files --eol src/test/scaling.ts src/test/scaling.test.ts` → `w/crlf` for both after `git add`.

- [ ] **Step 7: Commit**

Message file:
```
test: add expectLinearScaling, a load-independent timing guard (§592, §593)

Claude-Session: https://[session link removed]
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

For each of the 4 sites, replace the `performance.now()` pair and the ceiling with `expectLinearScaling`. Today's N becomes the LARGE size, so `n` is today's repetition count divided by 4. The retired-name site becomes:

```ts
    expectLinearScaling({
      label: "retired-name lookups",
      build: (n) => "<w:tbl".repeat(n) + ">",
      run: (input) => {
        const seen: string[] = [];
        forEachTagPair(input, SPEC, (pair) => {
          seen.push(pair);
          return true;
        });
        return seen;
      },
      // No open ever finds its close, so nothing is yielded.
      check: (seen) => expect(seen).toEqual([]),
      n: 20_000,
    });
```

Adapt `run`/`check` to each site's actual callback signature and to what that fixture really yields — read the callback type in `tag-pair-walk.ts` first, and run the site once on green code to learn the true output before pinning it. Rewrite each site's measurement comment: keep the explanation of WHY the ordering matters, and replace the ms figures with the green and red ratios you measure (Step 3).

- [ ] **Step 2: Convert `html-extract.test.ts`**

- Delete `DOS_BUDGET_MS` once nothing reads it. Keep `CLAMP_CHARS` and `repeatTo`. Keep the ★★★ banner above the tests. Rewrite the MARGIN docstring as a ratio table (green → red per fixture, with the date), keeping its ★★ note about `TAG_STRIP_RE`'s constant.
- Replace `timeExtract` with `expectLinearScaling` calls. Scale DOWN: the large size is today's size (at the clamp), `n` is a quarter of it (125,000). `build` takes the character count:
  ```ts
  // rows 1–2 (and the same with "<li")
  build: (n) => repeatTo("<h1", n),
  // rows 3–4 keep their wrapper arithmetic
  build: (n) => `<table>${repeatTo("<tr", n - 15)}</table>`,
  build: (n) => `<table><tr>${repeatTo("<td", n - 24)}</tr></table>`,
  // trailing-tag test: today's 100,000 opens over 500,000 chars is one fifth;
  // keep that proportion at both sizes.
  build: (n) => {
    const opens = "<".repeat(n / 5);
    return `${opens}${"x".repeat(n - opens.length - 1)}>`;
  },
  ```
- `check`: rows 1–4 keep `expect(out).toBe("_(document contained no extractable text)_")`. The trailing-tag test keeps `expect(out.length).toBeGreaterThan(n / 2)` — note it becomes `n / 2` of the size being checked, not `CLAMP_CHARS / 2`.
- **Clamp pin (Review Focus 5):** each `build` asserts it never exceeds the clamp, so a later edit cannot push the large size past it and make both sizes do identical work:
  ```ts
  const input = repeatTo("<h1", n);
  expect(input.length).toBeLessThanOrEqual(CLAMP_CHARS);
  return input;
  ```
- The 4-row test: if the rows together exceed 10 s green, convert it to `it.each(cases)("bounds processing time: %s", ...)`. The failure label is the row label.

- [ ] **Step 3: Run green, measure, then mutation-prove**

Run: `npx vitest run src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 2 passed`. Record each site's green ratio (temporarily log `expectLinearScaling`'s return value, then remove the log).

Mutants (follow the Mutant procedure section):
- `tag-pair-walk` retired-name site: swap the two checks inside `forEachTagPair` so the `indexOf(">", ...)` scan runs before the `closeRe === null` check. Expected red.
- the three 250 ms sites: the mutant each site's comment names.
- `html-extract`, each of the 5 fixtures: revert the linear walk it guards to the regex it replaced (the MARGIN docstring says each was taken by reverting a fix; `git log -S 'repeatTo("<li"' -- src/app/html-extract.test.ts` finds the commit). Expected red, on the ratio or by timeout.

Record every green and red ratio in the site comments.

- [ ] **Step 4: Load check**

Run the two files under `burn.mjs` (see "Peer protocol and load check"). Expected: EXIT=0.

- [ ] **Step 5: Gates**

`npx tsc --noEmit` → 0 total errors; `npx eslint --max-warnings=0 src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts` → 0; line endings unchanged (`git ls-files --eol` matches the pre-edit value).

- [ ] **Step 6: Commit**

```
test: §592 §593 — tag-pair-walk and html-extract timing guards use a scaling ratio

Claude-Session: https://[session link removed]
```
`git commit --only src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts -F <msgfile>` (after `git add` of those two paths).

---

### Task 3: Office extractors — `docx`, `xlsx`, `pptx`, `office-xml`

**Files:**
- Modify: `src/app/docx-extract.test.ts` (2 sites, both `toBeLessThan(1000)`)
- Modify: `src/app/xlsx-extract.test.ts` (6 sites / 8 executions, all `toBeLessThan(1000)`; one already asserts its output)
- Modify: `src/app/pptx-extract.test.ts` (1 site)
- Modify: `src/app/office-xml.test.ts` (1 site)

**Interfaces:**
- Consumes: `expectLinearScaling` from `../test/scaling`.

- [ ] **Step 1: Convert each site**

Pattern for every site (shown for a generic extractor; adapt `build`, `run` and `check` to each site's real fixture and function):

```ts
    expectLinearScaling({
      label: "<the it() name, or the row label>",
      build: (n) => /* today's fixture with its repetition count replaced by n */,
      run: (input) => /* the call today's test times */,
      check: (out) => /* a specific assertion on out: an exact text, a cell count, a run count */,
      n: /* see the direction rule below */,
    });
```

Direction: `docx-extract`, `xlsx-extract`, `pptx-extract` scale UP — today's N is `n`, and the large size is 4N. Their comments record that smaller sizes were unreliable, so shrinking is not allowed. `office-xml` has no such note: today's N becomes the large size, so `n` is N/4. If a site's comment contradicts this for that specific site, follow the comment and say so in the report.

`check`: run the site once on green code to learn its true output, then pin something specific to the fixture. "Is truthy" and "length > 0" do not count.

Rewrite each measurement comment: ms figures out, green and red ratios in, with the date. The "N-doubling" series in `docx-extract`/`xlsx-extract` comments can stay as the historical evidence for the chosen N, marked as measured on the date it was, but the assertion text must describe the ratio.

- [ ] **Step 2: Run green and measure**

`npx vitest run src/app/docx-extract.test.ts src/app/xlsx-extract.test.ts src/app/pptx-extract.test.ts src/app/office-xml.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 4 passed`. Record each green ratio. Every `it` must be under 10 s green; if an up-scaled site is not, lower `repeats` for that site (not below 3) and say so.

- [ ] **Step 3: Mutation-prove each site** (Mutant procedure). Record red ratios or "timeout" in the comments.

- [ ] **Step 4: Load check** — the four files under `burn.mjs`. EXIT=0.

- [ ] **Step 5: Gates** — `npx tsc --noEmit` → 0 total errors; `npx eslint --max-warnings=0` on the four files → 0; line endings unchanged.

- [ ] **Step 6: Commit**

```
test: office extractor timing guards use a scaling ratio (§592, §593 class)

Claude-Session: https://[session link removed]
```
`git commit --only` the four files.

---

### Task 4: `rich-text-plain`, `document-asset-patterns.differential`, `raid-escalation`

**Files:**
- Modify: `src/app/rich-text-plain.test.ts` (4 sites / 6 executions: one looped over rows under `CEILING_MS`, three `toBeLessThan(2000)`)
- Modify: `src/app/document-asset-patterns.differential.test.ts` (2 sites / 7 executions under `CEILING_MS`; one row sized to `MAX_HTML_TEXT_CHARS`)
- Modify: `src/app/raid-escalation.test.ts` (1 site, `toBeLessThan(1000)`)

**Interfaces:**
- Consumes: `expectLinearScaling` from `../test/scaling`.

- [ ] **Step 1: Convert `rich-text-plain.test.ts`**

Scale UP: today's size is `n`, and the large size is 4×. Its comments record that 128 KB and 256 KB were too small for two mutants — never go below today's size. Looped rows become `it.each` if they would pass 10 s together. Delete `CEILING_MS` once nothing reads it. Output checks: specific to each fixture (for example, the exact plain text a fixture reduces to), learned by running on green code once.

- [ ] **Step 2: Convert `document-asset-patterns.differential.test.ts`**

The row sized to `MAX_HTML_TEXT_CHARS` scales DOWN: large = `MAX_HTML_TEXT_CHARS`, `n` = a quarter of it, and its `build` asserts `input.length <= MAX_HTML_TEXT_CHARS` (Review Focus 5). The other rows: today's size becomes the large size. Keep the "A PATTERN-LEVEL BOUND, DELIBERATELY SEPARATE FROM THE ROWS" explanation. Delete `CEILING_MS` once unused.

- [ ] **Step 3: Convert `raid-escalation.test.ts`**

```ts
    expectLinearScaling({
      label: "escalation name is clamped before the regex runs",
      build: (n) => /* today's huge toName fixture, with its length set to n */,
      run: (input) => /* today's sanitizeRaidEscalations call */,
      check: (out) => /* today's existing output assertion, kept */,
      n: /* today's length divided by 4, and at least 1_000 so it stays far above the 200-char clamp */,
      factor: 4,
      // The name is clamped to RAID_ESCALATION_NAME_MAX before the regex runs, so the
      // work does not grow with n. Linear would be 4; the clamp makes it ≈ 1.
      maxRatio: 2,
    });
```

The mutant is removing the clamp (pass the unsliced input to the regex). Expected red: the ratio rises to at least linear.

- [ ] **Step 4: Run green, measure, mutation-prove, load check**

`npx vitest run src/app/rich-text-plain.test.ts src/app/document-asset-patterns.differential.test.ts src/app/raid-escalation.test.ts --maxWorkers=1 --reporter=dot > <log> 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 3 passed`. Then mutants per the Mutant procedure (the `rich-text-plain` comments name its mutants), then the three files under `burn.mjs`.

- [ ] **Step 5: Gates** — `npx tsc --noEmit` → 0 total errors; eslint on the three files → 0; line endings unchanged. Then confirm no ceiling is left anywhere:

```bash
git grep -nE "performance\.now\(\)|Date\.now\(\)" -- "src/**/*.test.ts" "src/**/*.test.tsx"
```
Expected: no hit that compares a duration against a fixed number (hits inside `src/test/scaling.ts` itself, or unrelated `Date.now()` fixtures, are fine — list them in the report and say why each is not a ceiling).

- [ ] **Step 6: Commit**

```
test: rich-text-plain, document-asset-patterns and raid-escalation timing guards use a scaling ratio (§592, §593 class)

Claude-Session: https://[session link removed]
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
- Replace the `**Status:**` paragraph with: `**Status:** CLOSED 2026-09-19 by \`docs/timing-flake-592-593\`: ` followed by one or two sentences saying what now holds — the site uses `expectLinearScaling` (`src/test/scaling.ts`), its green and red ratios as recorded in the test comment, and that it stayed green under a saturated-CPU run.
- Delete the `**Work item:** #376` / `#377` line. A closed entry must not carry one.
- Insert, directly after the Status paragraph: `_Original finding, as filed 2026-09-19. Preserved as the dated record; see Status._`
- Leave the original body untouched.
- §593's body links to §592 by anchor. Update that link to §592's new anchor: `#592-the-50-ms-wall-clock-ceiling-in-tag-pair-walktestts-can-fail-a-correct-build-under-load--closed-2026-09-19`.

Index rows (between the real INDEX markers, not the fenced sample): update each row's anchor to end `--closed-2026-09-19` and its title text to end `— CLOSED 2026-09-19`, matching the §567 row.

- [ ] **Step 2: CONTRIBUTING line**

In "Unit + component tests — Vitest", add one bullet:

```markdown
- Timing guards (a test that fails when code turns quadratic or backtracks) use `expectLinearScaling` from `src/test/scaling.ts`, never `elapsed < CEILING_MS` — a fixed ceiling fails a correct build on a loaded machine. It requires an output `check` at both sizes.
```

- [ ] **Step 3: Gates**

Each redirected to a log, then `echo "EXIT=$?"`, all EXIT=0:
`npm run followups:index:check`, `npm run followups:workitems:check`, `npm run docs:claims:check`, `npm run docs:symbols:check`, `npm run docs:scripts:check`. Confirm `git ls-files --eol docs/open-followups.md` stays `w/lf`, and that `grep -c "#592-.*--open\|#593-.*--open" docs/open-followups.md` prints 0.

- [ ] **Step 4: Commit**

```
docs(register): close §592 and §593 — timing guards use a scaling ratio

Claude-Session: https://[session link removed]
```
`git commit --only docs/open-followups.md CONTRIBUTING.md -F <msgfile>`. No "Closes" line and no `#376`/`#377` in the commit message — those go only in the MR description.

The GitLab issues #376 and #377 are closed by the MR description's `Closes` lines at release, and verified closed after merge. Not in this task.
