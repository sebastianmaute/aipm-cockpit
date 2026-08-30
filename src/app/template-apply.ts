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
import { htmlPlainProjection, sanitizeRichText } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";
import { TEXTAREA_MAX } from "./sanitize";

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
/**
 * Allow-list ONE rich HTML field, then RE-APPLY THE EMPTY RULE. The only way
 * this file should reach `sanitizeRichHtml` — every rich-field site in the four
 * `allowList*` passes below routes through here.
 *
 * ★★★ THE SECOND PASS IS THE POINT, AND A BARE `sanitizeRichHtml` AT A NEW SITE
 * REINTRODUCES THE DEFECT IT CLOSES. The allow-list can EMPTY a value whose only
 * content was a disallowed element while leaving its wrapper standing:
 * `"<p><script>x</script></p>"` and `"<p><img src=a></p>"` both come out as
 * `"<p></p>"` — measured, not reasoned. `"<p></p>"` is TRUTHY, so it sails
 * through every `if (description)` gate downstream and is stored, exported and
 * indexed as content for a field that is in fact empty. `sanitizeRichText` drops
 * a visually-empty value, so re-running it turns the phantom back into `""`.
 *
 * ★★ This is `sanitizeAiRichText`'s (`ai-rich-text.ts`) trailing re-run, copied
 * deliberately — same defect, same repair, same two constants. `TEXTAREA_MAX`
 * and `RICH_SINK` are the SAME ones that boundary uses ON PURPOSE: both guard
 * the same rich entity fields on their way into the same six write paths, so
 * picking a different cap or sink here would let the two boundaries drift and
 * store bytes one of them would have refused. Do not "tidy" either into a local
 * constant.
 *
 * ★ Note what the re-run does NOT do: it is the empty rule and the cap, not a
 * second allow-list, and it cannot recognise less than the pass above it keeps
 * (`isHtmlStart(value, "rich")` derives its test from the same
 * `RICH_ALLOWED_TAGS` list `sanitizeRichHtml` enforces).
 */
function allowListField(html: string): string {
  return sanitizeRichText(sanitizeRichHtml(html), TEXTAREA_MAX, RICH_SINK);
}

function allowListNoteLog(noteLog: NoteLogEntry[] | undefined): NoteLogEntry[] | undefined {
  // ★★ `text` MUST be re-derived, not carried. The allow-list can remove markup
  // whose inner text the projection had already captured — `<p>ok</p><script>
  // alert(1)</script>` projects to "ok alert(1)", and keeping that beside an
  // allow-listed `<p>ok</p>` stores a `text` that describes markup no longer
  // present. `NoteLogEntry.text` feeds CSV/MD export, `cellText`, DOCX and
  // search, so the stale projection is what a reader actually sees.
  // ★ Same rule `sanitizeSeedNoteLog` states on the way in: the html is the
  // source of truth and `text` is derived from it, at every boundary that
  // rewrites the html.
  return noteLog?.map((n) => {
    const html = allowListField(n.html);
    return { ...n, html, text: htmlPlainProjection(html) };
  });
}

/** Allow-lists the description + note-log rich fields every seed entity with a
 *  note log shares (Task, RaidItem, ChangeItem — see docs/AGENTS/rich-text.md). */
function allowListRich<T extends { description?: string; noteLog?: NoteLogEntry[] }>(
  row: T,
): T {
  return {
    ...row,
    ...(row.description ? { description: allowListField(row.description) } : {}),
    ...(row.noteLog ? { noteLog: allowListNoteLog(row.noteLog) } : {}),
  };
}

/** RAID carries a SECOND rich field (`mitigation`) the shared shape above
 *  doesn't cover — `allowListRich` handles `description` + `noteLog`, this
 *  layers `mitigation` on top rather than widening the generic helper for one
 *  caller. */
function allowListRaid(row: RaidItem): RaidItem {
  const base = allowListRich(row);
  return row.mitigation ? { ...base, mitigation: allowListField(row.mitigation) } : base;
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
      ? { impactDescription: allowListField(row.impactDescription) }
      : {}),
    ...(row.resolutionNotes
      ? { resolutionNotes: allowListField(row.resolutionNotes) }
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

/** The four allow-list passes, applied to a whole seed. Tasks and milestones
 *  share `allowListRich` (description + note log); RAID adds `mitigation` and
 *  changes add `impactDescription` + `resolutionNotes`.
 *  ★ Stakeholders, budgets and resources carry no rich HTML field, so they are
 *  deliberately absent rather than overlooked — `Stakeholder.notes` and
 *  `Resource.notes` (`types.ts`) are plain free text and `BudgetBucket` has no
 *  notes field at all. `AI_RICH_FIELDS` in `ai-rich-text.ts` corroborates from
 *  the other direction: it names the entities that DO carry a rich field
 *  outside a note log — raid, change, milestone (`Task.description` is handled
 *  separately, via `sanitizeAiRichText` directly, so it is not a fourth key
 *  there) — and none of the three absentees here is among them. */
function allowListSeed(seed: TemplateSeed): TemplateSeed {
  let out = seed;
  if (out.tasks) out = { ...out, tasks: out.tasks.map(allowListRich) };
  // RAID has no equivalent single-item re-sanitizer exported from
  // `templates.ts` for this to run alongside, so this only layers the
  // allow-list onto `description`/`mitigation`/`noteLog` — it does not
  // re-validate the rest of the row.
  if (out.raid) out = { ...out, raid: out.raid.map(allowListRaid) };
  if (out.changes) out = { ...out, changes: out.changes.map(allowListChange) };
  // ★★ Milestones carry NO note log but DO carry a rich `description` —
  // `sanitizeMilestone` upgrades it through the same `sanitizeRichText`/
  // `RICH_SINK` pair inside the DOM-free graph and cannot allow-list it, so it
  // is the fourth seeded ENTITY and belongs here exactly as the other three do.
  // ★ ENTITY, not field — it is the tenth allow-listed rich FIELD (and the
  // seventh that is not a note log). The two counts differ because three
  // entities carry more than one rich field each, and an earlier revision of
  // this line said "fourth seeded rich field", which contradicts §36(a)'s
  // table. It was missed on the first cut because the scope was framed as "the
  // note-log entities", which is a property of the CARRY (§168) and not of
  // this allow-list — the two have different footprints and the entity list
  // must be derived from "what is rich", never from "what has a note log".
  if (out.milestones) out = { ...out, milestones: out.milestones.map(allowListRich) };
  return out;
}

/** ★★★ THE ALLOW-LIST RUNS HERE, not in `applyTemplate`, and that placement is
 *  the whole of open-followups §288. `applyTemplate` and the AI-seed branch of
 *  `buildNewProjectWorkspace` end in the IDENTICAL `appendSeed(…, remapSeed(…))`
 *  tail; the four passes used to sit above only the template one, so a seed the
 *  model produced reached a workspace with no allow-list pass at all.
 *  ★★ Fixing it at the PRODUCER (`proposalToSeed`) was rejected for the reason
 *  the §228 comment in this same file already gives about fixing at save: apply
 *  is the only ingress into a workspace, so a producer-side fix leaves every
 *  other seed source — including one added tomorrow — unprotected.
 *  ★★ The passes are IDEMPOTENT and must stay so: an AI task already met
 *  `sanitizeAiRichText` in `buildSeedTask` and now meets `allowListRich` too.
 *  `allowListNoteLog` re-derives `text` from the html at every boundary, so it
 *  is idempotent by construction; `sanitizeRichHtml` is idempotent under its
 *  default configuration — but read that pin's SCOPE before leaning on it:
 *  `sanitize-html.test.ts`'s "is idempotent on already-clean html" covers
 *  exactly the second-application case this relies on, and nothing wider.
 *  ★ `allowListField`'s trailing `sanitizeRichText` re-run inherits the same
 *  qualification: `rich-text-plain.test.ts`'s "is idempotent — it runs on every
 *  load" pins `descriptionHtml` over four inputs, which is the upgrade half; the
 *  cap and the empty rule are idempotent by construction (a value already at or
 *  under the cap is unchanged, and `""` stays `""`), and nothing pins the
 *  composed function end to end. */
export function appendSeed(ws: Workspace, seed: TemplateSeed): Workspace {
  const allowed = allowListSeed(seed);
  return {
    ...ws,
    tasks: allowed.tasks ? [...ws.tasks, ...allowed.tasks] : ws.tasks,
    milestones: allowed.milestones
      ? [...(ws.milestones ?? []), ...allowed.milestones]
      : ws.milestones,
    raid: allowed.raid ? [...ws.raid, ...allowed.raid] : ws.raid,
    changes: allowed.changes
      ? [...(ws.changes ?? []), ...allowed.changes]
      : ws.changes,
    stakeholders: allowed.stakeholders
      ? [...(ws.stakeholders ?? []), ...allowed.stakeholders]
      : ws.stakeholders,
    budgets: allowed.budgets ? [...(ws.budgets ?? []), ...allowed.budgets] : ws.budgets,
    resources: allowed.resources ? [...(ws.resources ?? []), ...allowed.resources] : ws.resources,
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
  //   `localModifiedAt`, `outlookEventId`, `healthOverride` and
  //   `knowledgeLinks` outright. The captured `createdDate` is discarded too, but
  //   `migrateTask` backfills a replacement from `lastUpdateDate` — so the
  //   applied task still carries a `createdDate`, just not the one that was
  //   captured. ★★ NINE, NOT TEN, AND `noteLog` IS NO LONGER AMONG THEM — it is
  //   CARRIED as of §168, and allow-listed inside `appendSeed` (§288 moved the
  //   pass there from this function — see `allowListSeed`'s docstring above).
  //   Leaving it on this list contradicted the `allowListRich` docstring.
  //   The load path already dropped all nine; this makes the two
  //   agree. It also stops a per-row external link being CLONED — two local
  //   tasks pointing at one Jira issue is not a template.
  const seed = tpl.seed.tasks
    ? {
        ...tpl.seed,
        tasks: tpl.seed.tasks
          .map(sanitizeSeedTask)
          .filter((x): x is Task => x !== null),
      }
    : tpl.seed;
  return appendSeed(base, remapSeed(ws, seed));
}
