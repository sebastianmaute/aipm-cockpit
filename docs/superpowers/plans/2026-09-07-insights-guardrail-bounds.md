# Insights Guardrail Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the three unbounded, unmeasured or unvalidated places in the TimeLog guardrail path — the actuals-cache eviction that counts entries without measuring them (§361), the guardrail insight cardinality that can starve `overdueTrend` out of the insight cap entirely (§363's live half), and `parseDailyKey` admitting any non-empty string as a date (§367).

**Architecture:** Three independent changes in three pure modules. §367 tightens a parser in `timelog-types.ts`. §363 adds a reserved-capacity selection to `reconcile.ts` — deliberately NOT a cap in `detect.ts`, because dropping rows from the detection set makes reconcile read them as cleared and fabricate an `"improved"` outcome into shared exported data. §361 makes `saveActualsCache` measure the serialised map and shed load in three stages, stripping rolls from old entries before dropping any entry whole.

**Tech Stack:** TypeScript, vitest. No React, no DOM, no UI in any task.

**Spec:** `docs/superpowers/specs/2026-09-07-insights-guardrail-bounds-design.md`

---

## Before you start

Read these three things. The plan depends on all of them and none is guessable from the code you will be editing.

1. **`docs/AGENTS/insights.md`** — the detect → reconcile → recommend → outcome chain.
2. **The `isEvaluated` docstring on `reconcileInsights`** (`src/app/insights/reconcile.ts`). It explains why a detector that can go dark must never have its rows silently removed from the detection set. Task 2 exists because of it.
3. **The `withBoundedDaily` docstring** (`src/app/timelog-actuals-store.ts`). It states the rule Task 3 is built to honour: losing the roll must never cost the `aggregates` beside it, and a narrowed coverage claim is worse than an absent one.

**Standing constraints for every task in this plan:**

- Every file under `src/app/` is **CRLF**. The `Edit` tool preserves line endings; the `Write` tool re-lines to LF. **Use `Edit`, never `Write`, on any `src/app/**` file.** Never use `sed -i` on a source file — under Git Bash it silently re-lines the whole file.
- **Never run two vitest processes at once.** `Failed to start forks worker` means machine contention, not a broken test.
- **Never read a gate's exit code through a pipe.** Redirect to a file, `echo "EXIT=$?"` unpiped, then read the file.
- **No full test suite.** Targeted runs only, per the standing instruction on this branch.
- `git add` does not scope a commit. Commit with `git commit --only <paths>`. Never `git add -A` or `git add .` — `not-in-use.env.local.bak` is untracked, not gitignored, and holds a live token.
- **Never `git commit --amend`** — this is a shared worktree and an amend has swallowed a stranger's commit twice.
- Never commit or revert `sample-workspace-big.json` / `sample-workspace-huge.json`.

**Baseline test counts**, measured 2026-09-07 before any change. Every mutation record below must report `N failed / M passed` whose SUM equals the file's runtime test count — a mutant that never landed otherwise reads as a proof:

| File | Tests before |
|---|---|
| `src/app/insights/reconcile.test.ts` | 45 |
| `src/app/timelog-actuals-store.test.ts` | 41 |
| `src/app/timelog-policy.test.ts` | 33 |

Re-measure yourself rather than trusting this table — it is a snapshot and the tasks below add to it:

```bash
for f in src/app/insights/reconcile.test.ts src/app/timelog-actuals-store.test.ts src/app/timelog-policy.test.ts; do echo "$f: $(grep -cE '^\s*(it|test)\(' $f)"; done
```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/timelog-types.ts` | Modify `parseDailyKey` | The daily-roll KEY rule: what counts as a usable `userId\|date` key |
| `src/app/timelog-types.test.ts` | **Create** | Direct unit cover for `parseDailyKey`, which has none today |
| `src/app/timelog-policy.test.ts` | Modify | Pins that a malformed date no longer reaches the violation bounds |
| `src/app/timelog-actuals-store.test.ts` | Modify | Corrects a now-false comment; adds the map-budget cases |
| `src/app/insights/insight.ts` | Modify | Two new exported constants: the guardrail family, and the reservation |
| `src/app/insights/reconcile.ts` | Modify | The terminal selection at the cap |
| `src/app/insights/reconcile.test.ts` | Modify | Pins the reservation, the top-up, and the preserved order |
| `src/app/timelog-actuals-store.ts` | Modify `saveActualsCache` | Map-level size budget and three-stage shedding |
| `docs/open-followups.md` | Modify | §361, §363, §367 updated in place |

No new source module is created. `src/app/timelog-types.test.ts` is a new TEST file, which adds no coverage-gated source and therefore cannot move a coverage floor.

---

### Task 1: Validate the date shape in `parseDailyKey` (§367)

**Files:**
- Modify: `src/app/timelog-types.ts` (`parseDailyKey`)
- Create: `src/app/timelog-types.test.ts`
- Test: `src/app/timelog-policy.test.ts`
- Modify: `src/app/timelog-actuals-store.test.ts` (a comment that this task makes false)

- [ ] **Step 1: Write the failing unit test**

Create `src/app/timelog-types.test.ts` with exactly this content (this file is new, so `Write` is correct here — the CRLF rule applies to editing existing sources):

```ts
import { describe, expect, it } from "vitest";
import { dailyKey, parseDailyKey } from "./timelog-types";

describe("parseDailyKey", () => {
  it("round-trips a key built by dailyKey", () => {
    expect(parseDailyKey(dailyKey(7, "2026-09-01"))).toEqual({ userId: 7, date: "2026-09-01" });
  });

  // ★★ The oversized key is the shape open-followups §367 is named for: before
  // this check it parsed successfully and was a single roll cell larger than
  // MAX_DAILY_ROLL_CHARS on its own.
  it("rejects a date half that is not ISO-shaped", () => {
    expect(parseDailyKey("7|tomorrow")).toBeNull();
    expect(parseDailyKey("7|2026-9-1")).toBeNull();
    expect(parseDailyKey("7|2026-09-01T00:00:00Z")).toBeNull();
    expect(parseDailyKey(`7|${"x".repeat(600000)}`)).toBeNull();
  });

  // ★★★ THE NEGATIVE CONTROL, AND IT IS THE ONE THAT MUST NOT BE DELETED. This
  // is a SHAPE rule, never an existence rule: the check exists to make `<`/`>`
  // comparisons on the date lexicographically meaningful downstream, not to
  // certify that a date exists. Without this assertion, "tighten it to a real
  // calendar date" reads as a safe improvement — and it is not, because
  // `timelog-policy.ts` compares violation bounds against a roll window with
  // plain string comparison and never asks whether either end is a real day.
  it("admits an ISO-SHAPED date that is not a real day", () => {
    expect(parseDailyKey("7|9999-99-99")).toEqual({ userId: 7, date: "9999-99-99" });
  });

  it("still rejects a missing separator, an empty userId and a non-integer userId", () => {
    expect(parseDailyKey("no-pipe")).toBeNull();
    expect(parseDailyKey("|2026-09-01")).toBeNull();
    expect(parseDailyKey("7.5|2026-09-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails for the right reason**

```bash
npx vitest run src/app/timelog-types.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1a.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1a.log
```

Expected: `EXIT=1`, with `rejects a date half that is not ISO-shaped` failing. The other three tests must PASS already — if the round-trip or the negative control fails, the fixture is wrong, not the code.

- [ ] **Step 3: Implement the check**

In `src/app/timelog-types.ts`, immediately above `parseDailyKey`, add the constant and replace the function body. Use `Edit` — this file is CRLF.

Insert before `export function parseDailyKey`:

```ts
/** The date half of a daily-roll key. SHAPE, never existence — `9999-99-99` is
 *  admitted deliberately.
 *  ★★ The point is to make `<` and `>` comparisons on the date lexicographically
 *  meaningful downstream, not to certify a date exists. `timelog-policy.ts`
 *  tracks a running min/max into `firstViolationDate`/`lastViolationDate` and
 *  the reconcile then compares those against a roll window with plain string
 *  comparison; a key like `"7|tomorrow"` orders against ISO dates arbitrarily
 *  and still reaches both bounds.
 *  ★★★ THIS IS A KEY RULE AND IS DELIBERATELY NOT THE WINDOW RULE that
 *  `timelog-actuals-store.ts` declares under the same shape, nor the one in
 *  `sanitize-core.ts`. They answer different questions — "is this key usable?"
 *  versus "is this stored window usable?" — and sharing one constant would
 *  couple two independent decisions. The store's own docstring argues the same
 *  split from the other side, explaining why validating keys is not its job.
 *  See open-followups §367. */
const KEY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
```

Then change the guard line inside `parseDailyKey` from:

```ts
  if (!Number.isInteger(userId) || !date) return null;
```

to:

```ts
  if (!Number.isInteger(userId) || !KEY_DATE_RE.test(date)) return null;
```

The `!date` emptiness test is dropped because `KEY_DATE_RE` rejects the empty string already; keeping both would leave a branch no input can distinguish.

- [ ] **Step 4: Run the unit test and verify it passes**

```bash
npx vitest run src/app/timelog-types.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1b.log
```

Expected: `EXIT=0`, `Tests  4 passed (4)`.

- [ ] **Step 5: Write the failing policy-path test**

This is the reachable half of §367 and the reason the task is worth doing. In `src/app/timelog-policy.test.ts`, add inside the top-level `describe("evaluateTimelogPolicy", …)` block:

```ts
  // ★★★ THE REACHABLE HALF OF open-followups §367. Before `parseDailyKey`
  // checked the date shape, a malformed key reached this loop: `weekdayIndex`
  // returns null for a non-ISO string so the working-hours and weekend arms
  // skipped it, but the value still flowed into the running min/max, so
  // `lastViolationDate` became "tomorrow" and `worstHours` became 99. The
  // downstream window comparison in the reconcile then fails against that bound
  // and the insight FREEZES — the safe direction, which is why this was filed
  // as a latent shape rather than a live defect.
  // ★ The malformed cell books 99h, far above the 8h threshold, so if it were
  // still admitted it could only show up as a violation — never as an innocent
  // day that happens not to breach.
  it("keeps a malformed-date cell out of the violation bounds", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1], "7|tomorrow": [99, 99, 1] }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [link(7, 1)], shifts: [],
    });
    const v = res.violations.find((x) => x.rule === "timelogCapPerDay");
    expect(v).toBeDefined();
    expect(v!.firstViolationDate).toBe(TUE);
    expect(v!.lastViolationDate).toBe(TUE);
    expect(v!.worstHours).toBe(12);
    expect(v!.count).toBe(1);
  });
```

- [ ] **Step 6: Run the policy test and verify it passes**

```bash
npx vitest run src/app/timelog-policy.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1c.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1c.log
```

Expected: `EXIT=0`, `Tests  34 passed (34)` (33 baseline + 1).

This test was written after the fix, so it has not been seen to fail. Step 8 is what proves it.

- [ ] **Step 7: Correct the comment this task falsified**

`src/app/timelog-actuals-store.test.ts` carries a comment above the test `drops daily AND dailyWindow together when nothing survives, keeping the rest` which now states something untrue. Find it with:

```bash
grep -n "never checks the DATE" src/app/timelog-actuals-store.test.ts
```

Replace these three comment lines:

```ts
  // ★ It is NOT true that a single oversized cell cannot be constructed, which
  // is what this comment used to claim: `parseDailyKey` never checks the DATE
  // beyond non-emptiness, so `"7|" + "x".repeat(600000)` parses and is exactly
  // that. Many-unusable-keys is simply the shape this test chose.
```

with:

```ts
  // ★★ A single oversized cell is NO LONGER CONSTRUCTIBLE, and the history is
  // worth keeping because this comment has now been wrong in both directions.
  // It first claimed the shape was impossible on the strength of the userId
  // half of the check — true only via `Number(...)` overflowing to Infinity at
  // roughly 309 digits, a mechanism it never stated. It was then corrected to
  // say `parseDailyKey` never checks the DATE, which was true when written.
  // `KEY_DATE_RE` now rejects a non-ISO date half, so `"7|" + "x".repeat(N)`
  // does not parse. Many-unusable-keys remains the shape this test chose, and
  // it still exercises the same survivor-run path.
```

- [ ] **Step 8: Mutation-prove the check**

Revert the implementation by an anchored inverse write, assert the anchor is unique in BOTH directions, run, then restore. `git checkout -- <file>` is deny-blocked on this repo, so the revert must be a real edit.

Mutant: change `!KEY_DATE_RE.test(date)` back to `!date`.

```bash
npx vitest run src/app/timelog-types.test.ts src/app/timelog-policy.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1mut.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t1mut.log
```

Expected: `2 failed / 36 passed` — the `rejects a date half` test and the `keeps a malformed-date cell out of the violation bounds` test. The sum must be 38 (4 + 34).

Restore the line, then prove the tree is clean:

```bash
git diff --stat src/app/timelog-types.ts
```

Expected after restore: the only diff is the intended change (the new constant and the new guard), not the mutant.

- [ ] **Step 9: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. Note `npx tsc --noEmit` exits **2** on diagnostics, not 1.

- [ ] **Step 10: Commit**

```bash
git commit --only src/app/timelog-types.ts src/app/timelog-types.test.ts src/app/timelog-policy.test.ts src/app/timelog-actuals-store.test.ts -m "fix(timelog): validate the date shape in parseDailyKey

open-followups §367. The date half of a daily-roll key was checked for being
non-empty and nothing else, so a malformed date reached the policy engine and
flowed into firstViolationDate/lastViolationDate, after which the reconcile's
window comparison fails and the insight freezes.

SHAPE, never existence: 9999-99-99 is still admitted. The check exists to make
< and > comparisons on the date lexicographically meaningful downstream, and a
real-calendar-date rule would be a stricter promise than any consumer needs.

Also corrects a comment in timelog-actuals-store.test.ts that this change
falsifies, and adds the direct parseDailyKey cover the function never had."
```

Then verify the commit touched exactly four files:

```bash
git show --stat --oneline HEAD | tail -6
```

---

### Task 2: Reserve non-guardrail capacity at the insight cap (§363)

**Files:**
- Modify: `src/app/insights/insight.ts` (two new exported constants)
- Modify: `src/app/insights/reconcile.ts` (the terminal selection in `reconcileInsights`)
- Test: `src/app/insights/reconcile.test.ts`

**Why the cap is here and not in `detect.ts`** — read this before writing any code. `timelogGuardrailInsights` in `src/app/insights/detect.ts` is a bare `.map` over violations, so guardrail cardinality is 4 × (TimeLog users seen in a fetch), all at `"medium"`. Capping it there is the obvious move and it is unsafe: it drops rows from `detected`, and `reconcileInsights` reads "absent from the detection set" as "the condition cleared" unless `isEvaluated` says otherwise. That predicate is built at the `task-manager.tsx` call site from the daily roll, which cannot see a cap applied inside `detect.ts`. A capped-out row whose violating days the roll covers therefore resolves through `computeClearedOutcome` — which always writes `"improved"` — into `Workspace.insights`, which is shared, exported, and read on every AI turn. Do not "simplify" this task by moving the cap.

- [ ] **Step 1: Write the three failing tests**

In `src/app/insights/reconcile.test.ts`, extend the existing import from `./insight` so it reads:

```ts
import { INSIGHT_SEVERITY_RANK, MAX_INSIGHTS, RESERVED_NON_GUARDRAIL } from "./insight";
```

Then add a new `describe` block at the end of the file:

```ts
describe("reconcileInsights — reserved non-guardrail capacity", () => {
  const guardrails = (n: number, severity: "high" | "medium" = "medium"): DetectedInsight[] =>
    Array.from({ length: n }, (_, i) =>
      detected(`timelog:timelogCapPerDay:${i}`, { type: "timelogCapPerDay", severity }),
    );

  /** ★★★ THE FIXTURE IS THE TEST. `overdueTrend` is the app's ONLY `low`
   *  detector and every guardrail is `medium`, so under the comparator it loses
   *  to every guardrail before ties are even reached. The flood must exceed
   *  MAX_INSIGHTS on its own — with fewer guardrails than the cap the singleton
   *  survives whether or not a reservation exists, and the test proves nothing. */
  it("keeps a low-severity singleton alive against a flood of guardrails", () => {
    const out = reconcileInsights(
      [],
      [...guardrails(MAX_INSIGHTS + 50), detected("overdueTrend", { type: "overdueTrend", severity: "low" })],
      "2026-02-01",
      ALL_EVALUATED,
    );
    expect(out).toHaveLength(MAX_INSIGHTS);
    expect(out.some((i) => i.key === "overdueTrend")).toBe(true);
    expect(out.filter((i) => i.type === "timelogCapPerDay")).toHaveLength(
      MAX_INSIGHTS - RESERVED_NON_GUARDRAIL,
    );
  });

  /** ★★★ THE FAILURE MODE A RESERVATION INTRODUCES, and the test the previous
   *  one cannot cover: a reservation that nobody claims must not shorten the
   *  list. With no core insights at all the output must still be MAX_INSIGHTS,
   *  not the 140 the guardrail budget alone would admit. */
  it("still fills the cap when the reserved family has nothing to put in it", () => {
    const out = reconcileInsights([], guardrails(MAX_INSIGHTS + 50), "2026-02-01", ALL_EVALUATED);
    expect(out).toHaveLength(MAX_INSIGHTS);
  });

  /** ★★ ORDER SURVIVES THE SELECTION. The two-pass admission visits deferred
   *  rows after the rest, so an implementation that concatenates its two passes
   *  emits them out of comparator order. The fixture makes that visible by
   *  giving the DEFERRED family the HIGHER severity: 200 high guardrails against
   *  40 low core rows means pass one admits 140 high + 40 low = 180, and pass two
   *  tops up with 20 more high — which a concatenating implementation appends
   *  AFTER the low rows. (Guardrails are always `medium` in production; the type
   *  permits any severity, and using `high` here is what makes the defect
   *  observable at all.) */
  it("emits in comparator order even when the reservation defers a higher-severity row", () => {
    const core = Array.from({ length: 40 }, (_, i) =>
      detected(`raidAging:${i}`, { type: "raidAging", severity: "low" }),
    );
    const out = reconcileInsights([], [...guardrails(MAX_INSIGHTS, "high"), ...core], "2026-02-01", ALL_EVALUATED);
    expect(out).toHaveLength(MAX_INSIGHTS);
    const ranks = out.map((i) => INSIGHT_SEVERITY_RANK[i.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
npx vitest run src/app/insights/reconcile.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t2a.log 2>&1; echo "EXIT=$?"
grep -E "Tests |RESERVED_NON_GUARDRAIL" /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t2a.log
```

Expected: `EXIT=1`. The run fails to import `RESERVED_NON_GUARDRAIL`, which does not exist yet — that is the correct first failure. The `still fills the cap` test will pass even now (today's plain `slice` returns 200), which is expected: it is a regression guard against the fix, not a demonstration of the bug.

- [ ] **Step 3: Add the two constants**

In `src/app/insights/insight.ts`, immediately after the existing `export const MAX_INSIGHTS = 200;`, add (use `Edit`; the file is CRLF):

```ts
/** The four TimeLog guardrail members of `INSIGHT_TYPES`, as one named set so
 *  the family has a single definition rather than a literal list at each reader.
 *  ★★ These four are also `TimelogRuleId` — `timelog-policy.test.ts` pins that
 *  identity with a type-level assertion — so this set must never gain a member
 *  that is not a rule. */
export const GUARDRAIL_INSIGHT_TYPES: ReadonlySet<InsightType> = new Set<InsightType>([
  "timelogCapPerEntry",
  "timelogCapPerDay",
  "timelogNonWorkingDay",
  "timelogWorkingHours",
]);

/** Slots at `MAX_INSIGHTS` that guardrail rows may never occupy.
 *  ★★★ WHY IT EXISTS. Guardrail cardinality is 4 × (TimeLog users seen in a
 *  fetch) with no cap in `detect.ts`, and every guardrail is `medium` while
 *  `overdueTrend` is the app's ONLY `low` detector. Under the comparator that
 *  singleton therefore loses to every guardrail before ties are even reached, so
 *  an org-scope fetch of ~50 people pushes it out of the cap entirely — and once
 *  sliced away it is gone from `stored` and never returns. 60 covers a large
 *  project's `milestoneSlip` and `raidAging` sets plus the three singletons; the
 *  resulting guardrail budget of 140 is 35 people across 4 rules.
 *  ★★★ THE RESERVATION LIVES IN `reconcile.ts`, NOT IN `detect.ts`, AND THAT IS
 *  A SAFETY PROPERTY RATHER THAN A PREFERENCE. Capping the detector drops rows
 *  from `detected`, and `reconcileInsights` reads absence as "the condition
 *  cleared" unless `isEvaluated` says otherwise — a predicate built at the
 *  `task-manager.tsx` call site from the daily roll, which cannot see a cap
 *  applied inside `detect.ts`. A capped-out row whose days the roll covers would
 *  resolve through `computeClearedOutcome`, which always writes `"improved"`,
 *  into shared and exported data. Reserving at the cap drops nothing from the
 *  detection set, so no row can be re-read as cleared.
 *  ★★ It does NOT make the cap lossless. A frozen row can still be evicted here;
 *  open-followups §363 keeps that residue open deliberately, because losing a
 *  row is strictly better than fabricating an outcome for it. */
export const RESERVED_NON_GUARDRAIL = 60;
```

- [ ] **Step 4: Replace the terminal selection**

In `src/app/insights/reconcile.ts`, extend the existing import from `./insight` to include the two new names:

```ts
import {
  GUARDRAIL_INSIGHT_TYPES,
  INSIGHT_SEVERITY_RANK,
  MAX_INSIGHTS,
  RESERVED_NON_GUARDRAIL,
  type DetectedInsight,
  type Insight,
} from "./insight";
```

Then replace the final line of `reconcileInsights`:

```ts
  return result.slice(0, MAX_INSIGHTS);
```

with:

```ts
  // ★★★ RESERVE AT THE CAP; DO NOT CAP THE DETECTOR. Everything in `result`
  // remains a candidate — this only decides which candidates survive. The
  // reasoning for why a `detect.ts` cap would fabricate an "improved" outcome
  // lives on `RESERVED_NON_GUARDRAIL`; read it before changing this.
  // ★★ TWO PASSES, and the second is what stops the list getting SHORTER than
  // the plain slice it replaces: pass one admits every non-guardrail row and
  // admits guardrails only while their own budget holds; pass two hands any slot
  // still free back to the rows pass one deferred. Without it a device with 300
  // guardrails and no core insights would return 140 rows where the old slice
  // returned 200.
  // ★★ ADMISSION IS RECORDED BY INDEX AND THE OUTPUT IS FILTERED FROM `result`,
  // never concatenated from the two passes — concatenating emits pass two's rows
  // after everything else, which is out of comparator order and reorders the
  // panel. An index is used rather than a key because two stored rows CAN carry
  // the same key (the stored array is iterated directly, not de-duplicated).
  if (result.length <= MAX_INSIGHTS) return result;
  const guardrailBudget = MAX_INSIGHTS - RESERVED_NON_GUARDRAIL;
  const admit = new Array<boolean>(result.length).fill(false);
  let admitted = 0;
  let guardrails = 0;
  for (let i = 0; i < result.length && admitted < MAX_INSIGHTS; i += 1) {
    if (GUARDRAIL_INSIGHT_TYPES.has(result[i].type)) {
      if (guardrails >= guardrailBudget) continue;
      guardrails += 1;
    }
    admit[i] = true;
    admitted += 1;
  }
  for (let i = 0; i < result.length && admitted < MAX_INSIGHTS; i += 1) {
    if (admit[i]) continue;
    admit[i] = true;
    admitted += 1;
  }
  return result.filter((_, i) => admit[i]);
```

- [ ] **Step 5: Run and verify all three pass**

```bash
npx vitest run src/app/insights/reconcile.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t2b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t2b.log
```

Expected: `EXIT=0`, `Tests  48 passed (48)` (45 baseline + 3).

- [ ] **Step 6: Mutation-prove each of the three separately**

Three mutants, each reverted before the next is applied. Record every one as `N failed / M passed` and check the sum is 48.

**Mutant A — no reservation.** Change `RESERVED_NON_GUARDRAIL = 60` to `= 0`.
Expected: `1 failed / 47 passed` — `keeps a low-severity singleton alive` only.

**Mutant B — no top-up.** Delete the entire second `for` loop.
Expected: `2 failed / 46 passed` — `still fills the cap` and `emits in comparator order` (the latter drops to 180 rows and fails its length assertion first).

**Mutant C — concatenate instead of filter.** Replace the final `return result.filter((_, i) => admit[i]);` with a concatenation that emits deferred rows last:

```ts
  const first: Insight[] = [];
  const second: Insight[] = [];
  for (let i = 0; i < result.length; i += 1) {
    if (!admit[i]) continue;
    if (GUARDRAIL_INSIGHT_TYPES.has(result[i].type) && i >= guardrailBudget) second.push(result[i]);
    else first.push(result[i]);
  }
  return [...first, ...second];
```

Expected: `1 failed / 47 passed` — `emits in comparator order` only.

If Mutant C survives, the order fixture is not discriminating and must be strengthened before proceeding — a surviving mutant is a question, not a pass.

After each mutant, restore by an anchored inverse write and confirm:

```bash
git diff --stat src/app/insights/insight.ts src/app/insights/reconcile.ts
```

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/insights/insight.ts src/app/insights/reconcile.ts src/app/insights/reconcile.test.ts -m "fix(insights): reserve non-guardrail capacity at the insight cap

open-followups §363, live half. Guardrail cardinality is 4 x (TimeLog users
seen in a fetch) with no cap in detect.ts, and every guardrail is medium while
overdueTrend is the app's only low detector. An org-scope fetch of ~50 people
therefore pushed overdueTrend out of MAX_INSIGHTS entirely, and once sliced away
it is gone from stored and never returns.

RESERVED_NON_GUARDRAIL holds 60 of the 200 slots, leaving a guardrail budget of
140 (35 people x 4 rules). A two-pass admission hands unclaimed reserved slots
back, so the list is never shorter than the plain slice it replaces, and the
output is filtered from the sorted list rather than concatenated from the two
passes, so comparator order survives.

The cap is deliberately NOT in detect.ts. Capping the detector drops rows from
the detection set, and reconcile reads absence as 'the condition cleared' unless
isEvaluated objects -- a predicate built from the daily roll, which cannot see a
cap applied in detect.ts. A capped-out row whose days the roll covers would
resolve through computeClearedOutcome, which always writes 'improved', into
shared exported data read on every AI turn.

§363's residue stays open: the plain cap can still evict a frozen row."
```

---

### Task 3: Measure the actuals cache and shed load in three stages (§361)

**Files:**
- Modify: `src/app/timelog-actuals-store.ts` (one new constant, two new helpers, `saveActualsCache`)
- Test: `src/app/timelog-actuals-store.test.ts`

- [ ] **Step 1: Write the three failing tests**

In `src/app/timelog-actuals-store.test.ts`, extend the existing import from `./timelog-actuals-store` to add `MAX_ACTUALS_TOTAL_CHARS`:

```ts
import { isDailyCell, loadActualsCache, MAX_ACTUALS_TOTAL_CHARS, MAX_DAILY_ROLL_CHARS, saveActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";
```

Add a new top-level `describe` block at the end of the file. It reuses `agg` from the top of the file and declares its own roll helper, because the existing `rollOf`/`CELL`/`OVER_DAYS` are scoped inside another describe:

```ts
describe("timelog actuals cache — map-level size budget", () => {
  const CELL = { hours: 8, maxEntryHours: 8, entryCount: 1 };

  /** `days` consecutive dated cells for one booker. 20,000 days lands each
   *  entry just under MAX_DAILY_ROLL_CHARS after `withBoundedDaily` trims it,
   *  so five such entries exceed the 2 MiB map budget while none of them is
   *  individually over the per-entry bound. */
  function bigRoll(days: number): Record<string, typeof CELL> {
    const out: Record<string, typeof CELL> = {};
    const base = Date.UTC(2000, 0, 1);
    for (let i = 0; i < days; i += 1) {
      const d = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      out[`7|${d}`] = { ...CELL };
    }
    return out;
  }

  const bigEntry = (fetchedAt: string) => ({
    fetchedAt,
    aggregates: agg(3),
    daily: bigRoll(20_000),
    dailyWindow: { from: "2000-01-01", to: "2054-09-08" },
    dailyUsers: [7],
  });

  /** ★★★ STAGE 2 IS THE POINT: the old entry loses its roll and KEEPS its
   *  aggregates. `withBoundedDaily`'s own docstring states the rule — losing the
   *  roll must never cost the aggregates beside it — and the count-based
   *  eviction it replaces violated exactly that.
   *  ★★ The three roll fields must go TOGETHER. A stripped entry with a window
   *  but no roll is a coverage CLAIM about data that is gone: the reconcile
   *  would pass its window check, find no violation, and resolve a stored
   *  guardrail insight as a fabricated "improved" into exported data. */
  it("strips old rolls before dropping any entry, keeping their aggregates", () => {
    for (let i = 0; i < 5; i += 1) {
      saveActualsCache(`p${i}`, bigEntry(`2026-09-0${i + 1}T00:00:00.000Z`));
    }
    const raw = window.localStorage.getItem(TIMELOG_ACTUALS_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(MAX_ACTUALS_TOTAL_CHARS);

    // The oldest entry is still present and still carries what the network
    // round trip bought, but claims no coverage.
    const oldest = loadActualsCache("p0");
    expect(oldest).toBeDefined();
    expect(oldest?.aggregates?.unattributed.hours).toBe(3);
    expect(oldest?.daily).toBeUndefined();
    expect(oldest?.dailyWindow).toBeUndefined();
    expect(oldest?.dailyUsers).toBeUndefined();

    // The entry just saved keeps its roll.
    expect(loadActualsCache("p4")?.daily).toBeDefined();
  });

  /** ★★★ THE ENTRY BEING SAVED IS NEVER A CANDIDATE, or a save silently does
   *  nothing — a network round trip discarded with no error anywhere, since
   *  `writeDeviceJson` swallows every failure. The pathological input is a
   *  single entry that alone exceeds the map budget. */
  it("never strips or evicts the entry being saved, even alone over budget", () => {
    saveActualsCache("solo", bigEntry("2026-09-01T00:00:00.000Z"));
    const e = loadActualsCache("solo");
    expect(e).toBeDefined();
    expect(e?.daily).toBeDefined();
    expect(e?.aggregates?.unattributed.hours).toBe(3);
  });

  /** ★★ Stage 3 only runs once stage 2 has nothing left to give. Seeding
   *  roll-free entries makes stripping a no-op, so reaching the budget can only
   *  happen by dropping entries whole. */
  it("drops whole entries once there are no rolls left to strip", () => {
    const filler = "x".repeat(400_000);
    for (let i = 0; i < 6; i += 1) {
      saveActualsCache(`q${i}`, {
        fetchedAt: `2026-09-0${i + 1}T00:00:00.000Z`,
        aggregates: agg(1),
        users: [{ userId: i, firstName: filler, lastName: "L", initials: "L", email: "a@b.c", isActive: true }],
      });
    }
    const raw = window.localStorage.getItem(TIMELOG_ACTUALS_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(MAX_ACTUALS_TOTAL_CHARS);
    // Oldest first: q0 goes before q5, and the entry just saved always survives.
    expect(loadActualsCache("q0")).toBeUndefined();
    expect(loadActualsCache("q5")).toBeDefined();
  });

  /** ★★★ THE CONTROL, and without it every assertion above passes against a
   *  shedder that fires unconditionally. A map comfortably under budget must
   *  come back completely untouched, rolls included. */
  it("leaves a map within budget completely untouched", () => {
    saveActualsCache("s1", { fetchedAt: "2026-09-01T00:00:00.000Z", aggregates: agg(1), daily: bigRoll(10), dailyWindow: { from: "2000-01-01", to: "2000-01-10" }, dailyUsers: [7] });
    saveActualsCache("s2", { fetchedAt: "2026-09-02T00:00:00.000Z", aggregates: agg(2), daily: bigRoll(10), dailyWindow: { from: "2000-01-01", to: "2000-01-10" }, dailyUsers: [7] });
    expect(loadActualsCache("s1")?.daily).toBeDefined();
    expect(loadActualsCache("s1")?.dailyWindow).toBeDefined();
    expect(loadActualsCache("s1")?.dailyUsers).toEqual([7]);
    expect(loadActualsCache("s2")?.daily).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
npx vitest run src/app/timelog-actuals-store.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t3a.log 2>&1; echo "EXIT=$?"
grep -E "Tests |MAX_ACTUALS_TOTAL_CHARS" /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t3a.log
```

Expected: `EXIT=1`, failing to import `MAX_ACTUALS_TOTAL_CHARS`.

- [ ] **Step 3: Add the constant**

In `src/app/timelog-actuals-store.ts`, immediately after the existing `export const MAX_DAILY_ROLL_CHARS = 512 * 1024;`, add (use `Edit`; CRLF file):

```ts
/** Budget for the WHOLE serialised cache map, not one entry.
 *  ★★★ WHY A SECOND BOUND EXISTS. `MAX_DAILY_ROLL_CHARS` is per-entry, so 50
 *  entries (`MAX_PROJECTS`) each sitting just under it is ~25 MB against a
 *  localStorage origin quota of roughly 5 MB shared with every other
 *  `aipm-cockpit:*` key — and `writeDeviceJson` swallows the resulting quota
 *  error, so the ENTIRE save is lost silently, `aggregates` included. The
 *  map-level bound was `MAX_PROJECTS` eviction ALONE, which counts entries and
 *  never measures them. See open-followups §361.
 *  ★ 2 MiB is ~40% of that quota, leaving ~3 MB for every other device key, and
 *  admits four full-size rolls against the per-entry cap.
 *  ★★ Measured with `JSON.stringify(...).length`, matching the per-entry bound:
 *  that counts UTF-16 code units rather than bytes, which for a real roll —
 *  ASCII keys, numeric values — is the same number, and browsers bill
 *  localStorage in UTF-16 units anyway. */
export const MAX_ACTUALS_TOTAL_CHARS = 2 * 1024 * 1024;

function mapSize(map: CacheMap): number {
  return JSON.stringify(map).length;
}

/** Shedding order: oldest `fetchedAt` first, and NEVER the entry just saved.
 *  ★★★ EXCLUDING `keep` IS LOAD-BEARING. Without it a single entry that alone
 *  exceeds the budget is stripped or dropped by its own save, so a network round
 *  trip is discarded and nothing anywhere reports it — `writeDeviceJson` cannot.
 *  ★ The id breaks a tie so two entries written in the same millisecond shed in
 *  a stable order rather than whatever `Object.keys` happens to yield. */
function shedOrder(map: CacheMap, keep: string): string[] {
  return Object.keys(map)
    .filter((k) => k !== keep)
    .sort((a, b) =>
      map[a].fetchedAt === map[b].fetchedAt
        ? a.localeCompare(b)
        : map[a].fetchedAt.localeCompare(map[b].fetchedAt),
    );
}
```

- [ ] **Step 4: Rewrite `saveActualsCache`**

Replace the whole existing function with:

```ts
/** ★★★ THREE STAGES, EACH RE-MEASURING, AND THE ORDER IS THE DESIGN.
 *  1. Count eviction (`MAX_PROJECTS`), unchanged, newest `fetchedAt` first.
 *  2. Strip `daily` + `dailyWindow` + `dailyUsers` TOGETHER from the oldest
 *     entries, keeping their `aggregates`.
 *  3. Drop whole entries, oldest first.
 *  ★★★ WHY STRIP BEFORE DROP. `withBoundedDaily`'s docstring already states the
 *  rule this honours: losing the roll must never cost the `aggregates` beside
 *  it — the aggregates are what the network round trip bought, and whole-entry
 *  eviction throws them away. Stripping is safe for exactly the reason §361
 *  gives for whole-entry eviction: the three fields go together, so a stripped
 *  entry claims NO coverage, `rollWindow === undefined` makes the reconcile
 *  predicate return false, and the insight FREEZES — the recoverable direction.
 *  ★★★ WHAT MUST NEVER BE DONE HERE IS A TRIM. Narrowing another project's
 *  `dailyWindow` during a save for THIS one rewrites a coverage CLAIM the
 *  insights reconcile trusts; the insight would then read as covered, find no
 *  violation in the trimmed roll, and resolve as a fabricated "improved" into
 *  shared, exported data. Strip whole or leave alone — never narrow. */
export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): void {
  const map = readMap();
  map[projectId] = withBoundedDaily(entry);

  // Stage 1 — count eviction, newest first.
  let out: CacheMap = map;
  const entries = Object.entries(map);
  if (entries.length > MAX_PROJECTS) {
    entries.sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt));
    const kept: CacheMap = {};
    for (const [k, v] of entries.slice(0, MAX_PROJECTS)) kept[k] = v;
    // ★ A caller may hand over an OLD `fetchedAt` (a replayed or backfilled
    // fetch), which would sort the entry being saved out of its own save. Put it
    // back rather than lose the write; one entry over the count bound is a far
    // smaller cost than a silently discarded save.
    if (kept[projectId] === undefined) kept[projectId] = map[projectId];
    out = kept;
  }

  // Stage 2 — strip rolls, oldest first, aggregates kept.
  if (mapSize(out) > MAX_ACTUALS_TOTAL_CHARS) {
    for (const k of shedOrder(out, projectId)) {
      if (mapSize(out) <= MAX_ACTUALS_TOTAL_CHARS) break;
      const e = out[k];
      if (e.daily === undefined && e.dailyWindow === undefined && e.dailyUsers === undefined) continue;
      const stripped = { ...e };
      delete stripped.daily;
      delete stripped.dailyWindow;
      delete stripped.dailyUsers;
      out = { ...out, [k]: stripped };
    }
  }

  // Stage 3 — drop whole entries, oldest first.
  if (mapSize(out) > MAX_ACTUALS_TOTAL_CHARS) {
    for (const k of shedOrder(out, projectId)) {
      if (mapSize(out) <= MAX_ACTUALS_TOTAL_CHARS) break;
      const next = { ...out };
      delete next[k];
      out = next;
    }
  }

  writeDeviceJson(TIMELOG_ACTUALS_KEY, out);
}
```

- [ ] **Step 5: Run and verify they pass**

```bash
npx vitest run src/app/timelog-actuals-store.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t3b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/t3b.log
```

Expected: `EXIT=0`, `Tests  45 passed (45)` (41 baseline + 4).

If the run is slow, that is the fixture: five 512 KiB rolls are re-serialised on each measurement. It must still finish well inside the 20s `testTimeout`. If it does not, reduce `bigRoll(20_000)` to the smallest value that still exceeds the budget across five entries — do not raise the timeout.

- [ ] **Step 6: Mutation-prove each stage separately**

Four mutants, each reverted before the next. Record every one as `N failed / M passed`; the sum must be 45.

**Mutant A — no map budget at all.** Change the stage-2 and stage-3 guards to `if (false)`.
Expected: `2 failed / 43 passed` — `strips old rolls before dropping any entry` and `drops whole entries once there are no rolls left`.

**Mutant B — strip does not remove all three fields.** Delete `delete stripped.dailyWindow;`.
Expected: `1 failed / 44 passed` — `strips old rolls before dropping any entry`, on the `dailyWindow` assertion. This is the mutant that matters most: a stripped entry keeping its window is a coverage claim about data that is gone.

**Mutant C — the saved entry is a candidate.** Change `shedOrder(out, projectId)` to `shedOrder(out, "")` at both call sites.
Expected: `1 failed / 44 passed` — `never strips or evicts the entry being saved`.

**Mutant D — shed newest-first.** Invert the comparator in `shedOrder` (swap `a` and `b`).
Expected: `1 failed / 44 passed` — `drops whole entries once there are no rolls left`, on the `q0` / `q5` assertions.

If any mutant survives, the corresponding fixture does not discriminate and must be strengthened before proceeding.

After each, restore and confirm:

```bash
git diff --stat src/app/timelog-actuals-store.ts
```

- [ ] **Step 7: Update the `withBoundedDaily` docstring**

That docstring currently states the hole this task closes. Find it:

```bash
grep -n "It is a real hole" src/app/timelog-actuals-store.ts
```

Replace the paragraph reading `★★★ WHAT IT DOES NOT PROTECT AGAINST, stated plainly: …` through `… `MAX_PROJECTS` eviction ALONE, which counts entries and never measures them.` with:

```
 *  ★★★ WHAT IT DOES NOT PROTECT AGAINST, stated plainly: this is a PER-ENTRY
 *  bound, so 50 entries (`MAX_PROJECTS`) each sitting just under it is ~25 MB
 *  and would blow the origin quota exactly as before. That hole is now closed
 *  one level up by `MAX_ACTUALS_TOTAL_CHARS`, which measures the whole
 *  serialised map on every save; this bound alone never did.
```

Leave the `★ Per-entry was chosen over a whole-map budget…` paragraph below it exactly as it is — it explains why a whole-map TRIM is still forbidden, which the new stage-2 STRIP deliberately does not do, and it remains true.

- [ ] **Step 8: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 9: Commit**

```bash
git commit --only src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts -m "fix(timelog): bound the actuals cache by measured size, not entry count

open-followups §361. MAX_PROJECTS counts entries and never measures them, and
MAX_DAILY_ROLL_CHARS is per-entry, so 50 entries each just under budget is
~25 MB against a ~5 MB shared origin quota. writeDeviceJson swallows the quota
error, so the entire save -- aggregates included -- was lost silently.

MAX_ACTUALS_TOTAL_CHARS (2 MiB) bounds the whole serialised map. Shedding runs
in three stages, re-measuring between each: count eviction unchanged, then
strip daily + dailyWindow + dailyUsers TOGETHER from the oldest entries while
keeping their aggregates, then drop whole entries oldest-first.

Stripping before dropping honours the rule withBoundedDaily's own docstring
already states -- losing the roll must never cost the aggregates beside it --
and is safe for the reason §361 gives for whole-entry eviction: the three
fields go together, so a stripped entry claims no coverage, the reconcile
predicate returns false and the insight freezes, which is recoverable. It is a
strip, never a trim: narrowing another project's dailyWindow during this
project's save would falsify a coverage claim and fabricate an 'improved'
outcome into exported data.

The entry being saved is never a shedding candidate at any stage."
```

---

### Task 4: Update the register

**Files:**
- Modify: `docs/open-followups.md` (§361, §363, §367)

`docs/open-followups.md` is **LF-only** (`git ls-files --eol` reports `i/lf w/lf attr/text eol=lf`). Never introduce a CR byte.

Read the three entries first:

```bash
grep -nE "^## 36(1|3|7)\." docs/open-followups.md
```

- [ ] **Step 1: Close §361 and §367, narrow §363**

Run these three commands FIRST and keep their output — the Status lines below cite them, and a Status line citing a command you did not run is the exact fabrication the gate exists to prevent:

```bash
grep -n "MAX_ACTUALS_TOTAL_CHARS\|shedOrder" src/app/timelog-actuals-store.ts
grep -n "KEY_DATE_RE" src/app/timelog-types.ts
grep -n "RESERVED_NON_GUARDRAIL\|GUARDRAIL_INSIGHT_TYPES" src/app/insights/insight.ts src/app/insights/reconcile.ts
```

**§361** — change the heading suffix to `— CLOSED 2026-09-07`. Replace its `**Status:**` line with:

```
**Status:** Fixed by the guardrail-bounds slice, 2026-09-07. Verified by command:
`grep -n "MAX_ACTUALS_TOTAL_CHARS\|shedOrder" src/app/timelog-actuals-store.ts` returns the
map-level budget and the shedding order that `saveActualsCache` now measures against on every
save; `npx vitest run src/app/timelog-actuals-store.test.ts` covers all three stages plus the
within-budget control.
```

Then append this paragraph to the body:

```
★★ THE CLOSURE TAKEN IS NOT THE ONE THIS ENTRY NAMED, and the difference is worth recording.
The entry proposed making `MAX_PROJECTS` eviction size-based, which keeps whole-entry drops. What
shipped sheds in three stages and STRIPS `daily` + `dailyWindow` + `dailyUsers` together from the
oldest entries before dropping anything whole, because `withBoundedDaily`'s own docstring already
forbids the cheaper option: losing the roll must never cost the `aggregates` beside it, and
whole-entry eviction throws away exactly what the network round trip bought. Stripping is safe for
the same reason the entry gives for whole-entry eviction — the three fields go together, so a
stripped entry claims no coverage and the reconcile freezes rather than clears. It is a STRIP and
never a TRIM: narrowing another project's window during this project's save is still forbidden,
for the reason the paragraph above already gives.
```

**§367** — change the heading suffix to `— CLOSED 2026-09-07`. Replace its `**Status:**` line with:

```
**Status:** Fixed by the guardrail-bounds slice, 2026-09-07. Verified by command:
`grep -n "KEY_DATE_RE" src/app/timelog-types.ts` returns the key-date rule and the guard in
`parseDailyKey` that now applies it; `npx vitest run src/app/timelog-types.test.ts
src/app/timelog-policy.test.ts` covers the rejection, the shape-not-existence control, and the
policy path.
```

Then append this paragraph to the body:

```
★★ HALF OF THIS ENTRY WAS ALREADY CLOSED WHEN IT WAS FILED, which is why the headline overstated
it. The oversized-cell half could not reach the store: `withBoundedDaily` skips any key failing its
own `ISO_DATE_RE` before building its retention list, so a key with a 600,000-character date half
never entered that list and was dropped on the next trim. The reachable half was the policy engine,
where the malformed date flowed into `firstViolationDate` / `lastViolationDate` and the downstream
window comparison then failed — freezing the insight, the safe direction. That is the half
`KEY_DATE_RE` closes. The check is SHAPE, never existence: `9999-99-99` is still admitted, because
its only job is to make `<` and `>` comparisons on the date lexicographically meaningful.
```

**§363** — heading stays **OPEN** and unchanged. Replace its `★ WHAT REMAINS OPEN` paragraph with:

```
★ WHAT REMAINS OPEN is the plain cap: with more than `MAX_INSIGHTS` rows of one severity, frozen
rows can still be dropped — they are simply no longer SELECTED for it. Losing a row is strictly
better than fabricating an `"improved"` outcome for it, so the residue is a NOTE, not a defect.
★★ THE STARVATION HALF IS FIXED as of 2026-09-07 and this paragraph used to carry it: guardrail
cardinality is 4 × (TimeLog users seen in a fetch) at `"medium"` with no cap in `detect.ts`, so an
org-scope fetch pushed `"low"`-severity core insights — `overdueTrend`, the app's only `low` — out
of the cap entirely. `RESERVED_NON_GUARDRAIL` now holds 60 of the 200 slots against the guardrail
family, and a second admission pass hands unclaimed reserved slots back so the list is never
shorter than the plain slice it replaced.
★★★ DO NOT CLOSE THE RESIDUE BY CAPPING `detect.ts`. It is the obvious move and it fabricates
data. Capping `timelogGuardrailInsights` drops rows from `detected`, and `reconcileInsights` reads
"absent from the detection set" as "the condition cleared" unless `isEvaluated` says otherwise —
a predicate built at the `task-manager.tsx` call site from the daily roll, which cannot see a cap
applied inside `detect.ts`. A capped-out row whose violating days the roll covers therefore passes
the window check, finds no violation, and resolves through `computeClearedOutcome` — which always
writes `"improved"` — into `Workspace.insights`, which is shared, exported, and read on every AI
turn. Any future bound on guardrail generation must be visible to `isEvaluated`, so that a
capped-out row reads as NOT EVALUATED and freezes rather than clearing.
```

Also update §363's `**Status:**` line to carry the new date and command:

```
**Status:** OPEN, residue only. Narrowed twice — 2026-09-04 (the sinking half) and 2026-09-07 (the
starvation half). Verified by command:
`grep -n "RESERVED_NON_GUARDRAIL\|GUARDRAIL_INSIGHT_TYPES" src/app/insights/insight.ts src/app/insights/reconcile.ts`
returns the reservation, the guardrail family and the two-pass admission that applies them. What
remains open — a frozen row still competing at the plain cap — is never machine-verified.
```

Every `**Status:**` line must satisfy the blocking gate: it begins with the literal `**Status:**`, must NOT contain the word CLOSED (the `##` heading owns closure, and a body line claiming it breaks every count in the register), carries at least one ISO date, and names an EXECUTED verification in command shape (`grep` / `npm run` / `npx` / `node scripts`) or says `never machine-verified`.

★★ **THE CLOSED CHECK IS CASE-SENSITIVE, AND THE STATUS LINES ABOVE ARE WRITTEN NOT TO DEPEND ON THAT.** The predicate is `/\bCLOSED\b/` with no `i` flag (`scripts/followup-status-lib.mjs`, the `SAYS_CLOSED` push), so `Closed by …` passes today. Do not lean on that — a gate you satisfy by letter case is one the next editor breaks by capitalising a word. Use `Fixed by the guardrail-bounds slice, 2026-09-07.` in both §361 and §367 instead, which is true, reads the same, and cannot be broken by a capitalisation. Verify the choice rather than trusting this paragraph:

```bash
grep -n "CLOSED" scripts/followup-status-lib.mjs
```

- [ ] **Step 2: Add the three index rows / adjust existing ones**

§361, §363 and §367 already have index rows. Closure changes no row, so this step is a CHECK, not an edit — run the gate and act only on what it reports.

- [ ] **Step 3: Run the register gates**

```bash
npm run followups:index:check > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/idx.log 2>&1; echo "EXIT=$?"
cat /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/idx.log
npm run followups:status:check > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/sts.log 2>&1; echo "EXIT=$?"
tail -20 /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/sts.log
npm run docs:claims:check > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/claims.log 2>&1; echo "EXIT=$?"
tail -12 /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/claims.log
```

Expected: `EXIT=0` for all three.

**Exit 1 is DRIFT; exit 2 is the gate unable to scan** — the two demand opposite responses. Exit 2 means the register's shape broke; fix that before reading any result. `docs:claims:check` is a RATCHET: it fails on any NEW `path:LINE` citation, so cite SYMBOLS in the register text, never a line number.

- [ ] **Step 4: Verify no CR byte entered the register**

```bash
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
```

Expected: `CR: 0`.

- [ ] **Step 5: Commit**

```bash
git commit --only docs/open-followups.md -m "docs(followups): close §361 and §367, narrow §363

§361 CLOSED -- the actuals cache is now bounded by measured size. Records that
the closure taken strips rolls before dropping entries, rather than the
size-based whole-entry eviction the entry itself named: withBoundedDaily's
docstring already forbids losing the aggregates with the roll.

§367 CLOSED -- parseDailyKey validates the date shape. Records that the store
half was already closed before this slice, since withBoundedDaily skips any key
failing ISO_DATE_RE, so the oversized cell never entered the retention set. The
policy path was the reachable half.

§363 stays OPEN with its residue unchanged -- the plain cap can still evict a
frozen row. Its 'pushes low-severity core insights out of the cap entirely'
claim is superseded by RESERVED_NON_GUARDRAIL, and the entry gains the
correction that a cap in detect.ts is unsafe, with the mechanism named, so the
next reader does not attempt it."
```

---

### Task 5: Whole-branch verification

**Files:** none modified.

- [ ] **Step 1: Run every touched test file in one process**

Never run two vitest processes at once.

```bash
npx vitest run src/app/timelog-types.test.ts src/app/timelog-policy.test.ts src/app/timelog-actuals-store.test.ts src/app/insights/reconcile.test.ts src/app/insights/detect.test.ts > /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/all.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad/all.log
```

Expected: `EXIT=0` and `Test Files  5 passed (5)`.

**Assert `Test Files 5` against the five paths you passed, never the test tally.** A missing test path behaves differently depending on context: alone it exits 1 with `No test files found`, but MIXED with real paths it is dropped SILENTLY at exit 0.

`detect.test.ts` is included because Task 2's reasoning is about `detect.ts` even though no line of it changes — a red there would mean the guardrail family assumption is wrong.

- [ ] **Step 2: Run the consumers this branch did not touch but could break**

`parseDailyKey` and `reconcileInsights` have callers outside the files above.

```bash
grep -rln "reconcileInsights\|parseDailyKey\|saveActualsCache" src --include=*.test.ts --include=*.test.tsx
```

Run every file that command names, in ONE vitest invocation, and assert `Test Files N` equals the number of paths you passed.

- [ ] **Step 3: Final typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. Use `npx eslint --max-warnings=0 src`, not `npm run lint` — the latter exits 1 from gitignored `.worktrees/` and `.demo-tmp/` leftovers.

- [ ] **Step 4: Confirm the working tree holds nothing unintended**

```bash
git status --porcelain --untracked-files=all
git log --oneline origin/main..HEAD
```

Expected: `git status` shows only `sample-workspace-big.json` / `sample-workspace-huge.json` if they were already dirty (never commit or revert those), and the log shows exactly the four commits from Tasks 1–4.

- [ ] **Step 5: Report, and stop**

Report the mutation scorecards from Tasks 1–3 as `N failed / M passed` with each sum checked against that file's runtime test count, plus the gate exit codes.

**Do not push, do not open an MR, do not merge.** Those need the user's explicit say-so. "release" means push → MR → poll pipeline → merge on green, and merging requires a green pipeline and `--auto-merge=false`.

No version bump and no CHANGELOG entry are part of this plan — the release steps are a separate decision, taken on the user's word.

---

## Notes for the implementer

**Things that will bite you, all measured on this repo:**

- `npx tsc --noEmit` exits **2** on diagnostics, not 1. A script testing for exit 1 reads a broken typecheck as a pass.
- The IDE language server's inline diagnostics are mid-edit snapshots. After a multi-file edit they routinely show phantom errors a real `npx tsc --noEmit` contradicts. Trust tsc.
- `vitest` has no `--reporter=basic` and no `--minWorkers`. Both fail at startup in a way that reads like a broken suite. `--reporter=dot` and `--maxWorkers=N` exist.
- A surviving mutant is a QUESTION, not a pass. "Equivalent mutant" and "missing test" look identical from the harness; separating them needs an input the suite does not have. Go find one.
- When you revert a mutant, assert the anchor is unique in BOTH directions before and after the write, and finish on `git diff --stat` to prove the file is back. `git checkout -- <file>` is deny-blocked here.

---

## Corrections found during execution (2026-09-07)

The plan body above is left exactly as written. Its claims below were falsified while executing it;
each is recorded here with what shipped instead. Read this section before treating any assertion,
comment or fixture in the plan as a specification.

★★★ THIS SECTION ONCE SAID "FOUR OF ITS CLAIMS", AND A COUNT WAS THE WRONG SHAPE FOR IT. It was
written at `53d48ac1`, which precedes `3fdd3f40` — the commit that added a whole shedding stage — so
the list was closed before execution was. Four more clusters (items 5-8) were found by cold review
afterwards. A checklist item that is a SET must not carry a number: the number tells a reader when to
stop, and the only honest stopping rule for a set is an enumeration someone actually ran. Treat the
list as open.

**1. Task 2, test 1's third assertion was wrong, and it contradicted the plan's own test 2.** It
asserted the surviving guardrail count as `MAX_INSIGHTS - RESERVED_NON_GUARDRAIL` (140). The true
value for that fixture is 199: its single non-guardrail row (`overdueTrend`) claims one reserved
slot, and the top-up pass hands the other 59 back to the guardrails pass one deferred. The plan's
test 2 — "a reservation that nobody claims must not shorten the list" — REQUIRES that hand-back, so
the two tests as written could not both pass. Shipped as `MAX_INSIGHTS - 1`, with a comment naming
the arithmetic, plus a fourth test whose fixture supplies enough non-guardrail rows to actually
claim the reservation, so `RESERVED_NON_GUARDRAIL` stays pinned to a value rather than dropping out
of the suite.

**2. Task 1's test comment cited the wrong file.** It said `timelog-policy.ts` compares violation
bounds against a roll window. That comparison is in `task-manager.tsx`, where `isEvaluated` is built.
The policy engine only TRACKS the bounds (`firstViolationDate` / `lastViolationDate`); it never
compares them against a window.

**3. Task 1 was scoped to half of §367.** Validating the date half left the entry's headline defect
constructible through the userId half, because `Number()` strips leading whitespace — see §367's
point 3 in `docs/open-followups.md` for the measurement. Closing it took a second commit adding
`KEY_USER_RE`, and that fix in turn required withholding `evaluated` from a partial read in
`timelog-policy.ts`, which the plan did not anticipate at all.

**4. Task 3's test 2 was vacuous as written, and its fixture had two further defects.** The test
saved ONE big entry and asserted it kept its roll, but the per-entry roll cap is a quarter of the map
budget, so a lone entry can never exceed the map budget and NEITHER shedding stage ran — the
assertion passed with the `keep` exclusion deleted, and the test's own docstring claim of "even alone
over budget" is arithmetically impossible. Shipped as four big entries saved first, then the entry
under test saved LAST carrying the OLDEST `fetchedAt`, which puts it first in the shed order so only
the `keep` exclusion can save it. Separately: the plan's stage-1 restore grew the map to 51 entries,
breaking the `MAX_PROJECTS` cap it sits inside (shipped swapping out the oldest survivor instead),
and its hardcoded `to: "2054-09-08"` was wrong by roughly 25 days (shipped derived from the day
constant rather than written by hand).

**5. THE PLAN DESCRIBES THREE SHEDDING STAGES AND FOUR SHIPPED.** A stage shedding `users` +
`projectRefs` was inserted ahead of the whole-entry drop, so the plan's numbering is off by one from
its own stage 3 onward. ★★★ THE WORST INSTANCE IS A CODE COMMENT: the plan carries
`// Stage 3 — drop whole entries, oldest first.`, and in the shipped code that is Stage 4 — Stage 3
sheds `users` + `projectRefs`. An engineer implementing the plan literally writes a map that spends
`aggregates` on a `users`-heavy entry without ever trying the cheaper shed, which is exactly the
inversion `3fdd3f40` exists to fix. The same off-by-one is in the spec. Read the stage list off
`saveActualsCache` itself, never off either document.

**6. "Admits four full-size rolls" is wrong; it admits three.** Four times `MAX_DAILY_ROLL_CHARS` is
2,097,152 — the budget EXACTLY — so a fourth entry has nothing left for its own key, `fetchedAt`,
`aggregates`, window or the map braces. Measured: four such entries serialise to 2,098,213, over by
1,061. The shipped `MAX_ACTUALS_TOTAL_CHARS` docstring self-corrects this in capitals; the plan and
spec were never updated.

**7. The UTF-16 "for a real roll the two are equal" clause is misscoped onto the MAP budget.** It is
true of a ROLL (ASCII keys, numeric values) and false of the map, which also carries
`users[].firstName` / `lastName` / `email` free text — and in a German-locale product a `ü` is one
UTF-16 unit and two UTF-8 bytes. The shipped docstring says so explicitly and tells the reader NOT to
carry the clause over. ★ The SPEC carries the clause verbatim; the plan carries a PARAPHRASE of it
("is the same number"), so a `grep` for the quoted wording finds the spec and misses the plan — which
is how this survived a sweep that was looking for it.

**8. "The reconcile predicate returns false" is stated unqualified and needs its scope.** It is
qualified to guardrail insights — `3fdd3f40`'s own commit message says so. Unqualified, it reads as a
claim about every insight type, which is not what the predicate does.

★ Items 5-8 were found by a cold reviewer reading the plan against the shipped tree on 2026-09-07,
after the branch was otherwise finished. None of them affects the shipped code — every one is a
defect in this document, which is the failure mode this repository keeps paying for: a plan that
reads as authoritative while being wrong outlives the work it planned.
