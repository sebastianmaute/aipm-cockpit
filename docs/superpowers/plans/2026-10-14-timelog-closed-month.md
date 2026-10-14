# TimeLog closed months Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a PM close TimeLog months ledger-style, saving each linked person's daily hours, and raise a sixth guardrail insight when TimeLog later shows those hours changed.

**Architecture:** An optional `close` field on the `TimelogLinks` meta-blob (every write path already carries the blob whole, so only `sanitizeTimelogLinks` changes). A pure, clock-free module closes and reopens months against the cached daily roll. The policy engine gains a sixth rule, `timelogClosedMonth`, which runs while any month is closed. The insight runner certifies a clean for it only per fully covered month.

**Tech Stack:** TypeScript, React 19, Next 16, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-14-timelog-closed-month-design.md`

## Global Constraints

- Branch `feat/699-timelog-closed-month`, worktree `C:/Projects/aipm-cockpit-wt38`.
- Commits: `feat|fix|test|docs: … (§699)`. NEVER `--amend`. No trailer lines, no URLs, no `Closes #`.
- `src/app/**` files are CRLF in the working tree: edit with the Edit tool or node, never `sed -i`. Docs and CHANGELOG are LF.
- `i18n.de.ts` is edited ONLY by a node utf8 script with `\r\n` anchors and real umlauts. EN and DE key sets must stay identical (tsc enforces).
- `task-manager.tsx` has ZERO size headroom (`docs/baselines/file-sizes.json`). Do not add a line to it.
- `close` is ABSENT, never `{}`, when nothing is closed.
- Hours tolerance: `CLOSED_MONTH_TOLERANCE_HOURS = 0.01`. A difference with absolute value `>= 0.01` is a change.
- Months are `"YYYY-MM"`, days `"YYYY-MM-DD"`, compared as strings. The new module is clock-free: `today` is passed in.
- Use `Number.isFinite`, never the global `isFinite`.
- Vitest only under the guarded lock: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> --maxWorkers=1 > <log> 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`. Never two runs at once, never read an exit code through a pipe, never delete a lock you did not create. No full suite, e2e or build locally.
- Before handing back each task: `npx tsc --noEmit` (exit 0, 0 errors in total) and `npx eslint --max-warnings=0 <changed files>`, both unpiped.
- Every guard gets a mutant: break it, name the failing test, revert by inverse anchored write, end on an empty `git diff --stat`.
- Scratch only under `C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/230744f7-2928-4c71-ad31-ffb1d3da0e35/scratchpad/b22`.
- Never touch `C:/Projects/aipm-cockpit`, `C:/Projects/aipm-cockpit-2`. Don't push. Don't kill the dev server on :3000. Implementers dispatch no subagents.

## Review Focus

1. **A person missing from the fetch must never read as "all deleted".** With a close for Ann and a roll whose `dailyUsers` omits her, the rule produces NO violation for her and does not certify her clean (Task 3, test `skips a saved person absent from dailyUsers`).
2. **A partly covered month must not clear an old flag.** A window covering 12–19 Sep while Ann's stored insight is about 12–19 Sep: the runner must freeze it, because September is not FULLY covered (Task 4, test `freezes when the window covers the changed days but not the whole month`).
3. **A closed person with no bookings is distinct from a person linked later.** Closing saves `{}` for a linked, covered person with no bookings, so later bookings by them are changes. A person with no `saved[month]` key at all is "linked after the close" (Task 2, test `saves an empty map for a linked person with no bookings`; Task 5 warning).
4. **Reopening the last month clears its flags rather than freezing them forever** (Task 4, test `clears after the month is reopened`).
5. **A hand-edited or corrupt `close` drops whole, with a diagnostic, and never partly survives** (Task 1, test `drops the whole close when one hours value is negative`).

---

### Task 1: The `close` field — type, sanitize, persistence

**Files:**
- Modify: `src/app/timelog-types.ts` (beside `TimelogLinks`)
- Modify: `src/app/timelog-sanitize.ts` (`sanitizeTimelogLinks`)
- Test: `src/app/timelog-sanitize.test.ts`, `src/app/timelog-links-persistence.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // timelog-types.ts
  export type TimelogMonthClose = {
    through: string; // "YYYY-MM"
    saved: Record<string, Record<string, Record<string, number>>>; // month → userId (string) → day → hours
  };
  // TimelogLinks gains: close?: TimelogMonthClose;
  // timelog-sanitize.ts
  export function sanitizeTimelogClose(raw: unknown): TimelogMonthClose | undefined;
  ```
- `saved[month][userId]` MAY be `{}` (a linked, covered person with no bookings).

- [ ] **Step 1: Write the failing tests** in `timelog-sanitize.test.ts`, in a `describe("sanitizeTimelogClose (§699)")`:
  - `keeps a valid close`: `{ through: "2026-09", saved: { "2026-08": { "7": { "2026-08-03": 8 } }, "2026-09": { "7": {}, "9": { "2026-09-12": 7.5 } } } }` round-trips `toEqual`.
  - One test per bad shape, each expecting `undefined` from `sanitizeTimelogClose` AND `sanitizeTimelogLinks({ userLinks: [], projectLinks: [], close: bad })` to have no `close` key: `through: "2026-13"`; a saved month `"2026-10"` after `through: "2026-09"`; user key `"0"`; user key `"x"`; day `"2026-09-31"`; day `"2026-08-03"` under month `"2026-09"`; hours `-1`; hours `NaN`; hours `"8"`; `saved` an array.
  - `drops the whole close when one hours value is negative`: two valid users plus one `-1` cell → `undefined`, not a partial copy.
  - `logs a diagnostic when it drops a close`: `vi.mock("./diagnostics")` and expect `logDiag` called with `("warn", "timelog.close-dropped", expect.objectContaining({ reason: expect.any(String) }))`; NOT called for a valid close or an absent one.
  - `leaves close absent when unset`: `sanitizeTimelogLinks({ userLinks: [], projectLinks: [] })` has no `close` key (`expect("close" in out).toBe(false)`).
- [ ] **Step 2: Add to `timelog-links-persistence.test.ts`** a `SAMPLE_CLOSE` and, inside each of the JSON, CSV and Markdown describes, `it("round-trips a close (§699)")` asserting `restored.timelogLinks?.close` `toEqual(SAMPLE_CLOSE)`. (IndexedDB and both Turso layouts decode through `sanitizeTimelogLinks`, `browser-backend.ts` and `turso-schema.ts` `decodeMeta("timelog_links", …)`, which Step 1 pins.)
- [ ] **Step 3: Run** both files under the lock. Expected: the new tests FAIL (no `close` key kept / function not exported).
- [ ] **Step 4: Implement** `sanitizeTimelogClose` with the spec's section 2 rules (month regex `^\d{4}-(0[1-9]|1[0-2])$`; day must be a real calendar day inside its month; user key `^[1-9]\d*$`; hours `Number.isFinite && >= 0`). All-or-nothing: on the first failure call `logDiag("warn", "timelog.close-dropped", { reason })` and return `undefined`. Wire it into `sanitizeTimelogLinks` with the same spread-if-defined pattern `policy` uses.
- [ ] **Step 5: Run** under the lock. Expected: PASS. Then tsc and eslint.
- [ ] **Step 6: Mutants:** (a) accept negative hours; (b) keep valid users and skip the bad one instead of dropping whole; (c) remove the `logDiag` call. Name the test each fails.
- [ ] **Step 7: Commit** `feat: TimelogLinks.close, sanitized all-or-nothing (§699)`.

### Task 2: Closing and reopening — `timelog-month-close.ts`

**Files:**
- Create: `src/app/timelog-month-close.ts`
- Test: `src/app/timelog-month-close.test.ts`

**Interfaces:**
- Consumes: `TimelogMonthClose`, `TimelogDailyRoll`, `parseDailyKey` (`timelog-types.ts`); `TimelogRollWindow` (type-only import from `timelog-actuals-store.ts`).
- Produces:
  ```ts
  export type MonthCloseCache = {
    daily: TimelogDailyRoll | undefined;
    dailyWindow: TimelogRollWindow | undefined;
    partial: boolean | undefined;
    dailyUsers: readonly number[] | undefined;
  };
  export type MonthCloseRefusal = "no-roll" | "window-start" | "window-end" | "partial" | "person-missing" | "not-ended";
  export type MonthCloseResult = { ok: true; close: TimelogMonthClose } | { ok: false; reason: MonthCloseRefusal; month: string };
  export function nextMonth(month: string): string;     // "2026-12" → "2027-01"
  export function previousMonth(month: string): string; // "2027-01" → "2026-12"
  export function lastDayOfMonth(month: string): string; // "2028-02" → "2028-02-29"
  export function monthToClose(close: TimelogMonthClose | undefined, firstMonth: string): string;
  export function closeNextMonth(args: {
    close: TimelogMonthClose | undefined;
    firstMonth: string;            // used only when close is undefined
    cache: MonthCloseCache;
    linkedUserIds: readonly number[];
    today: string;                 // "YYYY-MM-DD"
  }): MonthCloseResult;
  export function reopenLastMonth(close: TimelogMonthClose): TimelogMonthClose | undefined;
  ```
- Refusal order (first failing check wins): `no-roll` (daily or dailyWindow undefined) → `not-ended` (`today <= lastDayOfMonth(month)`) → `window-start` → `window-end` → `partial` (any value other than `undefined`/`false`, matching the runner's reading) → `person-missing` (a linked id not in `dailyUsers`, or `dailyUsers` undefined).

- [ ] **Step 1: Write the failing tests:**
  - month arithmetic across a year boundary, plus `lastDayOfMonth` for Feb 2028 (leap) and Feb 2027;
  - one test per refusal reason, each asserting `{ ok: false, reason, month }`;
  - `closes the first month`: no close, `firstMonth "2026-08"`, a window `2026-07-01..2026-09-30`, users `[7, 9]` both linked and covered, cells for 7 in Aug and Sep and for 9 in Sep → `close` equals `{ through: "2026-08", saved: { "2026-08": { "7": { …Aug cells only… }, "9": {} } } }`;
  - `saves an empty map for a linked person with no bookings` (the `"9": {}` above, asserted on its own);
  - `saves only linked people`: a roll cell for unlinked user 11 is not saved;
  - `closes the month after through`: `through "2026-08"` → the result's `through` is `"2026-09"` and `saved["2026-08"]` is unchanged by reference-equal content;
  - `refuses the current month`: `today "2026-09-30"` for September → `not-ended`; `today "2026-10-01"` → ok;
  - `reopenLastMonth`: drops `saved[through]` and moves `through` back; on a single-month close returns `undefined`;
  - inputs are not mutated (deep-freeze the inputs).
- [ ] **Step 2: Run** under the lock. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Copy cells by iterating the roll's keys through `parseDailyKey` and keeping those whose day starts with `month + "-"`.
- [ ] **Step 4: Run.** Expected: PASS. Then tsc and eslint.
- [ ] **Step 5: Mutants:** drop each of the six refusal checks in turn; `<` for `<=` in `not-ended`; save unlinked users; omit the `{}` for a person with no bookings. Name the failing test for each.
- [ ] **Step 6: Commit** `feat: close and reopen TimeLog months against the cached roll (§699)`.

### Task 3: The `timelogClosedMonth` rule

**Files:**
- Modify: `src/app/timelog-types.ts` (`TimelogRuleId`, `TIMELOG_RULE_IDS`)
- Modify: `src/app/timelog-policy.ts` (input, result, evaluation, `netHours`)
- Modify: `src/app/timelog-sanitize.ts` (policy loop skips the new id)
- Modify: `src/app/insights/insight.ts`, `insights/outcome.ts`, `insights/insight-text.ts`, `insights/insight-prompt.ts`, `insights/detect.ts` (`netHours` into `data`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/timelog-policy.test.ts`, `src/app/timelog-sanitize.test.ts`, `src/app/insights/insight-text.test.ts`, `insight-prompt.test.ts`, `outcome.test.ts`

**Interfaces:**
- Consumes: `TimelogMonthClose` (Task 1); `lastDayOfMonth` (Task 2).
- Produces:
  ```ts
  // TimelogRuleId gains "timelogClosedMonth", appended LAST to TIMELOG_RULE_IDS and INSIGHT_TYPES.
  // TimelogPolicyInput gains (all REQUIRED keys):
  readonly close: TimelogMonthClose | null;
  readonly dailyWindow: TimelogRollWindow | undefined;
  readonly dailyUsers: readonly number[] | undefined;
  // TimelogViolation gains:
  readonly netHours?: number; // set only for timelogClosedMonth
  // TimelogPolicyResult gains:
  readonly closedMonthsCovered: readonly string[]; // closed months fully inside dailyWindow, ascending
  export const CLOSED_MONTH_TOLERANCE_HOURS = 0.01;
  /** The runner's per-insight certification for timelogClosedMonth. */
  export function closedMonthCertifies(args: {
    first: string; last: string; userId: number;
    close: TimelogMonthClose | null;
    closedMonthsCovered: readonly string[];
    partial: boolean;            // already normalised by the runner (non-false = true)
    dailyUsers: readonly number[] | undefined;
    linkedUsers: readonly number[];
  }): boolean;
  ```
- Evaluation rules (spec section 4):
  - The rule runs independently of `policy`: the engine's early return becomes "no roll AND no close". `timelogClosedMonth` is in `evaluated` whenever `close === null` (nothing closed means a certain clean) or `daily !== null`.
  - A person is checked for a month only if linked, in `dailyUsers`, and the month is in `closedMonthsCovered`. A person in `saved[month]` but absent from `dailyUsers` is skipped: no violation, no clean.
  - A linked person with no `saved[month]` entry is compared against an empty map, so all their bookings count (spec section 6).
  - Changed day: `Math.abs(current - saved) >= CLOSED_MONTH_TOLERANCE_HOURS`, a missing side counting as 0. One violation per person: `count` = changed days, `worstHours` = max absolute change, `threshold: 0`, first/last changed day, `netHours` = signed sum rounded to 2 decimals.
  - `closedMonthCertifies`: return `true` when `close === null`. Otherwise, for every month from `first.slice(0,7)` to `last.slice(0,7)` inclusive: a month after `close.through` (reopened) is fine; a still-closed month requires that it is in `closedMonthsCovered`, `!partial`, the person is in `dailyUsers`, and the person is in `linkedUsers`. Return `true` only if every month passes.
- `sanitizeTimelogPolicy` skips `timelogClosedMonth`: it has no toggle and no threshold, so a stored policy key for it is dropped.
- Text keys (EN): `insightTimelogClosedMonthTitle` = "TimeLog changed in a closed month"; `insightTimelogClosedMonthDetail` (plural on count) = "{0}: {1} day in closed months changed since the close (net {2} h, largest {3} h)." / "{0}: {1} days in closed months changed since the close (net {2} h, largest {3} h)." with `{2}` formatted with a sign (`+6`, `−2`). DE with real umlauts: "TimeLog in einem abgeschlossenen Monat geändert"; "{0}: {1} Tag in abgeschlossenen Monaten seit dem Abschluss geändert (netto {2} h, größte Änderung {3} h)." / "… {1} Tage …". Outcome metric: `count`.

- [ ] **Step 1: Write the failing policy tests** (`describe("timelogClosedMonth (§699)")`). Fixture: users 7 (Ann) and 9 linked, `close = { through: "2026-09", saved: { "2026-09": { "7": { "2026-09-12": 8, "2026-09-19": 4 }, "9": {} } } }`, window `2026-09-01..2026-09-30`, `dailyUsers [7, 9]`:
  - `flags a day added`: roll adds `2026-09-20: 3` for Ann → count 1, worst 3, net 3, first = last = `2026-09-20`;
  - `flags a day deleted`: roll lacks `2026-09-19` → count 1, worst 4, net −4;
  - `flags hours moved with no net change`: `12 → 4`, a new `13 → 4` → count 2, net 0;
  - `ignores rounding`: `8 → 8.004` → no violation;
  - `flags bookings by a person saved empty`: user 9 books `2026-09-05: 2` → count 1;
  - `flags bookings by a person linked after the close`: user 11 linked, no saved entry, books in Sep → flagged;
  - `skips a saved person absent from dailyUsers`: `dailyUsers [9]`, Ann's roll empty → no Ann violation;
  - `skips a month not fully covered`: window `2026-09-02..2026-09-30` → no violations and `closedMonthsCovered` is `[]`;
  - `runs without a policy`: `policy: undefined` with a close still evaluates the rule;
  - `no close is evaluated and clean`: `close: null`, `daily: null` → `evaluated` contains `timelogClosedMonth`, no violations;
  - `closedMonthCertifies`: true for `close null`; true for a month after `through`; false when partial; false for a person missing from `dailyUsers`; false for an unlinked person; false for a month not in `closedMonthsCovered`; true when all months in the span pass; false when one of two months fails.
  - The existing identity test (`TIMELOG_RULE_IDS` ⊆ `INSIGHT_TYPES`) stays green with the new member.
- [ ] **Step 2: Add** a sanitize test `drops a policy key for timelogClosedMonth`; insight-text / insight-prompt / outcome tests mirroring the `timelogAbsenceDay` cases, with the detail text asserting `"Ann Lee: 3 days in closed months changed since the close (net +6 h, largest 8 h)."` in EN and the DE singular after `loadI18n("de")`.
- [ ] **Step 3: Run** under the lock. Expected: FAIL.
- [ ] **Step 4: Implement.** The `{ on, acc }` record in `evaluateTimelogPolicy` is typed over every rule id, so tsc will demand the new entry. Compute the closed-month part in a separate function called before the existing `policy === undefined` return, and merge its result. `detect.ts` adds `netHours` to `data` only when defined.
- [ ] **Step 5: Run.** Expected: PASS. Then tsc (key parity) and eslint.
- [ ] **Step 6: Mutants:** tolerance `>` for `>=`; treat a missing `dailyUsers` person as all-deleted; drop the full-month coverage check; keep the `policy === undefined` early return ahead of the rule; `closedMonthCertifies` ignores `partial`; ignores reopened months (treats them as closed). Name the failing test for each.
- [ ] **Step 7: Commit** `feat: timelogClosedMonth guardrail (§699)`.

### Task 4: Runner wiring and reconcile

**Files:**
- Modify: `src/app/use-insight-lifecycle.ts` (the `evaluateTimelogPolicy` call and `isEvaluated`)
- Test: `src/app/use-insight-lifecycle.test.ts`, `src/app/task-manager.guardrail-reconcile.test.tsx`

**Interfaces:**
- Consumes: `close`, `dailyWindow`, `dailyUsers` input keys and `closedMonthsCovered` / `closedMonthCertifies` (Task 3).
- The call passes `close: timelogLinks?.close ?? null`, `dailyWindow: actuals?.dailyWindow`, `dailyUsers: actuals?.dailyUsers`.
- In `isEvaluated`, `timelogClosedMonth` is handled BEFORE the generic `rollPartial` / `rollWindow` / dates / `rollUsers` checks, right after `if (!evaluatedRules.has(insight.type)) return false;`: it returns `closedMonthCertifies({ first, last, userId, close, closedMonthsCovered, partial: rollPartial, dailyUsers: rollUsers, linkedUsers: policyResult.linkedUsers })`. A missing or non-string date or non-number `timelogUserId` still returns `false` first.
- `linkedUsers` must be populated whenever the closed-month rule runs, including with no `policy` (Task 3's restructure must keep it).

- [ ] **Step 1: Write the failing tests** in `task-manager.guardrail-reconcile.test.tsx`, reusing its harness, with a stored `timelogClosedMonth` insight for Ann over `2026-09-12..2026-09-19`:
  - `raises a flag for a late change`: close + roll with a changed day → insight present with `data.netHours`;
  - `clears after the month is reopened`: `close` removed → the insight resolves;
  - `clears when the change is reverted over a covering roll`;
  - `freezes when the window covers the changed days but not the whole month`: window `2026-09-12..2026-09-30` → unchanged;
  - `freezes on a partial fetch`;
  - `freezes when the person is missing from dailyUsers`.
- [ ] **Step 2: Add** to `use-insight-lifecycle.test.ts`: `passes the close to the engine` (spy or observable result). A mutant that passes `close: null` must fail it.
- [ ] **Step 3: Run** under the lock. Expected: FAIL.
- [ ] **Step 4: Implement** per the Interfaces block. Add `timelogLinks?.close` to nothing new in the deps array: `timelogLinks` is already there.
- [ ] **Step 5: Run.** Expected: PASS. Then tsc and eslint.
- [ ] **Step 6: Mutants:** the call passes `close: null`; `isEvaluated` lets `timelogClosedMonth` fall through to the generic day-window check; the call omits `dailyUsers`. Name the failing test for each.
- [ ] **Step 7: Commit** `feat: wire timelogClosedMonth into the insight runner (§699)`.

### Task 5: The "Closed months" settings block

**Files:**
- Create: `src/app/timelog-month-close-panel.tsx`
- Modify: `src/app/timelog-settings.tsx` (render the panel inside the guardrails area; new optional prop)
- Modify: `src/app/settings-sections/integrations-section.tsx` (forward the prop)
- Modify: `src/app/settings-view.tsx` (pass `props.projectId ?? "default"`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/timelog-month-close-panel.test.tsx`, `src/app/timelog-settings.test.tsx`

**Interfaces:**
- Consumes: `closeNextMonth`, `reopenLastMonth`, `monthToClose`, `MonthCloseRefusal` (Task 2); `loadActualsCache` (`timelog-actuals-store.ts`).
- Produces:
  ```ts
  export function TimelogMonthClosePanel(props: {
    lang: Lang;
    links: TimelogLinks;
    onLinksChange: (next: TimelogLinks) => void;
    cacheProjectId: string;  // the actuals-cache key, `projectId ?? "default"`
    today: string;           // "YYYY-MM-DD"
  }): JSX.Element;
  ```
- New optional prop `timelogCacheProjectId?: string` on `IntegrationsSection` and `TimelogSettings`. The panel renders only when `links`, `onLinksChange` AND `timelogCacheProjectId` are all present (pre-project surfaces render none, same rule as the guardrails).
- `today`: computed in `TimelogSettings` with a lazy `useState(() => isoToday())`, never in the render body (the react-hooks purity rule). Use the repo's existing local-date ISO helper (grep `export function` for `todayIso`/`isoDate` in `src/app` and reuse it; do not hand-roll one).
- The cache is read with `loadActualsCache(cacheProjectId)` inside the click handler (fresh) and once for the displayed refusal (a `useMemo` keyed on `cacheProjectId` and `links`).
- When nothing is closed, a month `<select>` offers the 12 fully ended months before `today`, newest first, default the newest. `firstMonth` = the selection.
- Reopen opens an in-page confirmation row (Confirm / Cancel buttons), never `window.confirm`.
- Writes: `onLinksChange({ ...links, close })`, and when `reopenLastMonth` returns `undefined`, the same object WITHOUT a `close` key (destructure it out).
- Linked after close: when `close` exists, list the linked people with no `saved[close.through]` entry in a warning line.
- Buttons are `Button` from the design system (`secondary`, `sm`). Accessible names include the month: "Close September 2026", "Reopen September 2026".

i18n keys (EN; DE with real umlauts):

| Key | EN | DE |
|---|---|---|
| `timelogCloseTitle` | Closed months | Abgeschlossene Monate |
| `timelogCloseHelp` | Closing a month saves each linked person's TimeLog hours for it. While any month is closed, Cockpit flags later changes to them. | Beim Abschluss eines Monats werden die TimeLog-Stunden jeder verknüpften Person gespeichert. Solange ein Monat abgeschlossen ist, meldet Cockpit spätere Änderungen daran. |
| `timelogCloseThrough` | Closed through {0} | Abgeschlossen bis {0} |
| `timelogCloseNone` | No month is closed. | Kein Monat ist abgeschlossen. |
| `timelogCloseFirstMonth` | First month to close | Erster abzuschließender Monat |
| `timelogCloseButton` | Close {0} | {0} abschließen |
| `timelogReopenButton` | Reopen {0} | {0} wieder öffnen |
| `timelogReopenConfirm` | Reopen {0}? Its saved hours are deleted. | {0} wieder öffnen? Die gespeicherten Stunden werden gelöscht. |
| `timelogReopenConfirmYes` | Reopen | Wieder öffnen |
| `timelogCloseRefuseNoRoll` | Fetch TimeLog bookings first. | Rufen Sie zuerst die TimeLog-Buchungen ab. |
| `timelogCloseRefuseNotEnded` | {0} has not ended yet. | {0} ist noch nicht vorbei. |
| `timelogCloseRefuseWindowStart` | The last fetch starts after the 1st of {0}. Fetch the whole month. | Der letzte Abruf beginnt nach dem 1. {0}. Rufen Sie den ganzen Monat ab. |
| `timelogCloseRefuseWindowEnd` | The last fetch ends before the end of {0}. Fetch the whole month. | Der letzte Abruf endet vor dem Ende von {0}. Rufen Sie den ganzen Monat ab. |
| `timelogCloseRefusePartial` | The last fetch was incomplete. Fetch again. | Der letzte Abruf war unvollständig. Rufen Sie erneut ab. |
| `timelogCloseRefusePersonMissing` | The last fetch did not include every linked person. | Der letzte Abruf enthielt nicht alle verknüpften Personen. |
| `timelogCloseLinkedLater` | Linked after the close, so all their bookings in closed months are flagged: {0} | Nach dem Abschluss verknüpft, daher werden alle ihre Buchungen in abgeschlossenen Monaten gemeldet: {0} |

The refusal key is built from a typed `Record<MonthCloseRefusal, TranslationKey>`, never from a template string (a `string` into `t()` fails tsc).

- [ ] **Step 1: Write the failing panel tests** (`timelog-month-close-panel.test.tsx`, `vi.mock("./timelog-actuals-store")` for `loadActualsCache`):
  - shows "No month is closed." and the month select when `close` is absent;
  - shows the refusal text for each `MonthCloseRefusal` (one table-driven test), with the Close button disabled;
  - a covering cache → clicking "Close August 2026" calls `onLinksChange` with `close.through === "2026-08"`;
  - with `through "2026-09"`: shows "Closed through September 2026"; "Reopen September 2026" shows the confirmation; Cancel writes nothing; Confirm writes `through "2026-08"`;
  - reopening the only month writes links with NO `close` key (`"close" in arg` is false);
  - the linked-later warning names a linked person with no saved entry, and is absent when everyone is saved;
  - every button's accessible name is unique (`src/test/row-unique-names` helper if it applies, else `getAllByRole("button").map(name)` has no duplicates).
- [ ] **Step 2: Add** to `timelog-settings.test.tsx`: the panel renders when `timelogCacheProjectId` is passed with links, and not when it is omitted.
- [ ] **Step 3: Run** under the lock. Expected: FAIL.
- [ ] **Step 4: Implement**, then add the i18n keys (DE via the node utf8 script with `\r\n` anchors).
- [ ] **Step 5: Run** the two files plus `src/app/i18n.test.ts` and `src/app/i18n-encoding.test.ts`. Expected: PASS. Then tsc and eslint on every changed file.
- [ ] **Step 6: Mutants:** reopen without confirmation; write `close: undefined` instead of omitting the key; render the panel without `timelogCacheProjectId`. Name the failing test for each.
- [ ] **Step 7: Commit** `feat: Closed months block in TimeLog settings (§699)`.

### Task 6: Docs and register

**Files:**
- Modify: `CHANGELOG.md` ([Unreleased])
- Modify: `docs/open-followups.md` (§699 → CLOSED; rebuild the index)
- Modify: `docs/AGENTS/integrations.md` (a "Closed months (§699)" subsection under "### Timelog integration")

- [ ] **Step 1: CHANGELOG:** one entry describing what ships: closing through a month in TimeLog settings, the saved per-person daily hours, the sixth guardrail, that nothing is blocked and budget actuals are untouched, and the refusal conditions.
- [ ] **Step 2: Register §699:** heading `— CLOSED 2026-10-14`, a Status line naming the branch, the mechanism, the measured vitest commands with `Test Files` / `Tests` counts, the mutant tally per task, and residues (no size cap on `saved`; a dropped `close` reaches the diagnostics ring only, no toast; a person unlinked after the close freezes rather than clears). Keep the old body under "Status before closure". Run `node scripts/rebuild-followup-index.mjs`.
- [ ] **Step 3: integrations.md:** what `close` stores, that it rides the `TimelogLinks` blob whole through all six write paths with only `sanitizeTimelogLinks` changed, that it stays absent when unset, the refusal conditions, and `closedMonthCertifies` as the reason a partly covered month cannot clear a flag. Cite symbols, not line numbers.
- [ ] **Step 4: Gates**, each unpiped with exit 0: `npm run docs:symbols:check`, `docs:claims:check`, `followups:index:check`, `followups:status:check`, `followups:workitems:check`, `size:check`, `dup:check`, `changelog:check`.
- [ ] **Step 5: Commit** `docs: TimeLog closed months, register §699 closed (§699)`.
