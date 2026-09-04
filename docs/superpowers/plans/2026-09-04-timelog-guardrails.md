# TimeLog Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag TimeLog bookings that violate team policy as Insights, and make `reconcileInsights` incapable of resolving an insight type it never evaluated.

**Architecture:** A new pure module `src/app/timelog-policy.ts` evaluates four rules over a new per-(user × date) roll persisted on the existing device actuals cache. The caller in `task-manager.tsx` runs it, hands the resulting violations to `detectInsights` as pre-computed input, and hands the evaluated type set to `reconcileInsights` as a newly **required** argument so an unevaluated type is frozen rather than cleared. Policy rides the existing `TimelogLinks` meta-blob and needs no codec code on any of the six write paths.

**Tech Stack:** TypeScript, React 19, vitest, Next 16.2.11. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-timelog-guardrails-design.md`
**Register entry:** `docs/open-followups.md` §347

---

## Ground rules for every task

These apply to every task below. They are repeated here rather than in each task because forgetting one is silent.

1. **`src/app/*.ts` and `src/app/*.tsx` are CRLF.** Use the **Edit** tool. Never the Write tool (it re-lines the file to LF, invisible to `git diff` under `core.autocrlf=true`). Never `sed -i` (same). Verify with `git ls-files --eol <file>` — healthy is `i/lf w/crlf`.
2. **`src/app/i18n.de.ts` must not be touched with the Edit tool** — it corrupts umlauts and curls double quotes. Patch it with a node utf8 write whose anchor uses `\r\n`. A `\n` anchor silently matches nothing and the write is a no-op that reports success.
3. **Never run two vitest processes at once.** A red run mentioning `Failed to start forks worker` is machine contention, not a failure.
4. **Never read a gate's exit code through a pipe.** Redirect to a file in the session scratchpad, echo `$?` unpiped, then grep the file.
5. **`npx tsc --noEmit` exits 2 on diagnostics**, not 1.
6. **`git checkout -- <file>` is deny-blocked.** Revert a mutation with an inverse anchored Edit, assert the anchor is unique in both directions, and finish on an empty `git diff --stat`.
7. **Mutation-proving means reading which cases fail**, not just that the exit code is non-zero. Record `N failed / M passed` and check the sum equals the file's runtime test count.
8. Commit after every task. Every commit message ends with:
   `Claude-Session: https://[session link removed]`
9. **No release, no version bump.** This plan ends on a green branch. Pushing, the MR and the merge happen separately, on explicit say.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/timelog-policy.ts` | Pure, i18n-free. The four rules and `evaluateTimelogPolicy`. Knows nothing about insights, React or i18n. |
| `src/app/timelog-policy.test.ts` | Rule behaviour, including the three fixtures that would otherwise be vacuous. |

★ Before creating `timelog-policy.ts`, run `ls src/app/timelog-policy.*`. A bare `./timelog-policy` import resolves `.ts` ahead of `.tsx`, so a new pure module can silently hijack an existing component import. Expected: no such file.

★ It is deliberately **not** named `timelog-guardrails.ts`. `src/app/timelog-guards.ts` already exists and is a different concept (TimeLog *action* guards — one contract per action, shared by handler and button, register §74). One character of separation between two unrelated modules is a trap for every future grep.

**Modified:**

| File | Change |
|---|---|
| `src/app/timelog-types.ts` | `TimelogRuleId`, `TimelogRulePolicy`, `TimelogPolicy`, `TimelogDailyCell`, `TimelogDailyRoll`, `dailyKey`; `policy?` on `TimelogLinks` |
| `src/app/timelog-sanitize.ts` | `sanitizeTimelogLinks` admits `policy`, dropping the key when nothing is configured |
| `src/app/timelog-actuals.ts` | `buildDailyRoll(items)` |
| `src/app/timelog-actuals-store.ts` | optional `daily` on `ActualsCacheEntry` + an `isEntry` branch that fails open |
| `src/app/use-timelog-sync.ts` | compute the roll in `finish()`; carry `daily` through **all three** `saveActualsCache` calls |
| `src/app/insights/insight.ts` | four new `INSIGHT_TYPES` members |
| `src/app/insights/insight-text.ts` | four `TITLE_KEY` entries + four `insightDetail` cases |
| `src/app/insights/reconcile.ts` | required `evaluated` argument; freeze instead of clear |
| `src/app/insights/detect.ts` | `timelogViolations` on `InsightInput`; `timelogGuardrailInsights`; `CORE_INSIGHT_TYPES` |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | eight new keys each |
| `src/app/task-manager.tsx` | run the policy module, pass violations to detect and the evaluated set to reconcile |
| `src/app/settings-view.tsx`, `src/app/settings-sections/integrations-section.tsx`, `src/app/timelog-settings.tsx` | thread `timelogLinks` + `onTimelogLinksChange`; render the guardrails section |

**Test files modified:** `src/app/insights/reconcile.test.ts` (every existing `reconcileInsights` call gains the fourth argument), `src/app/timelog-sanitize.test.ts`, `src/app/timelog-links-persistence.test.ts`, `src/app/timelog-actuals-store.test.ts`, `src/app/timelog-settings.test.tsx`.

---

## Naming decision that removes a whole class of drift

`TimelogRuleId` and the four new `InsightType` members are **the same four string literals**. There is no rule→type lookup table, so there is nothing to drift. A type-level assertion in Task 6 pins the identity; if someone later renames one side, tsc fails.

```
"timelogCapPerEntry" | "timelogCapPerDay" | "timelogNonWorkingDay" | "timelogWorkingHours"
```

---

### Task 1: Policy types on `timelog-types.ts`

**Files:**
- Modify: `src/app/timelog-types.ts`

- [ ] **Step 1: Add the types**

Append after the existing `TimelogLinks` declaration, and add `policy?: TimelogPolicy;` to `TimelogLinks` itself.

```ts
/** The four guardrail rules. These literals are ALSO the four guardrail
 *  `InsightType` members — deliberately identical, so no rule→type lookup
 *  table exists to drift. `timelog-policy.test.ts` pins the identity. */
export type TimelogRuleId =
  | "timelogCapPerEntry"
  | "timelogCapPerDay"
  | "timelogNonWorkingDay"
  | "timelogWorkingHours";

export const TIMELOG_RULE_IDS: readonly TimelogRuleId[] = [
  "timelogCapPerEntry",
  "timelogCapPerDay",
  "timelogNonWorkingDay",
  "timelogWorkingHours",
];

/** `threshold` is hours. Absent on the two rules that compare against the
 *  shift rather than a number. */
export type TimelogRulePolicy = { enabled: boolean; threshold?: number };

/** Partial by construction: an unconfigured rule has NO key, which is what
 *  keeps an unconfigured blob byte-stable. */
export type TimelogPolicy = Partial<Record<TimelogRuleId, TimelogRulePolicy>>;

/** One (user, date) cell of the daily roll.
 *  ★ `maxEntryHours` is the whole reason this is a roll and not a sum: a daily
 *  total cannot distinguish one 18h entry from three 6h ones, and
 *  `timelogCapPerEntry` is exactly that distinction. */
export type TimelogDailyCell = {
  hours: number;
  maxEntryHours: number;
  entryCount: number;
};

/** Keyed by `dailyKey(userId, date)`. Sparse — only days carrying bookings. */
export type TimelogDailyRoll = Record<string, TimelogDailyCell>;

export function dailyKey(userId: number, date: string): string {
  return `${userId}|${date}`;
}

export function parseDailyKey(key: string): { userId: number; date: string } | null {
  const i = key.indexOf("|");
  if (i <= 0) return null;
  const userId = Number(key.slice(0, i));
  const date = key.slice(i + 1);
  if (!Number.isInteger(userId) || !date) return null;
  return { userId, date };
}
```

And in `TimelogLinks`:

```ts
export type TimelogLinks = {
  userLinks: TimelogUserLink[];
  projectLinks: TimelogProjectLink[];
  customerId?: number;
  projectIds?: number[];
  /** Guardrail policy. Absent when no rule is configured — see
   *  `sanitizeTimelogLinks`, which drops the key to keep the blob byte-stable. */
  policy?: TimelogPolicy;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`. (Exit 2 means diagnostics.)

- [ ] **Step 3: Commit**

```bash
git add src/app/timelog-types.ts
git commit --only src/app/timelog-types.ts -m "$(cat <<'EOF'
feat(timelog): add guardrail policy and daily-roll types

The rule ids are deliberately identical to the four guardrail InsightType
members that follow, so no rule-to-type lookup table exists to drift.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 2: The four rules — `timelog-policy.ts`

**Files:**
- Create: `src/app/timelog-policy.ts`
- Test: `src/app/timelog-policy.test.ts`

**Scene:** This module is the whole rule layer. It takes a daily roll, a policy, the holiday set, the TimeLog→resource links and the shifts, and returns violations plus the set of rules it actually evaluated. It never imports i18n, React or anything from `insights/`.

**The evaluated-set contract, which is the subtle part.** A rule is evaluated only when it could have produced a true answer:

| Rule | Evaluated when |
|---|---|
| `timelogCapPerEntry` | roll non-null, enabled, and `threshold` is a finite number > 0 |
| `timelogCapPerDay` | same |
| `timelogNonWorkingDay` | roll non-null and enabled (`holidaySet` is always available) |
| `timelogWorkingHours` | roll non-null, enabled, **and at least one user link exists** |

The last row is what stops a false clean. With no links at all the rule can produce nothing, and "produced nothing" is exactly what `clear()` reads as "the condition went away".

- [ ] **Step 1: Check the filename is free**

Run: `ls src/app/timelog-policy.* 2>/dev/null; echo "EXIT=$?"`
Expected: no output, `EXIT` non-zero (no such file). If a `.tsx` exists, stop and rename the new module — a bare `./timelog-policy` import resolves `.ts` first and would hijack it.

- [ ] **Step 2: Write the failing test**

Create `src/app/timelog-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateTimelogPolicy } from "./timelog-policy";
import { dailyKey, type TimelogDailyRoll, type TimelogPolicy } from "./timelog-types";
import type { Shift, WeekHours } from "./types";
import type { TimelogUserLink } from "./timelog-types";

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function roll(cells: Record<string, [hours: number, max: number, count: number]>): TimelogDailyRoll {
  const out: TimelogDailyRoll = {};
  for (const [k, [hours, maxEntryHours, entryCount]] of Object.entries(cells)) {
    out[k] = { hours, maxEntryHours, entryCount };
  }
  return out;
}

function link(timelogUserId: number, resourceId: number): TimelogUserLink {
  return { timelogUserId, resourceId, manual: true };
}

function shift(resourceId: number, hoursPerWeekday: WeekHours): Shift {
  return { id: resourceId, assignee: `r${resourceId}`, hoursPerWeekday, resourceId };
}

// 2026-09-01 is a Tuesday; 2026-09-05 is a Saturday.
const TUE = "2026-09-01";
const WED = "2026-09-02";
const SAT = "2026-09-05";

describe("evaluateTimelogPolicy", () => {
  it("reports no violations and an empty evaluated set when the roll is null", () => {
    const policy: TimelogPolicy = { timelogCapPerDay: { enabled: true, threshold: 8 } };
    const res = evaluateTimelogPolicy({
      daily: null, policy, holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([]);
    expect(res.evaluated).toEqual([]);
  });

  it("does not evaluate a rule that is enabled without a threshold", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  it("does not evaluate a disabled rule even when the roll is present", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: false, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  // ★★★ THE FIXTURE THAT MAKES THIS TEST NON-VACUOUS. The daily SUM (7h) is
  // UNDER the 8h cap while one ENTRY (6.5h) is over a 6h per-entry cap. A
  // fixture whose sum also exceeded the cap would pass with `maxEntryHours`
  // replaced by `hours`, unpinning the entire reason the field exists.
  it("flags an entry over the cap on a day whose total is under the daily cap", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [7, 6.5, 2] }),
      policy: {
        timelogCapPerEntry: { enabled: true, threshold: 6 },
        timelogCapPerDay: { enabled: true, threshold: 8 },
      },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogCapPerEntry", "timelogCapPerDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogCapPerEntry", timelogUserId: 7, resourceId: null, count: 1, worstHours: 6.5, threshold: 6 },
    ]);
  });

  it("does not flag a value exactly at the cap", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [8, 8, 1] }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([]);
  });

  it("aggregates per user and reports the worst value and the day count", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, TUE)]: [10, 10, 1],
        [dailyKey(7, WED)]: [12, 12, 1],
        [dailyKey(9, TUE)]: [9, 9, 1],
      }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([
      { rule: "timelogCapPerDay", timelogUserId: 7, resourceId: null, count: 2, worstHours: 12, threshold: 8 },
      { rule: "timelogCapPerDay", timelogUserId: 9, resourceId: null, count: 1, worstHours: 9, threshold: 8 },
    ]);
  });

  it("flags a booking on a holiday with no link required", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [4, 4, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: new Set([TUE]),
      userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogNonWorkingDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: null, count: 1, worstHours: 4, threshold: 0 },
    ]);
  });

  it("flags a booking on a zero-hour weekday when a shift resolves", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, SAT)]: [3, 3, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [shift(40, [0, 8, 8, 8, 8, 8, 0])],
    });
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 3, threshold: 0 },
    ]);
  });

  // ★★ FIXTURE (c-i) — DARK. No link at all: the rule must not be evaluated,
  // so nothing downstream can read its silence as "no violations".
  it("does not evaluate working hours when no user link exists", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS,
      userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  // ★★ FIXTURE (c-ii) — DEFAULTED. A link but no shift: the rule IS evaluated,
  // against DEFAULT_WEEK_HOURS. Distinct from (c-i); one does not imply the other.
  it("evaluates working hours against the default week when a link has no shift", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogWorkingHours"]);
    expect(res.violations).toEqual([
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 12, threshold: 8 },
    ]);
  });

  it("leaves an unlinked user unchecked while the rule is evaluated for a linked one", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, TUE)]: [12, 12, 1],
        [dailyKey(8, TUE)]: [12, 12, 1],
      }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [shift(40, [0, 6, 8, 8, 8, 8, 0])],
    });
    expect(res.evaluated).toEqual(["timelogWorkingHours"]);
    expect(res.violations).toEqual([
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 12, threshold: 6 },
    ]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/app/timelog-policy.test.ts > "$SCRATCH/policy-red.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Cannot find" "$SCRATCH/policy-red.log"`

(`SCRATCH` is the session scratchpad directory named in the environment block. Do not use `/tmp`.)

Expected: non-zero exit, `Cannot find module './timelog-policy'`.

- [ ] **Step 4: Implement**

Create `src/app/timelog-policy.ts`:

```ts
// Pure, i18n-free. The four TimeLog guardrail rules.
//
// ★★★ REVIEW-TIME, NOT CREATE-TIME. OpenProject's equivalents are validations on
// entries its own users write. Cockpit never writes a time entry, so these flag
// bookings already made elsewhere. Nothing is blocked.
//
// ★★★ THE EVALUATED SET IS THE LOAD-BEARING RETURN VALUE, not the violations.
// `reconcileInsights` resolves a stored insight whose key stops being detected;
// for a rule that can go DARK, "produced nothing" means "not evaluated", not
// "not violated". A rule therefore reports itself evaluated only when it could
// have produced a true answer — see the per-rule conditions below.
//
// ★ NOT named timelog-guardrails.ts: `timelog-guards.ts` is a different concept
// (per-action handler/button guard parity, open-followups §74).
import {
  TIMELOG_RULE_IDS,
  parseDailyKey,
  type TimelogDailyRoll,
  type TimelogPolicy,
  type TimelogRuleId,
  type TimelogUserLink,
} from "./timelog-types";
import { DEFAULT_WEEK_HOURS, type Shift } from "./types";

export interface TimelogViolation {
  readonly rule: TimelogRuleId;
  readonly timelogUserId: number;
  /** null when no user link resolves — the person is identified by TimeLog id. */
  readonly resourceId: number | null;
  /** Offending days (or, for capPerEntry, offending days carrying an offending
   *  entry). Lower-is-better, which is what metricAtAction/delta require. */
  readonly count: number;
  readonly worstHours: number;
  /** The number compared against. 0 for the two rules that have no cap. */
  readonly threshold: number;
}

export interface TimelogPolicyInput {
  /** null when no fetch has produced a roll on this device. */
  readonly daily: TimelogDailyRoll | null;
  readonly policy: TimelogPolicy | undefined;
  readonly holidaySet: ReadonlySet<string>;
  readonly userLinks: readonly TimelogUserLink[];
  readonly shifts: readonly Shift[];
}

export interface TimelogPolicyResult {
  readonly violations: readonly TimelogViolation[];
  /** In TIMELOG_RULE_IDS order. Empty when nothing could be evaluated. */
  readonly evaluated: readonly TimelogRuleId[];
}

const EMPTY: TimelogPolicyResult = { violations: [], evaluated: [] };

function isCap(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Weekday index matching WeekHours: 0 = Sunday. Parsed from the ISO date
 *  directly rather than via `new Date(s)`, which is timezone-dependent. */
function weekdayIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

type Accum = { count: number; worstHours: number; threshold: number; resourceId: number | null };

function bump(m: Map<number, Accum>, userId: number, resourceId: number | null, hours: number, threshold: number): void {
  const cur = m.get(userId);
  if (cur === undefined) {
    m.set(userId, { count: 1, worstHours: hours, threshold, resourceId });
    return;
  }
  cur.count += 1;
  if (hours > cur.worstHours) {
    cur.worstHours = hours;
    cur.threshold = threshold;
  }
}

function drain(rule: TimelogRuleId, m: Map<number, Accum>): TimelogViolation[] {
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timelogUserId, a]) => ({
      rule,
      timelogUserId,
      resourceId: a.resourceId,
      count: a.count,
      worstHours: a.worstHours,
      threshold: a.threshold,
    }));
}

export function evaluateTimelogPolicy(input: TimelogPolicyInput): TimelogPolicyResult {
  const { daily, policy, holidaySet, userLinks, shifts } = input;
  if (daily === null || policy === undefined) return EMPTY;

  const userToResource = new Map(userLinks.map((l) => [l.timelogUserId, l.resourceId]));
  const resourceToShift = new Map<number, Shift>();
  for (const s of shifts) {
    if (typeof s.resourceId === "number") resourceToShift.set(s.resourceId, s);
  }

  const entryCap = policy.timelogCapPerEntry;
  const dayCap = policy.timelogCapPerDay;
  const nonWorking = policy.timelogNonWorkingDay;
  const working = policy.timelogWorkingHours;

  const doEntry = entryCap?.enabled === true && isCap(entryCap.threshold);
  const doDay = dayCap?.enabled === true && isCap(dayCap.threshold);
  const doNonWorking = nonWorking?.enabled === true;
  // ★★ The link floor is what stops a false clean: with no links this rule can
  // produce nothing, and producing nothing is what clear() reads as "resolved".
  const doWorking = working?.enabled === true && userLinks.length > 0;

  const perEntry = new Map<number, Accum>();
  const perDay = new Map<number, Accum>();
  const perNonWorking = new Map<number, Accum>();
  const perWorking = new Map<number, Accum>();

  for (const [key, cell] of Object.entries(daily)) {
    const parsed = parseDailyKey(key);
    if (parsed === null) continue;
    const { userId, date } = parsed;
    const resourceId = userToResource.get(userId) ?? null;
    const shift = resourceId === null ? undefined : resourceToShift.get(resourceId);
    const weekday = weekdayIndex(date);
    const definedHours =
      resourceId === null || weekday === null
        ? null
        : (shift?.hoursPerWeekday ?? DEFAULT_WEEK_HOURS)[weekday];

    if (doEntry && cell.maxEntryHours > (entryCap.threshold as number)) {
      bump(perEntry, userId, resourceId, cell.maxEntryHours, entryCap.threshold as number);
    }
    if (doDay && cell.hours > (dayCap.threshold as number)) {
      bump(perDay, userId, resourceId, cell.hours, dayCap.threshold as number);
    }
    if (doNonWorking && (holidaySet.has(date) || definedHours === 0)) {
      bump(perNonWorking, userId, resourceId, cell.hours, 0);
    }
    // A user with no link contributes nothing here, which is correct: the rule
    // is evaluated (some link exists) but this person is simply unchecked.
    if (doWorking && definedHours !== null && definedHours > 0 && cell.hours > definedHours) {
      bump(perWorking, userId, resourceId, cell.hours, definedHours);
    }
  }

  const evaluated: TimelogRuleId[] = [];
  const violations: TimelogViolation[] = [];
  const byRule: Record<TimelogRuleId, { on: boolean; acc: Map<number, Accum> }> = {
    timelogCapPerEntry: { on: doEntry, acc: perEntry },
    timelogCapPerDay: { on: doDay, acc: perDay },
    timelogNonWorkingDay: { on: doNonWorking, acc: perNonWorking },
    timelogWorkingHours: { on: doWorking, acc: perWorking },
  };
  for (const rule of TIMELOG_RULE_IDS) {
    const { on, acc } = byRule[rule];
    if (!on) continue;
    evaluated.push(rule);
    violations.push(...drain(rule, acc));
  }
  return { violations, evaluated };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/timelog-policy.test.ts > "$SCRATCH/policy-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/policy-green.log"`
Expected: `EXIT=0`, `Tests  11 passed`.

- [ ] **Step 6: Mutation-prove the `maxEntryHours` fixture (trap (a))**

Edit `timelog-policy.ts`, replacing exactly

```ts
    if (doEntry && cell.maxEntryHours > (entryCap.threshold as number)) {
      bump(perEntry, userId, resourceId, cell.maxEntryHours, entryCap.threshold as number);
```

with

```ts
    if (doEntry && cell.hours > (entryCap.threshold as number)) {
      bump(perEntry, userId, resourceId, cell.hours, entryCap.threshold as number);
```

Run: `npx vitest run src/app/timelog-policy.test.ts > "$SCRATCH/policy-mutant-a.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/policy-mutant-a.log"`

Expected: `EXIT` non-zero, and the failing case named must be **"flags an entry over the cap on a day whose total is under the daily cap"**. Record `N failed / M passed`; `N + M` must equal 11. If that specific case is not among the failures, the fixture is vacuous — fix the fixture, not the assertion.

- [ ] **Step 7: Revert the mutant and prove the tree is clean**

Apply the inverse Edit (swap the two blocks back). Before applying, confirm the mutant text appears exactly once:

```bash
grep -c "cell.hours > (entryCap.threshold as number)" src/app/timelog-policy.ts
```
Expected: `1`. After the revert, confirm the original appears exactly once and the mutant zero times:

```bash
grep -c "cell.maxEntryHours > (entryCap.threshold as number)" src/app/timelog-policy.ts
grep -c "cell.hours > (entryCap.threshold as number)" src/app/timelog-policy.ts
git diff --stat
```
Expected: `1`, `0`, and **empty** `git diff --stat` output.

- [ ] **Step 8: Mutation-prove the dark/defaulted split (trap (c))**

Edit `timelog-policy.ts`, changing

```ts
  const doWorking = working?.enabled === true && userLinks.length > 0;
```
to
```ts
  const doWorking = working?.enabled === true;
```

Run the suite as in Step 6. Expected: the failing case is **"does not evaluate working hours when no user link exists"** and *only* that one — if "evaluates working hours against the default week when a link has no shift" also fails, the two fixtures are not independent and one is masking the other.

Revert with the inverse Edit, assert uniqueness both directions, and end on an empty `git diff --stat`.

- [ ] **Step 9: Lint and typecheck**

```bash
npx eslint --max-warnings=0 src/app/timelog-policy.ts src/app/timelog-policy.test.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0` both.

- [ ] **Step 10: Commit**

```bash
git add src/app/timelog-policy.ts src/app/timelog-policy.test.ts
git commit --only src/app/timelog-policy.ts src/app/timelog-policy.test.ts -m "$(cat <<'EOF'
feat(timelog): add the four guardrail rules as a pure module

Review-time, not create-time: Cockpit never writes a time entry, so these flag
bookings already made in TimeLog.

The evaluated set is the load-bearing return value. A rule reports itself
evaluated only when it could have produced a true answer — in particular
timelogWorkingHours requires at least one user link, because with none it can
produce nothing and reconcile would read that silence as "resolved".

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 3: Admit `policy` in `sanitizeTimelogLinks`, byte-stably

**Files:**
- Modify: `src/app/timelog-sanitize.ts`
- Test: `src/app/timelog-sanitize.test.ts`

**Scene:** `TimelogLinks` reaches all six write paths as a whole-blob `JSON.stringify` (`timelogLinksToCsv`, `timelogLinksToMarkdown`, Turso's stringified meta value, JSON and IndexedDB carrying the object). **No codec code is needed anywhere.** The only requirement is that the sanitizer admits `policy` and **drops the key** when nothing is configured — the same thing it already does for `customerId` and `projectIds`, and for the same reason: `golden-workspace.test` pins these bytes and an added key reads as a real format change.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/timelog-sanitize.test.ts`:

```ts
describe("sanitizeTimelogLinks policy", () => {
  const base = { userLinks: [], projectLinks: [] };

  // ★★ TRAP (d): the round-trip alone does not protect golden-workspace.test.
  // This is the half that does — an unconfigured blob must be byte-identical
  // to what it was before `policy` existed.
  it("omits the policy key entirely when no rule is configured", () => {
    const out = sanitizeTimelogLinks({ ...base });
    expect(out).toBeDefined();
    expect(Object.keys(out as object)).toEqual(["userLinks", "projectLinks"]);
    expect(JSON.stringify(out)).toBe('{"userLinks":[],"projectLinks":[]}');
  });

  it("omits the policy key when the policy object is present but empty", () => {
    const out = sanitizeTimelogLinks({ ...base, policy: {} });
    expect(JSON.stringify(out)).toBe('{"userLinks":[],"projectLinks":[]}');
  });

  it("keeps a configured rule and its threshold", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: { timelogCapPerDay: { enabled: true, threshold: 10 } },
    });
    expect(out?.policy).toEqual({ timelogCapPerDay: { enabled: true, threshold: 10 } });
  });

  it("keeps a disabled rule, because off is a decision the user made", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: { timelogCapPerDay: { enabled: false, threshold: 10 } },
    });
    expect(out?.policy).toEqual({ timelogCapPerDay: { enabled: false, threshold: 10 } });
  });

  it("drops an unknown rule id", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: { nope: { enabled: true, threshold: 3 }, timelogNonWorkingDay: { enabled: true } },
    });
    expect(out?.policy).toEqual({ timelogNonWorkingDay: { enabled: true } });
  });

  it("drops a non-finite or out-of-range threshold but keeps the enabled flag", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: {
        timelogCapPerDay: { enabled: true, threshold: Number.NaN },
        timelogCapPerEntry: { enabled: true, threshold: 999 },
      },
    });
    expect(out?.policy).toEqual({
      timelogCapPerDay: { enabled: true },
      timelogCapPerEntry: { enabled: true },
    });
  });

  it("ignores a non-object policy without dropping the links", () => {
    const out = sanitizeTimelogLinks({ ...base, policy: "yes" });
    expect(out).toEqual({ userLinks: [], projectLinks: [] });
  });
});
```

Add `MAX_HOURS_PER_DAY` to the test's imports if the linter asks for it; the value `999` above is rejected because it exceeds it.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/timelog-sanitize.test.ts > "$SCRATCH/sanitize-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/sanitize-red.log"`
Expected: non-zero exit; the four policy-keeping cases fail because `policy` is dropped. The two "omits" cases already pass — they are the regression pins, and passing now is correct.

- [ ] **Step 3: Implement**

In `src/app/timelog-sanitize.ts`, add the import and the helper, then the return-object spread.

Import line — add to the existing `./timelog-types` import:

```ts
  TIMELOG_RULE_IDS, type TimelogPolicy, type TimelogRuleId,
```

Add `MAX_HOURS_PER_DAY` from `./types`:

```ts
import { MAX_HOURS_PER_DAY } from "./types";
```

Helper, placed above `sanitizeTimelogLinks`:

```ts
// Guardrail policy. Mirrors the customerId/projectIds treatment directly above:
// an unconfigured rule contributes NO key, and an entirely unconfigured policy
// contributes no `policy` key at all, so a blob that predates this feature
// serialises byte-identically. golden-workspace.test pins those bytes.
function sanitizeTimelogPolicy(raw: unknown): TimelogPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: TimelogPolicy = {};
  for (const rule of TIMELOG_RULE_IDS) {
    const v = r[rule];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const threshold =
      isNum(o.threshold) && o.threshold > 0 && o.threshold <= MAX_HOURS_PER_DAY
        ? o.threshold
        : undefined;
    out[rule as TimelogRuleId] = {
      enabled: Boolean(o.enabled),
      ...(threshold !== undefined ? { threshold } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

And in the return of `sanitizeTimelogLinks`:

```ts
  const policy = sanitizeTimelogPolicy(r.policy);
  return {
    userLinks,
    projectLinks,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(projectIds.length > 0 ? { projectIds } : {}),
    ...(policy !== undefined ? { policy } : {}),
  };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/timelog-sanitize.test.ts src/app/timelog-links-persistence.test.ts > "$SCRATCH/sanitize-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/sanitize-green.log"`
Expected: `EXIT=0`.

- [ ] **Step 5: Prove the golden bytes did not move**

Run: `npx vitest run src/app/golden-workspace.test.ts > "$SCRATCH/golden.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/golden.log"`
Expected: `EXIT=0`. **If this is red, do not regenerate the fixtures** — a red run here means the empty-policy key is being emitted, which is the defect this task exists to avoid.

- [ ] **Step 6: Mutation-prove the byte-stability pin**

Edit the return so the key is always present:

```ts
    ...(policy !== undefined ? { policy } : {}),
```
becomes
```ts
    policy: policy ?? {},
```

Run: `npx vitest run src/app/timelog-sanitize.test.ts src/app/golden-workspace.test.ts > "$SCRATCH/sanitize-mutant.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/sanitize-mutant.log"`

Expected: red, and the named failures must include **"omits the policy key entirely when no rule is configured"** *and* at least one `golden-workspace` case. Two independent detectors is the point — if only one fires, say which in the commit message.

Revert with the inverse Edit, `grep -c` both spellings (expect `1` for the guarded form, `0` for the mutant), and finish on an empty `git diff --stat`.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx eslint --max-warnings=0 src/app/timelog-sanitize.ts src/app/timelog-sanitize.test.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/timelog-sanitize.ts src/app/timelog-sanitize.test.ts
git commit --only src/app/timelog-sanitize.ts src/app/timelog-sanitize.test.ts -m "$(cat <<'EOF'
feat(timelog): persist guardrail policy on the TimelogLinks blob

Both codecs are whole-blob JSON.stringify, so no codec code is needed on any of
the six write paths — only the sanitizer. It drops the policy key when nothing
is configured, the same treatment customerId and projectIds already get, so an
unconfigured workspace serialises byte-identically and golden-workspace.test's
pinned bytes do not move.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 4: The daily roll — build it and persist it

**Files:**
- Modify: `src/app/timelog-actuals.ts`, `src/app/timelog-actuals-store.ts`
- Test: `src/app/timelog-actuals.test.ts`, `src/app/timelog-actuals-store.test.ts`

**Scene, and why this task exists at all.** `aggregateActuals` reduces items to `{byBucket, byResource, unattributed}`: the calendar date collapses to `periodKeyForDate(it.date, granularity)` (a month or week key), per-entry hours are summed into a `HourCell`, and `unattributed` swallows every item whose user *or* project is unlinked. So **nothing persisted today can answer any of the four rules.** The roll is the new input.

- [ ] **Step 1: Write the failing test for `buildDailyRoll`**

Append to `src/app/timelog-actuals.test.ts`:

```ts
describe("buildDailyRoll", () => {
  const item = (userId: number, date: string, hours: number): TimelogTimeItem => ({
    timeRegistrationId: Math.round(Math.random() * 1e9),
    userId, projectId: 1, projectName: "P", projectNo: "1", taskId: 1,
    date, hours, billableHours: hours, isBillable: true,
  });

  it("sums hours per user and date and records the largest single entry", () => {
    const roll = buildDailyRoll([
      item(7, "2026-09-01", 3),
      item(7, "2026-09-01", 4.5),
      item(7, "2026-09-02", 8),
      item(9, "2026-09-01", 2),
    ]);
    expect(roll).toEqual({
      "7|2026-09-01": { hours: 7.5, maxEntryHours: 4.5, entryCount: 2 },
      "7|2026-09-02": { hours: 8, maxEntryHours: 8, entryCount: 1 },
      "9|2026-09-01": { hours: 2, maxEntryHours: 2, entryCount: 1 },
    });
  });

  // ★★ The roll must NOT reproduce aggregateActuals' attribution: it is the
  // input to rules about a PERSON's day, and an unlinked project is still that
  // person's time. Dropping ProjectID 0 (absence / non-project time) here would
  // make the daily total under-report against the very cap it is checked by.
  it("keeps non-project time, which aggregation folds into unattributed", () => {
    const zero = { ...item(7, "2026-09-01", 5), projectId: 0, projectName: "", projectNo: "" };
    expect(buildDailyRoll([zero])["7|2026-09-01"]).toEqual({
      hours: 5, maxEntryHours: 5, entryCount: 1,
    });
  });

  it("returns an empty roll for no items", () => {
    expect(buildDailyRoll([])).toEqual({});
  });
});
```

Add `buildDailyRoll` and `TimelogTimeItem` to that file's imports.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/timelog-actuals.test.ts > "$SCRATCH/roll-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×|is not a function" "$SCRATCH/roll-red.log"`
Expected: red — `buildDailyRoll is not a function` or an import error.

- [ ] **Step 3: Implement `buildDailyRoll`**

Append to `src/app/timelog-actuals.ts`:

```ts
/**
 * Per-(user, date) roll — the input to the guardrail rules.
 *
 * ★★★ SEPARATE FROM `aggregateActuals` ON PURPOSE, and the difference is the
 * point. Aggregation answers "how do these hours attribute to budget buckets",
 * so it collapses the date to a period key, sums per-entry hours away, and
 * folds every unlinked item into `unattributed`. The rules ask "what did this
 * PERSON book that day", so the roll keeps the calendar date, keeps the largest
 * single entry, and keeps non-project time — it is still their time.
 *
 * Sparse: only (user, date) pairs that carry bookings get a key.
 */
export function buildDailyRoll(items: readonly TimelogTimeItem[]): TimelogDailyRoll {
  const out: TimelogDailyRoll = {};
  for (const it of items) {
    const k = dailyKey(it.userId, it.date);
    const cur = out[k];
    if (cur === undefined) {
      out[k] = { hours: it.hours, maxEntryHours: it.hours, entryCount: 1 };
      continue;
    }
    cur.hours += it.hours;
    if (it.hours > cur.maxEntryHours) cur.maxEntryHours = it.hours;
    cur.entryCount += 1;
  }
  return out;
}
```

Add to that file's imports from `./timelog-types`: `dailyKey, type TimelogDailyRoll`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/timelog-actuals.test.ts > "$SCRATCH/roll-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/roll-green.log"`
Expected: `EXIT=0`.

- [ ] **Step 5: Write the failing store test**

Append to `src/app/timelog-actuals-store.test.ts`:

```ts
describe("ActualsCacheEntry.daily", () => {
  it("round-trips a daily roll", () => {
    saveActualsCache("p1", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: { "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 } },
    });
    expect(loadActualsCache("p1")?.daily).toEqual({
      "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 },
    });
  });

  // Back-compat: an entry written before `daily` existed must still load.
  it("loads an entry that has no daily field", () => {
    saveActualsCache("p2", { fetchedAt: "2026-09-04T00:00:00.000Z" });
    const e = loadActualsCache("p2");
    expect(e?.fetchedAt).toBe("2026-09-04T00:00:00.000Z");
    expect(e?.daily).toBeUndefined();
  });

  // ★★ FAILS OPEN, matching `partial` (register §172): rejecting the whole
  // entry over a malformed optional field would drop good aggregates.
  it("keeps the rest of an entry whose daily field is malformed", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      p3: { fetchedAt: "2026-09-04T00:00:00.000Z", daily: "nonsense" },
    });
    expect(loadActualsCache("p3")?.fetchedAt).toBe("2026-09-04T00:00:00.000Z");
  });
});
```

Import `writeDeviceJson` from `./device-store` and `TIMELOG_ACTUALS_KEY` from `./timelog-actuals-store` in that test file if not already imported.

- [ ] **Step 6: Run and watch it fail**

Run: `npx vitest run src/app/timelog-actuals-store.test.ts > "$SCRATCH/store-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/store-red.log"`
Expected: red on the round-trip case (`daily` is not carried), green on the other two.

- [ ] **Step 7: Add the field and the validator branch**

In `src/app/timelog-actuals-store.ts`, add to `ActualsCacheEntry` after `partial`:

```ts
  // Per-(user, date) roll — the guardrail rules' only input. Optional for
  // back-compat with entries written before this field existed.
  // ★★ Like `partial`, this rides along on EVERY save. An entry is rewritten
  // whole, so a save that omits it CLEARS it (register §172, one field over).
  daily?: TimelogDailyRoll;
```

Add the type import:

```ts
import type { TimelogDailyRoll } from "./timelog-types";
```

And in `isEntry`, alongside the other optional-field branches:

```ts
  // Fails OPEN on garbage, deliberately: rejecting the whole entry would drop
  // good aggregates over a malformed roll. Same reasoning as `partial`.
  if (e.daily !== undefined && (typeof e.daily !== "object" || e.daily === null || Array.isArray(e.daily))) return false;
```

★ Note the asymmetry and keep it: this branch **rejects the entry** for a structurally impossible `daily`, matching the `aggregates`/`users`/`projectRefs` branches. The "fails open" property the third test asserts comes from the value being *dropped by the reader* rather than the entry being rejected — so if the test above goes red at this step, change the branch to leave `daily` unread rather than loosening the others. Re-run Step 6's command and confirm all three pass.

- [ ] **Step 8: Run the store tests**

Run: `npx vitest run src/app/timelog-actuals-store.test.ts > "$SCRATCH/store-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/store-green.log"`
Expected: `EXIT=0`.

- [ ] **Step 9: Commit**

```bash
git add src/app/timelog-actuals.ts src/app/timelog-actuals.test.ts src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts
git commit --only src/app/timelog-actuals.ts src/app/timelog-actuals.test.ts src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts -m "$(cat <<'EOF'
feat(timelog): build and persist a per-(user, date) daily roll

aggregateActuals collapses the date to a period key, sums per-entry hours away
and folds unlinked items into `unattributed`, so nothing persisted could answer
any guardrail rule. The roll keeps the calendar date, the largest single entry
and non-project time.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 5: Carry `daily` through every save site

**Files:**
- Modify: `src/app/use-timelog-sync.ts`
- Test: `src/app/use-timelog-sync.test.ts`

**★★★ This task is the whole reason the previous one is not enough.** `saveActualsCache` is called at **three** sites in this hook, and the file already carries a warning about exactly this hazard for `partial`: *"an entry is rewritten whole, so a dropped field is a cleared one."* Two of the three sites are directory reloads that do not have `items` — if they omit `daily`, a directory reload silently wipes the roll and every guardrail rule goes unevaluated with no error anywhere.

Find the three sites before editing:

```bash
grep -n "saveActualsCache" src/app/use-timelog-sync.ts
```
Expected: three hits (plus the import line).

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-timelog-sync.test.ts`, following the file's existing harness for rendering the hook:

```ts
it("does not clear the daily roll when a directory reload rewrites the entry", async () => {
  saveActualsCache("default", {
    fetchedAt: "2026-09-04T00:00:00.000Z",
    daily: { "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 } },
  });
  const { result } = renderTimelogSync();
  await act(async () => {
    await result.current.loadPeople();
  });
  expect(loadActualsCache("default")?.daily).toEqual({
    "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 },
  });
});
```

★ Adapt `renderTimelogSync()` and `loadPeople()` to the harness and action names the existing file already uses — read the file's other tests first and reuse their setup verbatim rather than inventing one. The assertion is the part that must not change: the roll survives a save that never saw `items`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/use-timelog-sync.test.ts > "$SCRATCH/sync-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/sync-red.log"`
Expected: red — the reload rewrites the entry without `daily`, so the assertion sees `undefined`.

- [ ] **Step 3: Add the state and thread it through all three saves**

Add the state seed beside the existing ones (`aggregates`, `fetchedAt`, `partial`, `users`, `projectRefs`):

```ts
  const [daily, setDaily] = useState<TimelogDailyRoll | undefined>(() => loadActualsCache(projectId)?.daily);
```

Import the type: add `type TimelogDailyRoll` to the existing `./timelog-types` type import.

In `finish()`, compute the roll and include it:

```ts
    const agg = aggregateActuals(items, effectiveLinks, granularity);
    const roll = buildDailyRoll(items);
    const at = new Date().toISOString();
    setAggregates(agg);
    setProjectRefs(refs);
    setFetchedAt(at);
    setPartial(isPartial);
    setDaily(roll);
    saveActualsCache(projectId, { fetchedAt: at, aggregates: agg, users: [...u], projectRefs: refs, partial: isPartial, daily: roll });
```

Add `buildDailyRoll` to the `./timelog-actuals` import.

At the **other two** save sites, add `daily` from state:

```ts
        saveActualsCache(projectId, { fetchedAt, aggregates, users: shown, projectRefs, partial, daily });
```
```ts
        saveActualsCache(projectId, { fetchedAt, aggregates, users, projectRefs: refs, partial, daily });
```

Expose `daily` on the hook's return value so `task-manager.tsx` can read it without a second cache read — add it to the returned object beside `aggregates`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/use-timelog-sync.test.ts > "$SCRATCH/sync-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/sync-green.log"`
Expected: `EXIT=0`.

- [ ] **Step 5: Mutation-prove the clearing trap**

Remove `, daily` from **one** of the two non-`finish` save calls. Run the suite. Expected: red, on the new test. Revert with the inverse Edit; because the two call sites are nearly identical, assert the anchor's uniqueness by grepping the **whole line** including its distinguishing argument (`users: shown` vs `users,`) before and after. Finish on an empty `git diff --stat`.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx eslint --max-warnings=0 src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts
git commit --only src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts -m "$(cat <<'EOF'
feat(timelog): compute the daily roll on fetch and carry it through every save

saveActualsCache has three call sites and an entry is rewritten whole, so a save
that omits a field clears it — the hazard the file already documents for
`partial`. Two of the three are directory reloads with no items in hand, so they
carry the roll through from state.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 6: Four new insight types, their text, and the identity pin

**Files:**
- Modify: `src/app/insights/insight.ts`, `src/app/insights/insight-text.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/timelog-policy.test.ts` (identity pin), `src/app/insights/sanitize-insights.test.ts`

**Scene:** `TITLE_KEY` is a `Record<InsightType, TranslationKey>` and `insightDetail`'s switch has no `default`, so adding members to `INSIGHT_TYPES` makes both non-exhaustive and tsc red until they are filled. That is the intended forcing function. `sanitize-insights.ts` needs **no** change — it validates with `INSIGHT_TYPES.includes(type)` — but that gets a test rather than an assumption.

- [ ] **Step 1: Add the four members**

In `src/app/insights/insight.ts`:

```ts
export const INSIGHT_TYPES = [
  "milestoneSlip",
  "overdueTrend",
  "stalledWork",
  "budgetVariance",
  "raidAging",
  // TimeLog guardrails. These four literals are ALSO `TimelogRuleId` — kept
  // deliberately identical so no rule-to-type lookup table exists to drift.
  // `timelog-policy.test.ts` pins the identity with a type-level assertion.
  "timelogCapPerEntry",
  "timelogCapPerDay",
  "timelogNonWorkingDay",
  "timelogWorkingHours",
] as const;
```

- [ ] **Step 2: Confirm tsc goes red in exactly two places**

Run: `npx tsc --noEmit > "$SCRATCH/types-red.log" 2>&1; echo "EXIT=$?"; grep -E "insight-text" "$SCRATCH/types-red.log"`
Expected: `EXIT=2`, with errors on `TITLE_KEY` (missing properties) and `insightDetail` (not all code paths return a value). If any *other* file appears, read it — an unexhausted `InsightType` map elsewhere is a real finding this step surfaced.

- [ ] **Step 3: Add the EN strings**

In `src/app/i18n.ts`, immediately after `insightRaidAgingDetail`:

```ts
  insightTimelogCapPerEntryTitle: "Time entry over the cap",
  insightTimelogCapPerEntryDetail: "{0} has {1} day(s) with a single entry over the {3} h cap — the largest is {2} h.",
  insightTimelogCapPerDayTitle: "Day over the booking cap",
  insightTimelogCapPerDayDetail: "{0} has {1} day(s) over the {3} h daily cap — the highest is {2} h. Only the fetched projects are counted, so this can under-report but never over-report.",
  insightTimelogNonWorkingDayTitle: "Time booked on a non-working day",
  insightTimelogNonWorkingDayDetail: "{0} booked time on {1} non-working day(s) — the largest is {2} h.",
  insightTimelogWorkingHoursTitle: "Time over defined working hours",
  insightTimelogWorkingHoursDetail: "{0} booked more than the defined hours on {1} day(s) — the highest is {2} h. People with no TimeLog link are not checked.",
```

- [ ] **Step 4: Add the DE strings via a node utf8 write**

★ The Edit tool corrupts umlauts and curls double quotes in this file, and its line endings are CRLF, so a `\n` anchor silently no-ops. Run this from the repo root:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  insightRaidAgingDetail:";
const i = s.indexOf(anchor);
if (i < 0) throw new Error("anchor not found");
const eol = s.indexOf("\r\n", i);
if (eol < 0) throw new Error("no CRLF after anchor - wrong line endings");
const add = [
  "  insightTimelogCapPerEntryTitle: \"Zeiteintrag über dem Limit\",",
  "  insightTimelogCapPerEntryDetail: \"{0} hat {1} Tag(e) mit einem Einzeleintrag über dem Limit von {3} h — der größte beträgt {2} h.\",",
  "  insightTimelogCapPerDayTitle: \"Tag über dem Buchungslimit\",",
  "  insightTimelogCapPerDayDetail: \"{0} hat {1} Tag(e) über dem Tageslimit von {3} h — der höchste beträgt {2} h. Nur die abgerufenen Projekte werden gezählt, daher kann dies zu niedrig, nie zu hoch ausfallen.\",",
  "  insightTimelogNonWorkingDayTitle: \"Zeit an einem arbeitsfreien Tag gebucht\",",
  "  insightTimelogNonWorkingDayDetail: \"{0} hat an {1} arbeitsfreien Tag(en) Zeit gebucht — der größte Wert beträgt {2} h.\",",
  "  insightTimelogWorkingHoursTitle: \"Zeit über den definierten Arbeitsstunden\",",
  "  insightTimelogWorkingHoursDetail: \"{0} hat an {1} Tag(en) mehr als die definierten Stunden gebucht — der höchste Wert beträgt {2} h. Personen ohne TimeLog-Verknüpfung werden nicht geprüft.\","
].join("\r\n");
fs.writeFileSync(p, s.slice(0, eol + 2) + add + "\r\n" + s.slice(eol + 2), "utf8");
console.log("inserted");
'
```

- [ ] **Step 5: Verify the German survived the write**

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");for(const w of ["über","größte","höchste","Arbeitsstunden"]) console.log(w, s.includes(w));'
git ls-files --eol src/app/i18n.de.ts
```
Expected: `true` for all four, and `i/lf w/crlf`. If any is `false`, the umlauts were mangled — revert and redo the write. If the eol reads `i/lf w/lf`, the file was re-lined; revert and redo.

Then confirm no ASCII substitutions were introduced:

```bash
npx vitest run src/app/i18n-encoding.test.ts > "$SCRATCH/i18n.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/i18n.log"
```
Expected: `EXIT=0`.

- [ ] **Step 6: Fill the two exhaustive maps**

In `src/app/insights/insight-text.ts`, add to `TITLE_KEY`:

```ts
  timelogCapPerEntry: "insightTimelogCapPerEntryTitle",
  timelogCapPerDay: "insightTimelogCapPerDayTitle",
  timelogNonWorkingDay: "insightTimelogNonWorkingDayTitle",
  timelogWorkingHours: "insightTimelogWorkingHoursTitle",
```

And to the `insightDetail` switch:

```ts
    case "timelogCapPerEntry":
      return t(lang, "insightTimelogCapPerEntryDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
    case "timelogCapPerDay":
      return t(lang, "insightTimelogCapPerDayDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
    case "timelogNonWorkingDay":
      return t(lang, "insightTimelogNonWorkingDayDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
    case "timelogWorkingHours":
      return t(lang, "insightTimelogWorkingHoursDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
```

- [ ] **Step 7: Add the identity pin**

Append to `src/app/timelog-policy.test.ts`:

```ts
import type { InsightType } from "./insights/insight";
import { TIMELOG_RULE_IDS, type TimelogRuleId } from "./timelog-types";

describe("rule ids are insight types", () => {
  // ★★★ THE ONLY THING STOPPING THE TWO SETS FROM DRIFTING. There is no
  // rule-to-type lookup table by design; this assignment is the contract.
  // Renaming either side turns tsc red.
  it("every rule id is assignable to InsightType", () => {
    const ids: readonly InsightType[] = TIMELOG_RULE_IDS;
    expect(ids).toHaveLength(4);
  });

  it("every rule id survives insight sanitisation", () => {
    for (const id of TIMELOG_RULE_IDS) {
      const rule: TimelogRuleId = id;
      expect(INSIGHT_TYPES).toContain(rule);
    }
  });
});
```

Add `INSIGHT_TYPES` to the imports from `./insights/insight`.

- [ ] **Step 8: Prove sanitisation admits the new types**

Append to `src/app/insights/sanitize-insights.test.ts`:

```ts
it("keeps a guardrail insight, which needs no change here because the type check reads INSIGHT_TYPES", () => {
  const out = sanitizeInsights([
    {
      id: 1, key: "timelog:timelogCapPerDay:7", type: "timelogCapPerDay",
      severity: "medium", data: { person: "Ada", count: 2, worstHours: 12, threshold: 8 },
      status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-04", occurrences: 2,
    },
  ]);
  expect(out).toHaveLength(1);
  expect(out[0].type).toBe("timelogCapPerDay");
});
```

- [ ] **Step 9: Run everything touched**

```bash
npx vitest run src/app/timelog-policy.test.ts src/app/insights > "$SCRATCH/types-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/types-green.log"
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0` both.

- [ ] **Step 10: Commit**

```bash
git add src/app/insights/insight.ts src/app/insights/insight-text.ts src/app/insights/sanitize-insights.test.ts src/app/i18n.ts src/app/i18n.de.ts src/app/timelog-policy.test.ts
git commit --only src/app/insights/insight.ts src/app/insights/insight-text.ts src/app/insights/sanitize-insights.test.ts src/app/i18n.ts src/app/i18n.de.ts src/app/timelog-policy.test.ts -m "$(cat <<'EOF'
feat(insights): add the four TimeLog guardrail insight types and their text

The four literals are identical to TimelogRuleId, so no lookup table exists to
drift; a type-level assertion pins the identity. sanitize-insights needs no
change because it validates against INSIGHT_TYPES, which now gets a test rather
than an assumption.

Both caveats reach the rendered strings: the daily cap counts only fetched
projects, and people with no TimeLog link are not checked for working hours.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 7: The reconcile evaluated-scope argument

**Files:**
- Modify: `src/app/insights/reconcile.ts`
- Test: `src/app/insights/reconcile.test.ts`

**★★★ This is the load-bearing change of the whole slice.** `reconcileInsights` reads "key absent from the detection set" as "the condition cleared". Sound for the five detectors that always run; false for one that can go dark. Bookings are a **per-device** cache; `Workspace.insights` is **shared and exported**. So a PM opening the workspace on a device with no TimeLog config makes the detector produce nothing, and `clear()` prunes the untouched guardrail insights and resolves any `acted` one through `computeClearedOutcome`, which **always** writes `"improved"` — a fabricated win in an exported artifact, then riding every AI turn through the outcomes section.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/insights/reconcile.test.ts`:

```ts
describe("evaluated scope", () => {
  const stored = (over: Partial<Insight> = {}): Insight => ({
    id: 1,
    key: "timelog:timelogCapPerDay:7",
    type: "timelogCapPerDay",
    severity: "medium",
    data: { person: "Ada", count: 2, worstHours: 12, threshold: 8 },
    status: "active",
    firstSeenAt: "2026-09-01",
    lastSeenAt: "2026-09-03",
    occurrences: 2,
    ...over,
  });

  const ALL: ReadonlySet<InsightType> = new Set(INSIGHT_TYPES);

  // ★★★ TRAP (b). Asserting only "it was not pruned" PASSES against a version
  // that keeps the row and resolves it to "improved" — which is the exact
  // fabricated win this argument exists to prevent. The assertion must be
  // UNCHANGED: same status, no resolvedAt, no outcome.
  it("leaves an acted insight completely unchanged when its type was not evaluated", () => {
    const prev = stored({ status: "acted", actedAt: "2026-09-02", metricAtAction: { count: 4 } });
    const out = reconcileInsights([prev], [], "2026-09-04", new Set(["milestoneSlip"]));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(prev);
    expect(out[0].status).toBe("acted");
    expect(out[0].outcome).toBeUndefined();
    expect(out[0].resolvedAt).toBeUndefined();
  });

  it("does not prune an untouched insight whose type was not evaluated", () => {
    const prev = stored();
    const out = reconcileInsights([prev], [], "2026-09-04", new Set(["milestoneSlip"]));
    expect(out).toEqual([prev]);
  });

  it("still resolves an acted insight whose type WAS evaluated", () => {
    const prev = stored({ status: "acted", actedAt: "2026-09-02", metricAtAction: { count: 4 } });
    const out = reconcileInsights([prev], [], "2026-09-04", ALL);
    expect(out[0].status).toBe("resolved");
    expect(out[0].outcome?.direction).toBe("improved");
  });

  it("still prunes an untouched insight whose type WAS evaluated", () => {
    const out = reconcileInsights([stored()], [], "2026-09-04", ALL);
    expect(out).toEqual([]);
  });

  // A disabled rule freezes rather than resolves. Distinct from the
  // bookings-null case above: neither implies the other.
  it("freezes a guardrail insight when its rule has been switched off", () => {
    const prev = stored({ status: "acknowledged", acknowledgedAt: "2026-09-02" });
    const evaluated = new Set<InsightType>([...INSIGHT_TYPES].filter((tp) => tp !== "timelogCapPerDay"));
    const out = reconcileInsights([prev], [], "2026-09-04", evaluated);
    expect(out).toEqual([prev]);
  });
});

// ★★★ The compile-error property is the ENTIRE justification for making the
// argument required rather than defaulting it to "all types". Prose cannot pin
// that; @ts-expect-error can, and `npx tsc --noEmit` is where it is checked —
// vitest never typechecks. If the argument is ever given a default, tsc fails
// here with "Unused '@ts-expect-error' directive".
// @ts-expect-error - the evaluated-scope argument is REQUIRED
const _requiredArgumentPin = () => reconcileInsights([], [], "2026-09-04");
void _requiredArgumentPin;
```

Add `INSIGHT_TYPES` and `type InsightType` to that file's imports from `./insight`.

- [ ] **Step 2: Update every existing call in the test file**

Run: `grep -c "reconcileInsights(" src/app/insights/reconcile.test.ts`

Every pre-existing call must gain a fourth argument of `new Set(INSIGHT_TYPES)`. Define a file-level `const ALL_TYPES: ReadonlySet<InsightType> = new Set(INSIGHT_TYPES);` near the top and pass it. Do **not** pass a narrower set to an existing test — those tests are about the old behaviour and must keep exercising it.

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/app/insights/reconcile.test.ts > "$SCRATCH/reconcile-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/reconcile-red.log"`
Expected: red on the two freeze cases (the fourth argument is ignored, so `clear()` still runs).

- [ ] **Step 4: Implement**

In `src/app/insights/reconcile.ts`:

```ts
/**
 * @param evaluated - The insight types whose detectors ACTUALLY RAN this pass.
 *
 * ★★★ REQUIRED, WITH NO DEFAULT, AND THAT IS THE POINT. `clear()` below reads
 * "absent from the detection set" as "the condition cleared". That inference is
 * sound only for a detector that always runs. A detector that can go DARK —
 * TimeLog unconfigured on this device, a failed fetch, a disabled rule —
 * produces nothing, and producing nothing is exactly what triggers clear().
 *
 * Because bookings are a PER-DEVICE cache while `Workspace.insights` is SHARED
 * AND EXPORTED, defaulting this to "all types" would let a second device prune
 * another device's guardrail insights and resolve any `acted` one through
 * `computeClearedOutcome`, which always writes "improved" — a fabricated win in
 * an exported artifact, which then rides every AI turn via the outcomes section.
 *
 * A default would reintroduce exactly that for the NEXT go-dark detector while
 * leaving this guard looking present. Required makes a forgetful detector a
 * typecheck error instead. `reconcile.test.ts` pins that with @ts-expect-error.
 */
export function reconcileInsights(
  stored: readonly Insight[],
  detected: readonly DetectedInsight[],
  today: string,
  evaluated: ReadonlySet<InsightType>,
): Insight[] {
```

And in the clear loop:

```ts
  for (const prev of stored) {
    if (detectedKeys.has(prev.key)) continue;
    // Not evaluated ⇒ FROZEN. Reconcile cannot distinguish "not violated" from
    // "not evaluated" on its own, so the caller says which it was.
    if (!evaluated.has(prev.type)) {
      result.push(prev);
      continue;
    }
    const cleared = clear(prev, today);
    if (cleared !== null) result.push(cleared);
  }
```

Add `type InsightType` to the imports from `./insight`.

- [ ] **Step 5: Update the one non-test call site so the build compiles**

In `src/app/task-manager.tsx`, inside the debounced insights effect:

```ts
        const next = reconcileInsights(base, detected, today, new Set(CORE_INSIGHT_TYPES));
```

`CORE_INSIGHT_TYPES` does not exist yet — add it to `src/app/insights/detect.ts` now and import it:

```ts
/** The five detectors that ALWAYS run. Guardrail types are added by the caller
 *  only when the rules were actually evaluated. */
export const CORE_INSIGHT_TYPES: readonly InsightType[] = [
  "milestoneSlip",
  "overdueTrend",
  "stalledWork",
  "budgetVariance",
  "raidAging",
];
```

Add `type InsightType` to `detect.ts`'s imports from `./insight`.

Task 8 refines this call to include the evaluated guardrail types.

- [ ] **Step 6: Run and typecheck**

```bash
npx vitest run src/app/insights > "$SCRATCH/reconcile-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/reconcile-green.log"
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0` both. `EXIT=2` from tsc with `Unused '@ts-expect-error' directive` means the argument is not actually required — fix the signature, not the directive.

- [ ] **Step 7: Mutation-prove the freeze (trap (b))**

Change the freeze branch to keep the row *without* skipping `clear()`:

```ts
    if (!evaluated.has(prev.type)) {
      const cleared = clear(prev, today);
      result.push(cleared ?? prev);
      continue;
    }
```

Run: `npx vitest run src/app/insights/reconcile.test.ts > "$SCRATCH/reconcile-mutant.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/reconcile-mutant.log"`

Expected: red, and the named failure **must include** "leaves an acted insight completely unchanged when its type was not evaluated". This mutant keeps the row, so a test that only asserted non-pruning would stay green — that is precisely the vacuity this step rules out. Note whether "does not prune an untouched insight…" also fails; it should not, which is the asymmetry worth recording.

Revert with the inverse Edit, `grep -c` both spellings, finish on an empty `git diff --stat`.

- [ ] **Step 8: Commit**

```bash
git add src/app/insights/reconcile.ts src/app/insights/reconcile.test.ts src/app/insights/detect.ts src/app/task-manager.tsx
git commit --only src/app/insights/reconcile.ts src/app/insights/reconcile.test.ts src/app/insights/detect.ts src/app/task-manager.tsx -m "$(cat <<'EOF'
fix(insights): reconcile must not resolve a type it never evaluated

clear() read "absent from the detection set" as "the condition cleared", which
is sound only for a detector that always runs. Bookings are a per-device cache
while Workspace.insights is shared and exported, so a device with no TimeLog
config would prune another device's guardrail insights and resolve any acted one
through computeClearedOutcome — which always writes "improved", fabricating a
win in an exported artifact that then rides every AI turn.

The evaluated-scope argument is required rather than defaulted so a future
detector that forgets to declare itself is a typecheck error, not a silent
prune. Pinned with @ts-expect-error, which only tsc can check.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 8: Detect the guardrail insights and wire the pipeline

**Files:**
- Modify: `src/app/insights/detect.ts`, `src/app/task-manager.tsx`
- Test: `src/app/insights/detect.test.ts`

**Scene:** `detect.ts` receives **already-computed violations** and never learns what a booking is — the same null-when-unknown shape `priorOverdueCount` uses. `task-manager.tsx` runs the policy module, passes the violations into `detectInsights`, and passes the evaluated types into `reconcileInsights`.

- [ ] **Step 1: Write the failing test**

Append to `src/app/insights/detect.test.ts`:

```ts
describe("timelog guardrail insights", () => {
  const violation = {
    rule: "timelogCapPerDay" as const,
    timelogUserId: 7,
    resourceId: 40,
    count: 2,
    worstHours: 12,
    threshold: 8,
  };

  it("emits nothing when violations are null", () => {
    const out = detectInsights(baseInput({ timelogViolations: null }), "2026-09-04");
    expect(out.filter((i) => i.type.startsWith("timelog"))).toEqual([]);
  });

  it("names the person from the linked resource", () => {
    const out = detectInsights(
      baseInput({
        timelogViolations: [violation],
        resources: [{ id: 40, name: "Ada Lovelace" } as Resource],
      }),
      "2026-09-04",
    );
    const g = out.find((i) => i.type === "timelogCapPerDay");
    expect(g).toBeDefined();
    expect(g?.key).toBe("timelog:timelogCapPerDay:7");
    expect(g?.entityRef).toEqual({ view: "resources", id: 40 });
    expect(g?.data).toEqual({ person: "Ada Lovelace", count: 2, worstHours: 12, threshold: 8 });
  });

  // No entityRef without a link: InsightEntityRef requires a real workspace id,
  // and the recommendation-replay path resolves it as a real row.
  it("omits entityRef and identifies the person by TimeLog id when unlinked", () => {
    const out = detectInsights(
      baseInput({ timelogViolations: [{ ...violation, resourceId: null }] }),
      "2026-09-04",
    );
    const g = out.find((i) => i.type === "timelogCapPerDay");
    expect(g?.entityRef).toBeUndefined();
    expect(g?.data.person).toBe("#7");
  });
});
```

★ `baseInput(...)` is a helper the existing `detect.test.ts` already has in some form — read the file and reuse its fixture builder, extending it with the new field rather than writing a second one.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/insights/detect.test.ts > "$SCRATCH/detect-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/detect-red.log"`
Expected: red — `timelogViolations` is not a property of `InsightInput`.

- [ ] **Step 3: Implement in `detect.ts`**

Add to `InsightInput`:

```ts
  /** Pre-computed guardrail violations, or null when the rules could not run
   *  (no daily roll on this device). This module never learns what a booking
   *  is — same null-when-unknown shape as `priorOverdueCount`. */
  readonly timelogViolations: readonly TimelogViolation[] | null;
```

Add the detector and call it:

```ts
/** Guardrail violations → insights. Aggregation already happened in
 *  `timelog-policy.ts`; this only names the person and attaches the ref.
 *  Severity is uniform: a cap breach is a review prompt, not a ranking. */
function timelogGuardrailInsights(
  violations: readonly TimelogViolation[] | null,
  resources: readonly Resource[],
): DetectedInsight[] {
  if (violations === null) return [];
  const byId = new Map(resources.map((r) => [r.id, r]));
  return violations.map((v) => {
    const resource = v.resourceId === null ? undefined : byId.get(v.resourceId);
    const person = resource?.name ?? `#${v.timelogUserId}`;
    return {
      key: `timelog:${v.rule}:${v.timelogUserId}`,
      type: v.rule,
      severity: "medium" as const,
      ...(resource !== undefined ? { entityRef: { view: "resources" as const, id: resource.id } } : {}),
      data: { person, count: v.count, worstHours: v.worstHours, threshold: v.threshold },
    };
  });
}
```

And inside `detectInsights`, after the budget line:

```ts
  out.push(...timelogGuardrailInsights(input.timelogViolations, input.resources));
```

Import `type TimelogViolation` from `../timelog-policy`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/insights > "$SCRATCH/detect-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/detect-green.log"`
Expected: `EXIT=0`. Existing `buildInsightInput` fixtures elsewhere will need `timelogViolations: null` added — that is the required-field forcing function working.

- [ ] **Step 5: Wire `task-manager.tsx`**

In the debounced insights effect, replace the body:

```ts
      const policyResult = evaluateTimelogPolicy({
        daily: loadActualsCache(currentProjectId ?? "default")?.daily ?? null,
        policy: timelogLinks?.policy,
        holidaySet,
        userLinks: timelogLinks?.userLinks ?? [],
        shifts,
      });
      const detected = detectInsights(
        { ...buildInsightInput(), timelogViolations: policyResult.violations },
        today,
      );
      setInsights((prev) => {
        const base = prev ?? [];
        const evaluated = new Set<InsightType>([...CORE_INSIGHT_TYPES, ...policyResult.evaluated]);
        const next = reconcileInsights(base, detected, today, evaluated);
        return insightsMateriallyEqual(base, next) ? base : next;
      });
```

★ `buildInsightInput()` should carry `timelogViolations` itself rather than being spread over — put the `evaluateTimelogPolicy` call inside `buildInsightInput` if that function already reads `timelogLinks`, `shifts` and `holidaySet`; read it first and choose whichever avoids widening the effect's dependency array. The **dependency array must not gain an `obj.member` expression** — `react-hooks/exhaustive-deps` rejects those and every warning is fatal. Hoist to a local const first.

★ `violations` is `readonly TimelogViolation[]`, never null, when the roll is present; `evaluateTimelogPolicy` already returns the empty result for a null roll, and its `evaluated` is then empty — which is what freezes the guardrail insights.

- [ ] **Step 6: Verify the whole suite and the lint**

```bash
npx eslint --max-warnings=0 src/app/insights src/app/task-manager.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/suite.log"
```
Expected: `EXIT=0` for all three. A red mentioning `Failed to start forks worker` is contention — re-run alone.

- [ ] **Step 7: Commit**

```bash
git add src/app/insights/detect.ts src/app/insights/detect.test.ts src/app/task-manager.tsx
git commit --only src/app/insights/detect.ts src/app/insights/detect.test.ts src/app/task-manager.tsx -m "$(cat <<'EOF'
feat(insights): surface TimeLog guardrail violations and wire the pipeline

detect receives pre-computed violations and never learns what a booking is —
the same null-when-unknown shape priorOverdueCount uses. Violations aggregate
per (rule, TimeLog user), never per booking, so a shared exported blob does not
gain hundreds of rows that churn on every fetch.

entityRef is attached only when a user link resolves to a real resource, because
InsightEntityRef requires a workspace id that the recommendation-replay path
resolves as a real row. No AI recommendation: the booking lives in TimeLog and
no tool in the allow-set can change it.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 9: The Settings guardrails section

**Files:**
- Modify: `src/app/settings-view.tsx`, `src/app/settings-sections/integrations-section.tsx`, `src/app/timelog-settings.tsx`
- Test: `src/app/timelog-settings.test.tsx`

**Scene:** policy lives on the workspace `timelogLinks` blob, but `TimelogSettings` currently receives only the per-device `settings.timelog`. Thread `timelogLinks` + `onTimelogLinksChange` the way `commTemplates` is already threaded through `settings-view`'s props bag.

All four rules default **OFF** with no threshold: `Workspace.insights` is shared and exported, so defaulting on would have an existing workspace silently gain rows in a team-visible artifact on first open after the upgrade.

- [ ] **Step 1: Write the failing test**

Create or append to `src/app/timelog-settings.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimelogSettings } from "./timelog-settings";
import { defaultTimelogConfig, type TimelogLinks } from "./timelog-types";
import { expectRowUniqueNames } from "../test/row-unique-names";

const links: TimelogLinks = { userLinks: [], projectLinks: [] };

function renderSettings(over: Partial<TimelogLinks> = {}, onLinks = vi.fn()) {
  render(
    <TimelogSettings
      lang="en-US"
      config={defaultTimelogConfig}
      onChange={vi.fn()}
      links={{ ...links, ...over }}
      onLinksChange={onLinks}
    />,
  );
  return onLinks;
}

describe("TimelogSettings guardrails", () => {
  it("renders every rule off when no policy is configured", () => {
    renderSettings();
    for (const name of [
      "Time entry over the cap",
      "Day over the booking cap",
      "Time booked on a non-working day",
      "Time over defined working hours",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  // ★★ The axe gate cannot see two controls sharing an accessible name — in any
  // view, at any seed size. A unit test is the only possible detector.
  it("gives every guardrail control a row-unique accessible name", () => {
    renderSettings({
      policy: {
        timelogCapPerEntry: { enabled: true, threshold: 6 },
        timelogCapPerDay: { enabled: true, threshold: 10 },
      },
    });
    expectRowUniqueNames({ minControls: 4, roles: ["button", "spinbutton"] });
  });

  it("enables a rule without inventing a threshold", async () => {
    const onLinks = renderSettings();
    await userEvent.click(screen.getByRole("button", { name: "Time booked on a non-working day" }));
    expect(onLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: { timelogNonWorkingDay: { enabled: true } },
      }),
    );
  });

  it("labels each threshold field, since a placeholder is not an accessible name", () => {
    renderSettings({ policy: { timelogCapPerDay: { enabled: true, threshold: 10 } } });
    expect(screen.getByRole("spinbutton", { name: "Daily cap (hours)" })).toHaveValue(10);
  });
});
```

★ `minControls: 4` is the **measured** floor for this scope — after the first green run, replace it with the exact number of `button`/`spinbutton` controls the component renders and record that number in a comment. A loose floor lets a silently narrowed `roles` array back in unnoticed.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/timelog-settings.test.tsx > "$SCRATCH/settings-red.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |×" "$SCRATCH/settings-red.log"`
Expected: red — `TimelogSettings` has no `links`/`onLinksChange` props.

- [ ] **Step 3: Add the props and the section to `timelog-settings.tsx`**

Extend `Props`:

```ts
interface Props {
  lang: Lang;
  config: TimelogConfig;
  onChange: (next: TimelogConfig) => void;
  /** Workspace-level guardrail policy rides here, NOT on the per-device config. */
  links: TimelogLinks;
  onLinksChange: (next: TimelogLinks) => void;
}
```

Add inside the component:

```tsx
  const policy = links.policy ?? {};
  function setRule(rule: TimelogRuleId, patch: Partial<TimelogRulePolicy>) {
    const cur = policy[rule] ?? { enabled: false };
    const next: TimelogPolicy = { ...policy, [rule]: { ...cur, ...patch } };
    onLinksChange({ ...links, policy: next });
  }
```

And the section, rendered after the existing config fields:

```tsx
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-1 text-sm font-medium text-foreground">{t(lang, "timelogGuardrailsTitle")}</h3>
        <p className="mb-2 text-xs text-muted-foreground">{t(lang, "timelogGuardrailsHint")}</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ToggleButton
              pressed={policy.timelogCapPerEntry?.enabled === true}
              onToggle={() => setRule("timelogCapPerEntry", { enabled: policy.timelogCapPerEntry?.enabled !== true })}
              lang={lang}
            >
              {t(lang, "insightTimelogCapPerEntryTitle")}
            </ToggleButton>
            <Input
              type="number"
              min={1}
              max={MAX_HOURS_PER_DAY}
              aria-label={t(lang, "timelogEntryCapLabel")}
              value={policy.timelogCapPerEntry?.threshold ?? ""}
              onChange={(e) => setRule("timelogCapPerEntry", { threshold: Number(e.target.value) || undefined })}
              className="w-20"
            />
          </div>
          <div className="flex items-center gap-2">
            <ToggleButton
              pressed={policy.timelogCapPerDay?.enabled === true}
              onToggle={() => setRule("timelogCapPerDay", { enabled: policy.timelogCapPerDay?.enabled !== true })}
              lang={lang}
            >
              {t(lang, "insightTimelogCapPerDayTitle")}
            </ToggleButton>
            <Input
              type="number"
              min={1}
              max={MAX_HOURS_PER_DAY}
              aria-label={t(lang, "timelogDayCapLabel")}
              value={policy.timelogCapPerDay?.threshold ?? ""}
              onChange={(e) => setRule("timelogCapPerDay", { threshold: Number(e.target.value) || undefined })}
              className="w-20"
            />
          </div>
          <ToggleButton
            pressed={policy.timelogNonWorkingDay?.enabled === true}
            onToggle={() => setRule("timelogNonWorkingDay", { enabled: policy.timelogNonWorkingDay?.enabled !== true })}
            lang={lang}
          >
            {t(lang, "insightTimelogNonWorkingDayTitle")}
          </ToggleButton>
          <ToggleButton
            pressed={policy.timelogWorkingHours?.enabled === true}
            onToggle={() => setRule("timelogWorkingHours", { enabled: policy.timelogWorkingHours?.enabled !== true })}
            lang={lang}
          >
            {t(lang, "insightTimelogWorkingHoursTitle")}
          </ToggleButton>
        </div>
      </div>
```

★ `ToggleButton` is mandatory here, never a hand-rolled `aria-pressed` button — the primitive carries the non-colour `data-pressed-marker` that keeps the pressed state visible without relying on hue (WCAG 1.4.1), and the derived 3:1 state border. Do **not** add a `dark:border-*` override: `scheme-apply.ts` already sets that property per scheme and mode, and a `dark:` variant re-pins the raw accent in exactly the schemes the derivation exists to fix.

★ The toggle label is pinned to what the toggle **enables**, so "Day over the booking cap, pressed" reads correctly. Do not flip the label to the opposite action.

Imports to add: `ToggleButton` from `./toggle-button`; `MAX_HOURS_PER_DAY` from `./types`; `type TimelogLinks, type TimelogPolicy, type TimelogRuleId, type TimelogRulePolicy` from `./timelog-types`.

- [ ] **Step 4: Add the four new i18n keys**

EN, in `src/app/i18n.ts`:

```ts
  timelogGuardrailsTitle: "Booking guardrails",
  timelogGuardrailsHint: "Flag bookings that break these rules. Cockpit never changes a booking — it only tells you. All rules are off until you turn them on.",
  timelogEntryCapLabel: "Entry cap (hours)",
  timelogDayCapLabel: "Daily cap (hours)",
```

DE, via the same node utf8 write pattern as Task 6 Step 4, anchored on `  timelogTestOk:`:

```
  timelogGuardrailsTitle: "Buchungs-Leitplanken",
  timelogGuardrailsHint: "Markiert Buchungen, die gegen diese Regeln verstoßen. Cockpit ändert keine Buchung — es weist nur darauf hin. Alle Regeln sind aus, bis Sie sie einschalten.",
  timelogEntryCapLabel: "Limit pro Eintrag (Stunden)",
  timelogDayCapLabel: "Tageslimit (Stunden)",
```

Re-run the umlaut check and `i18n-encoding.test.ts` exactly as in Task 6 Step 5.

- [ ] **Step 5: Thread the props**

In `src/app/settings-sections/integrations-section.tsx`, add to `Props`:

```ts
  timelogLinks: TimelogLinks;
  onTimelogLinksChange: (next: TimelogLinks) => void;
```

and pass them:

```tsx
      <TimelogSettings
        lang={lang}
        config={settings.timelog ?? defaultTimelogConfig}
        onChange={(next) => onChange({ ...settings, timelog: next })}
        links={timelogLinks}
        onLinksChange={onTimelogLinksChange}
      />
```

In `src/app/settings-view.tsx`, forward them from the props bag the way `props.commTemplates` and `props.onMigrateToTurso` already are:

```tsx
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChange}
              onMigrateToTurso={props.onMigrateToTurso}
              timelogLinks={props.timelogLinks}
              onTimelogLinksChange={props.onTimelogLinksChange}
            />
```

Add both to `settings-view.tsx`'s props type, then supply them at its own call site from the live workspace `timelogLinks` and its setter. Run `grep -rn "<SettingsView" src/app --include=*.tsx | grep -v test` to find that call site.

- [ ] **Step 6: Run, measure the floor, lint, typecheck**

```bash
npx vitest run src/app/timelog-settings.test.tsx > "$SCRATCH/settings-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/settings-green.log"
```
Expected: `EXIT=0`. Now raise `minControls` to the exact rendered count: temporarily set it to an absurd value (`99`), re-run, and read the number the helper reports in its throw. Set `minControls` to that number and add a comment recording it as measured.

```bash
npx eslint --max-warnings=0 src/app/timelog-settings.tsx src/app/timelog-settings.test.tsx src/app/settings-view.tsx src/app/settings-sections/integrations-section.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0` both.

- [ ] **Step 7: Commit**

```bash
git add src/app/timelog-settings.tsx src/app/timelog-settings.test.tsx src/app/settings-view.tsx src/app/settings-sections/integrations-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/timelog-settings.tsx src/app/timelog-settings.test.tsx src/app/settings-view.tsx src/app/settings-sections/integrations-section.tsx src/app/i18n.ts src/app/i18n.de.ts -m "$(cat <<'EOF'
feat(timelog): add the guardrails section to Settings

All four rules default off. Workspace.insights is shared and exported, so
defaulting on would have an existing workspace silently gain rows in a
team-visible artifact on first open after the upgrade.

Toggles use the ToggleButton primitive for its non-colour pressed marker, and
each threshold carries a real aria-label — a placeholder is not an accessible
name, and Settings is axe-scanned. Row-unique names are pinned by a unit test
because the axe gate cannot see two controls sharing an accessible name.

Claude-Session: https://[session link removed]
EOF
)"
```

---

### Task 10: Full gate run

**Files:** none modified unless a gate is red.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`. (2 means diagnostics.)

- [ ] **Step 2: Lint the whole app directory**

Run: `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"`
Expected: `EXIT=0`. Do not use `npm run lint` — it exits 1 from gitignored `.worktrees/` and `.demo-tmp/` leftovers.

- [ ] **Step 3: Full unit suite**

Run: `npm run test:run > "$SCRATCH/final-suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/final-suite.log"`
Expected: `EXIT=0`. Record the file and test counts.

- [ ] **Step 4: Shuffled suite**

This slice adds tests, so this gate is the one that catches order dependence. Run it **after** step 3 finishes — never concurrently.

Run: `npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/shuffle.log"`
Expected: `EXIT=0`.

- [ ] **Step 5: Size ratchet**

Run: `npm run size:check; echo "EXIT=$?"`
Expected: `EXIT=0`. **Never run it with `--update`** — that discards the doubled baseline and deletes rows rather than halving them.

- [ ] **Step 6: Doc gates**

```bash
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
```
Expected: `EXIT=0` for each. `followups:status:check` exit 1 means drift (write the Status line); exit 2 means the gate could not scan at all.

- [ ] **Step 7: Line endings did not move**

```bash
git diff --name-only origin/main...HEAD | grep -E "^src/app/.*\.tsx?$" | while read -r f; do git ls-files --eol "$f"; done
```
Expected: every row reads `i/lf w/crlf`. Any `i/lf w/lf` means the file was re-lined — fix it before proceeding.

- [ ] **Step 8: Commit any gate fixes**

If nothing changed, skip. Otherwise commit with a message naming the gate that failed and why.

---

### Task 11: Eye-verify against a live TimeLog project

**This is a gate, not a nicety.** Nothing in the unit suite can validate either caveated rule: `capPerDay`'s under-reporting depends on which projects the fetch actually scoped, and `workingHours` depends on real `TimelogUserLink` rows against real shifts. Both are properties of live data.

- [ ] **Step 1: Start a fresh dev server on an isolated port**

```bash
PORT=3100 npm run dev
```
Do **not** reuse the long-running server on port 3000 — it is the user's live-data tab and must not be disturbed.

- [ ] **Step 2: Configure and fetch**

In the app on `:3100`, open Settings → Integrations → TimeLog, configure a real tenant, and run a bookings fetch that returns at least one person with several days of entries.

- [ ] **Step 3: Confirm the roll was persisted**

In the browser console:

```js
JSON.parse(localStorage.getItem("aipm-cockpit:timelog-actuals"))
```
Expected: the project's entry carries a `daily` object whose keys look like `7|2026-09-01` and whose cells carry `hours`, `maxEntryHours` and `entryCount`.

- [ ] **Step 4: Verify each rule against known data**

Enable one rule at a time with a threshold you know some real day breaches, and check the Insights panel:

1. `timelogCapPerDay` — the flagged person, day count and worst value must match what TimeLog itself shows for the fetched projects.
2. `timelogCapPerEntry` — set a cap below a known single entry but above that day's total, and confirm it fires. This is the live counterpart of the fixture in Task 2.
3. `timelogNonWorkingDay` — confirm against a real holiday or weekend booking.
4. `timelogWorkingHours` — confirm it fires for a linked person and stays silent for an unlinked one.

- [ ] **Step 5: Verify the freeze, which is the whole point of Task 7**

With a guardrail insight present and acknowledged, switch the rule **off** in Settings. Expected: the insight remains, unchanged — not resolved, no `"improved"` outcome. Then clear the TimeLog config entirely and reload. Expected: the insight still remains unchanged.

★ This is the manual counterpart of the reconcile tests, and the only check that exercises the real per-device/shared-blob split the defect lives in.

- [ ] **Step 6: Stop the server**

```bash
PORT=3100 npm run stop
```
Never a blanket `taskkill /IM node.exe`.

- [ ] **Step 7: Record the result**

Write what was verified, against which tenant and on which date, into `docs/open-followups.md` §347's Status line. If any rule could not be verified — no suitable live data — say so explicitly rather than leaving it implied. `never machine-verified` is a conforming and honest answer for anything unprobed.

- [ ] **Step 8: Commit**

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "$(cat <<'EOF'
docs(followups): record the §347 eye-verify against a live TimeLog tenant

Claude-Session: https://[session link removed]
EOF
)"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: §4 rules → Task 2; §5 daily roll → Tasks 4–5; §6 reconcile → Task 7; §7 detect and surfacing → Task 8; §8 policy and defaults → Tasks 1, 3, 9; §9 surfaces → Tasks 6, 9; §10 testing → distributed, with the three named traps at Task 2 Step 6, Task 2 Step 8 and Task 7 Step 7; §11 gates → Task 10; §12's owed eye-verify → Task 11.

**Two things this plan adds that the spec did not have.** First, Task 5 exists because `saveActualsCache` has **three** call sites and the file already documents that a save omitting a field clears it — the spec described the roll but not the wholesale-rewrite hazard, which would have silently wiped it on any directory reload. Second, the rule ids and insight types are the **same literals**, removing the rule→type lookup table the spec implied; the identity is pinned in Task 6 Step 7.

**Not closed by this plan, deliberately.** §347's register entry is not marked closed — that happens when the slice ships, which is a separate step on explicit say. The two non-goals (closed-month, absence-day bookings) need their own register entries; file them when §347 is closed, not before, since a follow-up number is only reserved once it is on `origin/main`.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Three steps deliberately say *read the existing file and reuse its fixture builder* rather than inventing one — Task 5 Step 1, Task 8 Step 1, Task 9 Step 6's floor measurement. Those are instructions to measure, not placeholders: inventing a second harness beside an existing one is the failure being avoided.
