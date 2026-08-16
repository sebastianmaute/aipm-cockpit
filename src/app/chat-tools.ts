import { sanitizeGroup, sanitizeLabels } from "./sanitize";
import {
  PRIORITIES,
  type Priority,
  type Task,
  type RaidItem,
  type ChangeItem,
  type Milestone,
  type Stakeholder,
  type Resource,
  type TaskDependency,
  type BudgetBucket,
  type BucketStatus,
} from "./types";
import type { Lang } from "./i18n";
import { type DepRejection } from "./task-dependency-write";
import { type KnowledgeItem, type KnowledgeLinkKind, linkKindOf } from "./document-link";
import { type CalendarEvent, type RecurrenceRule, type EventException } from "./calendar-event";

import type { AppMode, FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";
import type { Insight } from "./insights/insight";
import type { ActivityEntry } from "./activity-log";
import { searchHistory } from "./history-search";
import { type DashboardSnapshot } from "./ai-dashboard-snapshot";
import { type AllocationsSnapshot } from "./alloc-plan/alloc-plan";
import {
  isDocumentTool,
  runDocumentTool,
  type DocumentToolDispatcher,
} from "./chat-tools-documents";
export { TOOL_DEFS } from "./chat-tool-defs";

type TaskInput = {
  taskName: string;
  assignee: string;
  assigneeEmail?: string;
  dueDate: string;
  lastUpdateDate?: string;
  priority?: Priority;
  status?: string;
  blockers?: string;
  notes?: string;
  description?: string;
  group?: string;
  labels?: string[];
};

export type Filters = {
  search?: string;
  priority?: Priority | "All";
  assignee?: string;
  group?: string;
  label?: string;
};

export type RaidSummary = {
  id: number;
  category: string;
  title: string;
  status: string;
  severity?: string;
  owner?: string;
  stakeholderIds: number[];
};

export type ChangeSummary = {
  id: number;
  title: string;
  status: string;
  impact?: string;
  decisionDate?: string;
  stakeholderIds: number[];
};

export type MilestoneSummary = {
  id: number;
  name: string;
  date: string;
  achievedDate?: string;
};

export type StakeholderSummary = {
  id: number;
  name: string;
  category: string;
  influence: string;
  interest: string;
  organization?: string;
  email?: string;
};

/** Loose write-tool inputs: the model supplies these, the dispatcher routes
 *  them through the entity sanitizer which enforces enums/caps/required fields
 *  and fills defaults. Only the human-required field is non-optional here. */
export type RaidInput = {
  category?: string;
  title: string;
  description?: string;
  owner?: string;
  ownerEmail?: string;
  severity?: string;
  probability?: number;
  impact?: number;
  status?: string;
  mitigation?: string;
  raisedDate?: string;
  targetDate?: string;
  closedDate?: string;
  linkedTaskIds?: number[];
  causedByRaidIds?: number[];
  stakeholderIds?: number[];
};

export type ChangeInput = {
  title: string;
  description?: string;
  type?: string;
  status?: string;
  impact?: string;
  impactDescription?: string;
  scheduleImpactDays?: number;
  costImpact?: number;
  requestedBy?: string;
  raisedDate?: string;
  decisionBy?: string;
  decisionDate?: string;
  resolutionNotes?: string;
  linkedTaskIds?: number[];
  linkedRaidIds?: number[];
  stakeholderIds?: number[];
};

export type MilestoneInput = {
  name: string;
  date: string;
  description?: string;
  achievedDate?: string;
  linkedTaskIds?: number[];
};

export type StakeholderInput = {
  name: string;
  organization?: string;
  title?: string;
  email?: string;
  category?: string;
  influence?: string;
  interest?: string;
  notes?: string;
};

/** Safe-subset app-settings patch the AI may write. Every field is re-validated
 *  in the dispatcher (density/mode enums, `sanitizeFeatures`, per-field
 *  `NEXT_ACTIONS_FIELD_COERCE`) before it reaches `setSettings`; secrets, keys,
 *  storage, and integration config are intentionally NOT reachable here. */
export type SettingsUpdateInput = {
  dashboardDensity?: string;
  showViewHints?: boolean;
  tasksViewMode?: string;
  hideExternalTasks?: boolean;
  /** COMPLETE desired set of enabled feature-module ids (replaces current). */
  enabledModules?: unknown;
  /** Map of next-actions tuning field → numeric value; unknown keys ignored. */
  nextActionsWeights?: unknown;
};

/** A directory resource (person). `sanitizeResource` fills roleId/utilization
 *  defaults; discipline/grade are assigned in the app, not by the model. */
export type ResourceInput = {
  firstName?: string;
  lastName?: string;
  /** A single full name; split into first/last when the parts aren't given. */
  name?: string;
  email?: string;
  emails?: string[];
  title?: string;
  department?: string;
  company?: string;
  location?: string;
  businessPhone?: string;
  isExternal?: boolean;
  roleId?: number;
  notes?: string;
};

export type ResourceSummary = {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  emails?: string[];
  title?: string;
  department?: string;
  isExternal?: boolean;
  roleId?: number | null;
};

/** A standalone Knowledge-library item is just a link (name/url/kind) — it
 *  carries NO description field (rich or plain) to project here. */
export type KnowledgeSummary = {
  id: string;
  name: string;
  url: string;
  linkKind: KnowledgeLinkKind;
  taskIds: number[];
};

/** The complete key set of `CalendarEventSummary`, exported so the two tests
 *  asserting "no key outside the contract" share ONE list instead of a copy
 *  each. ★ It is still a hand-copy OF THE TYPE — `CALENDAR_SUMMARY_KEYS_MATCH`
 *  below is what actually binds them, so adding a field to the type without
 *  adding it here is a tsc error rather than a silently weakened test. */
export const CALENDAR_SUMMARY_KEYS = [
  "id", "title", "startDate", "startTime", "durationMinutes",
  "location", "notes", "attendeeResourceIds", "recurrence", "exceptions",
] as const;

/** The event's series definition, never expanded into individual occurrences
 *  (`recurrence`/`exceptions` are the model's own rule to compute from — an
 *  `exceptions` entry overrides the rule for its `date`: `kind: "skip"` drops
 *  that occurrence entirely, `kind: "move"` relocates it to `toDate`/`toTime`).
 *  `notes` is a plain free-text field on CalendarEvent (sanitizeMultiline at
 *  the boundary) — NOT one of the six rich-HTML fields, so no projection. */
export type CalendarEventSummary = {
  id: number;
  title: string;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
  attendeeResourceIds: number[];
  recurrence?: RecurrenceRule;
  exceptions: EventException[];
};

/** ★★ COMPILE-TIME BINDING between the type above and the key list above it,
 *  in BOTH directions. Without it the list is prose: add a field to the type
 *  and the "no key outside the contract" tests keep passing while silently
 *  ignoring it. The `[T] extends [U]` form is deliberate — a bare
 *  `T extends U` distributes over the union and collapses to `boolean`, which
 *  `true` is assignable to, making the whole check vacuous. */
export const CALENDAR_SUMMARY_KEYS_MATCH: [
  [keyof CalendarEventSummary] extends [(typeof CALENDAR_SUMMARY_KEYS)[number]] ? true : false,
  [(typeof CALENDAR_SUMMARY_KEYS)[number]] extends [keyof CalendarEventSummary] ? true : false,
] = [true, true];

/** One role line's PLANNED (budget) hours by period within a bucket. */
export type BudgetBucketAllocationSummary = {
  roleId: number;
  budgetHours: Record<string, number>;
};

/** Per-bucket detail: id/name/status/window plus each role line's PLANNED
 *  (budget) hours by period. Deliberately omits actualHours, disciplineAllocations
 *  and rate overrides — this is what a "what's planned in this bucket" question
 *  needs, not the full budget-planner row shape. */
export type BudgetBucketSummary = {
  id: number;
  name: string;
  /** The real union, not a widened `string` — a bucket is open or closed, and
   *  keeping it exhaustive means a typo is a compile error rather than
   *  something the model has to interpret. (The older RaidSummary /
   *  ChangeSummary above widen theirs; that is legacy, not the pattern.) */
  status: BucketStatus;
  startDate: string;
  endDate: string;
  allocations: BudgetBucketAllocationSummary[];
};

export type ToolDispatcher = {
  listTasks(): readonly Task[];
  getTask(id: number): Task | null;
  createTask(input: TaskInput): Task;
  updateTask(id: number, patch: Partial<Task>): Task | null;
  /** Replace task `id`'s predecessor-link list wholesale. `raw` is untrusted
   *  model output; `resolveDependencyWrite` sanitizes + cycle-checks it.
   *  Returns null when the task doesn't exist. `removed` is every link that
   *  existed before the call and is not in the returned `dependencies` — a
   *  wholly-rejected write (nothing applied, something rejected, prior links
   *  present) refuses to mutate at all and comes back with `removed: []`. */
  setTaskDependencies(
    id: number,
    raw: unknown,
  ): {
    id: number;
    dependencies: TaskDependency[];
    rejected: DepRejection[];
    removed: TaskDependency[];
  } | null;
  deleteTask(id: number): boolean;
  deleteAllTasks(): number;
  sendInquiry(id: number): { sent: boolean; reason?: string };
  setFilters(filters: Filters): void;
  setLanguage(lang: Lang): void;
  listRaid(): RaidSummary[];
  listChanges(): ChangeSummary[];
  listMilestones(): MilestoneSummary[];
  listStakeholders(): StakeholderSummary[];
  listResources(): ResourceSummary[];
  createRaid(input: RaidInput): RaidSummary;
  updateRaid(id: number, patch: Partial<RaidInput>): RaidSummary | null;
  deleteRaid(id: number): boolean;
  createChange(input: ChangeInput): ChangeSummary;
  updateChange(id: number, patch: Partial<ChangeInput>): ChangeSummary | null;
  deleteChange(id: number): boolean;
  createMilestone(input: MilestoneInput): MilestoneSummary;
  updateMilestone(id: number, patch: Partial<MilestoneInput>): MilestoneSummary | null;
  deleteMilestone(id: number): boolean;
  createStakeholder(input: StakeholderInput): StakeholderSummary;
  updateStakeholder(id: number, patch: Partial<StakeholderInput>): StakeholderSummary | null;
  deleteStakeholder(id: number): boolean;
  /** Apply a safe-subset settings patch; returns the fields actually applied
   *  (after validation/clamping). Throws in a read-only popout. */
  updateSettings(patch: SettingsUpdateInput): Record<string, unknown>;
  createResource(input: ResourceInput): ResourceSummary;
  getResource(id: number): ResourceSummary | null;
  updateResource(id: number, patch: Partial<ResourceInput>): ResourceSummary | null;
  deleteResource(id: number): boolean;
  getSnapshot(): {
    today: string;
    language: Lang;
    holidayCountries: string[];
    storageKind: string;
    taskCount: number;
    knownGroups?: string[];
    knownLabels?: string[];
    mode: AppMode;
    enabledModules: FeatureModuleId[];
    currentView: AppView;
    insights?: readonly Insight[];
    /** Compact text describing what is currently ON the active view, after the
     *  user's filters. Only 4 views contribute one; absent elsewhere. Lands in
     *  the VOLATILE prompt suffix — see buildSystemPrompt. */
    viewDigest?: string;
  };
  /** The project's activity log. ★★★ Deliberately a METHOD rather than a
   *  `getSnapshot()` field: `get_app_state` returns the snapshot VERBATIM and
   *  the model calls it freely. The log IS bounded — `ACTIVITY_MAX_ENTRIES`
   *  (500) — but 500 audit entries, each carrying up to `MAX_FIELD_CHANGES`
   *  field-level diffs, is still far more than belongs in the context window on
   *  every call. This keeps the log reachable by the one tool that wants it and
   *  out of the snapshot everything else reads. See chat-tools.test.ts's guard
   *  test. */
  getActivityLog(): readonly ActivityEntry[];
  /** The project's effective IANA zone — the SAME value behind `getSnapshot().today`,
   *  so a day bound and the `Today is …` date the model is given cannot disagree.
   *  ★ NOT the ephemeral display-tz override the top bar can set: that is a
   *  per-session viewing preference, and honouring it here would move the
   *  model's day boundaries without moving the date it reasons from. */
  getTimezone(): string;
  getDashboardSnapshot(): DashboardSnapshot;
  listAllocations(): AllocationsSnapshot;
  listKnowledgeItems(): KnowledgeSummary[];
  listCalendarEvents(): CalendarEventSummary[];
  listBudgetBuckets(): BudgetBucketSummary[];
  // ★ The five document methods are INTERSECTED in rather than restated, so
  // there is one declaration of each and the routing module (which owns the
  // guards in front of them) cannot drift from this type. Their routing lives
  // in chat-tools-documents.ts because this file sits close to the 800-line
  // ratchet.
} & DocumentToolDispatcher;

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asPriority(v: unknown): Priority | undefined {
  if (typeof v === "string" && (PRIORITIES as unknown as string[]).includes(v))
    return v as Priority;
  return undefined;
}

function buildPatch(input: Record<string, unknown>): Partial<Task> {
  const patch: Partial<Task> = {};
  if (input.taskName !== undefined) patch.taskName = asString(input.taskName) ?? "";
  if (input.assignee !== undefined) patch.assignee = asString(input.assignee) ?? "";
  if (input.assigneeEmail !== undefined)
    patch.assigneeEmail = asString(input.assigneeEmail) ?? "";
  if (input.dueDate !== undefined) patch.dueDate = asString(input.dueDate) ?? "";
  if (input.lastUpdateDate !== undefined)
    patch.lastUpdateDate = asString(input.lastUpdateDate) ?? "";
  if (input.priority !== undefined) {
    const p = asPriority(input.priority);
    if (p) patch.priority = p;
  }
  if (input.status !== undefined) {
    const s = asString(input.status);
    // Carry the raw value through; the dispatcher validates against
    // TASK_STATUSES and routes it through applyStatusChange (the sole writer
    // of status + completedDate). A non-string is ignored.
    if (s !== undefined) patch.status = s as Task["status"];
  }
  if (input.blockers !== undefined) patch.blockers = asString(input.blockers) ?? "";
  // Plain text from the model; wrapped to HTML at the dispatcher (single write
  // boundary — see use-chat-dispatcher updateTask).
  //
  // `description` is the field, and the only one the tool SCHEMA advertises
  // (chat-tool-defs taskFields); `notes` is its pre-0.196.0 name, kept as a
  // WRITE ALIAS deliberately.
  //
  // ★★ Do NOT retire it. A persisted insight recommendation stores its
  // proposedCalls verbatim and replays them through runTool at apply time, so a
  // proposal generated before the rename can still carry a `notes` key. Dropping
  // the alias would break replay of an already-stored recommendation.
  if (input.description !== undefined || input.notes !== undefined)
    patch.description = asString(input.description ?? input.notes) ?? "";
  if (input.group !== undefined) patch.group = sanitizeGroup(input.group);
  if (input.labels !== undefined) patch.labels = sanitizeLabels(input.labels);
  return patch;
}

/** Parse the numeric `id` field, throwing if absent/non-numeric. */
function requireId(input: Record<string, unknown>): number {
  const id = Number(input.id);
  if (!Number.isFinite(id)) throw new Error("id must be a number");
  return id;
}

/** A shallow copy of the tool input with `id` removed — the update patch. */
function patchWithoutId<T>(input: Record<string, unknown>): Partial<T> {
  const patch = { ...input };
  delete patch.id;
  return patch as Partial<T>;
}

export function toRaidSummary(item: RaidItem): RaidSummary {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    status: item.status,
    severity: item.severity,
    owner: item.owner,
    stakeholderIds: item.stakeholderIds ?? [],
  };
}

export function toChangeSummary(item: ChangeItem): ChangeSummary {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    impact: item.impact,
    decisionDate: item.decisionDate,
    stakeholderIds: item.stakeholderIds ?? [],
  };
}

export function toMilestoneSummary(item: Milestone): MilestoneSummary {
  return {
    id: item.id,
    name: item.name,
    date: item.date,
    achievedDate: item.achievedDate,
  };
}

export function toStakeholderSummary(item: Stakeholder): StakeholderSummary {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    influence: item.influence,
    interest: item.interest,
    organization: item.organization,
    email: item.email,
  };
}

export function toResourceSummary(item: Resource): ResourceSummary {
  return {
    id: item.id,
    firstName: item.firstName,
    lastName: item.lastName,
    email: item.email,
    emails: item.emails,
    title: item.title,
    department: item.department,
    isExternal: item.isExternal,
    roleId: item.roleId,
  };
}

export function toKnowledgeSummary(item: KnowledgeItem): KnowledgeSummary {
  return {
    id: item.id,
    name: item.name,
    url: item.url,
    linkKind: linkKindOf(item),
    taskIds: item.taskIds ?? [],
  };
}

export function toCalendarEventSummary(event: CalendarEvent): CalendarEventSummary {
  return {
    id: event.id,
    title: event.title,
    startDate: event.startDate,
    startTime: event.startTime,
    durationMinutes: event.durationMinutes,
    location: event.location,
    notes: event.notes,
    attendeeResourceIds: event.attendeeResourceIds ?? [],
    recurrence: event.recurrence,
    exceptions: event.exceptions ?? [],
  };
}

export function toBudgetBucketSummary(bucket: BudgetBucket): BudgetBucketSummary {
  return {
    id: bucket.id,
    name: bucket.name,
    status: bucket.status,
    startDate: bucket.startDate,
    endDate: bucket.endDate,
    allocations: bucket.allocations.map((a) => ({
      roleId: a.roleId,
      budgetHours: a.budgetHours,
    })),
  };
}

export async function runTool(
  d: ToolDispatcher,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<
    string,
    unknown
  >;

  switch (name) {
    case "list_tasks":
      return d.listTasks();

    case "get_task": {
      const id = Number(input.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const task = d.getTask(id);
      if (!task) throw new Error(`task #${id} not found`);
      return task;
    }

    case "create_task": {
      const taskName = asString(input.taskName);
      const assignee = asString(input.assignee);
      const dueDate = asString(input.dueDate);
      if (!taskName || !assignee || !dueDate) {
        throw new Error("taskName, assignee, and dueDate are required");
      }
      return d.createTask({
        taskName,
        assignee,
        dueDate,
        assigneeEmail: asString(input.assigneeEmail),
        lastUpdateDate: asString(input.lastUpdateDate),
        priority: asPriority(input.priority),
        status: asString(input.status),
        blockers: asString(input.blockers),
        notes: asString(input.notes),
        description: asString(input.description),
        group: asString(input.group),
        labels: Array.isArray(input.labels)
          ? sanitizeLabels(input.labels)
          : undefined,
      });
    }

    case "update_task": {
      const id = Number(input.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const patch = buildPatch(input);
      const updated = d.updateTask(id, patch);
      if (!updated) throw new Error(`task #${id} not found`);
      return updated;
    }

    case "set_task_dependencies": {
      const id = requireId(input);
      // A non-array here is byte-identical to a legitimate "clear all links"
      // once it reaches setTaskDependencies/resolveDependencyWrite (which
      // treats non-array input as a clear for non-tool callers). Reject it
      // AT THE TOOL BOUNDARY instead — malformed model output (a stray
      // string, an omitted field) must never silently wipe a task's
      // dependency graph with zero visible rejection.
      if (!Array.isArray(input.dependencies)) throw new Error("dependencies must be an array");
      const result = d.setTaskDependencies(id, input.dependencies);
      if (!result) throw new Error(`Task #${id} not found`);
      return result;
    }

    case "delete_task": {
      const id = Number(input.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const ok = d.deleteTask(id);
      if (!ok) throw new Error(`task #${id} not found`);
      return { deleted: id };
    }

    case "delete_all_tasks": {
      const count = d.deleteAllTasks();
      return { deleted: count };
    }

    case "send_inquiry": {
      const id = Number(input.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      return d.sendInquiry(id);
    }

    case "set_filters": {
      const filters: Filters = {};
      if (input.search !== undefined) filters.search = asString(input.search) ?? "";
      if (input.priority !== undefined) {
        const p = input.priority;
        if (p === "All") filters.priority = "All";
        else {
          const pr = asPriority(p);
          if (pr) filters.priority = pr;
        }
      }
      if (input.assignee !== undefined)
        filters.assignee = asString(input.assignee) ?? "";
      if (input.group !== undefined)
        filters.group = asString(input.group) ?? "";
      if (input.label !== undefined)
        filters.label = asString(input.label) ?? "";
      d.setFilters(filters);
      return { applied: filters };
    }

    case "set_language": {
      const l = asString(input.language);
      if (l !== "en-US" && l !== "en-GB" && l !== "de") {
        throw new Error("unsupported language");
      }
      d.setLanguage(l);
      return { language: l };
    }

    case "get_app_state":
      return d.getSnapshot();

    case "get_dashboard_snapshot":
      return d.getDashboardSnapshot();

    case "list_raid":
      return d.listRaid();

    case "list_changes":
      return d.listChanges();

    case "list_milestones":
      return d.listMilestones();

    case "list_stakeholders":
      return d.listStakeholders();

    case "list_resources":
      return d.listResources();

    case "list_allocations":
      return d.listAllocations();

    case "list_knowledge_items":
      return d.listKnowledgeItems();

    case "list_calendar_events":
      return d.listCalendarEvents();

    case "list_budget_buckets":
      return d.listBudgetBuckets();

    // Every field is coerced-or-dropped rather than validated-and-rejected:
    // the engine treats an absent field as "no filter", which is the honest
    // reading of garbage from a model that cannot be asked to try again.
    case "search_history":
      return searchHistory(d.getActivityLog(), {
        query: typeof input.query === "string" ? input.query : undefined,
        since: typeof input.since === "string" ? input.since : undefined,
        until: typeof input.until === "string" ? input.until : undefined,
        // A bare pass-through would hand a STRING to the engine's
        // `new Set(q.kinds)`, which iterates it into a set of characters
        // matching no kind — an empty result reported as a real filter.
        kinds: Array.isArray(input.kinds)
          ? input.kinds.filter((k): k is string => typeof k === "string")
          : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      }, d.getTimezone());

    case "create_raid_item":
      return d.createRaid(input as RaidInput);

    case "update_raid_item": {
      const id = requireId(input);
      const updated = d.updateRaid(id, patchWithoutId(input));
      if (!updated) throw new Error(`RAID item #${id} not found`);
      return updated;
    }

    case "delete_raid_item": {
      const id = requireId(input);
      if (!d.deleteRaid(id)) throw new Error(`RAID item #${id} not found`);
      return { deleted: id };
    }

    case "create_change":
      return d.createChange(input as ChangeInput);

    case "update_change": {
      const id = requireId(input);
      const updated = d.updateChange(id, patchWithoutId(input));
      if (!updated) throw new Error(`change #${id} not found`);
      return updated;
    }

    case "delete_change": {
      const id = requireId(input);
      if (!d.deleteChange(id)) throw new Error(`change #${id} not found`);
      return { deleted: id };
    }

    case "create_milestone":
      return d.createMilestone(input as MilestoneInput);

    case "update_milestone": {
      const id = requireId(input);
      const updated = d.updateMilestone(id, patchWithoutId(input));
      if (!updated) throw new Error(`milestone #${id} not found`);
      return updated;
    }

    case "delete_milestone": {
      const id = requireId(input);
      if (!d.deleteMilestone(id)) throw new Error(`milestone #${id} not found`);
      return { deleted: id };
    }

    case "create_resource":
      return d.createResource(input as ResourceInput);

    case "get_resource": {
      const id = requireId(input);
      const found = d.getResource(id);
      if (!found) throw new Error(`resource #${id} not found`);
      return found;
    }

    case "update_resource": {
      const id = requireId(input);
      const updated = d.updateResource(id, patchWithoutId(input) as Partial<ResourceInput>);
      if (!updated) throw new Error(`resource #${id} not found`);
      return updated;
    }

    case "delete_resource": {
      const id = requireId(input);
      if (!d.deleteResource(id)) throw new Error(`resource #${id} not found`);
      return { deleted: id };
    }

    case "create_stakeholder":
      return d.createStakeholder(input as StakeholderInput);

    case "update_stakeholder": {
      const id = requireId(input);
      const updated = d.updateStakeholder(id, patchWithoutId(input));
      if (!updated) throw new Error(`stakeholder #${id} not found`);
      return updated;
    }

    case "delete_stakeholder": {
      const id = requireId(input);
      if (!d.deleteStakeholder(id)) throw new Error(`stakeholder #${id} not found`);
      return { deleted: id };
    }

    case "update_settings": {
      const applied = d.updateSettings(input as SettingsUpdateInput);
      if (Object.keys(applied).length === 0) {
        throw new Error("no recognized settings fields to update");
      }
      return { applied };
    }

    default:
      // Document tools route to their own module (which carries their boundary
      // guards) BEFORE the unknown-tool throw, so an unrouted document name
      // still surfaces as "unknown tool" rather than resolving silently.
      if (isDocumentTool(name)) return runDocumentTool(d, name, input);
      throw new Error(`unknown tool: ${name}`);
  }
}
