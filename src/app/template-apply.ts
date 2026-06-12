import type { Workspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { TaskDependency } from "./types";
import { nextId } from "./resource-foundation";

export interface ApplyTemplateOptions {
  includeSeed: boolean;
}

/**
 * Build an old-id -> new-id map for one seed entity list. New ids start at the
 * target workspace's `nextId` and increment, so seed content never collides
 * with existing rows.
 */
function idMap(
  existing: ReadonlyArray<{ id: number }>,
  seed: ReadonlyArray<{ id: number }>,
): Map<number, number> {
  const map = new Map<number, number>();
  let next = nextId(existing);
  for (const item of seed) {
    map.set(item.id, next);
    next += 1;
  }
  return map;
}

/** Remap a list of ids through `map`, dropping any that point outside the seed. */
function remapIds(
  ids: readonly number[] | undefined,
  map: Map<number, number>,
): number[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => map.get(id))
    .filter((id): id is number => id !== undefined);
}

/** Remap task dependencies, dropping deps whose predecessor is not in the seed. */
function remapDeps(
  deps: readonly TaskDependency[] | undefined,
  map: Map<number, number>,
): TaskDependency[] {
  if (!Array.isArray(deps)) return [];
  return deps
    .map((d) => {
      const t = map.get(d.taskId);
      return t !== undefined ? { ...d, taskId: t } : null;
    })
    .filter((d): d is TaskDependency => d !== null);
}

/**
 * Re-id a template seed relative to a target workspace and rewrite every
 * internal reference. References that point outside the seed are dropped;
 * person FKs (resource owners) are cleared since resources are not seeded.
 * Pure — returns a new seed, never mutates the input.
 */
export function remapSeed(ws: Workspace, seed: TemplateSeed): TemplateSeed {
  const taskMap = idMap(ws.tasks, seed.tasks ?? []);
  const milestoneMap = idMap(ws.milestones ?? [], seed.milestones ?? []);
  const raidMap = idMap(ws.raid, seed.raid ?? []);
  const changeMap = idMap(ws.changes ?? [], seed.changes ?? []);
  const stakeholderMap = idMap(ws.stakeholders ?? [], seed.stakeholders ?? []);
  const budgetMap = idMap(ws.budgets ?? [], seed.budgets ?? []);

  const out: TemplateSeed = {};
  if (seed.tasks) {
    out.tasks = seed.tasks.map((t) => ({
      ...t,
      id: taskMap.get(t.id)!,
      ...(t.dependencies
        ? { dependencies: remapDeps(t.dependencies, taskMap) }
        : {}),
    }));
  }
  if (seed.milestones) {
    out.milestones = seed.milestones.map((m) => ({
      ...m,
      id: milestoneMap.get(m.id)!,
      linkedTaskIds: remapIds(m.linkedTaskIds, taskMap),
    }));
  }
  if (seed.raid) {
    out.raid = seed.raid.map((r) => ({
      ...r,
      id: raidMap.get(r.id)!,
      linkedTaskIds: remapIds(r.linkedTaskIds, taskMap),
      causedByRaidIds: remapIds(r.causedByRaidIds, raidMap),
      stakeholderIds: remapIds(r.stakeholderIds, stakeholderMap),
      ownerResourceId: null,
    }));
  }
  if (seed.changes) {
    out.changes = seed.changes.map((c) => ({
      ...c,
      id: changeMap.get(c.id)!,
      linkedTaskIds: remapIds(c.linkedTaskIds, taskMap),
      linkedRaidIds: remapIds(c.linkedRaidIds, raidMap),
      stakeholderIds: remapIds(c.stakeholderIds, stakeholderMap),
    }));
  }
  if (seed.stakeholders) {
    out.stakeholders = seed.stakeholders.map((s) => {
      const raci: typeof s.raci = {};
      for (const [mid, role] of Object.entries(s.raci ?? {})) {
        const n = milestoneMap.get(Number(mid));
        if (n !== undefined) raci[String(n)] = role;
      }
      return { ...s, id: stakeholderMap.get(s.id)!, resourceId: null, raci };
    });
  }
  if (seed.budgets) {
    out.budgets = seed.budgets.map((b) => ({
      ...b,
      id: budgetMap.get(b.id)!,
      successorId:
        b.successorId != null
          ? (budgetMap.get(b.successorId) ?? null)
          : (b.successorId ?? null),
    }));
  }
  return out;
}

/**
 * Apply a template to a workspace: replace field-visibility wholesale and,
 * when `includeSeed` is set, append the re-ided seed content non-destructively
 * (existing rows are kept; seed rows get fresh ids and valid internal refs).
 * Feature toggles are NOT applied here. Pure — never mutates the input.
 */
export function applyTemplate(
  ws: Workspace,
  tpl: ProjectTemplate,
  opts: ApplyTemplateOptions,
): Workspace {
  const base: Workspace = { ...ws, fieldVisibility: tpl.fieldVisibility };
  if (!opts.includeSeed || !tpl.seed) return base;
  const seed = remapSeed(ws, tpl.seed);
  return {
    ...base,
    tasks: seed.tasks ? [...ws.tasks, ...seed.tasks] : ws.tasks,
    milestones: seed.milestones
      ? [...(ws.milestones ?? []), ...seed.milestones]
      : ws.milestones,
    raid: seed.raid ? [...ws.raid, ...seed.raid] : ws.raid,
    changes: seed.changes
      ? [...(ws.changes ?? []), ...seed.changes]
      : ws.changes,
    stakeholders: seed.stakeholders
      ? [...(ws.stakeholders ?? []), ...seed.stakeholders]
      : ws.stakeholders,
    budgets: seed.budgets ? [...(ws.budgets ?? []), ...seed.budgets] : ws.budgets,
  };
}
