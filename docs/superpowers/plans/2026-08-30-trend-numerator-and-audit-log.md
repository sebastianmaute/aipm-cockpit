# Completion-trend numerator, status audit trail, contact export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ★★★ **ONE CLAIM IN THIS PLAN WAS RETRACTED MID-EXECUTION. Read this before pasting any block below
> into source.**
>
> The plan asserted, in four places, that because the trend numerator is read from `completedDate`, a
> status writer that forgets to log "costs an audit entry and can never move a metric". **The second
> half is false.** `task.completed` and `task.reopened` are members of `COUNT_KINDS` in
> `completion-trend.ts`, and that set decides which days SEED a point as well as which entries survive
> the accumulation loop — so a missed writer drops a completion-only day from the sparkline and can
> take a sparse project back under the `days.length < 2` floor, where it renders no chart at all.
> Only the NUMERATOR half was ever true.
>
> Retracted in the shipped tree by **`9fffef94`** ("fix: retract 'a missed writer can never move a
> metric' and cover each site"), which corrected it in `docs/AGENTS/activity-log.md`,
> `task-status.ts`, `status-activity-census.test.ts` and `completion-trend.test.ts`.
>
> That commit did not reach this plan, and two of the four occurrences here are literal COMMENT TEXT
> inside prescribed code blocks — a re-executor would have pasted the retracted claim straight back
> into source. All four are corrected in place below and each is marked; nothing else is rewritten,
> so the plan stays the record of what was executed. `docs/superpowers/` is excluded from
> `docs:claims:check`, so no gate would have caught this.

**Goal:** Make the dashboard completion sparkline's numerator move (it is currently constant on every reconstructed day), give the inline status controls an audit-log entry, and stop the exporter emitting `Bob Jones <>` for a contact with no email.

**Architecture:** The trend numerator is derived from **task data** (`completedDate`), not from a new event producer — that avoids the undo, Jira-blindness and no-backfill hazards recorded in the spec. Status-transition events are added anyway, and a writer that forgets to log costs an audit entry and a plotted DAY: the numerator is safe, but both kinds sit in `COUNT_KINDS`, which decides which days seed a point. *(Corrected — this read "for the **audit log only**, so a writer that forgets to log costs an audit entry and can never produce a wrong metric"; see the retraction banner above and `9fffef94`.)* A file-granular census test makes a forgotten writer fail CI.

**Tech Stack:** TypeScript, React 19, Next 16, vitest 4.1.8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-trend-numerator-and-audit-log-design.md`
**Branch:** `fix/trend-numerator-and-audit-log`, currently at `826b6adb` (the spec commit), one ahead of `main` at `96e21098`.
**Closes:** open-followups 283 (Task 1), 163's open `dDone` half (Task 2), 235 (Tasks 3–5).

---

## Two corrections to the spec, made while reading the code

Both are recorded here rather than silently applied. **Read them before Task 2** — the spec is wrong on these two points and the plan is right.

### 1. There is NO clamp. The spec said there would be.

The spec called for `total = max(total, done)` per day, because a stale event-derived denominator can sit under an exact data-derived numerator.

That clamp is **dead code**. `reconstructFromActivity` ends by mapping every point through `clampPctFromCounts(done, total)`, which already returns `100` when `done > total`, and `CompletionPoint` exposes only `{label, percent}` — the raw counts never leave the function. So `max(total, done)` cannot change a single observable value.

This file has an explicit standard against exactly that. Its `reversedForwardDelta` carries:

> ★ No `typeof kind === "string"` guard: a numeric or hostile value matches none of the three literals below and contributes nothing anyway, so the guard would be dead code that a later comment could mistake for a load-bearing one. A cold review caught exactly that in the first cut.

Adding the clamp would repeat that mistake in the same file. **Write the comment, not the clamp** (Task 2, Step 5).

### 2. `currentDone` stays, and is still used — for the last point only.

The spec implied the whole numerator becomes data-derived, which would leave `currentDone` unused and force its removal from the interface and from ~15 test call sites.

That would break a stated design goal. The `currentTotal` doc comment on `CompletionTrendInput` says:

> Passing `model.progress.total` here makes the latest sparkline point disagree with the tile rendered above it.

The last plotted day's END state *is* "now" by construction — the backward walk seeds it from `currentTotal`. If the last point's numerator came from `doneOnDay(lastDay)` and the last activity day is older than today, the sparkline's final point would disagree with the completion tile directly above it.

So: **the last point keeps `currentDone`; every earlier point is data-derived.** `currentDone` stays on the interface, no test call site changes, and the diff stays small.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/contact-display.ts` | **create** | Pure `contactDisplay(cp)` — the single display rule for a contact person |
| `src/app/contact-display.test.ts` | **create** | Its unit tests (coverage-gated the moment the module lands) |
| `src/app/export-sections.ts` | modify | Import the helper instead of inlining the string |
| `src/app/project-form-fields.tsx` | modify | Import the helper instead of declaring a local `const` |
| `src/app/completion-trend.ts` | modify | Numerator from `tasks`; `dDone` deleted; denominator untouched |
| `src/app/dashboard-panel.tsx` | modify | Pass `tasks`, and add it to the memo deps |
| `src/app/task-status.ts` | modify | Add pure `statusActivityKind(before, after)` |
| `src/app/use-task-row-handlers.ts` | modify | Adopt — inline `<select>` and swimlane drop (this is §235) |
| `src/app/use-task-submit.ts` | modify | Adopt — form save |
| `src/app/use-chat-dispatcher.ts` | modify | Adopt — AI update |
| `src/app/use-bulk-operations.ts` | modify | Adopt — bulk edit |
| `src/app/use-jira-sync.ts` | modify | Adopt — the four Jira patch sites |
| `src/app/use-action-center-handlers.ts` | modify | Adopt — mark-done CTA; needs `logActivity` threaded in |
| `src/app/task-manager.tsx` | modify | Thread `logActivityUser` into the action-center hook |
| `src/app/status-activity-census.test.ts` | **create** | The recurrence gate |
| `docs/open-followups.md` | modify | Close 283, 163, 235 |
| `CHANGELOG.md` | modify | 0.267.0 entry |
| `src/app/version.ts` | modify | Bump, then `npm run version:sync` |

**No i18n work.** `activityTaskCompleted` (`"Task #{0} marked complete: {1}"`) and `activityTaskReopened` already exist in **both** `i18n.ts` and `i18n.de.ts`, and take `(id, name)` — the same shape as the existing `task.created` / `task.updated` / `task.deleted` calls. `i18n.de.ts` is not touched by this slice.

---

## Ground rules for every task

Violating any of these has cost this repo real work before.

- **Every `src/app/*.ts(x)` is CRLF.** Use `Edit`, never `Write`, on an existing file — `Write` re-lines to LF invisibly to `git diff`. A **new** file is fine with `Write`. `docs/**` and `CHANGELOG.md` are LF.
- **Never read a gate's exit code through a pipe.** `npm run x > "$LOG" 2>&1; echo "EXIT=$?"` then grep the file. `$LOG` lives in the session scratchpad, never `/tmp` (shared across sessions — a peer's run has overwritten a log here before, and the wrong checkout's result was read as this one's).

  Set `$SCRATCH` once per shell, to this session's own scratchpad directory, before any step that uses it:

  ```bash
  SCRATCH="<the session scratchpad path from the environment>"
  mkdir -p "$SCRATCH"
  ```

  Give each log a distinct basename (`t1.log`, `t2.log`, …) — never reuse a peer agent's log path, and hand over **numbers**, never a path.
- **Never run two vitest processes at once.** A red carrying `Failed to start forks worker` or `Test Files no tests` is machine contention — retry, do not debug.
- **`npx tsc --noEmit` exits 2 on diagnostics**, not 1.
- **File-size ratchet counts `split("\n").length`** = `wc -l` + 1. `LIMIT = 800` with `if (n <= LIMIT) continue`, so 800 passes and 801 fails. Read a real number with:
  ```bash
  node -e "console.log(require('fs').readFileSync('src/app/FILE','utf8').split('\n').length)"
  ```
  Today: `project-form-fields.tsx` **795** (five lines of headroom — Task 1 touches it), `use-chat-dispatcher.ts` 614, `dashboard-panel.tsx` 609, `use-task-submit.ts` 578, `use-bulk-operations.ts` 567, `export-sections.ts` 532, `use-jira-sync.ts` 484, `use-task-row-handlers.ts` 392, `use-action-center-handlers.ts` 290, `completion-trend.ts` 276, `task-status.ts` 114. None is baselined in `docs/baselines/file-sizes.json`.
- **One claim per `it()` block.** vitest aborts at the first failed hard assertion, so a second assertion in the same block is *unproved*. Where a task names a mutant, that mutant backs that block alone.
- **Every absence assertion needs a positive control**, or code that refused everything would satisfy it.
- **If an existing test breaks, decide deliberately** whether it encoded the old behaviour. Fix it and say so in the commit message; never weaken the assertion to get green.

**Risk-surface test list** (used by several tasks; the full suite exceeds the local cap and belongs to CI):

```bash
npx vitest run --reporter=dot \
  src/app/completion-trend.test.ts \
  src/app/completion-trend.property.test.ts \
  src/app/contact-display.test.ts \
  src/app/export-sections.test.ts \
  src/app/task-status.test.ts \
  src/app/use-task-row-handlers.test.ts \
  src/app/status-activity-census.test.ts
```

Drop from that list any file a task has not created yet.

---

## Task 1: Unit C — the shared contact display (closes 283)

Smallest and fully independent. Nothing else in the plan depends on it.

**Files:**
- Create: `src/app/contact-display.ts`
- Create: `src/app/contact-display.test.ts`
- Modify: `src/app/export-sections.ts` (the `contactPersons` branch of the export-value switch)
- Modify: `src/app/project-form-fields.tsx` (delete the local `const contactDisplay`, import instead)

---

- [ ] **Step 1: Confirm the defect is live**

```bash
grep -n 'cp.name} <\${cp.email}' src/app/export-sections.ts
grep -n 'const contactDisplay' src/app/project-form-fields.tsx
```

Expected: one hit each. The first builds the string unconditionally; the second guards on `cp.email`. That divergence is the bug.

---

- [ ] **Step 2: Write the failing test**

Create `src/app/contact-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contactDisplay } from "./contact-display";

const cp = (name: string, email: string) => ({ name, email });

describe("contactDisplay", () => {
  it("joins the address in angle brackets when there is one", () => {
    expect(contactDisplay(cp("Bob Jones", "bob@example.com"))).toBe("Bob Jones <bob@example.com>");
  });

  it("emits no angle brackets at all when the address is empty", () => {
    expect(contactDisplay(cp("Bob Jones", ""))).toBe("Bob Jones");
  });

  it("does not emit an empty angle-bracket pair", () => {
    // Named separately because it is the literal symptom 283 records, so a
    // reader grepping for the defect finds a block that states it.
    // ★ It is STRICTLY SUBSUMED by the block above — `toBe("Bob Jones")` on the
    //   same input already implies this — so it cannot fail on its own and adds
    //   no coverage. Kept for the name, not for the assertion.
    expect(contactDisplay(cp("Bob Jones", ""))).not.toContain("<>");
  });

  it("keeps a name that is itself empty from inventing content", () => {
    expect(contactDisplay(cp("", ""))).toBe("");
  });
});
```

---

- [ ] **Step 3: Run it and watch it fail for the right reason**

```bash
npx vitest run --reporter=dot src/app/contact-display.test.ts
```

Expected: **fail** at module resolution — `Failed to resolve import "./contact-display"`. That is the correct red: the module does not exist yet. A failure with any other message means something else is wrong; stop and read it.

---

- [ ] **Step 4: Create the module**

Write `src/app/contact-display.ts` (a new file, so `Write` is fine — it lands LF, which is what a new file gets):

```ts
// The single display rule for a `ContactPerson`: the name, plus the address in
// angle brackets ONLY when there is one.
//
// ★★ It exists because the exporter and the project form had drifted. The form
//    guarded on the address and `export-sections.ts` did not, so a contact with
//    no email rendered as "Bob Jones" on screen and exported as "Bob Jones <>".
//    `email` is REQUIRED on `ContactPerson` and holds "" when unset, and the Add
//    path does not ask for one, so the empty case is ORDINARY, not degenerate.
//    See docs/open-followups.md 283.
//
// ★ Deliberately NOT in `contacts.ts`: that module is a different concept (the
//   localStorage address book of assignee-to-email pairs) and it imports
//   `device-store`, which would drag localStorage into `export-sections.ts`'s
//   pure model layer.
import type { ContactPerson } from "./types";

export function contactDisplay(cp: Pick<ContactPerson, "name" | "email">): string {
  return `${cp.name}${cp.email ? ` <${cp.email}>` : ""}`;
}
```

`Pick<...>` rather than the whole type so a test fixture need not carry unrelated required fields.

---

- [ ] **Step 5: Run the test and watch it pass**

```bash
npx vitest run --reporter=dot src/app/contact-display.test.ts
```

Expected: **4 passed**.

---

- [ ] **Step 6: Adopt it in the exporter**

In `src/app/export-sections.ts`, add the import beside the existing ones:

```ts
import { contactDisplay } from "./contact-display";
```

Then change the `contactPersons` branch. Find:

```ts
      value = persons.map((cp) => `${cp.name} <${cp.email}>`).join(", ");
```

Replace with:

```ts
      value = persons.map(contactDisplay).join(", ");
```

Use `Edit`, not `Write` — this file is CRLF.

---

- [ ] **Step 7: Adopt it in the form**

In `src/app/project-form-fields.tsx`, add the import beside the existing ones:

```ts
import { contactDisplay } from "./contact-display";
```

Then delete the local declaration. Find:

```ts
  /** The string the row actually RENDERS. */
  const contactDisplay = (cp: ContactPerson) => `${cp.name}${cp.email ? ` <${cp.email}>` : ""}`;
```

Delete **both** lines. The comment goes with it — the rule now lives in the module, and a doc comment left behind on nothing is worse than none.

**Leave the other call site alone.** Further down, `contactTokens` calls `contactDisplay(cp)` for rows whose name repeats:

```ts
      name: (contactNameCounts.get(cp.name.trim().toLowerCase()) ?? 0) > 1 ? contactDisplay(cp) : cp.name,
```

That is the duplicate-name disambiguation for accessible names, a separate concern from the display rule. It keeps working unchanged against the imported helper.

---

- [ ] **Step 8: Check the line budget before committing**

`project-form-fields.tsx` was at **795** with a limit of 800. The edit adds one import and removes two lines, so it should land at **794**.

```bash
node -e "console.log(require('fs').readFileSync('src/app/project-form-fields.tsx','utf8').split('\n').length)"
node -e "console.log(require('fs').readFileSync('src/app/export-sections.ts','utf8').split('\n').length)"
```

Expected: **794** and **532**. If `project-form-fields.tsx` reads above 800, stop — do not commit; find what else grew.

---

- [ ] **Step 9: Verify line endings survived**

```bash
git ls-files --eol src/app/export-sections.ts src/app/project-form-fields.tsx
```

Expected: `i/lf w/crlf` for both. `i/lf w/lf` means a `Write` re-lined the file — revert and redo the edit with `Edit`.

---

- [ ] **Step 10: Run the risk surface and typecheck**

```bash
LOG="$SCRATCH/t1.log"
npx vitest run --reporter=dot src/app/contact-display.test.ts src/app/export-sections.test.ts > "$LOG" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: vitest `EXIT=0`, `TSC_EXIT=0`. (`$SCRATCH` is the session scratchpad directory.)

If `export-sections.test.ts` has a test asserting the old `<>` output, it encoded the bug — fix it to the new expectation and say so in the commit message.

---

- [ ] **Step 11: Commit**

```bash
git add src/app/contact-display.ts src/app/contact-display.test.ts src/app/export-sections.ts src/app/project-form-fields.tsx
git commit --only src/app/contact-display.ts src/app/contact-display.test.ts src/app/export-sections.ts src/app/project-form-fields.tsx -m "$(cat <<'EOF'
fix: one contact display rule, so the exporter stops emitting empty angle brackets

export-sections.ts built `${cp.name} <${cp.email}>` unconditionally while the
project form guarded on the address, so a contact with no email rendered as
"Bob Jones" on screen and exported as "Bob Jones <>". `email` is required on
ContactPerson and holds "" when unset, and the Add path does not ask for one,
so the empty case is ordinary rather than degenerate.

Both sites now import contact-display.ts, so they cannot drift again. The form's
duplicate-name disambiguation keeps calling it and is unchanged.

Closes open-followups 283.
EOF
)"
```

---

## Task 2: Unit A — numerator from task data (closes 163's open `dDone` half)

The pure engine. Read the two spec corrections at the top of this plan first.

**Files:**
- Modify: `src/app/completion-trend.ts`
- Modify: `src/app/dashboard-panel.tsx`
- Test: `src/app/completion-trend.test.ts`

---

- [ ] **Step 1: Confirm the premise still holds**

```bash
grep -rn '"task\.completed"' src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rn '"task\.reopened"'  src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Expected: **declaration and consumption only** — `activity-log.ts` (the union member plus its i18n label row) and `completion-trend.ts` (`COUNT_KINDS` and the `dDone` tally). Four lines total per the pair.

If either grep returns a producer, the design's premise has changed. Stop and escalate rather than proceeding.

---

- [ ] **Step 2: Write the failing test**

Append to `src/app/completion-trend.test.ts`. Note the existing file's fixtures use `snapshots`/`activity`/`currentDone`/`currentTotal`/`today`; the new `tasks` key joins them.

```ts
describe("numerator from task data", () => {
  const ev = (kind: string, timestamp: string, ...args: (string | number)[]) =>
    ({ kind, timestamp, args } as unknown as ActivityEntry);
  const task = (id: number, completedDate?: string) =>
    ({ id, taskName: `T${id}`, status: completedDate ? "Done" : "To Do", completedDate }) as unknown as Task;

  // Two days seeded by task.created events, so the denominator moves and the
  // series has the >= 2 days it needs to render at all.
  const activity = [
    ev("task.created", "2026-06-10T09:00:00.000Z", 1, "T1"),
    ev("task.created", "2026-06-12T09:00:00.000Z", 2, "T2"),
  ];

  it("moves the earlier point when a task was already delivered on that day", () => {
    const out = computeCompletionTrend({
      snapshots: [],
      activity,
      tasks: [task(1, "2026-06-10"), task(2)],
      currentDone: 1,
      currentTotal: 2,
      today: "2026-06-21",
    });
    // Day 2026-06-10: one task delivered on or before that day, denominator
    // walked back to 1 => 100%.
    expect(out[0].percent).toBe(100);
  });

  it("leaves the earlier point at zero when nothing was delivered by then", () => {
    // Positive control for the block above: same shape, no completedDate in
    // range, so a numerator that ignored `tasks` entirely could not satisfy
    // both blocks.
    const out = computeCompletionTrend({
      snapshots: [],
      activity,
      tasks: [task(1, "2026-06-20"), task(2)],
      currentDone: 1,
      currentTotal: 2,
      today: "2026-06-21",
    });
    expect(out[0].percent).toBe(0);
  });

  it("keeps the LAST point on currentDone so it agrees with the tile above it", () => {
    // The last plotted day's end state IS "now" by construction — the walk
    // seeds `total` from currentTotal. Deriving the last numerator from
    // `tasks` instead would disagree with the completion tile whenever the
    // last activity day is older than today.
    const out = computeCompletionTrend({
      snapshots: [],
      activity,
      tasks: [task(1, "2026-06-10"), task(2)],
      currentDone: 2,
      currentTotal: 2,
      today: "2026-06-21",
    });
    expect(out[out.length - 1].percent).toBe(100);
  });

  it("seeds a day carrying only a completion, with no denominator move", () => {
    const out = computeCompletionTrend({
      snapshots: [],
      activity: [
        ev("task.created", "2026-06-10T09:00:00.000Z", 1, "T1"),
        ev("task.completed", "2026-06-15T09:00:00.000Z", 1, "T1"),
      ],
      tasks: [task(1, "2026-06-15")],
      currentDone: 1,
      currentTotal: 1,
      today: "2026-06-21",
    });
    // Two days, not one: 06-15 contributes no dTotal but must still seed, or
    // the completion is invisible in the series.
    expect(out).toHaveLength(2);
  });
});
```

Add `Task` and `ActivityEntry` to the file's existing type imports if they are not already there.

---

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run --reporter=dot src/app/completion-trend.test.ts
```

Expected: **fail**. `tsc` will not have run yet, so the failure is behavioural: the first block gets `0` instead of `100` because `dDone` never moves. The fourth block gets `1` instead of `2` only if `task.completed` currently fails to seed — it does seed today (it is in `COUNT_KINDS`), so that block may already pass. That is fine and is stated here so a passing fourth block is not read as a broken test: it is a **characterization** guarding the seeding behaviour through the change, not a red-to-green.

---

- [ ] **Step 4: Add `tasks` to the input type**

In `src/app/completion-trend.ts`, add the type import:

```ts
import type { Task } from "./types";
```

Then add the field to `CompletionTrendInput`, directly above `currentDone`:

```ts
  /** Live task list — the numerator's source for every point but the last.
   *
   *  ★★ A task's `completedDate` states when it was delivered, so the historical
   *     numerator is READ rather than reconstructed. That is what makes it work
   *     retroactively over data already on disk: an event-producer fix would
   *     leave the curve flat over all history already recorded. */
  tasks: readonly Task[];
```

---

- [ ] **Step 5: Rewrite the delta accumulation and the walk**

Still in `src/app/completion-trend.ts`. Replace the `DayDelta` type:

```ts
type DayDelta = { day: string; dTotal: number };
```

Replace the `dDone`-bearing comment block above `const byDay` — the whole `★★★ THE NUMERATOR IS STILL CONSTANT ACROSS EVERY RECONSTRUCTED DAY` paragraph through the `See open-followups 163.` line — with:

```ts
  // Per-day deltas from task events move the DENOMINATOR only
  // (created/deleted/bulk-delete). The NUMERATOR is read from task data below.
  //
  // ★★★ `task.completed` and `task.reopened` STAY IN `COUNT_KINDS` WITH NO
  //   DELTA ARM, AND DELETING THEM DROPS EVERY COMPLETION-ONLY DAY FROM THE
  //   SERIES. `COUNT_KINDS` does ONE job here: deciding which days get SEEDED.
  //   A day on which something was delivered but nothing was created or deleted
  //   moves no `dTotal` at all, yet the percent moves on it, so it must seed.
  // ★★ The zero-delta warning just below is about UNDO and does NOT generalise
  //   to these two. A reverted edit seeds a point carrying no information; a
  //   completion seeds one carrying the only information this chart is about.
  //
  // ★★ NO CLAMP, DELIBERATELY. The numerator is exact (task fields) and the
  //   denominator is reconstructed from an activity ring that caps at 500
  //   entries and forgets, so a stale `total` CAN sit under `done`. It cannot
  //   escape: `clampPctFromCounts` already returns 100 for `done > total`, and
  //   `CompletionPoint` exposes only `percent` — the counts never leave this
  //   function. A `Math.max(total, done)` here would be dead code that a later
  //   reader mistakes for load-bearing, which is exactly what the
  //   `typeof kind === "string"` note in `reversedForwardDelta` warns about.
```

Change the accumulation loop. The map becomes a plain day-to-delta count:

```ts
  const byDay = new Map<string, number>();
  for (const e of activity) {
    // ★★ An undo/redo whose reversal decodes to 0 must fall through to `continue`
    //    and NOT seed a day: it would add a zero-delta point to the sparkline for
    //    every reverted edit, changing the series shape (and the `days.length < 2`
    //    gate) for ops that move no counts at all.
    const dir = e.kind === "undo" ? -1 : e.kind === "redo" ? 1 : 0;
    const reversal = dir === 0 ? 0 : dir * reversedForwardDelta(e.args);
    const isBulk = BULK_TOTAL_KINDS.has(e.kind);
    if (reversal === 0 && !isBulk && !COUNT_KINDS.has(e.kind)) continue;
    const day = e.timestamp.slice(0, 10);
    if (day > today) continue; // clock-skew guard
    // ★ Reversal first, then bulk: both read their delta from the entry rather
    //   than implying it from the kind, so neither can reach the ±1 chain below.
    let dTotal = 0;
    if (reversal !== 0) dTotal = reversal;
    else if (isBulk) dTotal = -bulkTaskCount(e.args);
    else if (e.kind === "task.created") dTotal = 1;
    else if (e.kind === "task.deleted") dTotal = -1;
    // A completion kind falls through with dTotal 0 and STILL seeds the day.
    byDay.set(day, (byDay.get(day) ?? 0) + dTotal);
  }
  const days: DayDelta[] = [...byDay.entries()]
    .map(([day, dTotal]) => ({ day, dTotal }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (days.length < 2) return [];
```

Replace the backward walk:

```ts
  // Walk backward for the DENOMINATOR only: the last event-day's END state =
  // current, so subtract each day's delta to get the previous day's end state.
  // The NUMERATOR is read from `tasks` per day — except for the last point,
  // which stays on `currentDone` so it agrees with the completion tile rendered
  // directly above the sparkline (see the `currentTotal` doc comment).
  const deliveredBy = (day: string): number =>
    tasks.reduce((n, t) => (t.completedDate && t.completedDate <= day ? n + 1 : n), 0);

  const endState: { done: number; total: number }[] = new Array(days.length);
  let total = currentTotal;
  for (let i = days.length - 1; i >= 0; i--) {
    const done = i === days.length - 1 ? currentDone : deliveredBy(days[i].day);
    endState[i] = { done: Math.max(0, done), total: Math.max(0, total) };
    total -= days[i].dTotal;
  }
```

Add `tasks` to the function signature:

```ts
function reconstructFromActivity(
  activity: readonly ActivityEntry[],
  tasks: readonly Task[],
  currentDone: number,
  currentTotal: number,
  today: string,
): CompletionPoint[] {
```

And to the call in `computeCompletionTrend`:

```ts
  return reconstructFromActivity(
    input.activity,
    input.tasks,
    input.currentDone,
    input.currentTotal,
    input.today,
  );
```

---

- [ ] **Step 6: Run the tests**

```bash
npx vitest run --reporter=dot src/app/completion-trend.test.ts src/app/completion-trend.property.test.ts
```

Expected: **pass**. Existing call sites in both test files now lack the required `tasks` key, so `tsc` will object even while vitest is green — that is the next step, and it is the documented vitest-green/tsc-red split.

---

- [ ] **Step 7: Add `tasks` to every existing test call site**

`npx tsc --noEmit` names them. `completion-trend.test.ts` has roughly fifteen object literals and `completion-trend.property.test.ts` one. Most existing cases assert denominator behaviour and care nothing about the numerator, so `tasks: []` is the right value for them — with one consequence to check per case: a case whose expectation depended on `currentDone` propagating backward through `dDone` will now read `0` for its earlier points.

**Do not blanket-edit expectations.** For each test that changes, decide whether it encoded the old constant-numerator behaviour. If it did, update it and list it in the commit message. If a test's intent was genuinely about the denominator, give it `tasks: []` and confirm its expectation is unchanged.

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: `TSC_EXIT=0`.

---

- [ ] **Step 8: Thread `tasks` from the dashboard**

In `src/app/dashboard-panel.tsx`, change the memo. Find:

```ts
      computeCompletionTrend({ snapshots, activity, currentDone, currentTotal, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapCount, activityCount, currentDone, currentTotal, today],
```

Replace with:

```ts
      computeCompletionTrend({ snapshots, activity, tasks: props.tasks, currentDone, currentTotal, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapCount, activityCount, props.tasks, currentDone, currentTotal, today],
```

★★ **`props.tasks` and not `taskCount`.** The neighbouring deps are COUNTS (`snapCount`, `activityCount`) and the file already carries a `taskCount` a few lines above, so the count is the obvious thing to reach for and it is wrong: the numerator depends on `completedDate` VALUES, not on how many tasks there are. A `completedDate` edited to a different past date leaves the count identical and the curve stale. The `exhaustive-deps` disable on the line above means the linter will not catch it either.

---

- [ ] **Step 9: Mutation-prove the two numerator blocks**

Each mutant is minimal and backs exactly one block.

**Mutant A** — makes the numerator ignore the data. In `deliveredBy`, change `t.completedDate <= day` to `false`:

```bash
npx vitest run --reporter=dot src/app/completion-trend.test.ts
```

Expected: **"moves the earlier point when a task was already delivered on that day" FAILS.** Revert.

**Mutant B** — makes the last point data-derived instead of live. Change `i === days.length - 1 ? currentDone : deliveredBy(days[i].day)` to `deliveredBy(days[i].day)`:

Expected: **"keeps the LAST point on currentDone so it agrees with the tile above it" FAILS.** Revert.

**Mutant C** — drops the completion kinds from seeding. Remove `"task.completed"` from `COUNT_KINDS`:

Expected: **"seeds a day carrying only a completion, with no denominator move" FAILS** (one day, so `days.length < 2` returns `[]`). Revert.

Record each result in the test file as a comment naming the mutant. If any mutant leaves the suite green, the block it backs is vacuous — fix the test before proceeding.

Revert every mutant with an inverse `Edit` and prove the tree is clean:

```bash
git diff --stat src/app/completion-trend.ts
```

Expected: only the intended change. `git checkout -- <file>` is deny-blocked in this environment.

---

- [ ] **Step 10: Gates**

```bash
LOG="$SCRATCH/t2.log"
npx vitest run --reporter=dot src/app/completion-trend.test.ts src/app/completion-trend.property.test.ts src/app/dashboard-panel.test.tsx > "$LOG" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG"
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/completion-trend.ts src/app/dashboard-panel.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/completion-trend.ts','utf8').split('\n').length)"
git ls-files --eol src/app/completion-trend.ts src/app/dashboard-panel.tsx
```

Expected: `EXIT=0`, `TSC_EXIT=0`, `LINT_EXIT=0`, `completion-trend.ts` comfortably under 800, both files `i/lf w/crlf`.

---

- [ ] **Step 11: Commit**

```bash
git add src/app/completion-trend.ts src/app/completion-trend.test.ts src/app/completion-trend.property.test.ts src/app/dashboard-panel.tsx
git commit --only src/app/completion-trend.ts src/app/completion-trend.test.ts src/app/completion-trend.property.test.ts src/app/dashboard-panel.tsx -m "$(cat <<'EOF'
fix: read the completion-trend numerator from task data instead of events

`dDone` was fed solely by task.completed and task.reopened, and nothing in the
app writes either kind, so the numerator was constant on every reconstructed
day: the sparkline was a curve about task count, not about completion. That is
the file-mode path and therefore the default — fromSnapshots wins only at two or
more snapshots, and snapshots are Turso-only.

The numerator now reads `completedDate` off the live task list, which works
retroactively over data already on disk. An event-producer fix would have left
the curve flat over all history already recorded, would not have decremented on
undo (reversedForwardDelta moves only dTotal), and could not have covered the
four Jira patch sites, which are prohibited from routing through
applyStatusChange.

The last point stays on currentDone so it keeps agreeing with the completion
tile rendered above it. The denominator is untouched. Both completion kinds stay
in COUNT_KINDS with no delta arm because that set decides day SEEDING, and a
completion-only day must still seed.

No clamp: clampPctFromCounts already bounds the percent and the raw counts never
leave the function, so a max() would be dead code.

Closes the open dDone half of open-followups 163.
EOF
)"
```

If Step 7 changed any existing expectation, add a paragraph naming each one and why it encoded the old behaviour.

---

## Task 3: Unit B part 1 — the pure transition helper

**Files:**
- Modify: `src/app/task-status.ts`
- Test: `src/app/task-status.test.ts`

---

- [ ] **Step 1: Write the failing test**

Append to `src/app/task-status.test.ts`:

```ts
describe("statusActivityKind", () => {
  const t = (status: TaskStatus, completedDate?: string) =>
    ({ id: 1, taskName: "T", status, completedDate }) as unknown as Task;

  it("reports a completion when the task becomes delivered", () => {
    expect(statusActivityKind(t("In Progress"), t("Done", "2026-06-10"))).toBe("task.completed");
  });

  it("reports a reopening when the task stops being delivered", () => {
    expect(statusActivityKind(t("Done", "2026-06-10"), t("In Progress"))).toBe("task.reopened");
  });

  it("reports nothing when delivered-ness did not change", () => {
    expect(statusActivityKind(t("To Do"), t("In Progress"))).toBeNull();
  });

  it("treats a move to Cancelled as no transition", () => {
    // Cancelled is CLOSED but never DELIVERED. Using isTaskClosed here instead
    // of isTaskDelivered would report a completion for cancelled work — the
    // exact confusion task-closed.ts exists to prevent.
    expect(statusActivityKind(t("In Progress"), t("Cancelled"))).toBeNull();
  });

  it("treats a move OFF Cancelled as no transition either", () => {
    // Positive control for the block above: a single-direction guard would
    // satisfy one of these two and not the other.
    expect(statusActivityKind(t("Cancelled"), t("In Progress"))).toBeNull();
  });

  it("reports a completion when a Cancelled task is delivered instead", () => {
    expect(statusActivityKind(t("Cancelled"), t("Done", "2026-06-10"))).toBe("task.completed");
  });
});
```

Add `statusActivityKind` to the file's import from `./task-status`, and `Task` / `TaskStatus` to its type imports if absent.

---

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --reporter=dot src/app/task-status.test.ts
```

Expected: **fail** — `statusActivityKind is not a function` (or a tsc-side "no exported member" once typechecked).

---

- [ ] **Step 3: Implement the helper**

In `src/app/task-status.ts`, add the import:

```ts
import { isTaskDelivered } from "./task-closed";
```

Then append the function:

```ts
/** Which activity kind a status write should record, or `null` for none.
 *
 *  ★★★ DELIVERED, NOT CLOSED. `isTaskClosed` is Done OR Cancelled; cancelling a
 *    task would then report as a COMPLETION and un-cancelling as a REOPENING,
 *    which is the precise confusion `task-closed.ts` was split to prevent. Only
 *    delivery — a `completedDate` — is a completion.
 *
 *  ★★ The trend's NUMERATOR does not consume what this decides — it is read
 *    from `completedDate` (see `completion-trend.ts`), so a missed writer
 *    cannot make a percentage wrong. It CAN change the SERIES: both kinds are
 *    members of `COUNT_KINDS`, which also decides which days SEED a point, so a
 *    status write that logs nothing drops a completion-only day and can take a
 *    sparse project under the `days.length < 2` floor. The census in
 *    `status-activity-census.test.ts` is a convenience for the two reasons its
 *    own header gives — file granularity and spelling — not because a miss is
 *    metric-free. */
export function statusActivityKind(
  before: Pick<Task, "completedDate">,
  after: Pick<Task, "completedDate">,
): "task.completed" | "task.reopened" | null {
  const was = isTaskDelivered(before);
  const now = isTaskDelivered(after);
  if (was === now) return null;
  return now ? "task.completed" : "task.reopened";
}
```

*★ **Corrected.** The second bullet of that docstring originally read "The trend does NOT consume what
this decides. The numerator is read from `completedDate` …, so a writer that forgets to log costs an
AUDIT ENTRY and can never move a metric. That split is deliberate: it is what makes the census in
`status-activity-census.test.ts` a convenience rather than a load-bearing correctness gate." The second
sentence is false and was retracted by `9fffef94`; the wording above is what the shipped
`task-status.ts` carries. See the banner at the top of this plan.*

Check for an import cycle: `task-closed.ts` imports `isTaskFinished` from `task-status.ts`, so this adds a cycle between the two modules. Both are pure and side-effect-free, and the functions are called at runtime rather than at module-evaluation time, so it resolves. Confirm with the typecheck and test run in the next step; if `isTaskDelivered` reads as `undefined` at call time, inline the one-line predicate (`!!task.completedDate`) here instead and say so in a comment.

---

- [ ] **Step 4: Run the test**

```bash
npx vitest run --reporter=dot src/app/task-status.test.ts
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: **6 passed**, `TSC_EXIT=0`.

---

- [ ] **Step 5: Mutation-prove the Cancelled blocks**

**Mutant D** — swap the predicate. Change both `isTaskDelivered(...)` calls to `isTaskClosed(...)` (importing it alongside).

```bash
npx vitest run --reporter=dot src/app/task-status.test.ts
```

Expected: **"treats a move to Cancelled as no transition" and "treats a move OFF Cancelled as no transition either" both FAIL.** Because one mutant kills two blocks, it proves neither *in isolation* — record that in the test comment rather than claiming each is independently pinned. The two blocks are still worth keeping apart: they fail for opposite reasons and a one-directional regression would kill only one.

Revert, then:

```bash
git diff --stat src/app/task-status.ts
```

Expected: only the intended change.

---

- [ ] **Step 6: Commit**

```bash
git add src/app/task-status.ts src/app/task-status.test.ts
git commit --only src/app/task-status.ts src/app/task-status.test.ts -m "$(cat <<'EOF'
feat: add statusActivityKind, the pure completion/reopening decision

Pure, i18n-free, DOM-free and clock-free: it reads isTaskDelivered on each side
and returns task.completed, task.reopened, or null.

Uses isTaskDelivered rather than isTaskClosed deliberately. Cancelled is closed
but never delivered, so cancelling a task is not a completion and un-cancelling
is not a reopening.

No caller yet — the adopters land next.
EOF
)"
```

---

## Task 4: Unit B part 2 — the adopters (closes 235)

Six files adopt the helper. `use-task-row-handlers.ts` is 235 proper; the rest exist so the audit log is uniform and the census in Task 5 has something consistent to enumerate.

**Files:**
- Modify: `src/app/use-task-row-handlers.ts`, `src/app/use-task-submit.ts`, `src/app/use-chat-dispatcher.ts`, `src/app/use-bulk-operations.ts`, `src/app/use-jira-sync.ts`, `src/app/use-action-center-handlers.ts`, `src/app/task-manager.tsx`
- Test: `src/app/use-task-row-handlers.test.ts`

---

- [ ] **Step 1: Confirm the 235 defect is live**

```bash
grep -n "logActivityRef.current(" src/app/use-task-row-handlers.ts
```

Expected: exactly one hit, and it is `task.deleted`. That is the gap.

---

- [ ] **Step 2: Write the failing tests for the two 235 routes**

Append to `src/app/use-task-row-handlers.test.ts`. That file already exists (806 lines) and provides `makeTask(overrides)` and `makeArgs(overrides)` — reuse them, do not add new fixtures. `makeTask` defaults to `{ id: 1, taskName: "Test task", status: "To Do" }`, and `makeArgs` already stubs `logActivity` with `vi.fn()`, so each block overrides only what it needs.

★ The file is over the 800-line limit and that is fine: `check-file-sizes.mjs` filters out `/\.test\.|\.property\./` before measuring, so test files are outside the ratchet entirely.

Two routes, four blocks — one claim each.

```ts
describe("useTaskRowHandlers — status transitions reach the activity log", () => {
  it("logs a completion when the inline select moves a task to Done", () => {
    const logActivity = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "In Progress" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    expect(logActivity).toHaveBeenCalledWith("task.completed", 1, "Test task");
  });

  it("logs a reopening when the inline select moves a task off Done", () => {
    const logActivity = vi.fn();
    const tasksRef = {
      current: [makeTask({ id: 1, status: "Done", completedDate: "2030-01-01" })],
    };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "In Progress"));
    expect(logActivity).toHaveBeenCalledWith("task.reopened", 1, "Test task");
  });

  it("writes no transition entry when delivered-ness does not change", () => {
    // Positive control: without it, a handler that logged nothing at all would
    // satisfy this block, and the two above would be the only evidence.
    const logActivity = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "In Progress"));
    expect(logActivity).not.toHaveBeenCalledWith("task.completed", 1, "Test task");
  });

  it("logs a completion when a swimlane drop moves a task to Done", () => {
    const logActivity = vi.fn();
    const tasksRef = {
      current: [makeTask({ id: 1, status: "To Do", assignee: "", resourceId: undefined })],
    };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() =>
      result.current.onSwimlaneDrop(
        1,
        { key: "res:7", label: "Anna Jordan", resourceId: 7 },
        "Done",
      ),
    );
    expect(logActivity).toHaveBeenCalledWith("task.completed", 1, "Test task");
  });
});
```

The lane literal `{ key: "res:7", label: "Anna Jordan", resourceId: 7 }` is the shape the file's existing `onSwimlaneDrop` describe already uses.

---

- [ ] **Step 3: Run and watch all four fail except the control**

```bash
npx vitest run --reporter=dot src/app/use-task-row-handlers.test.ts
```

Expected: the three positive blocks **fail** (`logActivity` never called with those arguments); the "writes no transition entry" control **passes** already, because nothing logs today. That asymmetry is the point of the control — it only becomes evidence once the other three are green.

---

- [ ] **Step 4: Adopt in `use-task-row-handlers.ts`**

Add to the import from `./task-status`: `statusActivityKind`.

In `onStatusChange`, the guarded block already computes `after`. Add the log after the `captureFieldEdit` call, inside the same `if`:

```ts
        const kind = statusActivityKind(prevRow, after);
        if (kind) logActivityRef.current(kind, id, prevRow.taskName);
```

In `onSwimlaneDrop`, likewise after its `captureFieldEdit` call:

```ts
      const kind = statusActivityKind(prevRow, after);
      if (kind) logActivityRef.current(kind, id, prevRow.taskName);
```

`logActivityRef` is an existing stable ref in this file, so no dependency array changes.

---

- [ ] **Step 5: Run and watch them pass**

```bash
npx vitest run --reporter=dot src/app/use-task-row-handlers.test.ts
```

Expected: all four pass.

---

- [ ] **Step 6: Mutation-prove the two routes separately**

**Mutant E** — delete the `if (kind) logActivityRef.current(...)` pair from `onStatusChange` only.
Expected: the two inline-select blocks FAIL; the swimlane block still passes. Revert.

**Mutant F** — delete it from `onSwimlaneDrop` only.
Expected: the swimlane block FAILS; the inline blocks still pass. Revert.

Two mutants rather than one because a single mutant removing both would kill all three positive blocks together and prove none of them for its own route. Record both results as a comment in the test file.

```bash
git diff --stat src/app/use-task-row-handlers.ts
```

Expected: only the intended change.

---

- [ ] **Step 7: Adopt in `use-task-submit.ts`**

Add `statusActivityKind` to the `./task-status` import. At each of the three `applyStatusChange` sites, the surrounding code already has the previous task and the result in scope and already calls `logActivity("task.updated", ...)`. Beside each such call, add:

```ts
          const transition = statusActivityKind(previousTask, nextTask);
          if (transition) logActivity(transition, updatedId, taskName);
```

Use the local names the surrounding block already binds — the form-save path binds `updatedId` and `taskName`; the create path binds `newId`. **A create is not a transition**: there is no before-state, so leave the `task.created` site alone.

---

- [ ] **Step 8: Adopt in `use-chat-dispatcher.ts`**

Add `statusActivityKind` to the `./task-status` import. The two `applyStatusChange` sites already have `baseTask` / `mergedBase` and their result. Beside each existing `logActivityAs?.("ai", "task.updated", …)`:

```ts
          const transition = statusActivityKind(baseTask, updated);
          if (transition) args.logActivityAs?.("ai", transition, updated.id, updated.taskName);
```

Use the actual result binding at each site. The `"ai"` actor is required here — this file logs AI writes, and threading the user actor would misattribute them.

---

- [ ] **Step 9: Adopt in `use-bulk-operations.ts`**

Add `statusActivityKind` to the `./task-status` import. The status branch is guarded by `statusEnabled` and produces `withStatus` from `next`. Inside the per-row mapping, collect the transitions and log them after the write:

```ts
      const transition = statusEnabled ? statusActivityKind(next, withStatus) : null;
      if (transition) logActivity(transition, next.id, next.taskName);
```

★ Bulk edit writes N rows in one tick. Log per row rather than once per batch — `activityTaskCompleted` takes a single id and name, and the completion kinds carry no count argument (that is what `BULK_TOTAL_KINDS` exists for, and these are not members of it).

---

- [ ] **Step 10: Adopt in `use-jira-sync.ts`**

Add `statusActivityKind` to the `./task-status` import. At each of the four `issueToTaskFields(issue, todayNow)` patch sites, the local task and the patch are both in scope. After the patch is applied:

```ts
          const transition = statusActivityKind(existing, { ...existing, ...patch });
          if (transition) logActivity(transition, existing.id, existing.taskName);
```

Use each site's real bindings for `existing` and `patch`.

★★★ **Do not route any Jira arm through `applyStatusChange`.** It would stamp `today` over Jira's real resolution date. `issueToTaskFields` derives both `status` and `completedDate` from one `statusKey` read, so the patch's pair is already coherent — this step only *observes* the transition, it does not write it. `docs/AGENTS/task-status.md` records the prohibition.

---

- [ ] **Step 11: Adopt in `use-action-center-handlers.ts` — and thread the dep**

This file has **no `logActivity` at all**; it is the only adopter needing new wiring.

Add to its args type:

```ts
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
```

importing `ActivityKind` from `./activity-log`, and destructure `logActivity` from `args` alongside the existing fields.

At the mark-done site, which currently reads:

```ts
    setTasks((prev) => prev.map((tk) => (tk.id === id ? applyStatusChange(tk, "Done", today) : tk)));
```

capture the row first so the transition can be decided:

```ts
    const before = tasksRef.current.find((tk) => tk.id === id);
    setTasks((prev) => prev.map((tk) => (tk.id === id ? applyStatusChange(tk, "Done", today) : tk)));
    if (before) {
      const transition = statusActivityKind(before, applyStatusChange(before, "Done", today));
      if (transition) logActivity(transition, id, before.taskName);
    }
```

Use whatever the file already has for reading the current rows; if it holds no tasks ref, take the row from the same source the surrounding handler already uses.

Then in `src/app/task-manager.tsx`, at the `useActionCenterHandlers(...)` call, add:

```ts
logActivity: logActivityUser,
```

★★★ **`logActivityUser`, never the raw `logActivity`.** `task-manager.tsx` carries the rule at its own wiring block: *"every `logActivity:` below MUST read `logActivityUser` … Threading the raw one shipped ZERO 'user' entries."* Every other hook in that file follows it.

---

- [ ] **Step 12: Gates for the whole adopter set**

```bash
LOG="$SCRATCH/t4.log"
npx vitest run --reporter=dot \
  src/app/use-task-row-handlers.test.ts \
  src/app/use-task-submit.test.ts \
  src/app/use-chat-dispatcher.test.tsx \
  src/app/use-bulk-operations.test.tsx \
  src/app/use-jira-sync.test.tsx > "$LOG" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG"
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "LINT_EXIT=$?"
for f in use-task-row-handlers.ts use-task-submit.ts use-chat-dispatcher.ts use-bulk-operations.ts use-jira-sync.ts use-action-center-handlers.ts task-manager.tsx; do
  echo "$f $(node -e "console.log(require('fs').readFileSync('src/app/$f','utf8').split('\n').length)")"
done
git ls-files --eol src/app/use-task-row-handlers.ts src/app/use-task-submit.ts src/app/use-chat-dispatcher.ts src/app/use-bulk-operations.ts src/app/use-jira-sync.ts src/app/use-action-center-handlers.ts src/app/task-manager.tsx
```

Expected: `EXIT=0`, `TSC_EXIT=0`, `LINT_EXIT=0`, every file under 800 (`use-chat-dispatcher.ts` had the least room at 614), all `i/lf w/crlf`.

Any existing test that asserted a *complete* list of `logActivity` calls will now see an extra entry. That test encoded the old silence — update it and name it in the commit message.

---

- [ ] **Step 13: Commit**

```bash
git add src/app/use-task-row-handlers.ts src/app/use-task-row-handlers.test.ts src/app/use-task-submit.ts src/app/use-chat-dispatcher.ts src/app/use-bulk-operations.ts src/app/use-jira-sync.ts src/app/use-action-center-handlers.ts src/app/task-manager.tsx
git commit --only src/app/use-task-row-handlers.ts src/app/use-task-row-handlers.test.ts src/app/use-task-submit.ts src/app/use-chat-dispatcher.ts src/app/use-bulk-operations.ts src/app/use-jira-sync.ts src/app/use-action-center-handlers.ts src/app/task-manager.tsx -m "$(cat <<'EOF'
fix: record completions and reopenings on every status write

The inline status select and the Kanban swimlane drop wrote no activity entry at
all, so the fastest way to complete a task left no audit record — while pressing
Undo on that same change DID write one, because the undo stack logs "undo".

All six status-writing surfaces now record the transition through the shared
statusActivityKind: the two inline routes, the form save, the AI update, bulk
edit, and the four Jira patch sites. The Jira arms observe the transition
without routing through applyStatusChange, which would stamp today over Jira's
real resolution date.

use-action-center-handlers had no logActivity at all; task-manager threads
logActivityUser into it, matching every other hook in that file.

The trend's numerator does not consume these entries — it is read from
completedDate — but the SERIES does: both kinds sit in COUNT_KINDS, which
decides which days seed a point, so a missed writer drops a completion-only
day from the sparkline.

Closes open-followups 235.
EOF
)"
```

---

## Task 5: Unit B part 3 — the recurrence census

**Files:**
- Create: `src/app/status-activity-census.test.ts`

---

- [ ] **Step 1: Re-derive the census set**

```bash
for f in $(ls src/app | grep -E "\.tsx?$" | grep -vE "\.test\.tsx?$"); do
  if grep -qE "applyStatusChange\(|issueToTaskFields\(" "src/app/$f"; then echo "$f"; fi
done
```

Expected, measured 2026-08-30, **ten files**: `change-log.ts`, `jira-api.ts`, `task-manager.tsx`, `task-status.ts`, `use-action-center-handlers.ts`, `use-bulk-operations.ts`, `use-chat-dispatcher.ts`, `use-jira-sync.ts`, `use-task-row-handlers.ts`, `use-task-submit.ts`.

Six are adopters; four are exempt. If the command returns a different set, use what it returns and adjust the constants below — the measured set is the input, not the list written here.

---

- [ ] **Step 2: Write the census**

Create `src/app/status-activity-census.test.ts`:

```ts
// Recurrence gate for open-followups 235: a file that WRITES a task's
// status/completedDate pair must also DECIDE whether that write was a
// completion or a reopening.
//
// ★★ WHAT THIS CANNOT DO, stated so a green run is not over-read:
//   - It is FILE-GRANULAR. A file holding two status writers where only one
//     calls statusActivityKind passes. It proves a file participates, never
//     that every site in it does.
//   - It matches on SPELLING. Rename either anchor and this silently stops
//     covering that family. That is not hypothetical: use-load-truncation's
//     census counted load sites by literal spelling and a renamed load broke it.
//   - It gates the AUDIT LOG only — but do NOT read that as "a miss here can
//     never move a metric". The completion-trend NUMERATOR is safe:
//     `deliveredBy` reduces over `tasks`, never over these entries. The SERIES
//     is not. Both kinds are members of `COUNT_KINDS`, which also decides which
//     days SEED a point, so a missed writer drops a completion-only day and can
//     take the chart under the `days.length < 2` floor entirely.
//
// ★ ANTI-VACUITY, measured rather than asserted: with the
//   `if (kind) logActivityRef.current(...)` pair deleted from onStatusChange in
//   use-task-row-handlers.ts, the "records a transition decision" block below
//   goes RED naming that file. Re-run that mutation if you change the anchors.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = join(process.cwd(), "src", "app");

/** A file that writes the status/completedDate pair matches one of these. */
const WRITER_ANCHORS = [/applyStatusChange\(/, /issueToTaskFields\(/];
const DECISION = /statusActivityKind\(/;

/** Files carrying an anchor that deliberately record no transition. */
const EXEMPT = new Map<string, string>([
  [
    "task-manager.tsx",
    "mints a child task at DEFAULT_TASK_STATUS: no before-state and no transition. It logs task.created instead.",
  ],
  ["task-status.ts", "declares applyStatusChange and statusActivityKind; not a call site."],
  ["jira-api.ts", "declares issueToTaskFields; not a call site."],
  ["change-log.ts", "names applyStatusChange in a comment only."],
]);

function writerFiles(): string[] {
  return readdirSync(APP_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => {
      const src = readFileSync(join(APP_DIR, f), "utf8");
      return WRITER_ANCHORS.some((re) => re.test(src));
    })
    .sort();
}

describe("status-write census", () => {
  it("finds the known set of status-writing files", () => {
    // Pinned as a SET, not a count, so a new writer forces a deliberate choice
    // (adopt or exempt) instead of silently joining an unchecked population.
    expect(writerFiles()).toEqual([
      "change-log.ts",
      "jira-api.ts",
      "task-manager.tsx",
      "task-status.ts",
      "use-action-center-handlers.ts",
      "use-bulk-operations.ts",
      "use-chat-dispatcher.ts",
      "use-jira-sync.ts",
      "use-task-row-handlers.ts",
      "use-task-submit.ts",
    ]);
  });

  it("records a transition decision in every non-exempt status-writing file", () => {
    const missing = writerFiles()
      .filter((f) => !EXEMPT.has(f))
      .filter((f) => !DECISION.test(readFileSync(join(APP_DIR, f), "utf8")));
    expect(missing).toEqual([]);
  });

  it("keeps every exemption pointed at a file that still exists", () => {
    // Without this, a renamed or deleted file leaves a stale exemption that
    // would silently excuse some future file of the same name.
    const present = new Set(writerFiles());
    expect([...EXEMPT.keys()].filter((f) => !present.has(f))).toEqual([]);
  });
});
```

---

- [ ] **Step 3: Run it**

```bash
npx vitest run --reporter=dot src/app/status-activity-census.test.ts
```

Expected: **3 passed**.

---

- [ ] **Step 4: Prove it is not vacuous**

**Mutant G** — in `src/app/use-task-row-handlers.ts`, delete both `if (kind) logActivityRef.current(kind, id, prevRow.taskName);` lines *and* both `const kind = statusActivityKind(...)` lines, so the file no longer contains the token.

```bash
npx vitest run --reporter=dot src/app/status-activity-census.test.ts
```

Expected: **"records a transition decision in every non-exempt status-writing file" FAILS**, with `use-task-row-handlers.ts` named in the diff. That is the whole value of the gate — confirm it by reading the failure message, not by the exit code alone.

Revert, then confirm:

```bash
git diff --stat src/app/use-task-row-handlers.ts
npx vitest run --reporter=dot src/app/status-activity-census.test.ts
```

Expected: empty diff, 3 passed. Update the anti-vacuity comment at the top of the census if the observed failure differed from what it claims.

---

- [ ] **Step 5: Commit**

```bash
git add src/app/status-activity-census.test.ts
git commit --only src/app/status-activity-census.test.ts -m "$(cat <<'EOF'
test: census so a new status writer cannot silently skip the audit log

open-followups 293 records that the destructive-save arming gate could only
enumerate the AI surface, because TOOL_DEFS gave it something to walk. Status
writers have no such declaration, so this walks the source instead: every file
matching applyStatusChange( or issueToTaskFields( must also call
statusActivityKind, against a four-entry exemption map that carries a reason
each.

The known set is pinned as a SET rather than a count, so a new writer forces a
deliberate adopt-or-exempt decision.

Anti-vacuity measured, not asserted: with the log pair deleted from
onStatusChange the census goes red naming that file. Its two blind spots are
written into the file — it is file-granular, and it matches on spelling.
EOF
)"
```

---

## Task 6: Register closures, changelog, version bump

**Files:**
- Modify: `docs/open-followups.md` (LF)
- Modify: `CHANGELOG.md` (LF)
- Modify: `src/app/version.ts`, then propagate

---

- [ ] **Step 1: Read each entry's four places before editing**

Closing an entry is a **four-place edit**: the `##` heading, the summary-table status cell, the table anchor, and the `**Status:**` witness.

```bash
grep -n "^## 235\.\|^## 163\.\|^## 283\." docs/open-followups.md
grep -n "#235-\|#163-\|#283-" docs/open-followups.md
```

★★★ **163 is a PARTIAL and must not be pattern-matched.** Its heading already reads `— FIXED 2026-08-17 (both actors); the dDone half stays OPEN`. Closing the `dDone` half makes the whole entry closable, so the heading needs rewriting rather than appending — and per the register's own convention, `— CLOSED` is reserved for whole-entry closure. Re-read the heading and decide deliberately.

★ Anchors are derived from heading text. Changing a heading changes its anchor, so every cross-reference to it must move too. Find them:

```bash
grep -n "#163-\|#235-\|#283-" docs/open-followups.md
```

---

- [ ] **Step 2: Close 283**

Heading gains `— CLOSED 2026-08-30`. The `**Status:**` line becomes a witness that does **not** contain the word CLOSED (a body line claiming closure breaks every count in the register):

```markdown
**Status:** fixed 2026-08-30 on `fix/trend-numerator-and-audit-log`. Both sites now import
`contactDisplay` from `contact-display.ts`. Verified 2026-08-30 by
`npx vitest run src/app/contact-display.test.ts src/app/export-sections.test.ts`.
```

★ **Cite symbols and commands, never `path:LINE`.** `docs/open-followups.md` is inside `doc-claims-check`'s scan set and that gate is a **ratchet** — a new `file.ts:123` citation fails CI.

---

- [ ] **Step 3: Close 235 and 163's remaining half**

Same four-place shape for each. For 163, state which half closed when: the denominator half on 2026-08-17, the `dDone` half now, and that the numerator is derived from `completedDate` rather than from a `task.completed` producer — so the "needs a real task.completed writer" framing in the old body is superseded rather than satisfied.

For 235, note that the producers landed *and* that the trend deliberately does not consume them, or a later reader will assume the two are wired together.

---

- [ ] **Step 4: Run the register gates**

```bash
LOG="$SCRATCH/t6.log"
npm run followups:status:check > "$LOG" 2>&1; echo "EXIT=$?"; tail -5 "$LOG"
npm run docs:claims:check > "$LOG" 2>&1; echo "EXIT=$?"; tail -5 "$LOG"
```

Expected: both `EXIT=0`. **Exit 1 is drift** (write the Status line); **exit 2 is the gate unable to scan** — an unreadable register or too few entries parsed, which demands the opposite response.

---

- [ ] **Step 5: Changelog and version**

`src/app/version.ts` is the source of truth. Bump `APP_VERSION` to `0.267.0`, set `APP_BUILD_DATE` to `2026-08-30`, and pick a new `APP_MILESTONE` codename (main shipped `0.266.0 "VanderMeer"`).

Add the `CHANGELOG.md` entry above the existing `0.266.0` one, keeping that entry verbatim:

```markdown
### Fixed
- The Dashboard completion sparkline's numerator no longer stays constant across reconstructed days. It is now read from each task's completion date, so the curve reflects completion rather than task count — and it works over history already recorded.
- Changing a task's status from the Open Points table or by dragging a Kanban card now writes an activity-log entry, so the fastest way to complete a task no longer leaves the audit trail silent.
- A contact with no email address now exports as their name alone, instead of the name followed by an empty pair of angle brackets.
```

Then propagate — six places carry the version and `version-sync-check` is blocking:

```bash
npm run version:sync
npm run version:check; echo "EXIT=$?"
```

Expected: `EXIT=0`. **Never hand-edit the six places.** Exit 1 is drift, exit 2 means the gate could not scan.

---

- [ ] **Step 6: Full local gate sweep**

```bash
LOG="$SCRATCH/final.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src scripts; echo "LINT_EXIT=$?"
npm run size:check > "$LOG" 2>&1; echo "SIZE_EXIT=$?"; tail -3 "$LOG"
npm run dup:check > "$LOG" 2>&1; echo "DUP_EXIT=$?"; tail -3 "$LOG"
npm run docs:symbols:check > "$LOG" 2>&1; echo "SYM_EXIT=$?"; tail -3 "$LOG"
npm run test:shuffle > "$LOG" 2>&1; echo "SHUFFLE_EXIT=$?"; grep -E "Test Files|Tests " "$LOG"
```

Expected: every exit `0`. `test:shuffle` is the only local reproduction of the `unit-tests-shuffled` CI job and this slice adds tests, so it matters here.

★ Leave the **full suite with coverage floors**, the **axe gate** and **prod-smoke** to CI. The full suite exceeds the local cap, and a backgrounded run gets killed with the notification reporting the wrong exit code. `contact-display.ts` is a new coverage-gated file — its tests exist, but only CI's `test:coverage` proves the floors hold.

---

- [ ] **Step 7: Commit**

```bash
git add docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit --only docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS -m "$(cat <<'EOF'
chore: close open-followups 163, 235 and 283; release 0.267.0

163's denominator half closed on 2026-08-17; its dDone half closes here, though
not the way the entry predicted. The numerator is read from completedDate rather
than from a new task.completed producer, so the fix works over history already
recorded and cannot be skewed by undo.

235 closes with producers on all six status-writing surfaces plus a census gate.

283 closes with a shared contactDisplay helper.
EOF
)"
```

---

## Task 7: Release — GATED

**Do not begin this task until the user says "release".** Nothing in this plan authorises a push, an MR or a merge. If Task 6 is complete and the user has not said the word, stop and report.

---

- [ ] **Step 1: Confirm main has not moved**

```bash
git fetch origin
git log --oneline -1 origin/main
git status --short
grep -E "APP_VERSION|APP_MILESTONE" src/app/version.ts
```

If `origin/main` has moved past `96e21098`, merge it in and re-run the Task 6 Step 6 sweep before going further — a version collision on a long-lived branch has bitten this repo before, when main released a number the branch had already taken.

---

- [ ] **Step 2: Code review before release**

Run a cold review of the whole branch (`96e21098..HEAD`) before pushing. This is a standing rule, not an optional step. Fix-round commits are the highest-defect commit class here, and on the previous slice nearly every defect a review found sat in the branch's own fix commits rather than in the code being fixed.

---

- [ ] **Step 3: Push and open the MR**

```bash
git push -u origin fix/trend-numerator-and-audit-log
```

Then create the MR with a description covering 163, 235 and 283, a scope note, and a test plan that marks the full suite, coverage floors, axe and prod-smoke as **CI's, not claimed locally**.

★★ **No `[session link removed]...` URL in the MR description or in `CHANGELOG.md`.** Commit trailers and MR comments are unaffected.

---

- [ ] **Step 4: Poll the pipeline to completion**

Wait for every blocking job: `lint`, `typecheck`, `semgrep`, `dependency-audit`, `file-size-ratchet`, `agents-symbol-check`, `version-sync-check`, `doc-claims-check`, `followups-status-check`, `duplication-gate`, `unit-tests` (the coverage floors), `unit-tests-shuffled`, `build`, `prod-smoke` (the only gate that sees the production CSP), and `e2e` (the axe gate). `dast-zap` is manual and non-blocking on an MR pipeline.

---

- [ ] **Step 5: Merge only on green**

```bash
glab mr merge <NUMBER> --auto-merge=false --yes
```

★★★ **`--auto-merge=false` is mandatory.** `glab mr merge` **defaults to `--auto-merge=true`**, so omitting the flag is not opting out — it queues the merge to fire on a pipeline nobody has read. Merge only after the pipeline is confirmed green.

---

- [ ] **Step 6: Verify the merge introduced nothing**

```bash
git checkout main && git pull --ff-only
git diff-tree --cc HEAD
grep -E "APP_VERSION|APP_MILESTONE" src/app/version.ts
```

A merge can contain content neither parent had; `--cc` is what shows it.

---

## Self-review

**Spec coverage.** Unit C → Task 1. Unit A → Task 2. Unit B's helper → Task 3, its adopters → Task 4, its census → Task 5. Register closures, changelog and bump → Task 6. Release → Task 7, gated. The spec's testing rules (separate `it()` blocks, positive controls, named mutants) are in the ground rules and applied per task. Non-goals carried over below.

**Two spec requirements deliberately not implemented as written**, both documented at the top of this plan with the evidence: the clamp is dead code given `clampPctFromCounts`, and `currentDone` survives because the last point must agree with the tile above it.

**Type consistency.** `statusActivityKind(before, after)` takes `Pick<Task, "completedDate">` and returns `"task.completed" | "task.reopened" | null` in Task 3, and every adopter in Task 4 calls it with that signature and guards on the null. `contactDisplay(cp)` takes `Pick<ContactPerson, "name" | "email">` in Task 1 and both call sites pass a full `ContactPerson`, which satisfies it. `CompletionTrendInput.tasks` is `readonly Task[]` in Task 2 and `dashboard-panel.tsx` passes `props.tasks`, typed `readonly Task[]`.

**Non-goals.** Not recovering deleted tasks into the denominator. Not touching the snapshot path. Not touching 227's Jira local-arm question, `migrateTask`'s non-repair of a valid-but-inconsistent pair, or 180's bulk-undo gap. No new UI and no change to the sparkline component. No i18n changes — both labels already exist in EN and DE.
