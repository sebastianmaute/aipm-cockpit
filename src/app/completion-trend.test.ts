import { describe, expect, test } from "vitest";
import { computeCompletionTrend, MAX_POINTS } from "./completion-trend";
import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";
import type { Task } from "./types";

function snap(capturedAt: string, pct: number): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket: capturedAt.slice(0, 10), cadence: "daily",
    trigger: "manual", isBaseline: false, remainingHours: null, remainingCost: null,
    pctComplete: pct, forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
    spi: null, cpi: null, overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

let nextId = 1;
function ev(timestamp: string, kind: ActivityEntry["kind"]): ActivityEntry {
  return { id: String(nextId++), timestamp, kind, args: [] };
}

/** `n` tasks delivered long BEFORE any plotted day, so `deliveredBy` returns the
 *  same numerator on every point of the window.
 *
 *  ★★★ WHY THIS AND NOT `tasks: []`: it reproduces the CONSTANT numerator the
 *  denominator blocks below were written against, so every one of their
 *  expectations stays byte-identical across the numerator change. `tasks: []`
 *  zeroes every historical point, and each of those blocks would have to be
 *  rewritten to a zeroed series. Re-measured 2026-08-30, mutant applied and
 *  reverted: replacing all FIVE `doneBefore(2)` call sites in this file with an
 *  empty array runs 17 failed / 18 passed out of 35. Reproduce with
 *    npx vitest run --maxWorkers=1 src/app/completion-trend.test.ts src/app/completion-trend.property.test.ts
 *
 *  ★★★ BOTH FIGURES IN THAT SENTENCE WERE WRONG BEFORE, AND EACH WAS WRONG A
 *  DIFFERENT WAY — which is why neither is worth trusting without the command.
 *  "six" came from a bare grep for the call, and that grep MATCHES ITS OWN
 *  PROSE: this docstring and the `BASE` comment further down both name it, so
 *  a raw count reads two higher than the code. It printed five real sites at
 *  `411702b8` and at every commit since, so "six" was never true, not even on
 *  the day it was written. "15 passed" WAS true when written and then drifted —
 *  tests were added, and 17 + 15 = 32 against a population that is now 35, so
 *  the sum alone refutes it. Count the code sites with a grep that drops the
 *  comment lines:
 *    grep -n "doneBefore(2)" src/app/completion-trend.test.ts | grep -vE "^[0-9]+: *(\*|//)"
 *
 *  ★★★ AN EARLIER REVISION OF THIS DOCSTRING CLAIMED `tasks: []` WOULD MAKE
 *  "subtracts N, not 1" (§163) AND "reverses N, not 1" (§166) PASS WHILE
 *  DETECTING NOTHING, under a "measured, not reasoned" banner. That is FALSE
 *  and it was reasoned: both are `expect(withN(8)).not.toEqual(withN(1))`, so
 *  two collapsed-to-identical arrays FAIL the assertion — they go RED loudly,
 *  they do not pass silently. Both appear by name in the 17 above. The mutant
 *  record at the foot of this file is the true measurement, and it and the old
 *  claim could not both hold: mutant A is behaviourally `tasks: []` for these
 *  fixtures, and it KILLED every §163/§166 case. */
function doneBefore(n: number): Task[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: i + 1,
        taskName: `T${i + 1}`,
        status: "Done",
        completedDate: "2026-01-01",
      }) as unknown as Task,
  );
}

describe("computeCompletionTrend", () => {
  test("prefers snapshots when >= 2 (exact pctComplete, log ignored)", () => {
    const snapshots = [snap("2026-06-10T00:00:00.000Z", 20), snap("2026-06-14T00:00:00.000Z", 55)];
    const activity = [ev("2026-06-12T00:00:00.000Z", "task.completed")];
    const out = computeCompletionTrend({ snapshots, activity, tasks: [], currentDone: 9, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([20, 55]);
    expect(out[1].label).toBe("06-14");
  });

  test("falls back to activity-log reconstruction when < 2 snapshots", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.completed"),
      ev("2026-06-20T09:00:00.000Z", "task.completed"),
    ];
    // The two completions are now BACKED BY TASK DATA rather than inferred from
    // the events: five delivered by 06-18, a sixth on 06-20. Same series as
    // before, read from a different source.
    const tasks: Task[] = [
      ...doneBefore(5),
      { id: 6, taskName: "T6", status: "Done", completedDate: "2026-06-20" } as unknown as Task,
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, tasks, currentDone: 6, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([50, 60]);
    expect(out.map((p) => p.label)).toEqual(["06-18", "06-20"]);
  });

  // ★★ WAS "created/deleted shift total; reopened decrements done", and the
  //   `reopened` half is DELETED rather than weakened: `dDone` no longer exists,
  //   so a `task.reopened` row moves no count and that claim is simply false
  //   now. Its replacement — a numerator that tracks delivery — is pinned by the
  //   "numerator from task data" block at the foot of this file. What survives
  //   here is the DENOMINATOR claim, and the fixture now makes it observable:
  //   the old one asserted [60, 50] off a fixture whose total never moved
  //   between the two plotted days, so it could not have caught a broken
  //   `task.created` arm either.
  test("a create shifts the total, so the earlier day divides by less", () => {
    const activity = [
      ev("2026-06-15T09:00:00.000Z", "task.created"),
      ev("2026-06-17T09:00:00.000Z", "task.created"),
    ];
    const out = computeCompletionTrend({
      snapshots: [], activity, tasks: doneBefore(5),
      currentDone: 5, currentTotal: 10, today: "2026-06-21",
    });
    // 06-17 is the last point and reads the live counts, 5/10 = 50. Walking
    // back over its +1 leaves 9 as the 06-15 denominator: 5/9 = 56.
    expect(out.map((p) => p.percent)).toEqual([56, 50]);
  });

  test("fewer than 2 points -> empty", () => {
    expect(computeCompletionTrend({ snapshots: [], activity: [], tasks: [], currentDone: 0, currentTotal: 0, today: "2026-06-21" })).toEqual([]);
    expect(computeCompletionTrend({ snapshots: [snap("2026-06-10T00:00:00.000Z", 20)], activity: [], tasks: [], currentDone: 1, currentTotal: 5, today: "2026-06-21" })).toEqual([]);
  });

  test("caps to the trailing MAX_POINTS", () => {
    const snapshots = Array.from({ length: MAX_POINTS + 5 }, (_, i) =>
      snap(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, i),
    );
    const out = computeCompletionTrend({ snapshots, activity: [], tasks: [], currentDone: 1, currentTotal: 2, today: "2026-06-30" });
    expect(out.length).toBe(MAX_POINTS);
    expect(out[out.length - 1].label).toBe(`06-${MAX_POINTS + 5}`);
  });

  test("total 0 -> 0% (no divide by zero)", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.deleted"),
      ev("2026-06-20T09:00:00.000Z", "task.deleted"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, tasks: [], currentDone: 0, currentTotal: 0, today: "2026-06-21" });
    expect(out.every((p) => p.percent === 0)).toBe(true);
  });

  test("ignores future-dated events (clock-skew guard) and non-task kinds", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.completed"),
      ev("2026-06-19T09:00:00.000Z", "raid.created"),
      ev("2027-01-01T09:00:00.000Z", "task.completed"),
      ev("2026-06-20T09:00:00.000Z", "task.completed"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, tasks: [], currentDone: 6, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.label)).toEqual(["06-18", "06-20"]);
  });
});

/** An entry carrying positional args — `bulk.delete` puts its task count in
 *  `args[0]`, which is the whole point of §163. */
function evArgs(
  timestamp: string,
  kind: ActivityEntry["kind"],
  args: (string | number)[],
): ActivityEntry {
  return { id: String(nextId++), timestamp, kind, args };
}

describe("bulk.delete counts against the denominator (§163)", () => {
  // The reconstruction only runs with FEWER THAN TWO snapshots, so every case
  // here passes `snapshots: []` — this is the no-Turso / new-project path.
  // `doneBefore(2)`, NOT `tasks: []`: see the helper. An empty task list
  // zeroes every historical point, so "subtracts N, not 1" below would compare
  // `[0, 0, 100]` with itself — and that `.not.toEqual` then goes RED, it does
  // not pass vacuously. Every expectation in this describe would need
  // rewriting to the zeroed series; keeping the numerator constant is what
  // makes them all still readable as claims about the DENOMINATOR.
  const BASE = { snapshots: [], tasks: doneBefore(2), currentDone: 2, currentTotal: 2, today: "2026-06-21" } as const;

  // ★★★ THE REGRESSION ITSELF. Two creates then a mass delete of 8, ending at
  //   2 done / 2 total. Walking back must restore a denominator of 9 and 10 on
  //   the earlier days. Before the fix `bulk.delete` was skipped entirely, so
  //   the walk reconstructed totals of 1 and 2 and reported [100, 100] — a
  //   project that had in fact been ~20% complete showed as fully done for its
  //   whole history. That is the "percent INFLATES" claim, in numbers.
  test("restores the historical denominator after an AI mass delete", () => {
    const activity = [
      ev("2026-06-16T09:00:00.000Z", "task.created"),
      ev("2026-06-18T09:00:00.000Z", "task.created"),
      evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", [8]),
    ];
    const out = computeCompletionTrend({ ...BASE, activity });
    expect(out.map((p) => p.label)).toEqual(["06-16", "06-18", "06-20"]);
    expect(out.map((p) => p.percent)).toEqual([22, 20, 100]);
  });

  // ★★ The SCALE must come from the entry, not from the kind. A fix that added
  //   `bulk.delete` to COUNT_KINDS (the tempting one-liner) subtracts 1 instead
  //   of N and passes any test that only checks "the day appears".
  test("subtracts N, not 1", () => {
    const withN = (n: number) =>
      computeCompletionTrend({
        ...BASE,
        activity: [
          ev("2026-06-16T09:00:00.000Z", "task.created"),
          ev("2026-06-18T09:00:00.000Z", "task.created"),
          evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", [n]),
        ],
      }).map((p) => p.percent);
    expect(withN(8)).not.toEqual(withN(1));
  });

  // ★★★ A corrupt count must not zero the WHOLE series. `total -= NaN` poisons
  //   every earlier day, and `clampPctFromCounts` turns each non-finite result
  //   into 0 — so the chart reads a plausible 0% across that earlier span rather
  //   than looking broken (earlier ONLY: `endState[i]` is assigned before the
  //   subtraction). Each of these must behave as "count 0", leaving the other
  //   days intact.
  test.each([
    ["a hostile arg coerced to \"\" by the load boundary", ""],
    ["a non-numeric string", "lots"],
    ["a negative count", -5],
    ["no args at all", undefined],
  ])("treats %s as zero without poisoning earlier days", (_label, arg) => {
    const activity = [
      ev("2026-06-16T09:00:00.000Z", "task.created"),
      ev("2026-06-18T09:00:00.000Z", "task.created"),
      evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", arg === undefined ? [] : [arg]),
    ];
    const out = computeCompletionTrend({ ...BASE, activity });
    expect(out.every((p) => Number.isFinite(p.percent))).toBe(true);
    // Identical to the same log with the bulk entry contributing nothing: the
    // walk restores totals of 1 and 2 against 2 done, so every point clamps to
    // 100. ★ Derived by running it, not predicted — the first cut of this line
    // guessed [50, 100, 100] and was wrong about the FIRST day, where done (2)
    // exceeds the reconstructed total (1) and `clampPctFromCounts` caps at 100.
    expect(out.map((p) => p.percent)).toEqual([100, 100, 100]);
  });

  // ★ The control for the block above: with a REAL count the result differs, so
  //   the "treated as zero" assertions are not passing for the wrong reason.
  test("the zero-count expectation really is distinguishable from a real one", () => {
    const out = computeCompletionTrend({
      ...BASE,
      activity: [
        ev("2026-06-16T09:00:00.000Z", "task.created"),
        ev("2026-06-18T09:00:00.000Z", "task.created"),
        evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", [8]),
      ],
    });
    expect(out.map((p) => p.percent)).not.toEqual([100, 100, 100]);
  });
});

describe("undo/redo reverse the denominator they moved (§166)", () => {
  // Two creates, a mass delete of 8, then the user presses Undo — so the 8 rows
  // are BACK and the live total is 10, not 2. Every case below shares that
  // prefix and differs only in what follows the delete.
  const PREFIX = [
    ev("2026-06-16T09:00:00.000Z", "task.created"),
    ev("2026-06-18T09:00:00.000Z", "task.created"),
    evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", [8]),
  ] as const;
  const RESTORED = { snapshots: [], tasks: doneBefore(2), currentDone: 2, currentTotal: 10, today: "2026-06-21" } as const;

  // ★★★ THE REGRESSION ITSELF, and note the DIRECTION — §166's own prose said
  //   the curve "sits above the truth" and that is backwards (corrected there in
  //   the same commit as this test). `percent` is `done/total`, so a denominator
  //   reconstructed 8 too HIGH pushes every historical point DOWN. Pre-fix this
  //   log produced [12, 11, 20]; the truth is [22, 20, 20].
  test("an undone bulk delete leaves the historical denominator alone", () => {
    const out = computeCompletionTrend({
      ...RESTORED,
      activity: [...PREFIX, evArgs("2026-06-20T10:00:00.000Z", "undo", [8, "task.deleted", 8])],
    });
    expect(out.map((p) => p.label)).toEqual(["06-16", "06-18", "06-20"]);
    expect(out.map((p) => p.percent)).toEqual([22, 20, 20]);
  });

  // ★★ The control: with the undo row DROPPED the same live state reconstructs
  //   differently, so the assertion above cannot be passing because the reversal
  //   happens to be a no-op on this fixture.
  test("dropping the undo row changes the answer", () => {
    const out = computeCompletionTrend({ ...RESTORED, activity: [...PREFIX] });
    expect(out.map((p) => p.percent)).toEqual([12, 11, 20]);
  });

  // ★★ Redo RE-APPLIES the delete, so undo+redo must land exactly where the bare
  //   delete did — the live total is 2 again, and the pair cancels. A fix that
  //   only taught the walk about `undo` reads this log as +8 and inflates.
  test("undo then redo cancels back to the plain-delete series", () => {
    const withPair = computeCompletionTrend({
      snapshots: [], tasks: doneBefore(2), currentDone: 2, currentTotal: 2, today: "2026-06-21",
      activity: [
        ...PREFIX,
        evArgs("2026-06-20T10:00:00.000Z", "undo", [8, "task.deleted", 8]),
        evArgs("2026-06-20T11:00:00.000Z", "redo", [8, "task.deleted", 8]),
      ],
    });
    const bare = computeCompletionTrend({
      snapshots: [], tasks: doneBefore(2), currentDone: 2, currentTotal: 2, today: "2026-06-21",
      activity: [...PREFIX],
    });
    expect(withPair.map((p) => p.percent)).toEqual(bare.map((p) => p.percent));
    expect(bare.map((p) => p.percent)).toEqual([22, 20, 100]);
  });

  // ★★★ THE THREE WAYS A ROW CAN FAIL TO NAME A KIND, all of which must read as
  //   the PRE-FIX behaviour rather than as a guess: a row written before this
  //   fix carries no pair at all; a row from §166's FIRST cut carries a kind but
  //   no count, since that cut wrote one kind rather than `(kind, count)` pairs;
  //   and a reversed kind that never moved the task total must not move it here.
  //   Each must reproduce the no-undo-row series exactly.
  //   ★★ The first two are NOT the same case dressed twice — they are the two
  //   distinct persisted shapes this decoder will meet in the wild, and both are
  //   real: rows in the 500-entry ring predate the fix, and the first cut was
  //   never released but did run locally. Both stop at the `i + 1 < args.length`
  //   bound rather than at any kind comparison.
  test.each([
    ["a legacy row with no pair at all", [8]],
    ["a first-cut row with a kind but no count", [8, "task.deleted"]],
    ["a reverted bulk EDIT", [8, "bulk.edit", 8]],
    ["a reverted RAID delete", [8, "raid.deleted", 8]],
  ])("ignores the reversal for %s", (_label, args) => {
    const out = computeCompletionTrend({
      ...RESTORED,
      activity: [...PREFIX, evArgs("2026-06-20T10:00:00.000Z", "undo", args as (string | number)[])],
    });
    expect(out.map((p) => p.percent)).toEqual([12, 11, 20]);
  });

  // ★★★ THE MIXED BATCH, which is what per-kind pairs exist for. A caret
  //   undo-through spanning two deleted rows and one edited row emits
  //   `[3, "task.deleted", 2, "bulk.edit", 1]`: three rows reverted, but only TWO
  //   of them ever left the total. Three readings are distinguishable here, and
  //   only one is right — over-correcting on `args[0]` (+3) gives [25, 22, 20],
  //   and §166's first cut, which wrote `""` for a mixed batch and ignored it,
  //   gives [18, 17, 20]. Both are pinned below so this cannot pass by accident.
  test("a mixed batch reverses only the rows that moved the total", () => {
    const series = (undoArgs: (string | number)[]) =>
      computeCompletionTrend({
        ...RESTORED,
        activity: [
          ev("2026-06-16T09:00:00.000Z", "task.created"),
          ev("2026-06-18T09:00:00.000Z", "task.created"),
          evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", [2]),
          evArgs("2026-06-20T10:00:00.000Z", "undo", undoArgs),
        ],
      }).map((p) => p.percent);
    expect(series([3, "task.deleted", 2, "bulk.edit", 1])).toEqual([22, 20, 20]);
    expect(series([3, "task.deleted", 3])).toEqual([25, 22, 20]); // over-corrected
    expect(series([3])).toEqual([18, 17, 20]); // the first cut's discarded row
  });

  // ★ Pair ORDER must not matter — the emitter's `Map` iteration is insertion
  //   ordered, so a batch that edited before it deleted emits the other order.
  test("pair order does not change the result", () => {
    const series = (undoArgs: (string | number)[]) =>
      computeCompletionTrend({
        ...RESTORED,
        activity: [
          ev("2026-06-16T09:00:00.000Z", "task.created"),
          ev("2026-06-18T09:00:00.000Z", "task.created"),
          evArgs("2026-06-20T09:00:00.000Z", "bulk.delete", [2]),
          evArgs("2026-06-20T10:00:00.000Z", "undo", undoArgs),
        ],
      }).map((p) => p.percent);
    expect(series([3, "bulk.edit", 1, "task.deleted", 2]))
      .toEqual(series([3, "task.deleted", 2, "bulk.edit", 1]));
  });

  // ★★ An undecodable undo must not SEED a day either. Here the only undo lands
  //   on a day with no other task event: if the walk recorded a zero-delta day
  //   for it, the series would grow a fourth point. (It is also what keeps the
  //   `days.length < 2` gate behaving as it did before this fix.)
  test("a reversal of zero adds no point to the series", () => {
    const out = computeCompletionTrend({
      ...RESTORED,
      activity: [...PREFIX, evArgs("2026-06-21T09:00:00.000Z", "undo", [3, "bulk.edit", 3])],
    });
    expect(out.map((p) => p.label)).toEqual(["06-16", "06-18", "06-20"]);
  });

  // ★ `task.created` has no undo-capture writer today, so this fixture is
  //   synthetic — it exists because the reversal table handling only the DELETE
  //   kinds is precisely the asymmetry §163 and §166 each cost a release to
  //   find. Undoing a create REMOVES a row, so the reversal is negative.
  test("undoing a create subtracts, the mirror of undoing a delete", () => {
    const activity = [
      ev("2026-06-16T09:00:00.000Z", "task.created"),
      ev("2026-06-18T09:00:00.000Z", "task.created"),
      evArgs("2026-06-20T09:00:00.000Z", "undo", [1, "task.created", 1]),
    ];
    const out = computeCompletionTrend({
      snapshots: [], tasks: doneBefore(1), currentDone: 1, currentTotal: 4, today: "2026-06-21", activity,
    });
    // Day 06-20 nets −1, so the walk restores a total of 5 on 06-18 (not 3, the
    // answer a table that ignored `task.created` would give).
    expect(out.map((p) => p.percent)).toEqual([25, 20, 25]);
  });

  // ★★★ THE DEFECT THE REVERSAL ITSELF INTRODUCED, caught by enumerating the
  //   `kind: "task.deleted"` capture sites rather than by any gate. Task dedup
  //   removes N rows and logs ONLY `ai.taskDedup N` — its undo capture carries
  //   `task.deleted`, so once undo rows were read the reversal contributed +N
  //   against a forward side of ZERO. `ai.taskDedup` joining `BULK_TOTAL_KINDS`
  //   makes both halves speak, so the pair nets to zero on its day.
  //   ★★ The cross-check is against the BULK-DELETE path, not against a log with
  //   no dedup in it — "remove N then restore N" is the same history whichever
  //   writer recorded it, so the two series must be identical. A first draft
  //   compared against three plain creates instead and failed [25, 22, 20] vs
  //   [22, 20, 20]: that fixture has a different history (+1 on the third day
  //   rather than a net zero), so it could never have agreed. A control has to
  //   be equivalent to the thing it controls for.
  test("a dedup and its undo cancel, leaving the denominator untouched", () => {
    const viaDedup = computeCompletionTrend({
      ...RESTORED,
      activity: [...PREFIX.slice(0, 2),
        evArgs("2026-06-20T09:00:00.000Z", "ai.taskDedup", [8]),
        evArgs("2026-06-20T10:00:00.000Z", "undo", [8, "task.deleted", 8]),
      ],
    });
    const viaBulkDelete = computeCompletionTrend({
      ...RESTORED,
      activity: [...PREFIX, evArgs("2026-06-20T10:00:00.000Z", "undo", [8, "task.deleted", 8])],
    });
    expect(viaDedup.map((p) => p.percent)).toEqual([22, 20, 20]);
    expect(viaDedup.map((p) => p.percent)).toEqual(viaBulkDelete.map((p) => p.percent));
  });

  // ★★ The control, and it is what actually pins `ai.taskDedup`'s membership:
  //   with the kind OUT of `BULK_TOTAL_KINDS` the dedup day contributes nothing
  //   at all, so it never enters `byDay` and the series is TWO points, [100,
  //   100]. ★★★ MEASURED against the mutant, not predicted — a first draft of
  //   this comment guessed [40, 33, 20] for the sibling test above and was
  //   wrong; the real pre-fix reading there is [100, 100, 20], because a
  //   denominator walked down to 1 against 2 done clamps at 100 rather than
  //   producing the small percentages a guess reaches for. The same clamp is
  //   why an inflated series here looks plausible instead of broken.
  test("a dedup with NO undo still moves the denominator", () => {
    const out = computeCompletionTrend({
      snapshots: [], tasks: doneBefore(2), currentDone: 2, currentTotal: 2, today: "2026-06-21",
      activity: [
        ev("2026-06-16T09:00:00.000Z", "task.created"),
        ev("2026-06-18T09:00:00.000Z", "task.created"),
        evArgs("2026-06-20T09:00:00.000Z", "ai.taskDedup", [8]),
      ],
    });
    expect(out.map((p) => p.percent)).toEqual([22, 20, 100]);
  });

  // ★★ The count must come from the ENTRY. A reversal that assumed ±1 (the
  //   tempting mirror of COUNT_KINDS) passes any test that only checks "the day
  //   moved" — same trap `bulk.delete` itself fell into.
  test("reverses N, not 1", () => {
    const withN = (n: number) =>
      computeCompletionTrend({
        ...RESTORED,
        activity: [...PREFIX, evArgs("2026-06-20T10:00:00.000Z", "undo", [n, "task.deleted", n])],
      }).map((p) => p.percent);
    expect(withN(8)).not.toEqual(withN(1));
  });
});

/** ★★ MUTATION-PROVED, and these are the OBSERVED results, not predictions.
 *  Each mutant was applied alone to `completion-trend.ts` and reverted after.
 *
 *  ★★★ ALL FOUR RE-MEASURED 2026-08-30 UNDER ONE COMMAND, because two of the
 *  tallies recorded here had drifted and nothing said which. The command is
 *    npx vitest run --maxWorkers=1 src/app/completion-trend.test.ts src/app/completion-trend.property.test.ts
 *  and its population is 35 (34 here + 1 in the property file). ANY tally below
 *  whose two halves do not sum to 35 is stale by construction — A and the
 *  `doneBefore` docstring above both read 32, which is what gave them away.
 *  A drifting FAILED count is the dangerous one and C had it: adding a test
 *  that a mutant also kills raises the number silently, and nothing re-runs
 *  these. Re-run the command, do not adjust a figure by reasoning.
 *
 *  A — `deliveredBy`'s `t.completedDate <= day` replaced by `false`:
 *      21 failed / 14 passed (was recorded as 21/11). Killed "moves the earlier point …" as intended,
 *      AND every §163/§166 case, because `doneBefore` makes their numerator
 *      real. That breadth is the point: with `tasks: []` those 20 would have
 *      survived, which is how a vacuous fixture announces itself.
 *  B — the last-point branch flattened to `deliveredBy(days[i].day)`:
 *      EXACTLY 1 failed / 34 passed — "keeps the LAST point on currentDone …".
 *      Nothing else reads that branch, so the block is the sole guard of it.
 *      Unchanged on re-measurement.
 *  C — `"task.completed"` removed from `COUNT_KINDS`:
 *      4 failed / 31 passed (was recorded as 3). Killed "seeds a day carrying
 *      only a completion …" as intended; two more are the seeding claims in
 *      the first describe; the FOURTH is "plots two points when the completion
 *      entry is present", from the completion-only pair at the foot of this
 *      file — a block added AFTER this record was written, whose own comment
 *      already said this mutant turns it RED. Two comments in one file
 *      disagreed about one mutant for a release. ★★ The sum check that caught
 *      A is USELESS here — 3 + 32 and 4 + 31 both total 35 — so a FAILED count
 *      recorded without its passed half has no self-check at all. Record both.
 *  D — `deliveredBy` replaced by `tasks.length` (ignore the day, count
 *      everything): 2 failed / 33 passed — "falls back to activity-log reconstruction …"
 *      and "leaves the earlier point at zero …". This is the mutant that was
 *      MISSING when A/B/C were recorded, and it matters because A/B/C leave
 *      the "always counts everything" direction unexercised: the zero control
 *      passes under A for the WRONG reason (A makes every numerator 0, and 0
 *      is what that block expects), so on its own it certifies nothing. D is
 *      what proves the pair constrains the implementation from both sides.
 *      Observed 2026-08-30, not predicted. */
describe("numerator from task data", () => {
  const task = (id: number, completedDate?: string) =>
    ({
      id,
      taskName: `T${id}`,
      status: completedDate ? "Done" : "To Do",
      completedDate,
    }) as unknown as Task;

  // Two days seeded by task.created events, so the denominator moves and the
  // series has the >= 2 days it needs to render at all.
  const activity = [
    evArgs("2026-06-10T09:00:00.000Z", "task.created", [1, "T1"]),
    evArgs("2026-06-12T09:00:00.000Z", "task.created", [2, "T2"]),
  ];

  test("moves the earlier point when a task was already delivered on that day", () => {
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

  test("leaves the earlier point at zero when nothing was delivered by then", () => {
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

  test("keeps the LAST point on currentDone so it agrees with the tile above it", () => {
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

  test("seeds a day carrying only a completion, with no denominator move", () => {
    const out = computeCompletionTrend({
      snapshots: [],
      activity: [
        evArgs("2026-06-10T09:00:00.000Z", "task.created", [1, "T1"]),
        evArgs("2026-06-15T09:00:00.000Z", "task.completed", [1, "T1"]),
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

/** A MISSED `task.completed` WRITER CAN COST THE WHOLE CHART, not just an audit
 *  row — which is the consequence three separate prose claims used to deny
 *  ("costs an AUDIT ENTRY and can never move a metric", in `task-status.ts`,
 *  `status-activity-census.test.ts` and `docs/AGENTS/activity-log.md`, all now
 *  corrected). The block above pins that a completion-only day SEEDS; this pair
 *  pins what its absence costs, which is the stronger and more surprising half:
 *  the series falls under the `days.length < 2` floor and renders NOTHING.
 *
 *  ★★ This is also the cheapest guard against someone "tidying" `task.completed`
 *  / `task.reopened` out of `COUNT_KINDS` on the strength of that false claim —
 *  they carry no `dTotal` arm, so they look inert to a reader who has not traced
 *  the seeding job.
 *
 *  ★★ MUTATION-PROVED 2026-08-30, mutant run and reverted: removing
 *  `"task.completed"` from `COUNT_KINDS` in `completion-trend.ts` turns the
 *  positive block RED (`expected [] to have a length of 2 but got +0`) while the
 *  absence block below stays GREEN — which is exactly what makes the second a
 *  CONTROL for the first rather than evidence of its own.
 *
 *  ★ That is mutant C in the record above, and this block is why its tally is
 *  4 rather than the 3 recorded when the record was written: adding a block
 *  that an existing mutant also kills raises that mutant's count, and nothing
 *  re-runs it. Re-run C's command when you add a block here. */
describe("a completion-only day is what keeps the series above the two-day floor", () => {
  const task = (id: number, completedDate?: string) =>
    ({
      id,
      taskName: `T${id}`,
      status: completedDate ? "Done" : "To Do",
      completedDate,
    }) as unknown as Task;

  const tasks = [task(1, "2026-06-10"), task(2)];
  const created = evArgs("2026-06-12T09:00:00.000Z", "task.created", [2, "T2"]);
  const completed = evArgs("2026-06-10T09:00:00.000Z", "task.completed", [1, "T1"]);

  test("plots two points when the completion entry is present", () => {
    const out = computeCompletionTrend({
      snapshots: [],
      activity: [completed, created],
      tasks,
      currentDone: 1,
      currentTotal: 2,
      today: "2026-06-21",
    });
    expect(out).toHaveLength(2);
  });

  test("plots nothing at all when the completion entry is missing", () => {
    // Control for the block above: identical tasks and numerator, one fewer
    // activity row. The numerator cannot tell the two cases apart — it reduces
    // over `tasks` — so only the SEEDING job of `COUNT_KINDS` explains the
    // difference, and a chart that renders is the only signal a user would get.
    const out = computeCompletionTrend({
      snapshots: [],
      activity: [created],
      tasks,
      currentDone: 1,
      currentTotal: 2,
      today: "2026-06-21",
    });
    expect(out).toEqual([]);
  });
});
