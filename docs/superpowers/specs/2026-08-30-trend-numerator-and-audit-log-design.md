# Completion-trend numerator, status audit trail, contact export — design

**Date:** 2026-08-30
**Branch:** `fix/trend-numerator-and-audit-log`
**Base:** `main` at `96e21098` (0.266.0 "VanderMeer")
**Closes:** §235, §163's open `dDone` half, §283
**Bump:** yes — the completion-trend fix is a user-visible metric correction.

---

## Why these three together

They are not a grab bag. §235 and §163's open half share one root, and §283 rides along as an
independent one-file correctness fix that needs no new machinery.

- **§235** — the inline status `<select>` and the Kanban swimlane drop write no activity-log entry.
  `use-task-row-handlers.ts` holds exactly one `logActivityRef.current(` call and it is
  `task.deleted`. The form save (`use-task-submit.ts`) and the AI write tools
  (`use-chat-dispatcher.ts`) both log. So the fastest way to complete a task leaves no audit record,
  and the paradox the entry records is real: pressing Undo on an inline status change *does* write an
  entry, because `use-undo-stack.ts` logs `"undo"` / `"redo"`.

- **§163's open half** — `dDone` is fed solely by `task.completed` and `task.reopened`, and **nothing
  in the app writes either kind**. Both are declared in `activity-log.ts` and consumed by
  `completion-trend.ts`; neither has a producer. The numerator is therefore constant across every
  reconstructed day, so the sparkline is a curve about task *count*, not about completion. The
  denominator half of §163 was fixed on 2026-08-17 and is not in scope here.

- **§283** — `export-sections.ts` builds a contact's display string unconditionally as
  `` `${cp.name} <${cp.email}>` ``, so a contact with no address exports as `Bob Jones <>`.
  `email` is required on `ContactPerson` and holds `""` when unset, and the Add path does not
  require one, so the empty case is ordinary rather than degenerate. `project-form-fields.tsx`'s
  `contactDisplay` guards it; the two disagree for exactly that input.

### Reproduce the state before starting

```bash
grep -n "logActivityRef" src/app/use-task-row-handlers.ts          # one call, task.deleted
grep -rn '"task\.completed"' src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rn '"task\.reopened"'  src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -n  'cp.name} <\${cp.email}' src/app/export-sections.ts
grep -rn "contactDisplay" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

The two kind greps must return **declaration and consumption only** — `activity-log.ts` (the union
member plus its i18n label row) and `completion-trend.ts` (`COUNT_KINDS` and the `dDone` tally). If
either returns a producer, this design's premise has changed and the plan must be re-derived.

---

## Severity: this is the file-mode path, i.e. the default

`computeCompletionTrend` prefers `fromSnapshots` and falls back to activity reconstruction when there
are fewer than two snapshots. **Snapshots are Turso-only.** So the constant numerator is what every
file-mode user sees. This is not an edge case.

---

## Measured facts the plan may rely on

Verified 2026-08-30 on `main` at `96e21098`. Re-run anything a task depends on; this file is prose
and prose decays.

1. **`applyStatusChange` call sites** — 11 real sites across 6 files, plus the declaration in
   `task-status.ts` and one comment in `change-log.ts` which are not call sites:
   `task-manager.tsx` (1), `use-action-center-handlers.ts` (1), `use-bulk-operations.ts` (1),
   `use-chat-dispatcher.ts` (2), `use-task-row-handlers.ts` (3), `use-task-submit.ts` (3).
   Re-derive with
   `grep -rn "applyStatusChange(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`.

2. **`logActivity` availability per writer file** — `task-manager.tsx` 32, `use-chat-dispatcher.ts`
   19, `use-task-submit.ts` 12, `use-bulk-operations.ts` 7, `use-jira-sync.ts` 7,
   `use-task-row-handlers.ts` 6, and **`use-action-center-handlers.ts` 0**. That last one is the
   only adopter needing a new dependency threaded in.

3. **Jira writes the pair without `applyStatusChange`, and must keep doing so.**
   `use-jira-sync.ts` holds four `issueToTaskFields(issue, todayNow)` patch sites.
   `docs/AGENTS/task-status.md` records the prohibition and its reason: routing either Jira arm
   through `applyStatusChange` would stamp `today` over Jira's real resolution date. So a census
   keyed on `applyStatusChange(` alone is structurally blind to a whole writer family — the §293
   shape, where the enumerable set does not cover the surface.

4. **`Task.createdDate` exists** and is optional on the type; `migrateTask` backfills it from
   `lastUpdateDate` and runs on all six load paths, so every *loaded* task carries one. Not used by
   this design's chosen approach, but it is what made the fully-data-derived alternative credible
   enough to evaluate, and a future slice may want it.

5. **`computeCompletionTrend` takes no task list** today. Its input is
   `{ snapshots, activity, currentDone, currentTotal, today }`, called once from
   `dashboard-panel.tsx`.

6. **`reversedForwardDelta` moves only `dTotal`.** The undo/redo reversal arm writes
   `cur.dTotal += reversal` and never touches `dDone`.

7. **`contacts.ts` is not a home for the display helper.** It is a different concept — a
   localStorage address book of assignee-to-email pairs — and it imports `device-store`, which would
   drag localStorage into `export-sections.ts`'s pure model layer. No `contact-display.tsx` exists,
   so a new `contact-display.ts` does not hit the `.ts`-before-`.tsx` resolution trap.

---

## Approach, and the two it was chosen over

The numerator is derived from **data** (`completedDate`), not from a new event producer. Event
producers are added anyway, but for the **audit log only** — the trend does not consume them.

**Rejected: event producers alone.** Three measured hazards, any one of which would have shipped a
fresh instance of the bug class being fixed.

- Undo would not decrement the numerator (fact 6), so undoing a completion skews it — the §163 shape,
  inside the fix for §163.
- The census cannot see the four Jira patch sites (fact 3).
- Nothing backfills. Existing projects carry no historical `task.completed`, so the sparkline stays
  flat over all history already recorded and only starts moving from the day the fix ships.

**Rejected: both halves from task data** (`total` from `createdDate`, `done` from `completedDate`).
Needs no clamp and is exact for every task still present regardless of ring age-out, but deleted
tasks vanish from history entirely — discarding the bulk-count and undo-reversal arithmetic §163
built deliberately. A third option that recovered deletions from `task.deleted` / `bulk.delete` on
top of a data base was rejected for carrying both failure modes rather than neither.

---

## Unit A — numerator from data (§163's open half)

`CompletionTrendInput` gains `tasks: readonly Task[]`; `dashboard-panel.tsx` passes the live list.
Inside `reconstructFromActivity`, `done(D)` becomes the count of tasks whose `completedDate` is set
and `<= D`, evaluated per plotted day. `DayDelta.dDone` and both `cur.dDone` arms go; the backward
walk carries `total` only.

The denominator is untouched — `reversedForwardDelta`, `BULK_TOTAL_KINDS`, `bulkTaskCount` and the
`task.created` / `task.deleted` arms all stay exactly as §163 left them.

### Two non-obvious consequences, both of which need a comment in the source

**`task.completed` and `task.reopened` stay in `COUNT_KINDS`** even though their `dDone` arms are
deleted. That set then does one job only: deciding which days get *seeded*. A day carrying a
completion is worth plotting, because the percent moves on it even when the denominator does not.
The file's existing warning about zero-delta days seeding the sparkline was written about **undo**,
where the seeded point carries no information; here it does. Without a comment saying so, the next
reader sees two kinds in `COUNT_KINDS` that contribute no delta and "simplifies" them out, which
silently drops every completion-only day from the series.

**The clamp:** `total = max(total, done)` per day. The two sources have different memory horizons —
the activity ring caps at 500 entries and forgets, task fields do not — so a stale denominator can
sit under an exact numerator. Both clamp directions yield the *same* percent (`done/done` and
`total/total` are each 1); this direction is chosen because it preserves the exact count rather than
suppressing it to match the stale one. Record that equivalence at the clamp, or it reads as an
arbitrary pick and gets flipped.

---

## Unit B — audit trail and its census gate (§235)

### The decision helper

`statusActivityKind(before: Task, after: Task): "task.completed" | "task.reopened" | null` in
`task-status.ts`. Pure, i18n-free, DOM-free, no clock — it reads `isTaskDelivered` on each side and
returns the transition, or `null` when there is none. Placed beside `applyStatusChange` because that
is where the status model already lives, and `task-closed.ts` is a trivial dependency
(`isTaskDelivered` is `!!completedDate`).

Note the asymmetry `task-closed.ts` exists to enforce: **Cancelled is closed but never delivered.**
Moving a task to Cancelled is not a completion, and moving it off Cancelled is not a reopening. Using
`isTaskDelivered` rather than `isTaskClosed` is what gets that right, and it is the exact confusion
that entry warns about.

### Adopters

Each calls the helper and logs when the result is non-null:

| File | Sites | Note |
|---|---|---|
| `use-task-row-handlers.ts` | inline `<select>`, swimlane drop | the §235 sites |
| `use-task-submit.ts` | form save | already logs `task.updated`; this is additive |
| `use-chat-dispatcher.ts` | AI create / update | already logs via `logActivityAs?.("ai", …)` |
| `use-bulk-operations.ts` | bulk edit with status | already logs `bulk.*` |
| `use-jira-sync.ts` | four `issueToTaskFields` patch sites | already logs `jira.sync` |
| `use-action-center-handlers.ts` | mark-done CTA | **has no `logActivity` — thread the dep in** |

`task-manager.tsx` is an **exemption with a stated reason**: its `applyStatusChange` call mints a
child task at `DEFAULT_TASK_STATUS`, so there is no before-state and no transition to record.

### The census gate

A test enumerating every non-test file under `src/app` that contains `applyStatusChange(` **or**
`issueToTaskFields(`, asserting each also contains `statusActivityKind(`, against an allowlist
carrying a reason per exemption.

Two things it must ship with, or it is theatre:

1. **An anti-vacuity proof.** Delete one adopter's call, confirm the gate goes red, restore. Measured
   and recorded in the test's own comment — not asserted in prose. A census that cannot be shown to
   fail is not known to work.
2. **Its blind spot written down.** The scan is **file-granular**: a file holding two writers where
   only one logs passes. It also matches on spelling, so a rename of either anchor makes it silently
   stop covering that family — which is exactly what happened to `use-load-truncation.test.ts`'s
   census when §287 changed a load's spelling, and the suite went red rather than blind only by luck.

The gate covers logging, never the metric. Unit A means a missed writer costs an audit entry and can
never produce a wrong number — which is the split the two register entries actually want.

> ★★★ **RETRACTED, 2026-08-30.** The sentence directly above is half false and is kept only as the
> record of what was designed. A missed writer cannot produce a wrong PERCENTAGE — that half holds,
> because `deliveredBy` reduces over `tasks[].completedDate`. It CAN change the SERIES: both
> `task.completed` and `task.reopened` are members of `COUNT_KINDS` in `completion-trend.ts`, which
> decides which days SEED a point, so a missed writer drops a completion-only day and can take a
> sparse project under the `days.length < 2` floor, rendering no chart at all. Retracted in the
> shipped tree by `9fffef94`; the plan carries the same banner. The claim was propagated verbatim
> from here into the plan and from the plan into three source files, which is the reason it is
> corrected at its origin rather than only downstream.

---

## Unit C — shared contact display (§283)

New pure `src/app/contact-display.ts`:

```ts
export function contactDisplay(cp: ContactPerson): string;
```

The rule is the one `project-form-fields.tsx` already implements: `name`, plus ` <email>` only when
`email` is non-empty. `export-sections.ts` and `project-form-fields.tsx` both import it, so the two
cannot drift again.

`project-form-fields.tsx` keeps its duplicate-name disambiguation — that call composes
`contactDisplay` for rows whose name collides, and is a separate concern from the display rule
itself.

---

## Testing

**Unit A** — pure, so table-driven over reconstructed days: a completion mid-history moves the curve
where today it does not; the clamp case with a ring-aged denominator under an exact numerator; a
reopened task (date cleared) dropping out, pinned as the **documented approximation** it is rather
than as a bug, so a later reader does not "fix" it.

**Unit B** — `statusActivityKind` exhaustive over the status matrix, including both Cancelled
directions. Then one behavioural test per adopter.

**Unit C** — the empty-email case in both directions, plus a test asserting the form and the exporter
agree on the same input.

### Two testing rules this slice must hold

- **Separate `it()` blocks per claim.** vitest aborts at the first hard assertion, so a second
  assertion in the same block is unproved. Where one mutant is killed by several blocks, say so — it
  then proves none of them in isolation.
- **Every absence assertion needs a positive control**, or a component that refused everything would
  satisfy it.

---

## Non-goals

Stated so the plan does not quietly grow them:

- Not recovering deleted tasks into the denominator (the rejected third option).
- Not touching the snapshot path — Turso mode already has real history.
- Not touching §227's Jira local-arm question, `migrateTask`'s non-repair of a valid-but-inconsistent
  pair, or §180's bulk-undo gap.
- No new UI. The sparkline renders whatever it is handed.

---

## Order and constraints

1. **Unit C** — smallest, independent, no interaction with the others.
2. **Unit A** — pure engine.
3. **Unit B** — widest blast radius, and its `COUNT_KINDS` interaction is only safe once A has landed:
   emitting `task.completed` while the `dDone` arm still exists would move the numerator twice.
4. Register closures, `CHANGELOG.md`, `npm run version:sync`.
5. **Release is a separate step, gated on the user saying so.** The plan must not authorise push, MR
   or merge on its own.

### Constraints carried into the plan

- Every `src/app/*.ts(x)` is **CRLF**. Never a `\n`-only anchor; never the `Write` tool on one (it
  re-lines to LF invisibly to `git diff`; `Edit` does not). `docs/**` and `CHANGELOG.md` are LF.
- `docs/open-followups.md` is inside `doc-claims-check`'s scan set and that gate is a **ratchet** —
  the closures cite **symbols and commands, never `path:LINE`**. This spec is exempt
  (`SKIP_DIRS = ["docs/superpowers"]` in `doc-claims-lib.mjs`, verified 2026-08-30).
- Closing each register entry is a **four-place edit**: heading, summary-table status cell, table
  anchor, `**Status:**` witness. A body line must never contain the word CLOSED.
- Never read a gate's exit code through a pipe. Redirect, check unpiped, read the file. Logs go in
  the session scratchpad, never `/tmp`.
- Never run two vitest processes at once. A red carrying `Failed to start forks worker` is
  contention — retry, do not debug. The full suite exceeds the local cap: plan a named risk-surface
  file list plus a shuffled run at `--sequence.seed=1`, and leave the full suite and the coverage
  floors to CI.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1.
- File-size ratchet counts `split("\n").length`, which is `wc -l` + 1; 800 passes and 801 fails.
  Check any file this slice grows with
  `node -e "console.log(require('fs').readFileSync('<f>','utf8').split('\n').length)"` **before**
  committing, not at gate time.
- If an existing test breaks, decide deliberately whether it encoded the old behaviour; fix it and
  **say so in the commit message** rather than weakening the assertion.
