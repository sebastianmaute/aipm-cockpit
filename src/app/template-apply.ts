import type { Workspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { TaskDependency } from "./types";
import { nextId, resourceDisplayName } from "./resource-foundation";

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
 * internal reference. References that point outside the seed are dropped.
 * When the seed carries resources, task/RAID owners and stakeholder links are
 * re-linked to them by case-folded name (or email); otherwise those person FKs
 * are cleared (no directory to point at).
 * Pure — returns a new seed, never mutates the input.
 */
export function remapSeed(ws: Workspace, seed: TemplateSeed): TemplateSeed {
  const taskMap = idMap(ws.tasks, seed.tasks ?? []);
  const milestoneMap = idMap(ws.milestones ?? [], seed.milestones ?? []);
  const raidMap = idMap(ws.raid, seed.raid ?? []);
  const changeMap = idMap(ws.changes ?? [], seed.changes ?? []);
  const stakeholderMap = idMap(ws.stakeholders ?? [], seed.stakeholders ?? []);
  const budgetMap = idMap(ws.budgets ?? [], seed.budgets ?? []);
  const resourceMap = idMap(ws.resources ?? [], seed.resources ?? []);

  // Re-id seeded resources, then index them by case-folded name/email so the
  // model's plain-string task assignees / RAID owners / stakeholders resolve to
  // a real directory entry instead of staying unlinked.
  const remappedResources = (seed.resources ?? []).map((r) => ({
    ...r,
    id: resourceMap.get(r.id)!,
  }));
  // First-wins on a duplicate name/email so linking is deterministic (declaration
  // order) rather than silently binding owners to the last same-named seed.
  const resByName = new Map<string, number>();
  const resByEmail = new Map<string, number>();
  for (const r of remappedResources) {
    const nm = resourceDisplayName(r).trim().toLowerCase();
    if (nm && !resByName.has(nm)) resByName.set(nm, r.id);
    const em = (r.email ?? "").trim().toLowerCase();
    if (em && !resByEmail.has(em)) resByEmail.set(em, r.id);
  }
  const linkResource = (name?: string, email?: string): number | undefined => {
    const e = (email ?? "").trim().toLowerCase();
    if (e && resByEmail.has(e)) return resByEmail.get(e);
    const n = (name ?? "").trim().toLowerCase();
    return n ? resByName.get(n) : undefined;
  };

  const out: TemplateSeed = {};
  if (seed.resources) out.resources = remappedResources;
  if (seed.tasks) {
    out.tasks = seed.tasks.map((t) => ({
      ...t,
      id: taskMap.get(t.id)!,
      resourceId: linkResource(t.assignee, t.assigneeEmail),
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
      ownerResourceId: linkResource(r.owner, r.ownerEmail) ?? null,
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
      return { ...s, id: stakeholderMap.get(s.id)!, resourceId: linkResource(s.name, s.email) ?? null, raci };
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

/** Append an already-remapped seed onto a workspace, non-destructively. Pure. */
export function appendSeed(ws: Workspace, seed: TemplateSeed): Workspace {
  return {
    ...ws,
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
    resources: seed.resources ? [...(ws.resources ?? []), ...seed.resources] : ws.resources,
  };
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
  return appendSeed(base, remapSeed(ws, tpl.seed));
}
