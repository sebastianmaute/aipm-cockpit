import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
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
  sanitizeNotes,
  sanitizeOptionalMinutes,
  sanitizePriority,
  sanitizeStakeholder,
  sanitizeTaskName,
} from "./sanitize";
import {
  RAID_CATEGORIES,
  type BudgetBucket,
  type ChangeItem,
  type Milestone,
  type RaidCategory,
  type RaidItem,
  type RaidStatus,
  type Stakeholder,
  type Task,
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
 * Minimal single-item Task sanitizer for template seed content. The workspace
 * loader (`jsonToWorkspace`) casts the `tasks` array raw, so there is no
 * canonical per-item Task sanitizer to reuse; this validates the required
 * `{ id > 0, taskName }` shape and passes every other field through the
 * existing field sanitizers. Returns null for anything malformed.
 */
function sanitizeSeedTask(raw: unknown): Task | null {
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
    blockers: sanitizeBlockers(raw.blockers),
    notes: sanitizeNotes(raw.notes),
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
  return task;
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
  return item;
}

function sanitizeSeed(raw: unknown): TemplateSeed | undefined {
  if (!isPlainObject(raw)) return undefined;
  const seed: TemplateSeed = {};
  const tasks = sanitizeArr<Task>(raw.tasks, sanitizeSeedTask);
  const milestones = sanitizeArr<Milestone>(raw.milestones, sanitizeMilestone);
  const rd = sanitizeArr<RaidItem>(raw.raid, sanitizeSeedRaidItem);
  const changes = sanitizeArr<ChangeItem>(raw.changes, sanitizeChangeItem);
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

/** Sanitize a stored array of templates, dropping any malformed entries. */
export function sanitizeTemplates(raw: unknown): ProjectTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeTemplate)
    .filter((t): t is ProjectTemplate => t !== null);
}
