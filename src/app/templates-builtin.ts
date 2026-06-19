import type { ProjectTemplate, TemplateSeed } from "./templates";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { applyTier, type FieldVisibilityConfig } from "./field-visibility";
import { MODAL_IDS, type FieldTier } from "./modal-fields";
import type { Milestone, RaidItem, Stakeholder, Task } from "./types";

/** Build a full field-visibility config by stamping one tier across every modal. */
function fvAll(tier: FieldTier): FieldVisibilityConfig {
  const cfg: FieldVisibilityConfig = {};
  for (const id of MODAL_IDS) cfg[id] = applyTier(id, tier);
  return cfg;
}

/** The "Standard PM" subset: classic project tracking without the heavier modules. */
const STANDARD_FEATURES: FeatureModuleId[] = [
  "dashboard",
  "gantt",
  "milestones",
  "raid",
  "changes",
];

/** A bare task with only the fields the seed needs; assignees stay empty and no
 *  resource FKs are seeded (those would dangle against an empty new project). */
function task(
  id: number,
  taskName: string,
  extra: Partial<Task> = {},
): Task {
  return {
    id,
    taskName,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    notes: "",
    ...extra,
  };
}

// ── builtin-minimal ─────────────────────────────────────────────────────────
const MINIMAL_TASKS: Task[] = [
  task(1, "Kickoff", { notes: "Agree on goals, scope, and the people involved." }),
  task(2, "Plan the work", {
    notes: "Break the goal into concrete, checkable steps.",
    dependencies: [{ taskId: 1, type: "FS" }],
  }),
  task(3, "Wrap up", {
    notes: "Confirm the outcome and capture any follow-ups.",
    dependencies: [{ taskId: 2, type: "FS" }],
  }),
];

const MINIMAL_SEED: TemplateSeed = { tasks: MINIMAL_TASKS };

// ── builtin-standard ────────────────────────────────────────────────────────
const STANDARD_TASKS: Task[] = [
  // Initiation
  task(1, "Define project goals", { group: "Initiation", priority: "High" }),
  task(2, "Identify stakeholders", {
    group: "Initiation",
    dependencies: [{ taskId: 1, type: "FS" }],
  }),
  task(3, "Draft project charter", {
    group: "Initiation",
    dependencies: [{ taskId: 1, type: "FS" }],
  }),
  // Planning
  task(4, "Build work breakdown", {
    group: "Planning",
    dependencies: [{ taskId: 3, type: "FS" }],
  }),
  task(5, "Estimate effort and schedule", {
    group: "Planning",
    dependencies: [{ taskId: 4, type: "FS" }],
  }),
  task(6, "Assemble the team", { group: "Planning" }),
  task(7, "Plan the budget", {
    group: "Planning",
    dependencies: [{ taskId: 5, type: "FS" }],
  }),
  // Execution
  task(8, "Execute first phase", {
    group: "Execution",
    priority: "High",
    dependencies: [{ taskId: 5, type: "FS" }],
  }),
  task(9, "Track progress and risks", { group: "Execution" }),
  task(10, "Review with stakeholders", {
    group: "Execution",
    dependencies: [{ taskId: 8, type: "FS" }],
  }),
  // Closure
  task(11, "Capture lessons learned", { group: "Closure" }),
  task(12, "Close out the project", {
    group: "Closure",
    dependencies: [{ taskId: 10, type: "FS" }],
  }),
];

const STANDARD_MILESTONES: Milestone[] = [
  {
    id: 1,
    name: "Planning complete",
    date: "2026-01-31",
    linkedTaskIds: [4, 5, 7],
  },
  {
    id: 2,
    name: "First phase delivered",
    date: "2026-03-31",
    linkedTaskIds: [8, 10],
  },
  {
    id: 3,
    name: "Project closed",
    date: "2026-06-30",
    linkedTaskIds: [11, 12],
  },
];

const STANDARD_SEED: TemplateSeed = {
  tasks: STANDARD_TASKS,
  milestones: STANDARD_MILESTONES,
};

// ── builtin-full ────────────────────────────────────────────────────────────
const FULL_TASKS: Task[] = [
  // Initiation
  task(1, "Capture business case", { group: "Initiation", priority: "High" }),
  task(2, "Define objectives and success criteria", { group: "Initiation" }),
  task(3, "Identify stakeholders", {
    group: "Initiation",
    dependencies: [{ taskId: 2, type: "FS" }],
  }),
  task(4, "Map stakeholder influence and interest", {
    group: "Initiation",
    dependencies: [{ taskId: 3, type: "FS" }],
  }),
  task(5, "Approve project charter", {
    group: "Initiation",
    priority: "High",
    dependencies: [{ taskId: 1, type: "FS" }],
  }),
  task(6, "Set up project tooling", { group: "Initiation" }),
  // Planning
  task(7, "Build work breakdown structure", {
    group: "Planning",
    dependencies: [{ taskId: 5, type: "FS" }],
  }),
  task(8, "Estimate effort", {
    group: "Planning",
    dependencies: [{ taskId: 7, type: "FS" }],
  }),
  task(9, "Build the schedule", {
    group: "Planning",
    dependencies: [{ taskId: 8, type: "FS" }],
  }),
  task(10, "Plan the budget", {
    group: "Planning",
    dependencies: [{ taskId: 8, type: "FS" }],
  }),
  task(11, "Plan resources and roles", { group: "Planning" }),
  task(12, "Assess initial risks", { group: "Planning" }),
  task(13, "Define quality and acceptance criteria", { group: "Planning" }),
  task(14, "Agree the communications plan", { group: "Planning" }),
  // Execution
  task(15, "Mobilise the team", {
    group: "Execution",
    dependencies: [{ taskId: 9, type: "FS" }],
  }),
  task(16, "Deliver phase one", {
    group: "Execution",
    priority: "High",
    dependencies: [{ taskId: 15, type: "FS" }],
  }),
  task(17, "Deliver phase two", {
    group: "Execution",
    dependencies: [{ taskId: 16, type: "FS" }],
  }),
  task(18, "Manage changes and scope", { group: "Execution" }),
  task(19, "Track risks and issues", { group: "Execution" }),
  task(20, "Report status to stakeholders", { group: "Execution" }),
  // Monitoring & Closure
  task(21, "Run quality reviews", { group: "Monitoring" }),
  task(22, "Secure stakeholder acceptance", {
    group: "Closure",
    dependencies: [{ taskId: 17, type: "FS" }],
  }),
  task(23, "Capture lessons learned", { group: "Closure" }),
  task(24, "Close out and hand over", {
    group: "Closure",
    priority: "High",
    dependencies: [{ taskId: 22, type: "FS" }],
  }),
];

const FULL_MILESTONES: Milestone[] = [
  {
    id: 1,
    name: "Charter approved",
    date: "2026-01-15",
    linkedTaskIds: [5],
  },
  {
    id: 2,
    name: "Planning baseline set",
    date: "2026-02-15",
    linkedTaskIds: [9, 10, 11],
  },
  {
    id: 3,
    name: "Delivery complete",
    date: "2026-05-31",
    linkedTaskIds: [16, 17],
  },
  {
    id: 4,
    name: "Project closed",
    date: "2026-06-30",
    linkedTaskIds: [22, 24],
  },
];

const FULL_RAID: RaidItem[] = [
  {
    id: 1,
    category: "R",
    title: "Scope may expand beyond the agreed baseline",
    status: "Open",
    description: "Unmanaged scope growth could threaten the schedule and budget.",
    mitigation: "Run all change requests through the change-control process.",
    probability: 3,
    impact: 4,
    linkedTaskIds: [18],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "",
    targetDate: "",
    closedDate: "",
  },
  {
    id: 2,
    category: "A",
    title: "Required resources are available on schedule",
    status: "Open",
    description: "Plans assume the team is staffed by the mobilisation date.",
    linkedTaskIds: [15],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "",
    targetDate: "",
    closedDate: "",
  },
  {
    id: 3,
    category: "I",
    title: "Acceptance criteria are not yet fully agreed",
    status: "Open",
    description: "Ambiguous acceptance criteria risk disputes at sign-off.",
    linkedTaskIds: [13, 22],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "",
    targetDate: "",
    closedDate: "",
  },
];

const FULL_STAKEHOLDERS: Stakeholder[] = [
  {
    id: 1,
    name: "Project Sponsor",
    category: "Sponsor",
    influence: "High",
    interest: "High",
    raci: {},
  },
  {
    id: 2,
    name: "Delivery Lead",
    category: "Internal",
    influence: "Medium",
    interest: "High",
    raci: {},
  },
];

const FULL_SEED: TemplateSeed = {
  tasks: FULL_TASKS,
  milestones: FULL_MILESTONES,
  raid: FULL_RAID,
  stakeholders: FULL_STAKEHOLDERS,
};

/**
 * In-code starter templates mapped to the app's Simple / Modular / Advanced
 * tiers. These are code constants — never persisted — and `builtIn` is honored
 * only here, never decoded from stored data.
 */
export const BUILT_IN_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "builtin-minimal",
    name: "Minimal",
    description:
      "A bare task list for lightweight work — no extra modules, just the essentials.",
    builtIn: true,
    features: [],
    fieldVisibility: fvAll("simple"),
    seed: MINIMAL_SEED,
  },
  {
    id: "builtin-standard",
    name: "Standard PM",
    description:
      "Classic project tracking: phased tasks, a Gantt view, milestones, RAID, and change control.",
    builtIn: true,
    features: STANDARD_FEATURES,
    fieldVisibility: fvAll("advanced"),
    seed: STANDARD_SEED,
  },
  {
    id: "builtin-full",
    name: "Full delivery",
    description:
      "Every module enabled, with a full delivery skeleton: phased tasks, milestones, RAID, and stakeholders.",
    builtIn: true,
    features: [...ALL_MODULE_IDS],
    fieldVisibility: fvAll("full"),
    seed: FULL_SEED,
  },
];
