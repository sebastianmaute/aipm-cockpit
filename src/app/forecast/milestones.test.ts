import { describe, expect, test } from "vitest";
import type { Milestone, Task } from "../types";
import { isAttributableMilestone, orderBacklog, milestoneChances } from "./milestones";
import { mulberry32 } from "./rng";
import { buildArrivals, drawDay, type SimOptions } from "./simulate";
import { nthWorkingDayAfter } from "../working-days";

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

describe("attributed scope", () => {
  // Tasks 1..10 of size 1 in queue order; 1 a day, so a trial has done exactly d on day d.
  const ten = Array.from({ length: 10 }, (_, i) => task(i + 1));
  /** The date `days` working days after the Monday TODAY. */
  const day = (days: number) => nthWorkingDayAfter(TODAY, days, new Set<string>());
  type Change = { day: number; amount: number; milestoneId: number };
  function scoped(milestones: Milestone[], attributed: Change[], capSteps: { day: number; amount: number }[], closedIds: number[] = []) {
    return milestoneChances({
      milestones,
      ordered: ten,
      closedIds: new Set(closedIds),
      sizeOf: () => 1,
      samples: [1],
      today: TODAY,
      holidaySet: new Set<string>(),
      o: opts(),
      attributed,
      cap: buildArrivals(10, capSteps, 1300),
    });
  }
  const figures = (r: ReturnType<typeof milestoneChances>, id: number) => {
    const m = r.find((x) => x.id === id);
    return m?.state === "chance" ? { chance: m.chance, chancePrioritised: m.chancePrioritised } : m?.state;
  };

  test("isAttributableMilestone: not achieved and a valid date", () => {
    expect(isAttributableMilestone(ms(1, "2026-11-01", [1]))).toBe(true);
    expect(isAttributableMilestone(ms(1, "2026-11-01", [1], { achievedDate: "2026-10-01" }))).toBe(false);
    expect(isAttributableMilestone(ms(1, "", [1]))).toBe(false);
    expect(isAttributableMilestone(ms(1, "2026-02-30", [1]))).toBe(false);
  });

  test("absent attributed and cap give today's result exactly", () => {
    const milestones = [ms(1, day(9), [5]), ms(2, day(14), [10])];
    const base = { milestones, ordered: ten, closedIds: new Set<number>(), sizeOf: () => 1, samples: [0, 1, 2], today: TODAY, holidaySet: new Set<string>() };
    const plain = milestoneChances({ ...base, o: opts() });
    const between = plain.filter((m) => m.state === "chance" && m.chance > 0 && m.chance < 1);
    expect(between, "some trials reach and some miss each milestone").toHaveLength(2);
    expect(milestoneChances({ ...base, o: opts(), attributed: [] })).toEqual(plain);
  });

  test("attributed scope moves its milestone and every later one, and both figures of its own", () => {
    // M1: position 5 + 5 = 10 > 9 done, own work 1 + 5 = 6 <= 9; M2: position 10 + 5 = 15 > 14, own work 1.
    const r = scoped([ms(1, day(9), [5]), ms(2, day(14), [10])], [{ day: 0, amount: 5, milestoneId: 1 }], [{ day: 0, amount: 5 }]);
    expect(figures(r, 1)).toEqual({ chance: 0, chancePrioritised: 1 });
    expect(figures(r, 2)).toEqual({ chance: 0, chancePrioritised: 1 });
  });

  test("unattributed added scope moves no milestone", () => {
    const r = scoped([ms(1, day(9), [5]), ms(2, day(14), [10])], [], [{ day: 0, amount: 5 }]);
    expect(figures(r, 1)).toEqual({ chance: 1, chancePrioritised: 1 });
    expect(figures(r, 2)).toEqual({ chance: 1, chancePrioritised: 1 });
  });

  test("an attributed removal stops at the milestone's own work", () => {
    // M1 owns 1 task, so -3 removes 1: M1 position 4, M2 position 9 (not 7). The cap carries additions only.
    const removal = [{ day: 0, amount: -3, milestoneId: 1 }];
    const r = scoped([ms(1, day(4), [5]), ms(2, day(7), [10])], removal, []);
    expect(figures(r, 1)).toMatchObject({ chance: 1 });
    expect(figures(r, 2)).toMatchObject({ chance: 0 });
    // Position exactly 9: reached on day 9, not on day 8 (no cap, so only the position decides).
    const at = (d: number) => milestoneChances({
      milestones: [ms(1, day(4), [5]), ms(2, day(d), [10])],
      ordered: ten, closedIds: new Set<number>(), sizeOf: () => 1, samples: [1], today: TODAY, holidaySet: new Set<string>(), o: opts(), attributed: removal,
    });
    expect(figures(at(8), 2)).toMatchObject({ chance: 0 });
    expect(figures(at(9), 2)).toMatchObject({ chance: 1 });
  });

  test("an addition after its milestone's date makes that milestone unreachable", () => {
    const r = scoped([ms(1, day(9), [5])], [{ day: 12, amount: 1, milestoneId: 1 }], [{ day: 12, amount: 1 }]);
    expect(figures(r, 1)).toEqual({ chance: 0, chancePrioritised: 0 });
  });

  test("an addition arriving after a later milestone's date does not move it", () => {
    const r = scoped([ms(1, day(9), [5]), ms(2, day(11), [10])], [{ day: 12, amount: 5, milestoneId: 1 }], [{ day: 12, amount: 5 }]);
    expect(figures(r, 2)).toMatchObject({ chance: 1 });
  });

  test("the all-reached exit respects a cap that falls later", () => {
    // 2 a day; a cap handed in that falls 10 -> 7 on day 12. Done reaches 10 on day 5, past every position,
    // but the cap holds it at 7 from day 12, so M2 (position 10, day 14) is missed.
    const r = milestoneChances({
      milestones: [ms(1, day(4), [5]), ms(2, day(14), [10])],
      ordered: ten, closedIds: new Set<number>(), sizeOf: () => 1, samples: [2], today: TODAY, holidaySet: new Set<string>(), o: opts(),
      cap: buildArrivals(10, [{ day: 12, amount: -3 }], 1300),
    });
    expect(figures(r, 1)).toEqual({ chance: 1, chancePrioritised: 1 });
    expect(figures(r, 2)).toEqual({ chance: 0, chancePrioritised: 1 });
  });

  test("a removal on a later milestone does not cap an earlier one", () => {
    // L owns tasks 1 and 11 (position 11), M owns task 10 (position 10). -2 on L moves L, not M, so M's cap stays 11.
    const eleven = Array.from({ length: 11 }, (_, i) => task(i + 1));
    const r = milestoneChances({
      milestones: [ms(1, day(12), [10]), ms(2, day(30), [1, 11])],
      ordered: eleven, closedIds: new Set<number>(), sizeOf: () => 1, samples: [1], today: TODAY, holidaySet: new Set<string>(), o: opts(),
      attributed: [{ day: 0, amount: -2, milestoneId: 2 }],
      cap: buildArrivals(11, [], 1300),
    });
    expect(figures(r, 1)).toEqual({ chance: 1, chancePrioritised: 1 });
    expect(figures(r, 2)).toEqual({ chance: 1, chancePrioritised: 1 });
  });

  test("the early exits stay exact with a cap per milestone", () => {
    // 12 tasks; M1 owns [10] (day 8), M2 owns every other task (day 9). -2 on M2 on day 3 moves only M2 (12 -> 10,
    // own 11 -> 9);
    // +6 on M1 on day 6 moves M1 (10 -> 16, own 7) and M2 (10 -> 16). Shared cap: 12, 18 from day 6.
    // M1's cap: 12, 18 from day 6. M2's cap: 12, 10 from day 3, 16 from day 6.
    const twelve = Array.from({ length: 12 }, (_, i) => task(i + 1));
    const samples = [0, 1, 3];
    const capOf = (steps: { day: number; amount: number }[]) => buildArrivals(12, steps, 1300).arrivedAt;
    const targets = [
      { id: 1, days: 8, position: 16, prio: 7, cap: capOf([{ day: 6, amount: 6 }]) },
      { id: 2, days: 9, position: 16, prio: 9, cap: capOf([{ day: 3, amount: -2 }, { day: 6, amount: 6 }]) },
    ];
    const o = opts({ trials: 300, rng: mulberry32(9) });
    const due = [0, 0];
    const prio = [0, 0];
    for (let trial = 0; trial < o.trials; trial += 1) {
      const done = [0, 0];
      for (let d = 1; d <= 9; d += 1) {
        const x = drawDay(samples, o, d);
        targets.forEach((t, k) => {
          done[k] = Math.min(done[k] + x, t.cap[d]);
          if (t.days !== d) return;
          if (done[k] >= t.position) due[k] += 1;
          if (done[k] >= t.prio) prio[k] += 1;
        });
      }
    }
    expect(due.every((c) => c > 0 && c < o.trials), "some trials reach and some miss each milestone").toBe(true);
    const fast = milestoneChances({
      milestones: [ms(1, day(8), [10]), ms(2, day(9), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12])],
      ordered: twelve, closedIds: new Set<number>(), sizeOf: () => 1, samples, today: TODAY, holidaySet: new Set<string>(),
      o: opts({ trials: 300, rng: mulberry32(9) }),
      attributed: [{ day: 3, amount: -2, milestoneId: 2 }, { day: 6, amount: 6, milestoneId: 1 }],
      cap: buildArrivals(12, [{ day: 6, amount: 6 }], 1300),
    });
    expect(fast).toEqual(targets.map((t, k) => ({ id: t.id, state: "chance", chance: due[k] / o.trials, chancePrioritised: prio[k] / o.trials })));
  });

  test("scope on a milestone with no open linked tasks is placed by its date", () => {
    // Owner decision 2026-10-17: M3 (all closed, day 10) sits after M1 (position 5, day 7) and before M2 (day 12):
    // M3 position 5 + 3 = 8 <= 10; M1 unmoved at 5 <= 7; M2 position 10 + 3 = 13 > 12.
    const r = scoped(
      [ms(1, day(7), [5]), ms(2, day(12), [10]), ms(3, day(10), [99])],
      [{ day: 0, amount: 3, milestoneId: 3 }],
      [{ day: 0, amount: 3 }],
      [99],
    );
    expect(figures(r, 3)).toEqual({ chance: 1, chancePrioritised: 1 });
    expect(figures(r, 1)).toEqual({ chance: 1, chancePrioritised: 1 });
    expect(figures(r, 2)).toMatchObject({ chance: 0 });
  });
});
