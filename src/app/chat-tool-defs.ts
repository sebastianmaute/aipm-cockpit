// src/app/chat-tool-defs.ts — Anthropic tool SCHEMAS for the AI assistant:
// the `tools` array (`TOOL_DEFS`) plus the per-entity field-property helpers
// that build it. Pure data; the dispatcher contract + `runTool` routing +
// arg-coercion live in chat-tools.ts (which re-exports `TOOL_DEFS`).
import {
  ASSUMPTION_STATUSES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  DEPENDENCY_STATUSES,
  INFLUENCE_INTEREST_LEVELS,
  ISSUE_STATUSES,
  PRIORITIES,
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  RISK_STATUSES,
  STAKEHOLDER_CATEGORIES,
  TASK_STATUSES,
} from "./types";

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

const resourceFields = {
  firstName: { type: "string" as const, description: "Given name" },
  lastName: { type: "string" as const, description: "Family name" },
  name: {
    type: "string" as const,
    description: "Full name — used only when firstName/lastName aren't given (it is split).",
  },
  email: { type: "string" as const, description: "Primary email address" },
  emails: {
    type: "array" as const,
    items: { type: "string" as const },
    description: "Additional email addresses beyond the primary email",
  },
  title: { type: "string" as const, description: "Job title / role" },
  department: { type: "string" as const, description: "Department" },
  company: { type: "string" as const, description: "Company / employer" },
  location: { type: "string" as const, description: "Office / location" },
  businessPhone: { type: "string" as const, description: "Business phone number" },
  isExternal: {
    type: "boolean" as const,
    description: "External resource: planned/capacity-tracked but excluded from all cost/budget figures",
  },
  roleId: {
    type: "number" as const,
    description: "Rate-card role id (assigns the resource's discipline + grade + rates)",
  },
  notes: { type: "string" as const, description: "Free-text notes" },
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
  status: {
    type: "string" as const,
    enum: TASK_STATUSES as unknown as string[],
    description:
      "Task status: To Do, In Progress, On Hold, In Review, Cancelled, or Done. Defaults to To Do on create. Cannot be changed for Jira-synced tasks.",
  },
  blockers: { type: "string" as const, description: "What's blocking progress" },
  description: {
    type: "string" as const,
    description: "Free-form task description (plain text; formatting applied automatically)",
  },
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
      "List every task in the app with all fields. Use this whenever you need to know what's in the app.",
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
      "Delete every task in the app. Always confirm with the user in chat before calling this.",
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
    name: "list_resources",
    description:
      "List the people in the resource directory (id, firstName, lastName, email, title, department). Read-only. Call this before creating a resource to avoid duplicates.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_resource",
    description:
      "Add a person to the resource directory. Provide firstName and lastName, OR a single full `name` (it is split). At least one of these is required — a call with no name is rejected. Use this when a document describes a team/resource plan — assigning a task to a name alone does NOT create a directory entry. Discipline/grade are assigned in the app, not here.",
    input_schema: {
      type: "object",
      properties: resourceFields,
    },
  },
  {
    name: "get_resource",
    description: "Fetch a single resource by ID (all directory fields). Read-only.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "update_resource",
    description: "Update fields on an existing resource. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...resourceFields },
      required: ["id"],
    },
  },
  {
    name: "delete_resource",
    description: "Delete a resource from the directory by ID. Confirm with the user first unless they were explicit.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
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
  {
    name: "update_settings",
    description:
      "Update a SAFE subset of the app's own settings when the user asks to change how the app looks or behaves: dashboard density, per-view hint banners, the Open Points table/board/swimlane mode and its hide-externals filter, which feature modules are enabled, and next-actions ranking weights. It CANNOT touch API keys, secrets, storage/backends, or any integration credential. All values are validated and clamped; unknown fields are ignored. Only pass the fields the user wants changed.",
    input_schema: {
      type: "object",
      properties: {
        dashboardDensity: {
          type: "string",
          enum: ["comfortable", "compact"],
          description: "Dashboard spacing density.",
        },
        showViewHints: {
          type: "boolean",
          description: "Whether the per-view 'Learn more' hint banners are shown.",
        },
        tasksViewMode: {
          type: "string",
          enum: ["table", "board"],
          description: "Open Points layout: sortable table or Kanban board.",
        },
        hideExternalTasks: {
          type: "boolean",
          description: "Whether Open Points hides tasks owned by external resources.",
        },
        enabledModules: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "dashboard",
              "trends",
              "gantt",
              "milestones",
              "resources",
              "budget",
              "raid",
              "changes",
              "stakeholders",
              "history",
              "knowledge",
              "timelog",
            ],
          },
          description:
            "The COMPLETE set of feature modules that should be enabled (this REPLACES the current set — include every module the user wants on). Invalid ids are dropped. Call get_app_state first to see the current enabledModules.",
        },
        nextActionsWeights: {
          type: "object",
          description:
            "Map of next-actions ranking/tuning field → numeric value. Unknown fields are ignored and every value is clamped to its safe range.",
        },
      },
    },
  },
];
