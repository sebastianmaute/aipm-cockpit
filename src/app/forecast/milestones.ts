/** Milestone chance: share of simulated trials that reach a milestone's queue position by its date (§502). */

import { PRIORITIES, type Milestone, type Task } from "../types";
import { addCalendarDays, countWorkingDays } from "../working-days";
import { cannotReach, dayDrawer, type Arrivals, type SimOptions } from "./simulate";
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

type AttributedChange = { day: number; amount: number; milestoneId: number };

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
  /** Dated scope changes on a milestone's own work (amounts in the forecast unit). Absent = none. */
  attributed?: readonly AttributedChange[];
  /** The work that has arrived by each day; caps each trial's done count. Absent = no cap. */
  cap?: Arrivals;
};

/** Not achieved and a valid date: the milestones a scope change may be attributed to (§4.1). */
export function isAttributableMilestone(m: Milestone): boolean {
  // R16: a milestone with no valid date (load repairs a bad one to "") has nothing to forecast.
  return !m.achievedDate && isValidIsoDate(m.date);
}

/**
 * A milestone's place in the queue: `position` and `date` order it, `own` is its remaining work. `days` is
 * null for an overdue milestone (no figures, but attributed scope on it still moves later ones).
 */
type Keyed = { id: number; date: string; days: number | null; position: number; own: number; dead: boolean };

/** A milestone's own work after its attributed changes, in day order, each removal stopping at zero. */
function addedOwnWork(changes: readonly AttributedChange[], id: number): number {
  let own = 0;
  for (const c of changes) if (c.milestoneId === id) own = Math.max(0, own + c.amount);
  return own;
}

/** Day order, input order within a day. */
function byDay(changes: readonly AttributedChange[] | undefined): AttributedChange[] {
  return [...(changes ?? [])].sort((a, b) => a.day - b.day);
}

/**
 * Applies the attributed changes in day order: an addition of `a` to N adds `a` to N's own work and to the
 * position of N and of every milestone whose key `(base position, date)` comes after N's; a removal does the
 * same with `-min(a, N's own work)`. Milestone M counts only changes with `day ≤ M.days`, except that an
 * addition to M itself after its date makes M unreachable (`dead`). The prioritised figure is `own`.
 */
function applyAttributed(keyed: readonly Keyed[], changes: readonly AttributedChange[]): void {
  const byId = new Map(keyed.map((k) => [k.id, k]));
  const base = new Map(keyed.map((k) => [k.id, k.position]));
  const own = new Map(keyed.map((k) => [k.id, k.own]));
  const after = (m: Keyed, n: Keyed) => {
    const pm = base.get(m.id) ?? 0;
    const pn = base.get(n.id) ?? 0;
    return pm > pn || (pm === pn && m.date > n.date);
  };
  for (const c of changes) {
    const n = byId.get(c.milestoneId);
    if (!n) continue;
    const current = own.get(n.id) ?? 0;
    const e = c.amount > 0 ? c.amount : -Math.min(-c.amount, current);
    own.set(n.id, current + e);
    for (const m of keyed) {
      if (m.days === null || m.dead) continue;
      if (m === n) {
        if (c.day <= m.days) {
          m.position += e;
          m.own += e;
        } else if (c.amount > 0) {
          m.dead = true;
        }
      } else if (c.day <= m.days && after(m, n)) {
        m.position += e;
      }
    }
  }
}

export function milestoneChances(args: Args): MilestoneChance[] {
  const { milestones, ordered, closedIds, sizeOf, today, holidaySet, o } = args;
  const cumulative = new Map<number, number>();
  let running = 0;
  for (const t of ordered) {
    running += sizeOf(t);
    cumulative.set(t.id, running);
  }
  const sizes = new Map(ordered.map((t) => [t.id, sizeOf(t)]));
  const changes = byDay(args.attributed);
  const daysTo = (date: string) => countWorkingDays(addCalendarDays(today, 1), addCalendarDays(date, 1), holidaySet);

  const results = new Map<number, MilestoneChance>();
  const keyed: Keyed[] = [];
  // Owner decision 2026-10-17: a milestone with no open linked tasks that gets net added work is placed by its date.
  const placedByDate: Milestone[] = [];
  for (const m of milestones) {
    if (!isAttributableMilestone(m)) continue;
    const open = m.linkedTaskIds.filter((id) => cumulative.has(id));
    const closed = m.linkedTaskIds.filter((id) => !cumulative.has(id) && closedIds.has(id));
    if (open.length === 0 && addedOwnWork(changes, m.id) > 0) {
      placedByDate.push(m);
    } else if (open.length === 0 && closed.length === 0) {
      results.set(m.id, { id: m.id, state: "no-linked-tasks" });
    } else if (open.length === 0) {
      results.set(m.id, { id: m.id, state: "chance", chance: 1, chancePrioritised: 1 });
    } else {
      keyed.push({
        id: m.id,
        date: m.date,
        days: m.date < today ? null : daysTo(m.date),
        position: open.reduce((a, id) => Math.max(a, cumulative.get(id) ?? 0), 0),
        own: open.reduce((s, id) => s + (sizes.get(id) ?? 0), 0),
        dead: false,
      });
    }
  }
  // Its base position: the largest base position of the milestones with open tasks dated on or before it.
  const placed = placedByDate.map((m): Keyed => ({
    id: m.id,
    date: m.date,
    days: m.date < today ? null : daysTo(m.date),
    position: keyed.reduce((a, k) => (k.date <= m.date ? Math.max(a, k.position) : a), 0),
    own: 0,
    dead: false,
  }));
  const all = [...keyed, ...placed];
  applyAttributed(all, changes);

  // Overdue stays overdue whatever is attributed.
  for (const k of all) {
    if (k.days === null) results.set(k.id, { id: k.id, state: "overdue" });
    else if (k.dead) results.set(k.id, { id: k.id, state: "chance", chance: 0, chancePrioritised: 0 });
  }
  const targets: Target[] = all.flatMap((k) =>
    k.days === null || k.dead ? [] : [{ id: k.id, days: k.days, position: k.position, positionPrioritised: k.own }],
  );

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
 * With `cap`, a day's done count may not exceed the work that has arrived by that day.
 */
function tally(targets: readonly Target[], { samples, o, cap }: Args): Map<number, { due: number; prio: number }> {
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
  const { draw, bestBetween, skipDays } = dayDrawer(samples, o);
  for (let trial = 0; trial < o.trials; trial += 1) {
    let done = 0;
    let i = 0;
    for (let d = 0; d <= lastDay; d += 1) {
      if (d > 0) done = cap ? Math.min(done + draw(d), cap.arrivedAt[d]) : done + draw(d);
      for (; i < n && queue[i].day === d; i += 1) {
        if (done >= queue[i].t.position) due[i] += 1;
        if (done >= queue[i].t.positionPrioritised) prio[i] += 1;
      }
      if (i === n) break;
      // Under a cap done falls when the arrived work does, so "all reached" also needs the cap to stay above.
      if (done >= allReachedAt[i] && (!cap || cap.suffixMin[d + 1] >= allReachedAt[i])) {
        for (let j = i; j < n; j += 1) {
          due[j] += 1;
          prio[j] += 1;
        }
        skipDays(lastDay - d);
        break;
      }
      if (cannotReach(done, 1, bestBetween(d, lastDay), noneReachedBelow[i])) {
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
