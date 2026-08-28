import type { Workspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import { sanitizeSeedTask } from "./templates";
import type {
  ChangeItem,
  NoteLogEntry,
  RaidItem,
  Task,
  TaskDependency,
} from "./types";
import { resourceDisplayName } from "./resource-foundation";
import { mintIds, type MintKind } from "./id-mint-session";
import { sanitizeRichHtml } from "./sanitize-html";

export interface ApplyTemplateOptions {
  includeSeed: boolean;
}

/**
 * Build an old-id -> new-id map for one seed entity list. New ids are drawn from
 * the session-scoped minter for `kind`, so they clear both the target
 * workspace's existing rows AND any id already handed out this session — a
 * deleted max-id row is never reassigned. Each kind draws from its OWN counter
 * (cross-kind id overlap is fine — different arrays).
 */
function idMap(
  kind: MintKind,
  existing: ReadonlyArray<{ id: number }>,
  seed: ReadonlyArray<{ id: number }>,
): Map<number, number> {
  const map = new Map<number, number>();
  const newIds = mintIds(kind, existing, seed.length);
  seed.forEach((item, i) => map.set(item.id, newIds[i]));
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
 * ★★ `templates.ts` cannot run this allow-list. That module sits inside
 * `scripts/generate-sample-workspace.ts`'s import graph, whose DOM-free
 * contract (enforced by `rich-text-plain.test.ts`) bans the DOMPurify-bearing
 * modules — so a captured seed rich field only ever gets `sanitizeRichText`'s
 * upgrade there, never an allow-list pass. `template-apply.ts` sits outside
 * that graph, so the allow-list runs here, at apply time, on every seed row
 * regardless of whether it reached `applyTemplate` via the storage load path
 * (already run through `templates.ts`'s per-item sanitizers) or via a
 * same-session save-then-apply, where `templateFromWorkspace` puts live
 * entity objects into the seed BY REFERENCE and no sanitizer has touched them
 * yet (the same hazard `sanitizeSeedTask` below is already guarding against).
 *
 * ★★★ `sanitizeRichHtml` is the SAME 21-tag list `RICH_SINK` classifies
 * against (see the `description` comment in `sanitizeSeedTask`, `templates.ts`).
 * That agreement between classifier and sink is what makes this safe — NOT the
 * function's name. A narrower list here would destroy a captured heading that
 * the classifier had already accepted as live markup.
 */
function allowListNoteLog(noteLog: NoteLogEntry[] | undefined): NoteLogEntry[] | undefined {
  return noteLog?.map((n) => ({ ...n, html: sanitizeRichHtml(n.html) }));
}

/** Allow-lists the description + note-log rich fields every seed entity with a
 *  note log shares (Task, RaidItem, ChangeItem — see docs/AGENTS/rich-text.md). */
function allowListRich<T extends { description?: string; noteLog?: NoteLogEntry[] }>(
  row: T,
): T {
  return {
    ...row,
    ...(row.description ? { description: sanitizeRichHtml(row.description) } : {}),
    ...(row.noteLog ? { noteLog: allowListNoteLog(row.noteLog) } : {}),
  };
}

/** RAID carries a SECOND rich field (`mitigation`) the shared shape above
 *  doesn't cover — `allowListRich` handles `description` + `noteLog`, this
 *  layers `mitigation` on top rather than widening the generic helper for one
 *  caller. */
function allowListRaid(row: RaidItem): RaidItem {
  const base = allowListRich(row);
  return row.mitigation ? { ...base, mitigation: sanitizeRichHtml(row.mitigation) } : base;
}

/** Changes carry THREE rich fields beyond the note log — `description` (the
 *  shared helper), plus `impactDescription` and `resolutionNotes`. All three
 *  reach the seed unsanitised the same way: `sanitizeChangeItem` upgrades them
 *  through `sanitizeRichText` inside the DOM-free graph and cannot allow-list
 *  them, and a same-session `templateFromWorkspace` puts live rows in by
 *  reference so nothing has touched them at all.
 *  ★★ Miss one and it is silent — a `<script>` in `resolutionNotes` survives
 *  apply exactly as one in `description` would. */
function allowListChange(row: ChangeItem): ChangeItem {
  const base = allowListRich(row);
  return {
    ...base,
    ...(row.impactDescription
      ? { impactDescription: sanitizeRichHtml(row.impactDescription) }
      : {}),
    ...(row.resolutionNotes
      ? { resolutionNotes: sanitizeRichHtml(row.resolutionNotes) }
      : {}),
  };
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
  const taskMap = idMap("task", ws.tasks, seed.tasks ?? []);
  const milestoneMap = idMap("milestone", ws.milestones ?? [], seed.milestones ?? []);
  const raidMap = idMap("raid", ws.raid, seed.raid ?? []);
  const changeMap = idMap("change", ws.changes ?? [], seed.changes ?? []);
  const stakeholderMap = idMap("stakeholder", ws.stakeholders ?? [], seed.stakeholders ?? []);
  const budgetMap = idMap("budgetBucket", ws.budgets ?? [], seed.budgets ?? []);
  const resourceMap = idMap("resource", ws.resources ?? [], seed.resources ?? []);

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
  // ★★★ Sanitise the seed's tasks HERE, not in templateFromWorkspace.
  //   templateFromWorkspace puts live Task objects into the seed by reference,
  //   so a template saved and applied in one session used to bypass the
  //   sanitiser that the localStorage load path applies — one template, two
  //   behaviours, separated by a refresh (open-followups §228). Fixing it at
  //   SAVE would leave templates written by older builds unrepaired; apply is
  //   the only ingress into a workspace.
  // ★★ This does MORE than reconcile the status/completedDate pair.
  //   `sanitizeSeedTask` rebuilds a task from a fixed field list, so it also
  //   drops `inquiriesSent`, `jiraKey`, `jiraIssueType`, `lastSyncedAt`,
  //   `localModifiedAt`, `outlookEventId`, `healthOverride`, `knowledgeLinks`
  //   and `noteLog` outright. The captured `createdDate` is discarded too, but
  //   `migrateTask` backfills a replacement from `lastUpdateDate` — so the
  //   applied task still carries a `createdDate`, just not the one that was
  //   captured. The load path already dropped all ten; this makes the two
  //   agree. It also stops a per-row external link being CLONED — two local
  //   tasks pointing at one Jira issue is not a template.
  let seed = tpl.seed.tasks
    ? {
        ...tpl.seed,
        tasks: tpl.seed.tasks
          .map(sanitizeSeedTask)
          .filter((x): x is Task => x !== null)
          // ★★ The allow-list pass — see the docstring above `allowListRich`.
          .map(allowListRich),
      }
    : tpl.seed;
  // RAID has no equivalent single-item re-sanitizer exported from
  // `templates.ts` for `applyTemplate` to run here, so this only layers the
  // allow-list onto `description`/`mitigation`/`noteLog` — it does not
  // re-validate the rest of the row.
  if (seed.raid) {
    seed = { ...seed, raid: seed.raid.map(allowListRaid) };
  }
  if (seed.changes) {
    seed = { ...seed, changes: seed.changes.map(allowListChange) };
  }
  return appendSeed(base, remapSeed(ws, seed));
}
