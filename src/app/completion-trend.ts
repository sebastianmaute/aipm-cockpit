// Pure, i18n-free engine for the Dashboard completion-trend sparkline.
// Produces a chronological series of % complete (0–100). Prefers exact Turso
// snapshot history; falls back to reconstructing done/total from the local
// activity log when there are fewer than two snapshots. No I/O, no clock —
// `today`, `currentDone`, `currentTotal` are passed in.

import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";

export interface CompletionPoint {
  /** Short day label "MM-DD" for tooltips/labels. */
  label: string;
  /** Completion percentage, clamped to [0, 100]. */
  percent: number;
}

export interface CompletionTrendInput {
  snapshots: readonly SnapshotRecord[];
  activity: readonly ActivityEntry[];
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
 *  ★★★ DELIBERATELY NOT MEMBERS OF `COUNT_KINDS` (§157). Every member of that
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
 *  ★★★ `ai.taskDedup` IS A MEMBER, and it is here because §160's reversal made
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
 *  as `""` (see `sanitizeActivityEntry`, §158), and `Number("")` is 0, so a
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

/** The FORWARD `total` delta of the ops an `undo`/`redo` row reverses (§160).
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
 *  row → the 50-row correction discarded → the original §160 defect, two clicks
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
 *  a reversal table is exactly the asymmetry §157 and §160 each cost a release to
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

type DayDelta = { day: string; dDone: number; dTotal: number };

function reconstructFromActivity(
  activity: readonly ActivityEntry[],
  currentDone: number,
  currentTotal: number,
  today: string,
): CompletionPoint[] {
  // Per-day deltas from task events (created/deleted/bulk-delete move total;
  // completed/reopened move done). Deleted task's done-state is unknown ->
  // assumed not done (documented approximation).
  //
  // ★★★ THE NUMERATOR IS STILL CONSTANT ACROSS EVERY RECONSTRUCTED DAY, and
  //   §157's bulk-delete fix does not change that — only the denominator moves,
  //   so this reconstruction is a curve about TASK COUNT, not about completion.
  //   `dDone` is fed solely by `task.completed` / `task.reopened`, and NOTHING
  //   in the app writes either kind: a status change to Done logs `task.updated`
  //   from every writer. Verify before reasoning about it:
  //     git grep -nE '"task\.(completed|reopened)"' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.'
  //   → only this file and `activity-log.ts` (the union member + its message row).
  // ★★ IT IS NOT CLOSABLE BY READING `changes` FOR A STATUS DIFF, which is the
  //   obvious fix and was measured before being rejected: the AI's `update_task`
  //   logs with NO `changes` array (`use-chat-dispatcher.ts` calls
  //   `logActivityAs?.("ai", "task.updated", id, name)`), while a form save
  //   passes `diffFields(...)`. So a changes-based numerator would move for user
  //   edits and not for AI ones — reintroducing exactly the user/AI asymmetry
  //   §157 exists to remove, one metric over. Closing it needs a real
  //   `task.completed` writer, which is a design slice. See open-followups §157.
  const byDay = new Map<string, { dDone: number; dTotal: number }>();
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
    const cur = byDay.get(day) ?? { dDone: 0, dTotal: 0 };
    // ★ Reversal first, then bulk: both read their delta from the entry rather
    //   than implying it from the kind, so neither can reach the ±1 chain below.
    if (reversal !== 0) cur.dTotal += reversal;
    else if (isBulk) cur.dTotal -= bulkTaskCount(e.args);
    else if (e.kind === "task.created") cur.dTotal += 1;
    else if (e.kind === "task.deleted") cur.dTotal -= 1;
    else if (e.kind === "task.completed") cur.dDone += 1;
    else if (e.kind === "task.reopened") cur.dDone -= 1;
    byDay.set(day, cur);
  }
  const days: DayDelta[] = [...byDay.entries()]
    .map(([day, d]) => ({ day, ...d }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (days.length < 2) return [];

  // Walk backward: the last event-day's END state = current; subtract each
  // day's delta to get the end state of the previous day. Floor counts at 0.
  const endState: { done: number; total: number }[] = new Array(days.length);
  let done = currentDone;
  let total = currentTotal;
  for (let i = days.length - 1; i >= 0; i--) {
    endState[i] = { done: Math.max(0, done), total: Math.max(0, total) };
    done -= days[i].dDone;
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
  return reconstructFromActivity(input.activity, input.currentDone, input.currentTotal, input.today);
}
