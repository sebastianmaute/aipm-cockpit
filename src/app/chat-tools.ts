import { sanitizeGroup, sanitizeLabels } from "./sanitize";
import {
  PRIORITIES,
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  RISK_STATUSES,
  ASSUMPTION_STATUSES,
  ISSUE_STATUSES,
  DEPENDENCY_STATUSES,
  CHANGE_TYPES,
  CHANGE_STATUSES,
  STAKEHOLDER_CATEGORIES,
  INFLUENCE_INTEREST_LEVELS,
  type Priority,
  type Task,
  type RaidItem,
  type ChangeItem,
  type Milestone,
  type Stakeholder,
} from "./types";
import type { Lang } from "./i18n";

/** Every RAID status across the four categories (deduped). The tool schema
 *  offers the whole union; `sanitizeRaidItem` enforces the per-category subset
 *  and falls back to that category's default when the model picks a mismatch. */
const ALL_RAID_STATUSES = Array.from(
  new Set<string>([
    ...(RISK_STATUSES as unknown as string[]),
    ...(ASSUMPTION_STATUSES as unknown as string[]),
    ...(ISSUE_STATUSES as unknown as string[]),
    ...(DEPENDENCY_STATUSES as unknown as string[]),
  ]),
);
import type { AppMode, FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";

type TaskInput = {
  taskName: string;
  assignee: string;
  assigneeEmail?: string;
  dueDate: string;
  lastUpdateDate?: string;
  priority?: Priority;
  blockers?: string;
  notes?: string;
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

export type ToolDispatcher = {
  listTasks(): readonly Task[];
  getTask(id: number): Task | null;
  createTask(input: TaskInput): Task;
  updateTask(id: number, patch: Partial<Task>): Task | null;
  deleteTask(id: number): boolean;
  deleteAllTasks(): number;
  sendInquiry(id: number): { sent: boolean; reason?: string };
  setFilters(filters: Filters): void;
  setLanguage(lang: Lang): void;
  listRaid(): RaidSummary[];
  listChanges(): ChangeSummary[];
  listMilestones(): MilestoneSummary[];
  listStakeholders(): StakeholderSummary[];
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
  };
};

const taskFields = {
  taskName: { type: "string" as const, description: "Short summary of the task" },
  assignee: {
    type: "string" as const,
    description: "Person responsible (name or email)",
  },
  assigneeEmail: {
    type: "string" as const,
    description: "Email address used for status inquiries",
  },
  dueDate: {
    type: "string" as const,
    description: "Due date in YYYY-MM-DD format",
  },
  lastUpdateDate: {
    type: "string" as const,
    description: "Last update date in YYYY-MM-DD format",
  },
  priority: {
    type: "string" as const,
    enum: PRIORITIES as unknown as string[],
    description: "Priority level",
  },
  blockers: { type: "string" as const, description: "What's blocking progress" },
  notes: { type: "string" as const, description: "Free-form notes" },
  group: {
    type: "string" as const,
    description: "Optional category/project the task belongs to",
  },
  labels: {
    type: "array" as const,
    items: { type: "string" as const },
    description: "Optional list of label/tag strings",
  },
};

const idList = (description: string) => ({
  type: "array" as const,
  items: { type: "number" as const },
  description,
});

const raidFields = {
  category: {
    type: "string" as const,
    enum: RAID_CATEGORIES as unknown as string[],
    description: "R=Risk, A=Assumption, I=Issue, D=Dependency. Defaults to R.",
  },
  title: { type: "string" as const, description: "Short title of the RAID item" },
  description: { type: "string" as const, description: "Full description" },
  owner: { type: "string" as const, description: "Person accountable" },
  ownerEmail: { type: "string" as const, description: "Owner's email" },
  severity: {
    type: "string" as const,
    enum: RAID_SEVERITIES as unknown as string[],
    description: "Severity level",
  },
  probability: { type: "number" as const, description: "Risk probability 1-5" },
  impact: { type: "number" as const, description: "Risk impact 1-5" },
  status: {
    type: "string" as const,
    enum: ALL_RAID_STATUSES,
    description:
      "Status valid for the category (Risk: Open/Mitigated/Realized/Closed; Assumption: Pending/Validated/Invalidated; Issue: Open/In Progress/Resolved/Closed; Dependency: Open/In Progress/Delivered/Blocked).",
  },
  mitigation: { type: "string" as const, description: "Mitigation / response plan" },
  raisedDate: { type: "string" as const, description: "Date raised, YYYY-MM-DD (defaults to today)" },
  targetDate: { type: "string" as const, description: "Target resolution date YYYY-MM-DD" },
  closedDate: { type: "string" as const, description: "Date closed YYYY-MM-DD" },
  linkedTaskIds: idList("IDs of related tasks"),
  causedByRaidIds: idList("IDs of RAID items that cause this one"),
  stakeholderIds: idList("IDs of related stakeholders"),
};

const changeFields = {
  title: { type: "string" as const, description: "Short title of the change request" },
  description: { type: "string" as const, description: "Full description" },
  type: {
    type: "string" as const,
    enum: CHANGE_TYPES as unknown as string[],
    description: "Change type. Defaults to Other.",
  },
  status: {
    type: "string" as const,
    enum: CHANGE_STATUSES as unknown as string[],
    description: "Change status. Defaults to Proposed.",
  },
  impact: {
    type: "string" as const,
    enum: RAID_SEVERITIES as unknown as string[],
    description: "Impact level",
  },
  impactDescription: { type: "string" as const, description: "Impact detail" },
  scheduleImpactDays: { type: "number" as const, description: "Schedule impact in days" },
  costImpact: { type: "number" as const, description: "Cost impact" },
  requestedBy: { type: "string" as const, description: "Who requested the change" },
  raisedDate: { type: "string" as const, description: "Date raised YYYY-MM-DD (defaults to today)" },
  decisionBy: { type: "string" as const, description: "Decision maker" },
  decisionDate: { type: "string" as const, description: "Decision date YYYY-MM-DD" },
  resolutionNotes: { type: "string" as const, description: "Resolution notes" },
  linkedTaskIds: idList("IDs of related tasks"),
  linkedRaidIds: idList("IDs of related RAID items"),
  stakeholderIds: idList("IDs of related stakeholders"),
};

const milestoneFields = {
  name: { type: "string" as const, description: "Milestone name" },
  date: { type: "string" as const, description: "Target date YYYY-MM-DD" },
  description: { type: "string" as const, description: "Description" },
  achievedDate: { type: "string" as const, description: "Sign-off date YYYY-MM-DD (omit if not yet achieved)" },
  linkedTaskIds: idList("IDs of related tasks"),
};

const stakeholderFields = {
  name: { type: "string" as const, description: "Stakeholder name" },
  organization: { type: "string" as const, description: "Organization" },
  title: { type: "string" as const, description: "Job title / role" },
  email: { type: "string" as const, description: "Email address" },
  category: {
    type: "string" as const,
    enum: STAKEHOLDER_CATEGORIES as unknown as string[],
    description: "Stakeholder category. Defaults to Other.",
  },
  influence: {
    type: "string" as const,
    enum: INFLUENCE_INTEREST_LEVELS as unknown as string[],
    description: "Influence level. Defaults to Medium.",
  },
  interest: {
    type: "string" as const,
    enum: INFLUENCE_INTEREST_LEVELS as unknown as string[],
    description: "Interest level. Defaults to Medium.",
  },
  notes: { type: "string" as const, description: "Free-form notes" },
};

export const TOOL_DEFS = [
  {
    name: "list_tasks",
    description:
      "List every task in the LOP with all fields. Use this whenever you need to know what's in the app.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_task",
    description: "Fetch a single task by its numeric ID.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task. Required: taskName, assignee, dueDate. Optional fields default sensibly.",
    input_schema: {
      type: "object",
      properties: taskFields,
      required: ["taskName", "assignee", "dueDate"],
    },
  },
  {
    name: "update_task",
    description:
      "Update one or more fields on an existing task. Only the fields you specify are changed.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        ...taskFields,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Delete a single task by ID. Confirm with the user before calling this if they were not explicit.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "delete_all_tasks",
    description:
      "Delete every task in the LOP. Always confirm with the user in chat before calling this.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "send_inquiry",
    description:
      "Open a pre-filled status-inquiry email to the task's assignee. Returns sent=false if no email is on file.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "set_filters",
    description:
      "Apply search and filters to the visible task list. Pass 'All' or empty string to reset a filter. The label filter matches if a task has that label.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        priority: {
          type: "string",
          enum: ["All", ...(PRIORITIES as unknown as string[])],
        },
        assignee: { type: "string" },
        group: { type: "string" },
        label: { type: "string" },
      },
    },
  },
  {
    name: "set_language",
    description: "Switch the app's UI language.",
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["en-US", "en-GB", "de"] },
      },
      required: ["language"],
    },
  },
  {
    name: "get_app_state",
    description:
      "Get a quick snapshot of the app: today's date, language, holiday countries, storage backend, task count.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_raid",
    description:
      "List all RAID items (Risks, Assumptions, Issues, Dependencies) with id, category, title, status, severity, owner, and stakeholderIds. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_changes",
    description:
      "List all change-control items with id, title, status, impact, decisionDate, and stakeholderIds. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_milestones",
    description:
      "List all project milestones with id, name, target date, and achievedDate (if signed off). Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_stakeholders",
    description:
      "List all stakeholders with id, name, category, influence, interest, organization, and email. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_raid_item",
    description:
      "Create a RAID item (Risk, Assumption, Issue, or Dependency). Required: title. category defaults to R; status defaults to that category's first state.",
    input_schema: {
      type: "object",
      properties: raidFields,
      required: ["title"],
    },
  },
  {
    name: "update_raid_item",
    description: "Update fields on an existing RAID item. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...raidFields },
      required: ["id"],
    },
  },
  {
    name: "delete_raid_item",
    description: "Delete a RAID item by ID. Confirm with the user first unless they were explicit.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "create_change",
    description:
      "Create a change-control item. Required: title. type defaults to Other, status to Proposed.",
    input_schema: {
      type: "object",
      properties: changeFields,
      required: ["title"],
    },
  },
  {
    name: "update_change",
    description: "Update fields on an existing change item. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...changeFields },
      required: ["id"],
    },
  },
  {
    name: "delete_change",
    description: "Delete a change item by ID. Confirm with the user first unless they were explicit.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "create_milestone",
    description: "Create a project milestone. Required: name and date (YYYY-MM-DD).",
    input_schema: {
      type: "object",
      properties: milestoneFields,
      required: ["name", "date"],
    },
  },
  {
    name: "update_milestone",
    description: "Update fields on an existing milestone. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...milestoneFields },
      required: ["id"],
    },
  },
  {
    name: "delete_milestone",
    description: "Delete a milestone by ID. Confirm with the user first unless they were explicit.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "create_stakeholder",
    description:
      "Create a stakeholder. Required: name. category defaults to Other; influence/interest default to Medium.",
    input_schema: {
      type: "object",
      properties: stakeholderFields,
      required: ["name"],
    },
  },
  {
    name: "update_stakeholder",
    description: "Update fields on an existing stakeholder. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...stakeholderFields },
      required: ["id"],
    },
  },
  {
    name: "delete_stakeholder",
    description: "Delete a stakeholder by ID. Confirm with the user first unless they were explicit.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
];

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
  if (input.blockers !== undefined) patch.blockers = asString(input.blockers) ?? "";
  if (input.notes !== undefined) patch.notes = asString(input.notes) ?? "";
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
        blockers: asString(input.blockers),
        notes: asString(input.notes),
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

    case "list_raid":
      return d.listRaid();

    case "list_changes":
      return d.listChanges();

    case "list_milestones":
      return d.listMilestones();

    case "list_stakeholders":
      return d.listStakeholders();

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

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
