// src/app/scale-workspace.ts
//
// Pure sample-data multiplier: replicate every entity `factor` times with a
// fixed per-replica id offset and a full FK remap, so big/huge demo datasets
// keep referential integrity (no dangling refs, globally-unique ids).
//
// All workspace entity ids are 1-based numbers (see `nextId` in
// resource-foundation.ts). For replica k (0-based), every id and every FK is
// shifted by `k * OFFSET`. Replica 0 reuses the originals verbatim so the first
// copy stays byte-identical to the input. Within a replica, FKs only ever point
// at that replica's own rows (offset is applied to both the id and the FK), so
// the link structure is duplicated rather than entangled across replicas.
//
// Singletons (plan, status, project, fxRates, fieldVisibility, features,
// reference lists like disciplines/grades/roles/resources) are NOT replicated —
// only the per-row "content" entities are. Reference-data ids therefore keep
// their original values, and content FKs into them (Task.resourceId,
// Role.disciplineId, …) are NOT offset.

import type { Workspace } from "./workspace";
import type {
  Absence,
  BudgetBucket,
  BucketAllocation,
  ChangeItem,
  DisciplineAllocation,
  Milestone,
  RaidItem,
  Shift,
  Stakeholder,
  Task,
  TaskDependency,
} from "./types";

/** Per-replica id stride. Sample ids are 1-based and far below this, so
 *  `id + k*OFFSET` stays unique and never collides across replicas. */
export const OFFSET = 100000;

/** Shift a scalar id by `offset`. */
function bump(id: number, offset: number): number {
  return id + offset;
}

/** Shift a nullable scalar FK by `offset` (null/undefined pass through). */
function bumpNullable(
  id: number | null | undefined,
  offset: number,
): number | null | undefined {
  return id == null ? id : id + offset;
}

/** Shift every element of an id-array FK by `offset`. */
function bumpArray(ids: readonly number[], offset: number): number[] {
  return ids.map((id) => id + offset);
}

// Replicas must read like a genuinely larger dataset, not the same rows with a
// "(2)" tacked on. Work-item titles get a distinct WORKSTREAM qualifier per
// replica; stakeholders (people) get distinct names from first/last pools. Both
// are deterministic functions of (replica, original id) so regeneration is
// stable. Replica 0 is always pristine (byte-identical to the input).

/** Workstream qualifiers for replica titles. Length covers huge (10×) — replicas
 *  1..9 each get a distinct word; beyond that it cycles. */
const WORKSTREAMS = [
  "Payments",
  "Mobile App",
  "Data Migration",
  "Partner API",
  "Compliance",
  "Analytics",
  "Infrastructure",
  "Support Portal",
  "Reporting",
  "Onboarding",
  "Billing",
  "Field Services",
] as const;

/** Distinct given/family name pools (20×20 = 400 combos) for replica people. */
const FIRST_NAMES = [
  "Liam", "Noah", "Olivia", "Emma", "Sofia", "Mateo", "Yuki", "Priya",
  "Omar", "Nina", "Lucas", "Maya", "Diego", "Aisha", "Felix", "Zoe",
  "Ravi", "Clara", "Ivan", "Leila",
] as const;
const LAST_NAMES = [
  "Andersen", "Bianchi", "Costa", "Dubois", "Eriksson", "Ferraro", "Gupta",
  "Haddad", "Ibrahim", "Jensen", "Kovac", "Lindqvist", "Moreau", "Novak",
  "Oliveira", "Petrov", "Rossi", "Silva", "Tanaka", "Varga",
] as const;

/** Replica title: original for replica 0, else `<title> — <workstream>`. */
function qualifyTitle(title: string, replica: number): string {
  if (replica === 0) return title;
  return `${title} — ${WORKSTREAMS[(replica - 1) % WORKSTREAMS.length]}`;
}

/** Deterministic distinct person name for a replica (>=1) keyed by entity id.
 *  Coprime strides spread the (replica, seed) space across the pools. */
function variedPersonName(replica: number, seed: number): string {
  const first = FIRST_NAMES[(seed * 31 + replica * 7) % FIRST_NAMES.length];
  const last = LAST_NAMES[(seed * 17 + replica * 23) % LAST_NAMES.length];
  return `${first} ${last}`;
}

// --- per-entity remap functions -------------------------------------------
// One explicit function per entity so a newly-added id/FK field is an obvious
// omission here rather than a silently-dropped reference at runtime.

function remapTask(t: Task, offset: number, replica: number): Task {
  const deps: TaskDependency[] | undefined = t.dependencies?.map((d) => ({
    ...d,
    taskId: bump(d.taskId, offset),
  }));
  return {
    ...t,
    id: bump(t.id, offset),
    taskName: qualifyTitle(t.taskName, replica),
    // resourceId -> Resource (reference data, not replicated): leave as-is.
    ...(deps ? { dependencies: deps } : {}),
  };
}

function remapRaid(r: RaidItem, offset: number, replica: number): RaidItem {
  return {
    ...r,
    id: bump(r.id, offset),
    title: qualifyTitle(r.title, replica),
    linkedTaskIds: bumpArray(r.linkedTaskIds, offset),
    causedByRaidIds: bumpArray(r.causedByRaidIds, offset),
    stakeholderIds: bumpArray(r.stakeholderIds, offset),
    // ownerResourceId -> Resource (reference data): leave as-is.
  };
}

function remapMilestone(m: Milestone, offset: number, replica: number): Milestone {
  return {
    ...m,
    id: bump(m.id, offset),
    name: qualifyTitle(m.name, replica),
    linkedTaskIds: bumpArray(m.linkedTaskIds, offset),
  };
}

function remapChange(c: ChangeItem, offset: number, replica: number): ChangeItem {
  return {
    ...c,
    id: bump(c.id, offset),
    title: qualifyTitle(c.title, replica),
    linkedTaskIds: bumpArray(c.linkedTaskIds, offset),
    linkedRaidIds: bumpArray(c.linkedRaidIds, offset),
    stakeholderIds: bumpArray(c.stakeholderIds, offset),
  };
}

function remapStakeholder(
  s: Stakeholder,
  offset: number,
  replica: number,
): Stakeholder {
  // raci is keyed by milestone id (string) -> remap each key by the offset.
  const raci: Record<string, (typeof s.raci)[string]> = {};
  for (const [mid, role] of Object.entries(s.raci ?? {})) {
    const n = Number(mid);
    // Guard against a non-numeric RACI key (would become "NaN" and orphan the entry).
    raci[Number.isFinite(n) ? String(bump(n, offset)) : mid] = role;
  }
  return {
    ...s,
    id: bump(s.id, offset),
    // Replicas are DISTINCT people, not "Name (2)". Replica 0 stays pristine.
    name: replica === 0 ? s.name : variedPersonName(replica, s.id),
    // A replica's distinct name no longer matches the resource it was linked to
    // (resources are shared reference data, not replicated), so drop the link —
    // the renamed replica stakeholder stands alone. Replica 0 keeps its link.
    ...(replica === 0 ? {} : { resourceId: undefined }),
    raci,
  };
}

function remapAbsence(a: Absence, offset: number): Absence {
  // Only id is a content id; resourceId -> Resource (reference data): leave.
  return { ...a, id: bump(a.id, offset) };
}

function remapShift(sh: Shift, offset: number): Shift {
  // Only id is a content id; resourceId -> Resource (reference data): leave.
  return { ...sh, id: bump(sh.id, offset) };
}

function remapBucketAllocation(a: BucketAllocation): BucketAllocation {
  // roleId/resourceIds -> reference data (roles/resources): not replicated,
  // so they are NOT offset. Returned as a fresh object for immutability.
  return { ...a };
}

function remapDisciplineAllocation(a: DisciplineAllocation): DisciplineAllocation {
  // disciplineId/resourceIds -> reference data: not offset.
  return { ...a };
}

function remapBudget(b: BudgetBucket, offset: number, replica: number): BudgetBucket {
  return {
    ...b,
    id: bump(b.id, offset),
    name: qualifyTitle(b.name, replica),
    successorId: bumpNullable(b.successorId, offset),
    allocations: b.allocations.map(remapBucketAllocation),
    ...(b.disciplineAllocations
      ? { disciplineAllocations: b.disciplineAllocations.map(remapDisciplineAllocation) }
      : {}),
    // taskIds -> Task (a replicated content entity, not reference data): each
    // replica's tasks are replicated with the SAME per-replica `offset` this
    // function receives (both loops share the same k in `replicate`), so
    // bumping by it keeps the link pointed at this replica's own tasks.
    // percentComplete is a scalar (manual override) and needs no remap — it
    // rides through unchanged via the `...b` spread above.
    ...(b.taskIds ? { taskIds: bumpArray(b.taskIds, offset) } : {}),
  };
}

/** Replicate one content array `factor` times, offsetting each replica. */
function replicate<T>(
  items: ReadonlyArray<T>,
  factor: number,
  remap: (item: T, offset: number, replica: number) => T,
): T[] {
  const out: T[] = [];
  for (let k = 0; k < factor; k += 1) {
    const offset = k * OFFSET;
    for (const item of items) {
      out.push(remap(item, offset, k));
    }
  }
  return out;
}

/** Guard the id-offset invariant: every original entity id must be `< OFFSET`,
 *  else replica k=0 and k=1 produce colliding ids and references cross replicas. */
function assertIdsBelowOffset(ws: Workspace): void {
  const ids = [
    ...ws.tasks,
    ...ws.raid,
    ...(ws.milestones ?? []),
    ...(ws.changes ?? []),
    ...(ws.stakeholders ?? []),
    ...ws.absences,
    ...ws.shifts,
    ...(ws.budgets ?? []),
  ].map((e) => e.id);
  const max = ids.length ? Math.max(...ids) : 0;
  if (max >= OFFSET) {
    throw new Error(
      `scaleWorkspace: entity ids must be < OFFSET (${OFFSET}) to avoid cross-replica collisions; found ${max}`,
    );
  }
}

/**
 * Replicate every per-row content entity `factor` times with an id offset and a
 * full FK remap. Reference data (resources/roles/disciplines/grades) and
 * singletons (plan/status/project/fxRates/fieldVisibility/features) are kept as
 * the first copy only. `factor <= 1` returns a structural clone with unchanged
 * counts. Pure — never mutates the input.
 */
export function scaleWorkspace(ws: Workspace, factor: number): Workspace {
  const n = Math.max(1, Math.floor(factor));
  if (n > 1) assertIdsBelowOffset(ws);

  return {
    ...ws,
    // --- replicated content entities -------------------------------------
    tasks: replicate(ws.tasks, n, remapTask),
    raid: replicate(ws.raid, n, remapRaid),
    milestones: replicate(ws.milestones ?? [], n, remapMilestone),
    changes: replicate(ws.changes ?? [], n, remapChange),
    stakeholders: replicate(ws.stakeholders ?? [], n, remapStakeholder),
    absences: replicate(ws.absences, n, remapAbsence),
    shifts: replicate(ws.shifts, n, remapShift),
    budgets: replicate(ws.budgets ?? [], n, remapBudget),
    // --- reference data + singletons: first copy only --------------------
    // resources, roles, disciplines, grades, plan, status, fxRates, project,
    // fieldVisibility, features all carry over unchanged via the spread above.
    // ★ documents too, and deliberately NOT replicated: a document is authored
    // narrative about the project as a whole, so 3x/10x copies of the same
    // "Steering update" would be noise, and its dataSection blocks re-render
    // against the scaled data anyway. Measured: seeding one document grows
    // -big and -huge by the SAME 1140 bytes, which is the no-replication proof.
  };
}
