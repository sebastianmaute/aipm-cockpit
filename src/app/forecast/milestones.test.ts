import { describe, expect, test } from "vitest";
import type { Milestone, Task } from "../types";
import { orderBacklog, milestoneChances } from "./milestones";
import { mulberry32 } from "./rng";
import { drawDay, type SimOptions } from "./simulate";

const TODAY = "2026-10-12"; // a Monday

function task(id: number, over: Partial<Task> = {}): Task {
  return { id, dueDate: "", priority: "Medium", status: "Open", ...over } as Task;
}

function ms(id: number, date: string, linkedTaskIds: number[], over: Partial<Milestone> = {}): Milestone {
  return { id, name: `M${id}`, date, linkedTaskIds, ...over };
}

function opts(over: Partial<SimOptions> = {}): SimOptions {
  return { trials: 100, rng: mulberry32(1), capacity: 1, horizon: 1300, integer: true, ...over };
}

function run(milestones: Milestone[], ordered: Task[], over: { closedIds?: number[]; samples?: number[]; date?: string } = {}) {
  return milestoneChances({
    milestones,
    ordered,
    closedIds: new Set(over.closedIds ?? []),
    sizeOf: () => 1,
    samples: over.samples ?? [1],
    today: over.date ?? TODAY,
    holidaySet: new Set<string>(),
    o: opts(),
  });
}

describe("orderBacklog", () => {
  test("orders by due date, blank last, then priority, then id", () => {
    const out = orderBacklog([
      task(1, { dueDate: "" }),
      task(2, { dueDate: "2026-11-01", priority: "Low" }),
      task(3, { dueDate: "2026-11-01", priority: "Urgent" }),
      task(5, { dueDate: "2026-11-01", priority: "Urgent" }),
      task(4, { dueDate: "2026-10-20" }),
    ]);
    expect(out.map((t) => t.id)).toEqual([4, 3, 5, 2, 1]);
  });
});

describe("milestoneChances", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => task(i + 1));

  test("prioritised chance is at least the due-date chance", () => {
    // task 20 is last of 20; 1/day, date 5 working days out (Mon 12 -> Mon 19)
    const [r] = run([ms(1, "2026-10-19", [20])], twenty);
    expect(r).toEqual({ id: 1, state: "chance", chance: 0, chancePrioritised: 1 });
  });

  test("due today with an open linked task is 0", () => {
    const [r] = run([ms(1, TODAY, [3])], twenty);
    expect(r).toEqual({ id: 1, state: "chance", chance: 0, chancePrioritised: 0 });
  });

  test("due today with all linked tasks closed is 1", () => {
    const [r] = run([ms(1, TODAY, [90])], [], { closedIds: [90] });
    expect(r).toEqual({ id: 1, state: "chance", chance: 1, chancePrioritised: 1 });
  });

  test("overdue milestone has no percent", () => {
    const [r] = run([ms(1, "2026-10-01", [3])], twenty);
    expect(r).toEqual({ id: 1, state: "overdue" });
  });

  test("overdue with every linked task closed reads 1/1, not overdue (T3b)", () => {
    // All-closed is checked before the date, so a late milestone whose work is done is certain.
    const [r] = run([ms(1, "2026-10-01", [90, 91])], twenty, { closedIds: [90, 91] });
    expect(r).toEqual({ id: 1, state: "chance", chance: 1, chancePrioritised: 1 });
  });

  test("a milestone with no valid date is omitted (R16)", () => {
    // Load repairs an invalid milestone date to "" (requiredIsoDateOnLoad); "" < today would read overdue.
    for (const date of ["", "garbage", "2026-02-30"]) {
      expect(run([ms(1, date, [3])], twenty)).toEqual([]);
      expect(run([ms(1, date, [90])], [], { closedIds: [90] })).toEqual([]);
    }
  });

  test("milestone with no linked tasks reports no-linked-tasks", () => {
    expect(run([ms(1, "2026-11-01", [])], twenty)).toEqual([{ id: 1, state: "no-linked-tasks" }]);
  });

  test("achieved milestone is omitted", () => {
    expect(run([ms(1, "2026-11-01", [3], { achievedDate: "2026-10-01" })], twenty)).toEqual([]);
  });

  test("dangling linked id is ignored", () => {
    const [a] = run([ms(1, "2026-10-19", [3, 999])], twenty);
    expect(a).toMatchObject({ state: "chance", chance: 1 });
    expect(run([ms(2, "2026-10-19", [999])], twenty)).toEqual([{ id: 2, state: "no-linked-tasks" }]);
  });

  test("one pass answers several milestones", () => {
    const res = run([ms(1, "2026-10-14", [2]), ms(2, "2026-10-14", [3])], twenty);
    expect(res.map((r) => (r.state === "chance" ? r.chance : -1))).toEqual([1, 0]);
  });

  test("a milestone waits for the LAST of its open linked tasks in the queue, not the first", () => {
    // tasks 2 and 10 sit at queue positions 2 and 10; 1/day over 5 working days reaches 5
    const [r] = run([ms(1, "2026-10-19", [2, 10])], twenty);
    expect(r).toEqual({ id: 1, state: "chance", chance: 0, chancePrioritised: 1 });
  });

  test("the early exits (all reached, none reachable) give exactly the chances of walking to the last day", () => {
    // Reference: every trial draws every day up to the last milestone's day from the same stream.
    type T = { id: number; days: number; position: number; prio: number };
    function walked(targets: T[], samples: number[], o: SimOptions) {
      const lastDay = Math.max(...targets.map((t) => t.days));
      const due = new Map(targets.map((t) => [t.id, 0]));
      const prio = new Map(targets.map((t) => [t.id, 0]));
      for (let trial = 0; trial < o.trials; trial += 1) {
        let done = 0;
        for (let d = 0; d <= lastDay; d += 1) {
          if (d > 0) done += drawDay(samples, o, d);
          for (const t of targets.filter((x) => x.days === d)) {
            if (done >= t.position) due.set(t.id, (due.get(t.id) ?? 0) + 1);
            if (done >= t.prio) prio.set(t.id, (prio.get(t.id) ?? 0) + 1);
          }
        }
      }
      return targets.map((t) => ({ id: t.id, state: "chance", chance: (due.get(t.id) ?? 0) / o.trials, chancePrioritised: (prio.get(t.id) ?? 0) / o.trials }));
    }
    const forty = Array.from({ length: 40 }, (_, i) => task(i + 1));
    const samples = [0, 0, 3];
    // Monday 2026-10-12: Oct 14 is 2 working days ahead, Oct 16 is 4, Oct 23 is 9, Nov 6 is 19, Nov 20 is 29.
    const scenarios: [Milestone[], T[]][] = [
      [
        [ms(1, "2026-10-14", [1]), ms(2, "2026-10-23", [2, 3]), ms(3, "2026-11-06", [30]), ms(4, "2026-11-20", [5, 25])],
        [
          { id: 1, days: 2, position: 1, prio: 1 },
          { id: 2, days: 9, position: 3, prio: 2 },
          { id: 3, days: 19, position: 30, prio: 1 },
          { id: 4, days: 29, position: 25, prio: 2 },
        ],
      ],
      // 4 days at most 3 a day cannot reach position 40: none reachable from day 0.
      [[ms(5, "2026-10-16", [40]), ms(6, "2026-10-14", [39])], [{ id: 6, days: 2, position: 39, prio: 1 }, { id: 5, days: 4, position: 40, prio: 1 }]],
      // Mid-trial: after day 2, below 6 done the 12 of milestone 8 are out of reach, so later trials hang on the skip.
      [
        [ms(7, "2026-10-14", [2]), ms(8, "2026-10-16", Array.from({ length: 12 }, (_, i) => i + 1))],
        [{ id: 7, days: 2, position: 2, prio: 1 }, { id: 8, days: 4, position: 12, prio: 12 }],
      ],
    ];
    for (const [milestones, targets] of scenarios) {
      const args = { ordered: forty, closedIds: new Set<number>(), sizeOf: () => 1, samples, today: TODAY, holidaySet: new Set<string>() };
      const fast = milestoneChances({ ...args, milestones, o: opts({ trials: 300, rng: mulberry32(9) }) });
      const slow = walked(targets, samples, opts({ trials: 300, rng: mulberry32(9) }));
      expect(fast, `early exits are exact for ${milestones.map((m) => m.id).join(",")}`).toEqual(
        milestones.map((m) => slow.find((s) => s.id === m.id)),
      );
    }
  });

  test("the milestone early exits stay exact under a varying multiplier", () => {
    // Reference: every trial draws sample x m[day], stochastic-rounded, every day up to the last milestone's day.
    // Each milestone links a run of tasks, so its prioritised position is large too: after day 15 a trial far
    // below 60 hits the none-reachable exit through the schedule's bestBetween, not only the all-reached one.
    const samples = [0, 1, 3];
    const m = Float64Array.from({ length: 1301 }, (_, d) => (d % 2 ? 0.2 : 2.5));
    const targets = [
      { id: 1, days: 15, position: 20, prio: 20 },
      { id: 2, days: 40, position: 60, prio: 60 },
    ];
    const o = opts({ trials: 300, rng: mulberry32(9) });
    const due = [0, 0];
    const prio = [0, 0];
    for (let trial = 0; trial < o.trials; trial += 1) {
      let done = 0;
      for (let d = 1; d <= 40; d += 1) {
        const x = samples[Math.floor(o.rng() * samples.length)] * m[d];
        const whole = Math.floor(x);
        done += whole + (o.rng() < x - whole ? 1 : 0);
        targets.forEach((t, k) => {
          if (t.days !== d) return;
          if (done >= t.position) due[k] += 1;
          if (done >= t.prio) prio[k] += 1;
        });
      }
    }
    const slow = targets.map((t, k) => ({ id: t.id, state: "chance", chance: due[k] / o.trials, chancePrioritised: prio[k] / o.trials }));
    // Monday 2026-10-12: Nov 2 is 15 working days ahead, Dec 7 is 40.
    const sixty = Array.from({ length: 60 }, (_, i) => task(i + 1));
    const fast = milestoneChances({
      milestones: [
        ms(1, "2026-11-02", Array.from({ length: 20 }, (_, i) => i + 1)),
        ms(2, "2026-12-07", Array.from({ length: 60 }, (_, i) => i + 1)),
      ],
      ordered: sixty,
      closedIds: new Set<number>(),
      sizeOf: () => 1,
      samples,
      today: TODAY,
      holidaySet: new Set<string>(),
      o: opts({ trials: 300, rng: mulberry32(9), capacityByDay: m }),
    });
    const bothOutcomes = (counts: number[]) => counts.every((n) => n > 0 && n < o.trials);
    expect(bothOutcomes(due), "some trials reach and some miss each milestone by due date").toBe(true);
    expect(bothOutcomes(prio), "some trials reach and some miss each milestone prioritised").toBe(true);
    expect(fast).toEqual(slow);
  });
});
