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

/** A removal that moves a target: it lowers that target's arrived work from `day` on. */
type Drop = { day: number; amount: number };

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
  /**
   * Base + every addition by day, no removals; caps each trial's done count. Each target's own cap is this
   * lowered by the attributed removals that move it (a removal on a later milestone does not), so no target is
   * capped below the work its unmoved position needs. Absent = no cap.
   */
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
type Keyed = { id: number; date: string; days: number | null; position: number; own: number; dead: boolean; drops: Drop[] };

/** A milestone's own work after its attributed changes, in day order, each removal stopping at zero. */
function addedOwnWork(changes: readonly AttributedChange[], id: number): number {
  let own = 0;
  for (const c of changes) if (c.milestoneId === id) own = Math.max(0, own + c.amount);
  return own;
}

/** Each milestone's own work today: the summed size of its open linked tasks (`openSizes`: open task id → size). */
export function ownWorkToday(milestones: readonly Milestone[], openSizes: ReadonlyMap<number, number>): Map<number, number> {
  return new Map(milestones.map((m) => [m.id, m.linkedTaskIds.reduce((s, id) => s + (openSizes.get(id) ?? 0), 0)]));
}

/**
 * The amount each change actually moves its milestone's own work: walking in day order (input order within a
 * day) from `ownAtStart`, a removal stops at the work the milestone still has then; an addition is unchanged.
 * Returned in input order, so the totals (`arrivedAt`, the cap) drop only by what really came off (§4.1).
 */
export function clampAttributedRemovals<T extends AttributedChange>(changes: readonly T[], ownAtStart: ReadonlyMap<number, number>): T[] {
  const own = new Map(ownAtStart);
  const out = [...changes];
  const order = changes.map((_, i) => i).sort((a, b) => changes[a].day - changes[b].day);
  for (const i of order) {
    const c = changes[i];
    const current = own.get(c.milestoneId) ?? 0;
    const amount = c.amount > 0 ? c.amount : -Math.min(-c.amount, current);
    own.set(c.milestoneId, current + amount);
    out[i] = { ...c, amount };
  }
  return out;
}

/** `cap` lowered by each drop from its day on, never below zero. */
function lowered(cap: Arrivals, drops: readonly Drop[]): Arrivals {
  if (drops.length === 0) return cap;
  const arrivedAt = Float64Array.from(cap.arrivedAt);
  for (const { day, amount } of drops) for (let d = day; d < arrivedAt.length; d += 1) arrivedAt[d] += amount;
  for (let d = 0; d < arrivedAt.length; d += 1) arrivedAt[d] = Math.max(0, arrivedAt[d]);
  const suffixMin = Float64Array.from(arrivedAt);
  for (let d = suffixMin.length - 2; d >= 0; d -= 1) suffixMin[d] = Math.min(suffixMin[d], suffixMin[d + 1]);
  return { arrivedAt, suffixMin, lastPositiveDay: cap.lastPositiveDay };
}

/** Day order, input order within a day. */
function byDay(changes: readonly AttributedChange[] | undefined): AttributedChange[] {
  return [...(changes ?? [])].sort((a, b) => a.day - b.day);
}

/**
 * Applies the attributed changes in day order: an addition of `a` to N adds `a` to N's own work and to the
 * position of N and of every milestone whose key `(base position, date)` comes after N's; a removal does the
 * same with `-min(a, N's own work)`. Milestone M counts only changes with `day ≤ M.days`, except that an
 * addition to M itself after its date makes M unreachable (`dead`). The prioritised figure is `own`. Each
 * removal that moves M is recorded in `M.drops`, for M's own cap.
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
          if (e < 0) m.drops.push({ day: c.day, amount: e });
        } else if (c.amount > 0) {
          m.dead = true;
        }
      } else if (c.day <= m.days && after(m, n)) {
        m.position += e;
        if (e < 0) m.drops.push({ day: c.day, amount: e });
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
        drops: [],
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
    drops: [],
  }));
  const all = [...keyed, ...placed];
  applyAttributed(all, changes);

  // Overdue stays overdue whatever is attributed.
  for (const k of all) {
    if (k.days === null) results.set(k.id, { id: k.id, state: "overdue" });
    else if (k.dead) results.set(k.id, { id: k.id, state: "chance", chance: 0, chancePrioritised: 0 });
  }
  const live = all.filter((k) => k.days !== null && !k.dead);
  const targets: Target[] = live.map((k) => ({ id: k.id, days: k.days ?? 0, position: k.position, positionPrioritised: k.own }));
  const { cap } = args;
  // Every trial walks to the latest attributable milestone dated today or later, target or not, so the stream
  // position of trial t never depends on which milestones a scenario's changes leave as targets.
  const walkTo = milestones.reduce(
    (a, m) => (isAttributableMilestone(m) && m.date >= today ? Math.max(a, Math.min(daysTo(m.date), o.horizon)) : a),
    0,
  );

  const hits = tally(targets, args, walkTo, cap ? live.map((k) => lowered(cap, k.drops)) : undefined);
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
 * Every trial consumes exactly `walkTo` days of draws (at least the last target's day): a trial done with its
 * targets skips the rest, so trial t starts at the same stream position in every scenario column.
 * With `caps` (one per target), each target keeps its own done count, capped by its own arrived work.
 */
function tally(
  targets: readonly Target[],
  { samples, o }: Args,
  walkTo: number,
  caps?: readonly Arrivals[],
): Map<number, { due: number; prio: number }> {
  const hits = new Map(targets.map((t) => [t.id, { due: 0, prio: 0 }]));
  if (targets.length === 0) return hits;
  const queue = targets
    .map((t, k) => ({ t, day: Math.min(t.days, o.horizon), cap: caps?.[k] }))
    .sort((a, b) => a.day - b.day);
  const lastDay = Math.max(walkTo, queue[queue.length - 1].day);
  const counts = caps ? walkCapped(queue, samples, o, lastDay) : walkShared(queue, samples, o, lastDay);
  queue.forEach(({ t }, i) => {
    const h = hits.get(t.id);
    if (!h) return;
    h.due += counts.due[i];
    h.prio += counts.prio[i];
  });
  return hits;
}

type Queued = { t: Target; day: number; cap?: Arrivals };
type Counts = { due: Int32Array; prio: Int32Array };

/** No cap: every target reads the same done count. Each trial consumes `lastDay` days of draws. */
function walkShared(queue: readonly Queued[], samples: readonly number[], o: SimOptions, lastDay: number): Counts {
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
  const lastTarget = queue[n - 1].day;
  const { draw, bestBetween, skipDays } = dayDrawer(samples, o);
  for (let trial = 0; trial < o.trials; trial += 1) {
    let done = 0;
    let i = 0;
    // Always left by a break: on the last target's day every target has been read.
    let d = 0;
    for (; d <= lastTarget; d += 1) {
      if (d > 0) done += draw(d);
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
        break;
      }
      if (cannotReach(done, 1, bestBetween(d, lastTarget), noneReachedBelow[i])) break;
    }
    skipDays(lastDay - d);
  }
  return { due, prio };
}

/**
 * A cap per target: target j's done is `min(done_j + draw(d), cap_j.arrivedAt[d])`, the same draw for all. The
 * exits ask every target still ahead: all certainly reached (done covers both positions and the cap cannot fall
 * below them later, since a falling cap pulls done down) or all certainly missed. Each trial consumes `lastDay`
 * days of draws.
 */
function walkCapped(queue: readonly Queued[], samples: readonly number[], o: SimOptions, lastDay: number): Counts {
  const n = queue.length;
  const need = queue.map(({ t }) => Math.max(t.position, t.positionPrioritised));
  const least = queue.map(({ t }) => Math.min(t.position, t.positionPrioritised));
  const caps = queue.map((q) => q.cap);
  const due = new Int32Array(n);
  const prio = new Int32Array(n);
  const done = new Float64Array(n);
  const lastTarget = queue[n - 1].day;
  const { draw, bestBetween, skipDays } = dayDrawer(samples, o);
  const allReached = (i: number, d: number) => {
    for (let j = i; j < n; j += 1) {
      const cap = caps[j];
      if (done[j] < need[j] || (cap && cap.suffixMin[d + 1] < need[j])) return false;
    }
    return true;
  };
  const noneReachable = (i: number, best: number) => {
    for (let j = i; j < n; j += 1) if (!cannotReach(done[j], 1, best, least[j])) return false;
    return true;
  };
  for (let trial = 0; trial < o.trials; trial += 1) {
    done.fill(0);
    let i = 0;
    // Always left by a break: on the last target's day every target has been read.
    let d = 0;
    for (; d <= lastTarget; d += 1) {
      if (d > 0) {
        const x = draw(d);
        for (let j = i; j < n; j += 1) {
          const cap = caps[j];
          done[j] = cap ? Math.min(done[j] + x, cap.arrivedAt[d]) : done[j] + x;
        }
      }
      for (; i < n && queue[i].day === d; i += 1) {
        if (done[i] >= queue[i].t.position) due[i] += 1;
        if (done[i] >= queue[i].t.positionPrioritised) prio[i] += 1;
      }
      if (i === n) break;
      if (allReached(i, d)) {
        for (let j = i; j < n; j += 1) {
          due[j] += 1;
          prio[j] += 1;
        }
        break;
      }
      if (noneReachable(i, bestBetween(d, lastTarget))) break;
    }
    skipDays(lastDay - d);
  }
  return { due, prio };
}
