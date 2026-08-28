import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import { migrateTask, reconcileStatusFromDate } from "./task-status";
import type { Workspace } from "./workspace";
import {
  sanitizeFieldVisibility,
  type FieldVisibilityConfig,
} from "./field-visibility";
import {
  fkIdOrUndefined,
  isPlainObject,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeBudgetBucket,
  sanitizeChangeItem,
  sanitizeEmail,
  sanitizeIdList,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeMilestone,
  sanitizeOptionalMinutes,
  sanitizePriority,
  sanitizeStakeholder,
  sanitizeTaskName,
  TEXTAREA_MAX,
} from "./sanitize";
import { htmlPlainProjection, sanitizeRichText } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";
import {
  DEPENDENCY_TYPES,
  RAID_CATEGORIES,
  type BudgetBucket,
  type ChangeItem,
  type DependencyType,
  type Milestone,
  type NoteLogEntry,
  type RaidCategory,
  type RaidItem,
  type RaidStatus,
  type Resource,
  type Stakeholder,
  type Task,
  type TaskDependency,
} from "./types";

/**
 * Seed content a template can stamp into a new project. Each entity list is
 * sanitized identically to how the workspace loader validates persisted data,
 * so a malformed template can never inject an entity shape the rest of the app
 * wouldn't accept.
 */
export interface TemplateSeed {
  tasks?: readonly Task[];
  milestones?: readonly Milestone[];
  raid?: readonly RaidItem[];
  changes?: readonly ChangeItem[];
  stakeholders?: readonly Stakeholder[];
  budgets?: readonly BudgetBucket[];
  resources?: readonly Resource[];
}

/**
 * A reusable project template: a named bundle of feature-module toggles, a
 * field-visibility config, and optional seed content. `builtIn` is only ever
 * set on in-code library templates — it is never honored from stored data.
 */
export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  features: readonly FeatureModuleId[];
  fieldVisibility: FieldVisibilityConfig;
  seed?: TemplateSeed;
}

function nonEmptyStr(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x.trim() : null;
}

function sanitizeArr<T>(
  raw: unknown,
  fn: (x: unknown) => T | null,
): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map(fn).filter((x): x is T => x !== null);
  return out.length ? out : undefined;
}

const RAID_CATEGORY_SET = new Set<RaidCategory>(RAID_CATEGORIES);

const RAID_STATUS_SET = new Set<RaidStatus>([
  "Open",
  "Mitigated",
  "Realized",
  "Closed",
  "Pending",
  "Validated",
  "Invalidated",
  "In Progress",
  "Resolved",
  "Delivered",
  "Blocked",
]);

const RISK_SCALES = new Set([1, 2, 3, 4, 5]);

/**
 * The DOM-free seed carry for a captured note log.
 *
 * ★★ Same posture as `description` below — `sanitizeRichText` against
 * `RICH_SINK`, no DOMPurify pass. This file is in the sample generator's import
 * graph, and its DOM-free contract is deliberate; the allow-list runs at APPLY
 * time in `template-apply.ts`, which is outside that graph.
 *
 * ★★★ DO NOT "fix" this by re-attaching the captured log after sanitizing. That
 * stores it un-sanitised. The whole point of the carry is that every entry goes
 * through the same boundary the description does.
 *
 * ★ `text` is DERIVED, never carried. A captured projection can disagree with
 * its html — a hand-edited template, or a sink change since capture — and the
 * html is the source of truth.
 */
function sanitizeSeedNoteLog(raw: unknown): NoteLogEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NoteLogEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const id = fkIdOrUndefined(item.id);
    if (id === undefined) continue;
    const timestamp = nonEmptyStr(item.timestamp);
    if (!timestamp) continue;
    const html = sanitizeRichText(item.html, TEXTAREA_MAX, RICH_SINK);
    const entry: NoteLogEntry = { id, timestamp, html, text: htmlPlainProjection(html) };
    const authorResourceId = fkIdOrUndefined(item.authorResourceId);
    if (authorResourceId !== undefined) entry.authorResourceId = authorResourceId;
    const authorName = nonEmptyStr(item.authorName);
    if (authorName) entry.authorName = authorName;
    const editedAt = nonEmptyStr(item.editedAt);
    if (editedAt) entry.editedAt = editedAt;
    out.push(entry);
  }
  return out.length ? out : undefined;
}

/**
 * Minimal single-item Task sanitizer for template seed content. The workspace
 * loader (`jsonToWorkspace`) casts the `tasks` array raw, so there is no
 * canonical per-item Task sanitizer to reuse; this validates the required
 * `{ id > 0, taskName }` shape and passes every other field through the
 * existing field sanitizers. Returns null for anything malformed.
 */
/** ★ Exported for `template-apply.ts`, so the in-session APPLY path sanitises
 *  through the SAME function as the localStorage LOAD path. Two sanitisers
 *  would drift; one cannot (open-followups §228). */
export function sanitizeSeedTask(raw: unknown): Task | null {
  if (!isPlainObject(raw)) return null;
  const id = fkIdOrUndefined(raw.id);
  if (id === undefined) return null;
  const taskName = sanitizeTaskName(raw.taskName);
  if (!taskName) return null;
  const task: Task = {
    id,
    taskName,
    assignee: sanitizeAssignee(raw.assignee),
    assigneeEmail: sanitizeEmail(raw.assigneeEmail),
    dueDate: sanitizeIsoDate(raw.dueDate),
    lastUpdateDate: sanitizeIsoDate(raw.lastUpdateDate),
    priority: sanitizePriority(raw.priority),
    status: raw.status as Task["status"],
    blockers: sanitizeBlockers(raw.blockers),
    // ★★★ `description` FIRST, `notes` only as the pre-0.196.0 fallback. Reading
    // `raw.notes` alone was silent DATA LOSS: templateFromWorkspace captures real
    // Task objects (`seed.tasks = ws.tasks`) and a Task has carried `description`
    // since the rename, so every captured task description imported as "".
    // ★ sanitizeRichText, not plainToHtml — the captured value is HTML and
    // plainToHtml would escape it into visible tags (AGENTS.md, rich-text bullet).
    // ★★★ And NOT `sanitizeAiRichText`, however much this looks like the same
    // boundary: THIS FILE IS IN `scripts/generate-sample-workspace.ts`'s import
    // graph, and the seed sanitizers are that graph's DOM-free layer by contract.
    // ★★ Enforced by `keeps the DOMPurify-bearing sanitiser out of templates.ts
    // specifically` in rich-text-plain.test.ts — NOT by the graph-wide sweep
    // beside it, whose predicate names only rich-text-projection and
    // ai-rich-text. That sweep passed green on a `./sanitize-html` import here
    // (measured 2026-08-28), and three comments claimed otherwise.
    // ★★★ THE REASON IS THE CONTRACT AND THE GUARD, NOT "it would throw under
    // bare node" — that rationale is FALSE and this comment used to assert it.
    // Measured 2026-08-28: the generator installs JSDOM globals BEFORE its
    // dynamic `await import("../src/app/storage")`, so a DOMPurify call
    // downstream has a DOM; and sanitize-html.ts — which imports dompurify — is
    // ALREADY in that 92-file graph, via html-start.ts and again via
    // note-log.ts. Neither leg survives. See open-followups.md §151.
    // ★★ The allow-list DOES run, just not here: `template-apply.ts` is outside
    // the graph and allow-lists every rich field on all three note-log entities
    // at apply time (§36(a)). Do not read this DOM-free posture as "the seed is
    // never allow-listed".
    // ★★ `||`, not `??`: a template carrying `description: ""` alongside a legacy
    // `notes` must fall back to the notes, and `??` only catches null/undefined.
    // ★★ The sink is the DESTINATION field's, never this file's. The value lands
    // in `Task.description`, whose human save AND whose whole-object load
    // normalizer (`sanitizeRichFields`, note-log.ts) both run `sanitizeRichHtml`
    // — the same 21-tag list "rich" classifies against, so classifier and sink
    // agree by construction and a captured heading survives as live markup.
    // ★★★ THAT AGREEMENT IS WHAT MAKES IT SAFE, NOT THE SINK NAME. Until §137
    // closed, both of those ran `sanitizeNoteHtml` — 8 tags at KEEP_CONTENT:
    // false, which deleted an unlisted element TOGETHER WITH its text — and the
    // right answer here was to classify NARROWLY so the value stored ESCAPED and
    // had no live element to delete. Measured 2026-08-10, on
    // "<h2>Plan</h2><p>steps</p>" captured by templateFromWorkspace:
    //   "template" stored: "<h2>Plan</h2><p>steps</p>" -> human Save: "<p>steps</p>"
    //                                                     "Plan" GONE, no undo
    //   "note"     stored: escaped markup               -> human Save: unchanged
    // Re-measured 2026-08-11 with one sanitizer: stored "<h2>Plan</h2><p>steps</p>"
    // -> human Save BYTE-IDENTICAL. The heading is now kept as a heading rather
    // than preserved as escaped text. Do not "restore" a narrower sink here — a
    // classifier narrower than its sink escapes the whole value (§107).
    description: sanitizeRichText(raw.description || raw.notes, TEXTAREA_MAX, RICH_SINK),
  };
  const startDate = sanitizeIsoDate(raw.startDate);
  if (startDate) task.startDate = startDate;
  const completedDate = sanitizeIsoDate(raw.completedDate);
  if (completedDate) task.completedDate = completedDate;
  const group = nonEmptyStr(raw.group);
  if (group) task.group = group;
  const labels = sanitizeLabels(raw.labels);
  if (labels.length) task.labels = labels;
  const originalEstimateMinutes = sanitizeOptionalMinutes(
    raw.originalEstimateMinutes,
  );
  if (originalEstimateMinutes !== undefined) {
    task.originalEstimateMinutes = originalEstimateMinutes;
  }
  const timeSpentMinutes = sanitizeOptionalMinutes(raw.timeSpentMinutes);
  if (timeSpentMinutes !== undefined) task.timeSpentMinutes = timeSpentMinutes;
  const resourceId = fkIdOrUndefined(raw.resourceId);
  if (resourceId !== undefined) task.resourceId = resourceId;
  const deps = Array.isArray(raw.dependencies)
    ? (raw.dependencies as unknown[])
        .map((d): TaskDependency | null => {
          if (!isPlainObject(d)) return null;
          const taskId = fkIdOrUndefined(d.taskId);
          if (taskId === undefined) return null;
          const type = (
            DEPENDENCY_TYPES as readonly string[]
          ).includes(d.type as string)
            ? (d.type as DependencyType)
            : null;
          if (!type) return null;
          return { taskId, type };
        })
        .filter((d): d is TaskDependency => d !== null)
    : [];
  if (deps.length) task.dependencies = deps;
  const noteLog = sanitizeSeedNoteLog(raw.noteLog);
  if (noteLog) task.noteLog = noteLog;
  // `migrateTask` derives a valid workflow status for legacy/sparse seed
  // content; a present-and-valid status is left alone, EVEN when it
  // contradicts `completedDate` — its only status write is guarded on
  // `!statusOk`. Nothing else reconciles the pair: this function reads
  // `status` (a bare cast) and `completedDate` independently. So reconcile
  // runs last — the DATE wins for every status but `Cancelled`, where the
  // STATUS wins and the stray date is CLEARED (its docstring owns the rule).
  // ★ Order is immaterial, and NOT because of migrateTask's short-circuit
  //   (§182 warns about that wrong mechanism). Reconcile clears the date ONLY
  //   for `Cancelled` — a VALID status — so migrate's `!statusOk` backfill can
  //   never see a date reconcile removed; and on an invalid status the two
  //   agree: with a date both derive "Done", without one reconcile abstains.
  return reconcileStatusFromDate(migrateTask(task));
}

function sanitizeRiskScale(raw: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  return RISK_SCALES.has(n) ? (n as 1 | 2 | 3 | 4 | 5) : undefined;
}

/**
 * Minimal single-item RaidItem sanitizer for template seed content. As with
 * tasks, `jsonToWorkspace` casts the `raid` array raw, so this validates the
 * required `{ id > 0, category, title, status }` shape and passes the rest
 * through the existing field sanitizers. Returns null for anything malformed.
 */
function sanitizeSeedRaidItem(raw: unknown): RaidItem | null {
  if (!isPlainObject(raw)) return null;
  const id = fkIdOrUndefined(raw.id);
  if (id === undefined) return null;
  const title = nonEmptyStr(raw.title);
  if (!title) return null;
  const category = raw.category;
  if (typeof category !== "string" || !RAID_CATEGORY_SET.has(category as RaidCategory)) {
    return null;
  }
  const status = raw.status;
  if (typeof status !== "string" || !RAID_STATUS_SET.has(status as RaidStatus)) {
    return null;
  }
  const item: RaidItem = {
    id,
    category: category as RaidCategory,
    title,
    status: status as RaidStatus,
    linkedTaskIds: sanitizeIdList(raw.linkedTaskIds),
    causedByRaidIds: sanitizeIdList(raw.causedByRaidIds),
    stakeholderIds: sanitizeIdList(raw.stakeholderIds),
    raisedDate: sanitizeIsoDate(raw.raisedDate),
  };
  const description = nonEmptyStr(raw.description);
  if (description) item.description = description;
  const owner = nonEmptyStr(raw.owner);
  if (owner) item.owner = owner;
  const ownerEmail = sanitizeEmail(raw.ownerEmail);
  if (ownerEmail) item.ownerEmail = ownerEmail;
  const ownerResourceId = fkIdOrUndefined(raw.ownerResourceId);
  if (ownerResourceId !== undefined) item.ownerResourceId = ownerResourceId;
  const mitigation = nonEmptyStr(raw.mitigation);
  if (mitigation) item.mitigation = mitigation;
  const targetDate = sanitizeIsoDate(raw.targetDate);
  if (targetDate) item.targetDate = targetDate;
  const closedDate = sanitizeIsoDate(raw.closedDate);
  if (closedDate) item.closedDate = closedDate;
  if (category === "R") {
    const probability = sanitizeRiskScale(raw.probability);
    if (probability !== undefined) item.probability = probability;
    const impact = sanitizeRiskScale(raw.impact);
    if (impact !== undefined) item.impact = impact;
  }
  const noteLog = sanitizeSeedNoteLog(raw.noteLog);
  if (noteLog) item.noteLog = noteLog;
  return item;
}

/**
 * ★★★ Changes route through the canonical `sanitizeChangeItem`, which
 * deliberately DROPS `noteLog`: the load paths re-attach it from the STORED row
 * via `withStoredNoteLog`, so a decoded or model-written change can never inject
 * one. A template seed has no stored row, so the same re-attach happens here,
 * from the seed's own captured log, through the same DOM-free boundary every
 * other seed rich field uses.
 *
 * ★★★ DO NOT move this into `sanitizeChangeItem`. That would give every caller —
 * the workspace load paths and the AI write path included — a note-log carry
 * they must not have.
 */
function sanitizeSeedChangeItem(raw: unknown): ChangeItem | null {
  const item = sanitizeChangeItem(raw);
  if (!item) return null;
  if (!isPlainObject(raw)) return item;
  const noteLog = sanitizeSeedNoteLog(raw.noteLog);
  return noteLog ? { ...item, noteLog } : item;
}

/** ★ Exported for TESTS only — no other module imports it, and its only caller
 *  is `sanitizeTemplate` below (verify:
 *  `grep -rnE "\bsanitizeSeed\b" src scripts e2e | grep -v "\.test\."`). The seed note-log
 *  carry is wired per-route (tasks and RAID locally, changes through
 *  `sanitizeSeedChangeItem`), and a test calling the per-item helpers directly
 *  would pass with every route unwired. Reaching them THROUGH here is what
 *  proves the wiring, so the widening buys a real assertion rather than
 *  convenience. Do not add a production caller without revisiting that. */
export function sanitizeSeed(raw: unknown): TemplateSeed | undefined {
  if (!isPlainObject(raw)) return undefined;
  const seed: TemplateSeed = {};
  const tasks = sanitizeArr<Task>(raw.tasks, sanitizeSeedTask);
  const milestones = sanitizeArr<Milestone>(raw.milestones, sanitizeMilestone);
  const rd = sanitizeArr<RaidItem>(raw.raid, sanitizeSeedRaidItem);
  const changes = sanitizeArr<ChangeItem>(raw.changes, sanitizeSeedChangeItem);
  const stakeholders = sanitizeArr<Stakeholder>(
    raw.stakeholders,
    sanitizeStakeholder,
  );
  const budgets = sanitizeArr<BudgetBucket>(raw.budgets, sanitizeBudgetBucket);
  if (tasks) seed.tasks = tasks;
  if (milestones) seed.milestones = milestones;
  if (rd) seed.raid = rd;
  if (changes) seed.changes = changes;
  if (stakeholders) seed.stakeholders = stakeholders;
  if (budgets) seed.budgets = budgets;
  return Object.keys(seed).length ? seed : undefined;
}

/** Sanitize one stored template. Returns null when it lacks a usable id/name. */
export function sanitizeTemplate(raw: unknown): ProjectTemplate | null {
  if (!isPlainObject(raw)) return null;
  const id = nonEmptyStr(raw.id);
  const name = nonEmptyStr(raw.name);
  if (!id || !name) return null;
  const tpl: ProjectTemplate = {
    id,
    name,
    features: sanitizeFeatures(raw.features),
    fieldVisibility: sanitizeFieldVisibility(raw.fieldVisibility) ?? {},
  };
  const desc = nonEmptyStr(raw.description);
  if (desc) tpl.description = desc;
  const seed = sanitizeSeed(raw.seed);
  if (seed) tpl.seed = seed;
  return tpl; // builtIn never honored from stored data
}

export interface SaveTemplateInput {
  name: string;
  description?: string;
  includeContent: boolean;
}

/**
 * Build a new `ProjectTemplate` from the current workspace state. Captures
 * feature-module toggles and field-visibility config always; optionally
 * captures seed content when `includeContent` is true. Pure function — no
 * side effects, no stripping of entity ids (sanitized on READ by
 * `sanitizeTemplates`, re-id'd on APPLY by `applyTemplate`).
 */
export function templateFromWorkspace(
  ws: Workspace,
  features: readonly FeatureModuleId[],
  input: SaveTemplateInput,
  newId: string,
): ProjectTemplate {
  const tpl: ProjectTemplate = {
    id: newId,
    name: input.name.trim(),
    features: sanitizeFeatures(features),
    fieldVisibility: sanitizeFieldVisibility(ws.fieldVisibility) ?? {},
  };
  if (input.description?.trim()) tpl.description = input.description.trim();
  if (input.includeContent) {
    const seed: TemplateSeed = {};
    if (ws.tasks.length) seed.tasks = ws.tasks;
    if (ws.milestones?.length) seed.milestones = ws.milestones;
    if (ws.raid.length) seed.raid = ws.raid;
    if (ws.changes?.length) seed.changes = ws.changes;
    if (ws.stakeholders?.length) seed.stakeholders = ws.stakeholders;
    if (ws.budgets?.length) seed.budgets = ws.budgets;
    if (Object.keys(seed).length) tpl.seed = seed;
  }
  return tpl;
}

/** Sanitize a stored array of templates, dropping any malformed entries. */
export function sanitizeTemplates(raw: unknown): ProjectTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeTemplate)
    .filter((t): t is ProjectTemplate => t !== null);
}
