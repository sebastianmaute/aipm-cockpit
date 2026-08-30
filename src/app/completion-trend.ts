// Pure, i18n-free engine for the Dashboard completion-trend sparkline.
// Produces a chronological series of % complete (0–100). Prefers exact Turso
// snapshot history; falls back to reconstructing the series when there are
// fewer than two snapshots. That fallback splits its two halves: the
// DENOMINATOR is walked back through the local activity log, the NUMERATOR is
// READ from `tasks[].completedDate`. No I/O, no clock — `today`, `tasks`,
// `currentDone`, `currentTotal` are passed in.

import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";
import { isTaskDelivered } from "./task-closed";
import type { Task } from "./types";

export interface CompletionPoint {
  /** Short day label "MM-DD" for tooltips/labels. */
  label: string;
  /** Completion percentage, clamped to [0, 100]. */
  percent: number;
}

export interface CompletionTrendInput {
  snapshots: readonly SnapshotRecord[];
  activity: readonly ActivityEntry[];
  /** Live task list — the numerator's source for every point but the last.
   *
   *  ★★ A task's `completedDate` states when it was delivered, so the historical
   *     numerator is READ rather than reconstructed. That is what makes it work
   *     retroactively over data already on disk: an event-producer fix would
   *     leave the curve flat over all history already recorded. */
  tasks: readonly Task[];
  /** Live completed-task count (model.progress.completed). */
  currentDone: number;
  /** Live IN-SCOPE task count (model.progress.inScope — total minus cancelled),
   *  the same denominator the dashboard completion tile divides by. Passing
   *  `model.progress.total` here makes the latest sparkline point disagree with
   *  the tile rendered above it. Historical points still reconstruct `total`
   *  from create/delete events (there is no cancel event kind), so earlier
   *  points remain the documented approximation. */
  currentTotal: number;
  /** Today as YYYY-MM-DD; used only to drop future-dated (clock-skew) events. */
  today: string;
}

/** Trailing window so a long history doesn't flood the sparkline. */
export const MAX_POINTS = 12;

function clampPctFromCounts(done: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((100 * done) / total);
  if (!Number.isFinite(pct)) return 0;
  return pct < 0 ? 0 : pct > 100 ? 100 : pct;
}

function clampPctValue(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const r = Math.round(pct);
  return r < 0 ? 0 : r > 100 ? 100 : r;
}

/** ISO timestamp/date -> "MM-DD". */
function dayLabel(iso: string): string {
  return iso.slice(5, 10);
}

function trailing<T>(arr: readonly T[]): T[] {
  return arr.length > MAX_POINTS ? arr.slice(arr.length - MAX_POINTS) : [...arr];
}

function fromSnapshots(snapshots: readonly SnapshotRecord[]): CompletionPoint[] {
  if (snapshots.length < 2) return [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return trailing(sorted).map((s) => ({
    label: dayLabel(s.capturedAt),
    percent: clampPctValue(s.pctComplete),
  }));
}

const COUNT_KINDS = new Set(["task.created", "task.completed", "task.reopened", "task.deleted"]);

/** Kinds whose FIRST arg carries the NUMBER of tasks the entry accounts for.
 *
 *  ★★★ DELIBERATELY NOT MEMBERS OF `COUNT_KINDS` (§163). Every member of that
 *  set moves the metric by exactly ±1 per entry; one `bulk.delete` carries a
 *  count of N. Adding it there would under-count by N−1 — which is why the
 *  original exclusion was right, and also why leaving it excluded was wrong
 *  once the AI dispatcher started writing it: `delete_all_tasks` emits ONE
 *  `bulk.delete` carrying N, so the backward walk ignored the whole deletion
 *  and every reconstructed historical `total` came back short by N. Since
 *  `percent` is `done/total`, that INFLATES every historical point.
 *
 *  ★★ The asymmetry only appeared with this branch: an AI `create_task` writes
 *  `task.created` (counted, ±1) while its mass delete writes `bulk.delete`
 *  (ignored) — before the AI logged anything at all, neither side existed.
 *
 *  ★★★ `ai.taskDedup` IS A MEMBER, and it is here because §166's reversal made
 *  it load-bearing rather than merely nice to have. Task dedup removes N rows
 *  and logs only `ai.taskDedup N` — no `task.deleted`, no `bulk.delete` — so the
 *  forward walk saw nothing. That was a self-cancelling blind spot for as long
 *  as undo was ignored too. It stopped being one the moment `reversedForwardDelta`
 *  started reading undo rows: the dedup's undo capture carries `task.deleted`
 *  (see `use-tasks-dedup.tsx`), so an undone dedup contributed +N against a
 *  forward side of ZERO and inflated every earlier day — a NEW corruption on a
 *  path that had been merely incomplete. Both halves now speak.
 *  ★★ The counts are equal BY CONSTRUCTION, not by coincidence: `applyMerges`
 *  returns `removedCount: removed.length` (`task-dedup/dedup.ts`), the logger
 *  passes `removedCount` and the undo capture passes `removed`. A future writer
 *  that lets those two diverge breaks the reversal silently.
 *  ★ ENUMERATE THE CAPTURE SITES, do not reason from the kind: there are FOUR
 *  undo captures of a task delete — two in `use-bulk-operations.ts`, one in
 *  `use-task-row-handlers.ts`, one in `use-tasks-dedup.tsx` — and only the last
 *  paired with a non-total kind. Sweep for them by grepping `src/app` for a
 *  `capture` call whose kind is the task-delete one, EXCLUDING this file and
 *  tests. ★★ The pattern is deliberately described rather than quoted: a comment
 *  that spells its own search string is matched BY it, so a quoted sweep here
 *  reports two phantom sites and the count stops reproducing. That is the third
 *  recorded instance of a self-matching grep in this repo's comments, and a cold
 *  review caught this one.
 *  ★★ `jira.sync` and `history.restore` also move the total and are deliberately
 *  NOT members. Neither carries a usable delta — `jira.sync`'s `args[0]` is
 *  `added + pulled`, creates and updates FUSED, and `history.restore` replaces a
 *  whole workspace. Both are pre-existing blind spots and neither takes an undo
 *  capture, so the reversal cannot reach them; do not "complete the set" with a
 *  number that does not mean what this set's members mean. */
const BULK_TOTAL_KINDS = new Set(["bulk.delete", "ai.taskDedup"]);

/** How many tasks a bulk entry accounts for, from its first positional arg.
 *
 *  ★★★ THE FINITE GUARD IS LOAD-BEARING, not defensive padding — and the
 *  failure it prevents is SILENT, not loud. The walk does `total -= delta`, so
 *  one NaN propagates into every EARLIER day's total. It does not surface as
 *  NaN: `clampPctFromCounts` maps a non-finite percentage to 0 (verified in
 *  this file — the `!Number.isFinite(pct)` branch), so the chart quietly
 *  renders that whole EARLIER span at 0% instead of the truth — earlier only,
 *  since `endState[i]` is assigned before the subtraction, so the corrupt day
 *  and everything after it keep correct values. A plausible
 *  wrong number is worse than a visibly broken one, because nothing prompts
 *  anyone to look. `args` is `(string | number)[]` and survives hostile input
 *  as `""` (see `sanitizeActivityEntry`, §164), and `Number("")` is 0, so a
 *  damaged entry contributes nothing instead of zeroing the series.
 *
 *  ★ Negative and fractional values are floored away for the same reason: the
 *  writer only ever emits a positive integer count, so anything else is
 *  corruption, and "count 0" is the honest reading of corruption. */
function positiveCount(raw: string | number | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function bulkTaskCount(args: readonly (string | number)[]): number {
  return positiveCount(args[0]);
}

/** The FORWARD `total` delta of the ops an `undo`/`redo` row reverses (§166).
 *
 *  ROW SHAPE: `args[0]` is the total row count (the i18n message's `{0}`), and
 *  everything after it is `(kind, count)` PAIRS written by `reversedKindCounts`
 *  — one pair per distinct kind in the batch. The caller applies the sign: an
 *  `undo` SUBTRACTS what this returns, a `redo` re-applies it.
 *
 *  ★★★ WITHOUT THIS THE WALK WAS SILENTLY WRONG IN ONE DIRECTION ONLY, which is
 *  why it survived: `undo` belonged to neither `COUNT_KINDS` nor
 *  `BULK_TOTAL_KINDS`, so the `bulk.delete −N` row was honoured and its reversal
 *  was not. Every reconstructed day before an undone mass delete had its
 *  DENOMINATOR read N too high, permanently, until the entry aged out of the
 *  500-entry ring — and because `percent` is `done/total`, a too-high
 *  denominator pushes the CURVE DOWN rather than breaking it. Nothing looks wrong.
 *
 *  ★★★ PAIRS, NOT ONE KIND, AND THE FIRST CUT OF THIS FIX GOT IT WRONG. That cut
 *  wrote a single kind and `""` for a MIXED batch, which the trend then ignored —
 *  and its docstring called that acceptable because "every single-entry undo is
 *  homogeneous". True and IRRELEVANT: single-entry undo never went through the
 *  batch helper at all, so the reassurance described a function the `""` case
 *  could not arise in. The `""` case arises ONLY under the caret's
 *  undo-through/redo-through, where a multi-entry batch is the entire point of
 *  the control. Delete 50 tasks, edit one field, undo through both → one mixed
 *  row → the 50-row correction discarded → the original §166 defect, two clicks
 *  away. Per-kind pairs are exact for every batch, so there is no mixed case and
 *  no `""` to document.
 *
 *  ★★ A pair whose COUNT is missing contributes nothing (`i + 1 < args.length`),
 *  which is what makes a legacy row safe: a pre-fix `undo` row is `[N]` alone and
 *  a first-cut row is `[N, kind]`, and neither carries a pair. Both read as 0 —
 *  the pre-fix behaviour — so no stored row is reinterpreted into a wrong number.
 *
 *  ★ `task.created` and `bulk.delete` are BOTH unreachable today and handled
 *  anyway: no `capture()` call passes either as its kind (`task.deleted` is what
 *  a delete captures, whatever kind the matching activity row uses), so neither
 *  can appear in a pair. They are here because leaving a total-moving kind out of
 *  a reversal table is exactly the asymmetry §163 and §166 each cost a release to
 *  find. `task.created` is pinned by a synthetic-fixture test; a `bulk.delete`
 *  capture kind would be a new writer's choice, and this branch means it would be
 *  correct rather than silent. */
function reversedForwardDelta(args: readonly (string | number)[]): number {
  let delta = 0;
  for (let i = 1; i + 1 < args.length; i += 2) {
    // ★ No `typeof kind === "string"` guard: a numeric or hostile value matches
    //   none of the three literals below and contributes nothing anyway, so the
    //   guard would be dead code that a later comment could mistake for a
    //   load-bearing one. A cold review caught exactly that in the first cut.
    const kind = args[i];
    const n = positiveCount(args[i + 1]);
    if (n === 0) continue;
    if (kind === "task.created") delta += n;
    else if (kind === "task.deleted" || kind === "bulk.delete") delta -= n;
  }
  return delta;
}

type DayDelta = { day: string; dTotal: number };

function reconstructFromActivity(
  activity: readonly ActivityEntry[],
  tasks: readonly Task[],
  currentDone: number,
  currentTotal: number,
  today: string,
): CompletionPoint[] {
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
  // ★★★ NO CLAMP, DELIBERATELY — AND *NOT* BECAUSE A CLAMP WOULD DO NOTHING.
  //   Two successive revisions of this note contradicted each other in place:
  //   the first called a `Math.max(total, done)` here "dead code a later reader
  //   mistakes for load-bearing", the second correctly observed that
  //   `clampPctFromCounts` returns 0 when `total <= 0`. Both cannot hold, and
  //   the second is the true one — the clamp is a BEHAVIOUR CHANGE, and a bad
  //   one. Do not reinstate the dead-code wording; it reads as permission.
  //   The numerator is read from live task fields while the denominator is
  //   reconstructed from an activity ring that caps and forgets
  //   (`ACTIVITY_MAX_ENTRIES`), so a stale `total` CAN sit under `done` — and
  //   the backward walk can drive it to 0 outright while `deliveredBy` stays
  //   positive. `clampPctFromCounts` opens with `if (total <= 0) return 0` and
  //   `endState` floors `total` at 0, so that day renders 0%. Clamping `total`
  //   up to `done` makes `total === done`, which renders 100%.
  // ★★ MEASURED 2026-08-30 by mutating the `endState[i] = …` line below to
  //   `Math.max(Math.max(0, total), Math.max(0, done))` and re-running the
  //   fixture through `npx vite-node`, then reverting — not reasoned. One task
  //   delivered 06-10 plus `task.created` days 06-12 and 06-14, `currentDone`
  //   1, `currentTotal` 2, today 06-21: as shipped
  //   `[06-10 → 0, 06-12 → 100, 06-14 → 50]`; with the clamp
  //   `[06-10 → 100, 06-12 → 100, 06-14 → 50]`.
  //   So the real question is WHICH WRONG NUMBER IS SAFER, and 0% wins: it is a
  //   benign reading of a prefix the ring has forgotten, while a confident 100%
  //   asserts the project was finished on a day it was not.
  // ★ The "raw counts never leave this function" fact is TRUE and worth
  //   keeping, it is simply not an argument that the clamp is inert: `endState`
  //   is local and each pair is rendered through `clampPctFromCounts` into a
  //   `CompletionPoint` carrying only `label` and `percent`, so no consumer
  //   ever sees a `done > total` pair and none has to defend against one.
  // ★★ THE NUMERATOR IS EXACT ONLY FOR TASKS STILL PRESENT. A row delivered on
  //   day D and later DELETED, or REOPENED (`applyStatusChange` writes
  //   `completedDate: ""` for any non-Done status), drops out of every
  //   historical numerator RETROACTIVELY while the walk still restores its
  //   create/delete events into the denominator. Measured: 10 tasks, 5 delivered by 06-10,
  //   all 5 bulk-deleted on 06-20 → the walk restores a total of 10 on 06-10
  //   while `deliveredBy("2026-06-10")` returns 0, so the point reads 0% where
  //   the truth was 50%. A documented approximation, not a regression — the
  //   event-counted numerator this replaced read 0% there too.
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

  // Walk backward for the DENOMINATOR only: the last event-day's END state =
  // current, so subtract each day's delta to get the previous day's end state.
  // The NUMERATOR is read from `tasks` per day — except for the last point,
  // which stays on `currentDone` so it agrees with the completion tile rendered
  // directly above the sparkline (see the `currentTotal` doc comment).
  // ★★ `isTaskDelivered`, never an inline `!!t.completedDate`. The repo keeps
  //   DELIVERED ("was it completed?") and CLOSED ("will it be worked on
  //   again?") apart on purpose — see `task-closed.ts` — and this numerator is
  //   the canonical DELIVERED reader. The call is behaviourally identical to
  //   the expression it replaced; what it buys is that the question is named.
  // ★ KNOWN, UNCHANGED EDGE, and the import does NOT close it: a split row
  //   carrying `status: "Cancelled"` beside a `completedDate` — which
  //   `migrateTask` deliberately does not repair — is OUT of the progress
  //   model's in-scope denominator yet counted here, so it inflates the
  //   historical points. `isTaskDelivered` reads `completedDate` alone, so
  //   filtering it out would need `!isTaskClosed` beside it, which would ALSO
  //   drop every legitimately Done row. Left as-is deliberately.
  // ★★ COST: this runs inside the backward loop over EVERY day, so the walk is
  //   O(distinct activity days × |tasks|). `trailing()`/`MAX_POINTS` bounds the
  //   RETURNED series, not this work — it is applied to the finished `points`
  //   array below. Distinct days is bounded only by `ACTIVITY_MAX_ENTRIES`
  //   (500), so the worst case is small; do not optimise it.
  const deliveredBy = (day: string): number =>
    tasks.reduce(
      (n, t) => (isTaskDelivered(t) && t.completedDate! <= day ? n + 1 : n),
      0,
    );

  const endState: { done: number; total: number }[] = new Array(days.length);
  let total = currentTotal;
  for (let i = days.length - 1; i >= 0; i--) {
    const done = i === days.length - 1 ? currentDone : deliveredBy(days[i].day);
    endState[i] = { done: Math.max(0, done), total: Math.max(0, total) };
    total -= days[i].dTotal;
  }
  const points = days.map((d, i) => ({
    label: dayLabel(`${d.day}`),
    percent: clampPctFromCounts(endState[i].done, endState[i].total),
  }));
  return trailing(points);
}

export function computeCompletionTrend(input: CompletionTrendInput): CompletionPoint[] {
  const snap = fromSnapshots(input.snapshots);
  if (snap.length >= 2) return snap;
  return reconstructFromActivity(
    input.activity,
    input.tasks,
    input.currentDone,
    input.currentTotal,
    input.today,
  );
}
