/** Milestone chance: share of simulated trials that reach a milestone's queue position by its date (§502). */

import { PRIORITIES, type Milestone, type Task } from "../types";
import { addCalendarDays, countWorkingDays } from "../working-days";
import { cannotReach, dayDrawer, type SimOptions } from "./simulate";
import { isValidIsoDate } from "./throughput";

export type MilestoneChance =
  | { id: number; state: "chance"; chance: number; chancePrioritised: number }
  | { id: number; state: "overdue" | "no-linked-tasks" };

/** Due date ascending (blank last), then priority descending, then id. */
export function orderBacklog(open: readonly Task[]): Task[] {
  return [...open].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    const byPriority = PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority);
    return byPriority !== 0 ? byPriority : a.id - b.id;
  });
}

type Target = { id: number; days: number; position: number; positionPrioritised: number };

type Args = {
  milestones: readonly Milestone[];
  ordered: readonly Task[];
  /** Ids of closed tasks, so a milestone whose linked tasks are all closed reads 100 %. */
  closedIds: ReadonlySet<number>;
  sizeOf: (t: Task) => number;
  samples: readonly number[];
  today: string;
  holidaySet: ReadonlySet<string>;
  o: SimOptions;
};

export function milestoneChances(args: Args): MilestoneChance[] {
  const { milestones, ordered, closedIds, sizeOf, today, holidaySet, o } = args;
  const cumulative = new Map<number, number>();
  let running = 0;
  for (const t of ordered) {
    running += sizeOf(t);
    cumulative.set(t.id, running);
  }
  const sizes = new Map(ordered.map((t) => [t.id, sizeOf(t)]));

  const results = new Map<number, MilestoneChance>();
  const targets: Target[] = [];
  for (const m of milestones) {
    // R16: a milestone with no valid date (load repairs a bad one to "") has nothing to forecast.
    if (m.achievedDate || !isValidIsoDate(m.date)) continue;
    const open = m.linkedTaskIds.filter((id) => cumulative.has(id));
    const closed = m.linkedTaskIds.filter((id) => !cumulative.has(id) && closedIds.has(id));
    if (open.length === 0 && closed.length === 0) {
      results.set(m.id, { id: m.id, state: "no-linked-tasks" });
    } else if (open.length === 0) {
      results.set(m.id, { id: m.id, state: "chance", chance: 1, chancePrioritised: 1 });
    } else if (m.date < today) {
      results.set(m.id, { id: m.id, state: "overdue" });
    } else {
      targets.push({
        id: m.id,
        days: countWorkingDays(addCalendarDays(today, 1), addCalendarDays(m.date, 1), holidaySet),
        position: Math.max(...open.map((id) => cumulative.get(id) ?? 0)),
        positionPrioritised: open.reduce((s, id) => s + (sizes.get(id) ?? 0), 0),
      });
    }
  }

  const hits = tally(targets, args);
  for (const t of targets) {
    const h = hits.get(t.id) ?? { due: 0, prio: 0 };
    const n = o.trials;
    results.set(t.id, {
      id: t.id,
      state: "chance",
      chance: n === 0 ? 0 : h.due / n,
      chancePrioritised: n === 0 ? 0 : h.prio / n,
    });
  }
  return milestones.flatMap((m) => results.get(m.id) ?? []);
}

/**
 * One pass: each trial walks the days once and checks every milestone on its own day. A trial stops
 * early once every milestone still ahead is certainly reached (its done work already covers both
 * positions) or certainly missed (even the best possible days cannot cover the smallest one), and skips
 * the draws it would have made, so every count is the same as walking to the last milestone's day.
 */
function tally(targets: readonly Target[], { samples, o }: Args): Map<number, { due: number; prio: number }> {
  const hits = new Map(targets.map((t) => [t.id, { due: 0, prio: 0 }]));
  if (targets.length === 0) return hits;
  const queue = targets.map((t) => ({ t, day: Math.min(t.days, o.horizon) })).sort((a, b) => a.day - b.day);
  const n = queue.length;
  // From queue index i on: the largest position (reached by all) and the smallest (missed by all).
  const allReachedAt = new Float64Array(n + 1);
  const noneReachedBelow = new Float64Array(n + 1).fill(Infinity);
  for (let i = n - 1; i >= 0; i -= 1) {
    const { position, positionPrioritised } = queue[i].t;
    allReachedAt[i] = Math.max(allReachedAt[i + 1], position, positionPrioritised);
    noneReachedBelow[i] = Math.min(noneReachedBelow[i + 1], position, positionPrioritised);
  }
  const due = new Int32Array(n);
  const prio = new Int32Array(n);
  const lastDay = queue[n - 1].day;
  const { draw, max, skipDays } = dayDrawer(samples, o);
  for (let trial = 0; trial < o.trials; trial += 1) {
    let done = 0;
    let i = 0;
    for (let d = 0; d <= lastDay; d += 1) {
      if (d > 0) done += draw();
      for (; i < n && queue[i].day === d; i += 1) {
        if (done >= queue[i].t.position) due[i] += 1;
        if (done >= queue[i].t.positionPrioritised) prio[i] += 1;
      }
      if (i === n) break;
      if (done >= allReachedAt[i]) {
        for (let j = i; j < n; j += 1) {
          due[j] += 1;
          prio[j] += 1;
        }
        skipDays(lastDay - d);
        break;
      }
      if (cannotReach(done, lastDay - d, max, noneReachedBelow[i])) {
        skipDays(lastDay - d);
        break;
      }
    }
  }
  queue.forEach(({ t }, i) => {
    const h = hits.get(t.id);
    if (!h) return;
    h.due += due[i];
    h.prio += prio[i];
  });
  return hits;
}
