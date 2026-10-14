# TimeLog closed months — design (§699)

Register §699, GitHub #673. Owner decisions 2026-10-14, recorded in the order they were made:

1. **Purpose: flag late changes.** Closing a month saves each person's TimeLog hours for it. Later, when
   TimeLog shows hours added, changed or deleted in a closed month, a guardrail insight names the person
   and the change. Review-time only; nothing is blocked, and budget actuals are untouched.
2. **Scope: project data.** The close is stored with the project's TimeLog settings, so every device and
   backend that opens the project sees it. Anyone who can edit the project can close or reopen, as with
   the other guardrail settings (Cockpit has no user roles).
3. **Model: close through a month**, ledger style. "Closed through September" closes every month up to it.
4. **Detail: per person per day.** A flag can name the days, and hours moved between days with no net
   change are still caught.
5. **Approach A:** a new optional field on `TimelogLinks` plus a sixth guardrail rule, rather than a new
   `Workspace` field (B) or device-local saved hours (C, which contradicts decision 2).

## 1. Why a saved copy is the only way

Cockpit never writes a time entry, and `TimelogTimeItem` carries a work `date` but no created or modified
timestamp. "Was this booked after the close?" cannot be asked of TimeLog. The only observable is a
difference between today's hours and the hours at the moment of closing, so the close must save them.

## 2. Data

`timelog-types.ts`:

```ts
export type TimelogMonthClose = {
  /** "YYYY-MM": the last closed month. Every month up to and including it is closed. */
  through: string;
  /** month "YYYY-MM" → TimeLog userId (as a string key) → day "YYYY-MM-DD" → hours.
   *  Sparse: only days that carried bookings when the month was closed. */
  saved: Record<string, Record<string, Record<string, number>>>;
};

// TimelogLinks gains:
close?: TimelogMonthClose;
```

★ `close` is ABSENT, never `{}` or `{ saved: {} }`, when nothing is closed, the same rule `policy` follows,
so an unconfigured blob stays byte-stable.

**Six write paths.** `TimelogLinks` rides the meta-blob and every codec carries the object whole
(`timelogLinksToCsv` and `timelogLinksToMarkdown` stringify it; see the guardrail spec, section 3.2). The
only code is `sanitizeTimelogLinks` admitting and validating `close`. A round-trip test per write path pins
that assumption rather than trusting it.

**Sanitize** (`timelog-sanitize.ts`). `close` is kept only if ALL of these hold, otherwise the whole
`close` is dropped:

- `through` matches `^\d{4}-(0[1-9]|1[0-2])$`;
- every key of `saved` is a valid month and `<= through`;
- every user key is a positive integer string; every day key is an ISO day inside its month;
- every hours value is a finite number `>= 0` (`Number.isFinite`, never the coercing global).

A partly kept copy would raise false "changed" flags, so the drop is all-or-nothing.

★ No reporting path exists for a dropped sub-field of `TimelogLinks` today: `sanitizeTimelogPolicy` drops
a malformed `policy` silently. So the sanitizer logs a dropped `close` itself, with
`logDiag("warn", "timelog.close-dropped", { reason })` (`diagnostics.ts`), which puts it in the diagnostics
ring. There is no toast, because sanitize runs at load with no `showToast`. The settings block then reads
"nothing closed", which is the user-visible sign. A test pins the log call.

## 3. Closing and reopening

A new pure, i18n-free module `timelog-month-close.ts`.

**`closeNextMonth`** closes `through + 1`, or, when nothing is closed, the month the user picks. It returns
either the new `TimelogMonthClose` or a refusal reason, and it refuses unless the current actuals cache:

1. covers the whole month: `dailyWindow.from <=` the 1st and `dailyWindow.to >=` the last day;
2. is not `partial`;
3. lists every linked person in `dailyUsers`, so a person missing from the fetch is never saved as 0 h;
4. is for a month that has fully ended, relative to a `today` passed in (the module is clock-free).

On success the month's cells from the daily roll are copied into `saved[month]` for linked users only, and
`through` advances one month. Refuse a correct close rather than save a wrong copy.

**`reopenLastMonth`** drops `saved[through]` and moves `through` back one month. Reopening the last closed
month removes `close` entirely.

**Surface.** A "Closed months" block in `timelog-settings.tsx` shows "Closed through <month>", the
Close-next and Reopen-last buttons, and the refusal reason when a close is not possible. Reopen asks for an
in-page confirmation (never `window.confirm`). The block says the rule runs while any month is closed, and
warns when a person was linked after the close (see section 6). Close and reopen are settings edits and
follow the existing settings undo behaviour.

## 4. The rule

`timelogClosedMonth` joins `TimelogRuleId`, `TIMELOG_RULE_IDS` and `InsightType` (the identity test pins
that the literals match), and is evaluated in `evaluateTimelogPolicy`, which gains a REQUIRED `close`
parameter (`TimelogMonthClose | null`), so a caller cannot omit it and certify a clean.

**Evaluated.**

- No `close`: evaluated and clean. With nothing closed no late change exists, so reopening the last month
  clears its flags.
- A (person, closed month) pair: evaluated only when the roll covers that whole month, is not `partial`,
  and lists that person in `dailyUsers`.
- Otherwise (the cache has dropped that old month, or the fetch missed the person): not evaluated, and
  `reconcileInsights` freezes old flags rather than clearing them.

**Changed day.** For each day of an evaluated closed month, current hours minus saved hours, with a missing
day counting as 0 on either side, so added and deleted days both count. A difference with an absolute value
of at least `CLOSED_MONTH_TOLERANCE_HOURS = 0.01` is a changed day; smaller ones are rounding.

**Violation.** One per person over all their evaluated closed months, in the existing shape:

- `count`: changed days (lower is better, for the metric delta);
- `worstHours`: the largest absolute single-day change;
- `firstViolationDate` / `lastViolationDate`: the first and last changed day;
- `threshold`: 0;
- new optional `netHours`: the signed sum of the changes, for the text only.

**Text, EN and DE.** "Ann Lee: 3 days in closed months changed since the close (net +6 h, largest 8 h)."
The changed days are carried in `data` (first and last) but not repeated in the text, which matches the
other five guardrails. Real umlauts in DE.

**On/off.** No separate toggle. Closing a month is the opt-in, and the rule runs while any month is closed.
This deliberately differs from the other five rules, which are off by default.

**Runner.** `use-insight-lifecycle.ts` passes `links.close ?? null`.

## 5. Out of scope

- Naming which TimeLog entry changed. Only per-person-per-day hours are kept.
- People with no user link. The rule checks linked people only.
- Freezing budget actuals for closed months (owner decision 1).
- Closing single months with gaps (owner decision 3).

## 6. Edge cases

- **Unlinked after the close:** their saved hours stay but are no longer evaluated.
- **Linked after the close:** no saved copy exists, so their closed-month bookings all count as changes.
  The settings block warns about this.
- **Project switch and load hold:** covered by the existing insight-runner gates.
- **Size:** about 20 people × 22 days × 12 months ≈ 5,000 numbers. No cap; recorded as a residue.

## 7. Testing

Test-first. Every guard is mutation-proved: apply the mutant, name the failing test, revert by inverse
anchored write, and end on an empty `git diff --stat`.

- **`timelog-month-close.test.ts`:** each refusal (window short at the start, window short at the end,
  `partial`, a linked person missing, the current month); a successful close saves exactly that month's
  cells for linked users; reopen drops only the last month; the last reopen removes `close`.
- **`timelog-sanitize.test.ts`:** a valid round-trip; each malformed shape drops the whole `close` and is
  reported; unset stays absent.
- **`timelog-policy.test.ts`:** a day added, a day deleted, hours moved with no net change, each flagged;
  0.004 h is not flagged; no close means evaluated and clean; an uncovered month, a partial fetch or a
  missing person means not evaluated; `count`, `worstHours`, the dates and `netHours` are exact.
- **Wiring:** the runner passes `close` (a mutant dropping it fails); reconcile clears after a reopen and
  freezes on lost coverage (`task-manager.guardrail-reconcile.test.tsx`).
- **`timelog-settings.test.tsx`:** state, refusal reason, close, reopen with in-page confirmation,
  row-unique accessible names.
- **Persistence:** a `close` round-trip through each of the six write paths.
- **i18n:** EN/DE parity, real umlauts.

## 8. Docs

- CHANGELOG [Unreleased] entry.
- Register §699 closed, with measurements and residues; the index rebuilt.
- A "Closed months" subsection under "Timelog integration" in `docs/AGENTS/integrations.md`.

## 9. Revision 2026-10-14: the close is per project (owner decision)

The final branch review found that the TimeLog panel fetches only by project (`fetchBookingsForProjects`), and that this fetch records no covered people (`dailyUsers: []`, deliberately, §366). Sections 3 and 4 required every linked person in `dailyUsers`, so with anyone linked a close was always refused, and the rule never checked anyone. The owner chose to make the close per project rather than add a per-person fetch. This section replaces the conflicting parts of sections 2–4 and 6.

**What a project fetch proves.** A complete project fetch returns every booking on the selected TimeLog projects in its window, whoever made it. So for those projects a linked person's daily hours are fully known, including a person who booked nothing (`{}`). Hours on other projects are out of scope by design.

**Data.** `TimelogMonthClose` gains `projectIds: number[]`: the TimeLog project ids the closed months were fetched over, unique, positive integers, ascending, non-empty. One set for the whole close. The sanitizer validates it with the same all-or-nothing rule.

**Cache.** `ActualsCacheEntry` gains `dailyProjects?: readonly number[]`: the TimeLog project ids a project-scope fetch covered (the ids passed to `fetchBookingsForProjects`, unique, ascending). It follows `dailyUsers` everywhere in the store: validated on read, carried on every save via `rollPair`, and shed together with `daily`, `dailyWindow` and `dailyUsers`. A person-scope fetch leaves it absent. Absent means "project scope unknown" and closed months cannot be checked against it.

**Closing.** `closeNextMonth` refuses, in this order: `no-roll` → `not-ended` → `window-start` → `window-end` → `partial` → `no-projects` (the cache has no `dailyProjects`, or an empty one) → `projects-changed` (a close exists and the cache's `dailyProjects` differs from `close.projectIds`). `person-missing` is removed. The first close records the cache's `dailyProjects` as `projectIds`. Linked people are saved as before, `{}` for a linked person with no bookings.

**Checking.** A closed month is covered when the window spans it, the fetch is not partial, and the cache's `dailyProjects` equals `close.projectIds`. Every linked person is checked in every covered closed month; `dailyUsers` plays no part. When the project set differs, no closed month is covered: no violations, the rule is not evaluated, and stored flags freeze until the same projects are fetched again or the months are reopened. `closedMonthCertifies` drops its `dailyUsers` condition and takes the project-set match instead.

**Panel.** New refusal texts replace `timelogCloseRefusePersonMissing`:
- `timelogCloseRefuseNoProjects`: "Fetch TimeLog bookings for the project's TimeLog projects first." / DE "Rufen Sie zuerst die TimeLog-Buchungen der TimeLog-Projekte des Projekts ab."
- `timelogCloseRefuseProjectsChanged`: "The last fetch covers different TimeLog projects than the closed months. Fetch the same projects, or reopen the closed months." / DE "Der letzte Abruf umfasst andere TimeLog-Projekte als die abgeschlossenen Monate. Rufen Sie dieselben Projekte ab oder öffnen Sie die abgeschlossenen Monate wieder."
The linked-later warning names a linked person missing from ANY saved month, not only the last.

**Residues added.** Changes on a person's other TimeLog projects are not seen. Adding or removing a TimeLog project after a close freezes the check until the selection matches again. A flag whose span the cache only partly covers is narrowed to the covered part when re-detected (the same shape as the other five rules). IndexedDB and both Turso layouts are not round-tripped by a test of their own; they decode through `sanitizeTimelogLinks`.

## 10. Revision 2026-10-14: everyone who booked, negative hours, accepting a change (owner decisions)

A fresh pre-merge review found four Important gaps. This section replaces the conflicting parts of sections 2–6 and 9.

**Who is saved and checked: every booker, not only linked people.** Stored `userLinks` hold only manual pins; people the panel matches automatically were never saved or checked, so a team matched by email closed months that protected nobody. A complete project fetch already returns every booking on its projects, so the close saves every positive TimeLog user id with a booking in that month, and the rule checks, per covered closed month, every user id in `saved[month]` or in the current roll for that month. A user with no `saved[month]` entry is compared against `{}`, so a new booker in a closed month is a change. Links are not consulted, and the "linked after the close" warning is removed. The violation names the person the way the other five rules name an unlinked booker.

**Hours may be negative.** TimeLog corrections can make a day total negative. The saved copy records what the fetch showed, so the sanitizer accepts any finite number; it still drops a non-number whole.

**Inactive TimeLog users.** Bookings are resolved to people against the whole TimeLog directory, inactive users included, so a person deactivated after a close is not read as having deleted every booking.

**Accepting a reviewed change.** Each closed month can be accepted: `acceptMonth(close, month, cache)` re-saves `saved[month]` from the current cache under the same coverage rules as a close (window spans the month, not partial, same project set), keeps `through` and `projectIds`, and refuses otherwise with the same refusal reasons. The panel offers "Accept current hours for {month}" for a chosen closed month, behind an in-page confirmation. After it, the flag for that month clears on the next evaluation and later changes compare against the accepted hours.

**Smaller corrections.** The change threshold is `|Δ| >= 0.01` with a float epsilon, not hundredths rounding. The close guards each copied cell as readable. The panel lists the close's TimeLog projects by name from the cached project refs. The first-month choices reach back to the start of the cached window when it is older than 12 months. A corrupted cell stripped by the cache reads as zero, not as unreadable (recorded residue). The 512 KB roll trim can narrow `dailyWindow` so the earliest closed months freeze (recorded residue).
