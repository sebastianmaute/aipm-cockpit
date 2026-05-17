import { sanitizeGroup, sanitizeLabels } from "./sanitize";
import { PRIORITIES, type Priority, type Task } from "./types";
import type { Lang } from "./i18n";

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

export type ToolDispatcher = {
  listTasks(): Task[];
  getTask(id: number): Task | null;
  createTask(input: TaskInput): Task;
  updateTask(id: number, patch: Partial<Task>): Task | null;
  deleteTask(id: number): boolean;
  deleteAllTasks(): number;
  sendInquiry(id: number): { sent: boolean; reason?: string };
  setFilters(filters: Filters): void;
  setLanguage(lang: Lang): void;
  getSnapshot(): {
    today: string;
    language: Lang;
    holidayCountries: string[];
    storageKind: string;
    taskCount: number;
    knownGroups?: string[];
    knownLabels?: string[];
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

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
