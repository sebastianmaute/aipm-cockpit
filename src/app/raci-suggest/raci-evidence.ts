import type { ChangeItem, Milestone, RaidCategory, RaidItem, Resource, Stakeholder, Task } from "../types";
import { resourceDisplayName } from "../resource-foundation";
import { isTaskClosed } from "../task-closed";
import { isRaidActiveForReview } from "../raid-review";

export interface RaciEvidenceInput {
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  resources: readonly Resource[];
}

export interface RaciEvidence {
  stakeholderId: number;
  milestoneId: number;
  tasksOwned: number;
  tasksClosed: number;
  scopeSize: number;
  raidOpen: Partial<Record<RaidCategory, number>>;
  raidClosed: Partial<Record<RaidCategory, number>>;
  changesRequested: number;
}

/** Built once per run by `buildMatchCtx`: the live resource ids and, per stakeholder, the lowercase
 *  names it answers to. */
export interface MatchCtx {
  resourceIds: ReadonlySet<number>;
  /** resource id -> ids of the stakeholders linked to it */
  byResource: ReadonlyMap<number, readonly number[]>;
  /** lowercase trimmed name -> ids of the stakeholders answering to it (stakeholder name or linked display name) */
  byName: ReadonlyMap<string, readonly number[]>;
}

const RAID_ORDER: readonly RaidCategory[] = ["R", "A", "I", "D"];

const nameKey = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

function addTo<K>(map: Map<K, number[]>, key: K, id: number): void {
  const ids = map.get(key);
  if (!ids) map.set(key, [id]);
  else if (!ids.includes(id)) ids.push(id);
}

export function buildMatchCtx(stakeholders: readonly Stakeholder[], resources: readonly Resource[]): MatchCtx {
  const resourcesById = new Map(resources.map((r) => [r.id, r]));
  const byResource = new Map<number, number[]>();
  const byName = new Map<string, number[]>();
  for (const s of stakeholders) {
    const linked = s.resourceId != null ? resourcesById.get(s.resourceId) : undefined;
    if (linked) addTo(byResource, linked.id, s.id);
    for (const key of [nameKey(s.name), linked ? nameKey(resourceDisplayName(linked)) : ""]) {
      if (key) addTo(byName, key, s.id);
    }
  }
  return { resourceIds: new Set(resourcesById.keys()), byResource, byName };
}

/** The stakeholder ids an item matches: by resource link when the item's id names a live resource
 *  (no name fallback then), else by typed name. More than one match means ambiguous: none. */
export function stakeholdersForItem(
  item: { resourceId?: number | null; person?: string },
  ctx: MatchCtx,
): number[] {
  let ids: readonly number[] = [];
  if (item.resourceId != null && ctx.resourceIds.has(item.resourceId)) {
    ids = ctx.byResource.get(item.resourceId) ?? [];
  } else {
    const key = nameKey(item.person);
    if (key) ids = ctx.byName.get(key) ?? [];
  }
  return ids.length === 1 ? [ids[0]] : [];
}

interface Tally {
  tasksOwned: number;
  tasksClosed: number;
  raidOpen: Partial<Record<RaidCategory, number>>;
  raidClosed: Partial<Record<RaidCategory, number>>;
  changesRequested: number;
}

const emptyTally = (): Tally => ({ tasksOwned: 0, tasksClosed: 0, raidOpen: {}, raidClosed: {}, changesRequested: 0 });

const sum = (m: Partial<Record<RaidCategory, number>>): number =>
  RAID_ORDER.reduce((n, c) => n + (m[c] ?? 0), 0);

const hasAny = (t: Tally): boolean => t.tasksOwned > 0 || sum(t.raidOpen) > 0 || sum(t.raidClosed) > 0 || t.changesRequested > 0;

function bump(m: Partial<Record<RaidCategory, number>>, c: RaidCategory): void {
  m[c] = (m[c] ?? 0) + 1;
}

const touchesScope = (linked: readonly number[], scope: ReadonlySet<number>): boolean =>
  linked.some((id) => scope.has(id));

function tallyMilestone(
  scope: ReadonlySet<number>,
  input: RaciEvidenceInput,
  ctx: MatchCtx,
): Map<number, Tally> {
  const tallies = new Map<number, Tally>();
  const of = (id: number): Tally => {
    let t = tallies.get(id);
    if (!t) tallies.set(id, (t = emptyTally()));
    return t;
  };
  for (const task of input.tasks) {
    if (!scope.has(task.id)) continue;
    for (const sid of stakeholdersForItem({ resourceId: task.resourceId, person: task.assignee }, ctx)) {
      const t = of(sid);
      t.tasksOwned += 1;
      if (isTaskClosed(task)) t.tasksClosed += 1;
    }
  }
  for (const item of input.raid) {
    if (!touchesScope(item.linkedTaskIds ?? [], scope)) continue;
    for (const sid of stakeholdersForItem({ resourceId: item.ownerResourceId, person: item.owner }, ctx)) {
      const t = of(sid);
      bump(isRaidActiveForReview(item) ? t.raidOpen : t.raidClosed, item.category);
    }
  }
  for (const change of input.changes) {
    if (!touchesScope(change.linkedTaskIds ?? [], scope)) continue;
    for (const sid of stakeholdersForItem({ person: change.requestedBy }, ctx)) of(sid).changesRequested += 1;
  }
  return tallies;
}

/** Evidence per stakeholder and milestone, only for pairs with any count above zero. Milestones keep
 *  the input order; within one, the strongest first (owned tasks, then RAID, then changes). Uncapped. */
export function buildRaciEvidence(input: RaciEvidenceInput): RaciEvidence[] {
  const ctx = buildMatchCtx(input.stakeholders, input.resources);
  const taskIds = new Set(input.tasks.map((t) => t.id));
  const rank = new Map(input.stakeholders.map((s, i) => [s.id, i]));
  const out: RaciEvidence[] = [];
  for (const m of input.milestones) {
    const scope = new Set((m.linkedTaskIds ?? []).filter((id) => taskIds.has(id)));
    if (scope.size === 0) continue;
    const rows: RaciEvidence[] = [];
    for (const [stakeholderId, t] of tallyMilestone(scope, input, ctx)) {
      if (!hasAny(t)) continue;
      rows.push({ stakeholderId, milestoneId: m.id, scopeSize: scope.size, ...t });
    }
    rows.sort(
      (a, b) =>
        b.tasksOwned - a.tasksOwned ||
        sum(b.raidOpen) + sum(b.raidClosed) - (sum(a.raidOpen) + sum(a.raidClosed)) ||
        b.changesRequested - a.changesRequested ||
        (rank.get(a.stakeholderId) ?? 0) - (rank.get(b.stakeholderId) ?? 0),
    );
    out.push(...rows);
  }
  return out;
}

function raidPart(label: string, m: Partial<Record<RaidCategory, number>>): string {
  const bits = RAID_ORDER.filter((c) => (m[c] ?? 0) > 0).map((c) => `${c}×${m[c]}`);
  return bits.length ? `${label} ${bits.join(", ")}` : "";
}

/** e.g. `owns 3 of 5 tasks (1 closed); owns open R×1, closed I×1; requested 1 change`. */
export function evidenceLine(e: RaciEvidence): string {
  const parts: string[] = [];
  if (e.tasksOwned > 0) {
    parts.push(`owns ${e.tasksOwned} of ${e.scopeSize} tasks${e.tasksClosed > 0 ? ` (${e.tasksClosed} closed)` : ""}`);
  }
  const open = raidPart("open", e.raidOpen);
  const closed = raidPart("closed", e.raidClosed);
  const raid = [open, closed].filter(Boolean).join(", ");
  if (raid) parts.push(`owns ${raid}`);
  if (e.changesRequested > 0) {
    parts.push(`requested ${e.changesRequested} change${e.changesRequested === 1 ? "" : "s"}`);
  }
  return parts.join("; ");
}
