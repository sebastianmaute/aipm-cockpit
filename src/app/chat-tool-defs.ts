// src/app/chat-tool-defs.ts — Anthropic tool SCHEMAS for the AI assistant:
// the `tools` array (`TOOL_DEFS`) plus the per-entity field-property helpers
// that build it. Pure data; the dispatcher contract + `runTool` routing +
// arg-coercion live in chat-tools.ts (which re-exports `TOOL_DEFS`).
import {
  ASSUMPTION_STATUSES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  DEPENDENCY_STATUSES,
  DEPENDENCY_TYPES,
  INFLUENCE_INTEREST_LEVELS,
  ISSUE_STATUSES,
  PRIORITIES,
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  RISK_STATUSES,
  STAKEHOLDER_CATEGORIES,
  TASK_STATUSES,
} from "./types";
import { DOCUMENT_TOOL_DEFS } from "./chat-tool-defs-documents";
// ★ The ADVERTISED token field is declared beside the code that ENFORCES it
//   (`requireToken`), so the schema and the refusal cannot drift apart.
import { expectedTokenField } from "./chat-tools-updates";
// ★ INTERPOLATED, never a literal number in the prose: search_history's
//   description tells the model how many events the log retains, and a
//   hardcoded copy would go quietly false the day the cap moves.
import { ACTIVITY_MAX_ENTRIES } from "./activity-log";
// ★ Same rule for search_chats: its default, ceiling and per-message excerpt
//   caps are EXPORTED constants, so the prose interpolates them rather than
//   restating numbers that go quietly false the day one of them moves.
import { CHAT_EXCERPT_MAX, DEFAULT_CHAT_LIMIT, MAX_CHAT_LIMIT } from "./chat-search";

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
      "List the tasks in the app. Use this whenever you need to know what's in the app. Returns `{items, total}` — `total` is ALWAYS the number of tasks that exist, so you never need a second call to count them. Each item carries every task field, with `description` and each `noteLog` entry projected to PLAIN TEXT (the markup is stripped); call get_task when you need a description's original HTML, e.g. before editing it.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Optional. Return at most this many tasks. `total` always reports the full count.",
        },
      },
    },
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
        ...expectedTokenField,
        ...taskFields,
      },
      required: ["id", "expectedToken"],
    },
  },
  {
    name: "set_task_dependencies",
    description:
      "REPLACE the entire predecessor-link list of one task — this is not a merge or an add. Any existing link you do not include in `dependencies` is REMOVED, even if you only meant to add one new link; call list_tasks (or re-send the task's current links plus your addition) first if you want to keep what is already there. A dependency lives on the DEPENDENT task and points at its PREDECESSOR: {taskId: 12, type: 'FS'} on task 40 means task 40 starts after task 12 finishes. Types: FS (finish-to-start), SS (start-to-start), FF (finish-to-finish), SF (start-to-finish). Pass an empty array to clear all links. Links that would create a cycle, point at a task that does not exist, or point at the task itself are refused and reported back in the result — read `rejected` and tell the user what could not be linked. The result also carries `removed`: every link that existed before this call and is gone afterward (whether because it was omitted from your list or because the whole write was refused to protect existing links — read `dependencies` for what is actually stored now). ALWAYS read `removed` and tell the user what was dropped, even when `rejected` is empty — a silently-dropped link is worse than a refused one. Use list_tasks first to see the current graph.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Id of the task whose links are being replaced." },
        dependencies: {
          type: "array",
          description: "The complete new list of predecessor links. An empty array clears them.",
          items: {
            type: "object",
            properties: {
              taskId: { type: "number", description: "Id of the PREDECESSOR task." },
              type: { type: "string", enum: DEPENDENCY_TYPES as unknown as string[] },
            },
            required: ["taskId", "type"],
          },
        },
      },
      required: ["id", "dependencies"],
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
    name: "get_dashboard_snapshot",
    description:
      "Read the project's current health: RAG ratings (overall, schedule, budget, scope) with whether each was manually overridden, completion progress, earned-value metrics (PV/EV/AC/SPI/CPI), the budget rollup (hours, value, cost, margin, EV, CPI), and counts of overdue tasks, due-soon tasks, open RAID items, overdue and at-risk milestones, and changes by state. Read-only. When a money figure is null, `costUnknownReason` says why the cost basis is unsound — report it as unknown, never as zero. This applies even when `cost` is null but `earnedValue`/`costPerformanceIndex` are not — do NOT back-derive a cost from them (cost = earnedValue / costPerformanceIndex); report cost as unknown instead.",
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
    name: "list_allocations",
    description:
      "Read the resource planning grid: the plan window, its granularity, the valid period keys, and each resource's planned load per period. Each cell reports the stored value with its unit (percent or hours), what that means in hours, and the capacity available in that period. Only non-zero cells are listed. Each resource carries its own `truncated` flag: `truncated: false` with an empty `cells` array means that resource genuinely has no planned load; `truncated: true` means some or all of its load could not be read (the size cap was hit) — treat that resource's load as UNKNOWN, not zero, and say so rather than asserting it has none. Read-only — planning changes are made in the app's Plan-with-AI review, not from chat.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_knowledge_items",
    description:
      "List the standalone Knowledge-library items (documents, Confluence pages, URLs) with id, name, url, linkKind (document/confluence/url), and the task ids they're linked to. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_calendar_events",
    description:
      "List resource-calendar meetings with id, title, startDate, startTime, durationMinutes, location, notes, attendeeResourceIds, the recurrence rule, and its exceptions. Recurring events are returned ONCE as their series definition, not expanded per occurrence — compute occurrences yourself from the rule, then apply exceptions: each exception overrides one date, either kind 'skip' (that occurrence is cancelled — drop it) or kind 'move' (that occurrence is relocated to toDate/toTime — do not also emit it on its original date). Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_budget_buckets",
    description:
      "List budget planner buckets with id, name, status, window (startDate/endDate), and per-role planned (budget) hours by period. This is PER-BUCKET detail. For project-level totals (hours, value, cost, margin, EV, CPI) call get_dashboard_snapshot instead — do NOT sum these buckets to derive a rollup, and do not report both as if they were independent figures. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_history",
    // ★★★ THE DESCRIPTION CARRIES ONE BLIND SPOT AND ONE ACTOR DISCLOSURE, AND
    //  BOTH ARE LOAD-BEARING, NOT HEDGING BLOAT.
    //  (1) ACTOR: this used to be a COVERAGE blind spot — `logActivity` was
    //      handed to `useDocumentTools` ALONE, so every chat write handler
    //      (createTask/updateTask/deleteTask and every register write) mutated
    //      state and logged NOTHING, and the description had to say so or the
    //      model would deny its own work. THAT GAP IS CLOSED: the dispatcher's
    //      entity writers now log with `actor: "ai"` — verify with
    //      `grep -c 'logActivityAs?.("ai"' src/app/use-chat-dispatcher.ts
    //      src/app/use-register-tools.ts`, which returns 11 and 12 — 23 writers,
    //      against the 1 a bare `grep -c logActivity` found when this caveat was
    //      written. ★★ TWO CHANGES from that original spelling, both deliberate.
    //      BOTH FILES: the register writers were extracted to the second, so a
    //      dispatcher-only grep silently stops at 11. And the CALL-SITE pattern,
    //      not the bare name: the bare one counts prose too, so it moved 17 -> 19
    //      and 16 -> 20 within one review round purely from comments being
    //      edited — including the commit that first wrote those two numbers here.
    //      This pattern moves only when a writer is added or removed.
    //      What replaced it is
    //      the ACTOR caution, and it is the narrower true claim: `actor` is
    //      OPTIONAL, an absent one means the entry is UNATTRIBUTABLE (older
    //      than the field, or written by a path that cannot see its own cause —
    //      `task-manager`'s debounced `settings.updated` logger is the one
    //      surviving production example), and reading absence as "the user did
    //      this" attributes work to a person who may not have done it.
    //      ★★★ THE CAUSES ARE EXAMPLES, NEVER A LIST — the description says "for
    //      example" for that reason. There is already a THIRD cause and it is
    //      the one a FUTURE release creates: `sanitizeActivityEntry` KEEPS an
    //      unknown-but-string `actor` (forward-compat, same reason it keeps an
    //      unknown `kind`), but `renderActivityEntry`'s `knownActor` then drops
    //      it from the rendered payload. So an entry a newer client stamped
    //      `actor: "scheduler"` reaches the model with NO actor while being
    //      neither older than the field nor written by a blind path. State the
    //      PROPERTY; enumerate nothing.
    //      Wording deliberately mirrors `view-ai-scope.ts`'s `activity.reading`
    //      — one claim, two surfaces, so they cannot drift apart.
    //  (2) RETENTION: the log is capped at `ACTIVITY_MAX_ENTRIES`, so an empty
    //      result for an OLD range is indistinguishable from a quiet period.
    //      `truncated` cannot cover this — it reports what the CAPPED LOG held,
    //      never what the cap already dropped. STILL TRUE; do not delete it.
    //  ★★ Note the shape of the retired claim: it stated a LIMITATION, and a
    //  later slice closed it while nothing in the build could see the prose go
    //  stale. `chat-tools.test.ts` now pins the retired sentence's ABSENCE as
    //  well as the actor disclosure's PRESENCE — an absence assertion alone is
    //  vacuous (it passes on an empty description), so the pair is the guard.
    description:
      "Search this project's activity history — the audit trail of changes made in this project: " +
      "through the app's own UI, by its integrations, and by you (creates, updates, deletes, " +
      "status changes, syncs), newest " +
      "first. Use it for questions about what CHANGED and WHEN (\"what happened last week\", \"who " +
      "moved that milestone\", \"what did this field say before\"); use the list_* tools for " +
      "current state. Each event has an ISO timestamp carrying the project's UTC offset — quote " +
      "that wall clock, it is the one the user's own Activity view shows — an English summary, " +
      "and an optional detail " +
      "string carrying the field-level before/after diff. Each " +
      "event may carry an `actor` (`user`, `ai` or `integration`) saying which. Never attribute " +
      "an entry whose actor is absent: an absent actor is unattributable (for example it may be " +
      "older than this field, or written by a path that could not tell who acted), and it is NOT " +
      "evidence the user did it. Answer confidently " +
      "from the events you DO get back, but never read an empty result as proof that nothing " +
      "happened: the log keeps " +
      `only the most recent ${ACTIVITY_MAX_ENTRIES} events and drops the oldest beyond that, so an ` +
      "older range can come back empty because those events aged out rather than because the period " +
      "was quiet. Say so instead of asserting the change never happened. If " +
      "`truncated` is true, more events matched than were returned — say so rather than implying " +
      "the list is complete. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive substring matched against the summary and diff detail.",
        },
        // ★★ THE FRAME OF REFERENCE IS PART OF THE CONTRACT. These bounds are
        //    resolved in the project's timezone — the same zone the `Today is`
        //    date in the system prompt is computed in and the same one the
        //    Activity panel renders in. Saying so is what lets the model treat
        //    that date as a usable bound; without it, "today" is ambiguous
        //    between two calendars that differ for hours of every day.
        since: {
          type: "string",
          description:
            "Inclusive lower bound as YYYY-MM-DD, in the project's timezone — the same " +
            "calendar as the `Today is` date you were given. Convert relative phrasing yourself.",
        },
        until: {
          type: "string",
          description: "Inclusive upper bound as YYYY-MM-DD, in the project's timezone.",
        },
        kinds: {
          type: "array",
          items: { type: "string" },
          description:
            'Restrict to specific event kinds, e.g. ["task.updated", "milestone.deleted"].',
        },
        limit: {
          type: "number",
          description: "Max events to return. Defaults to 50, capped at 200.",
        },
      },
    },
  },
  {
    name: "search_chats",
    // ★★★ THE COVERAGE DISCLOSURE IS LOAD-BEARING, NOT HEDGING. Threads are
    //  Turso-only by construction, so in file mode there is nothing to search —
    //  and an empty `hits` array looks identical either way. Without the
    //  `coverage` field and this sentence, the model reports "I searched your
    //  past conversations and found nothing" to every file-mode user, forever.
    // ★★ The ACTIVE thread is deliberately absent from results: it is already
    //  verbatim in this request, so saying so stops the model concluding its own
    //  conversation has gone missing.
    // ★★ A hit's `title` is `threadTitle` — the thread name the USER set whenever
    //  they set one, and only otherwise the one derived from the first user
    //  message. The description therefore says "its title" and never "its first
    //  message": a renamed thread would otherwise be described to the model under
    //  a title that appears nowhere in the user's sidebar.
    description:
      "Search this project's PAST chat conversations — the threads you and the user have had " +
      "before this one, newest first. Use it when the user refers to something you discussed " +
      "earlier (\"did we already decide…\", \"what did I tell you about…\", \"we talked about this\"), " +
      "or when you need a decision or piece of context that is not in the project's current " +
      "state. Use the list_* tools for current state and search_history for what CHANGED. " +
      "Each hit is one thread: its id, its title, the time it " +
      "was last updated (carrying the project's UTC offset), and the messages that matched. " +
      "The conversation you are in right now is NEVER returned — you already have it in full. " +
      "Check `coverage` before you answer: `turso` means past conversations were searched, and " +
      "`unavailable` means they were not, so an empty result is NOT " +
      "evidence that nothing was discussed — say you cannot look rather than that you found " +
      "nothing. If `truncated` is true, or a hit's `moreMessages` is above zero, more matched " +
      "than you were given — say so rather than implying the list is complete. A long message is " +
      `shortened to its first ${CHAT_EXCERPT_MAX} characters; such a message carries \`clipped\`: ` +
      "true, so treat its text as a partial excerpt — quote it as one, never as the message " +
      "in full. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive substring matched against message text.",
        },
        // ★★ Same frame-of-reference contract as search_history: these bounds
        //    resolve in the project's timezone, the same calendar as the
        //    `Today is` date in the system prompt.
        since: {
          type: "string",
          description:
            "Inclusive lower bound as YYYY-MM-DD, in the project's timezone — the same " +
            "calendar as the `Today is` date you were given. Convert relative phrasing yourself. " +
            "It filters on when the THREAD was last updated, NOT on when individual messages " +
            "were sent: a conversation held earlier but touched since will not match an earlier " +
            "bound, and one matching a recent bound may be months old inside.",
        },
        until: {
          type: "string",
          description:
            "Inclusive upper bound as YYYY-MM-DD, in the project's timezone. Like `since`, it " +
            "filters on the THREAD's last-update time, not on individual message times.",
        },
        limit: {
          type: "number",
          description:
            `Maximum MESSAGES to return across all threads (default ${DEFAULT_CHAT_LIMIT}, ` +
            `maximum ${MAX_CHAT_LIMIT}). ` +
            "Threads are not capped — every thread holding a match is eligible.",
        },
      },
    },
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
      properties: { id: { type: "number" }, ...expectedTokenField, ...resourceFields },
      required: ["id", "expectedToken"],
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
      properties: { id: { type: "number" }, ...expectedTokenField, ...raidFields },
      required: ["id", "expectedToken"],
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
      properties: { id: { type: "number" }, ...expectedTokenField, ...changeFields },
      required: ["id", "expectedToken"],
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
      properties: { id: { type: "number" }, ...expectedTokenField, ...milestoneFields },
      required: ["id", "expectedToken"],
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
      properties: { id: { type: "number" }, ...expectedTokenField, ...stakeholderFields },
      required: ["id", "expectedToken"],
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
          enum: ["table", "board", "swimlane"],
          description: "Open Points layout: sortable table, Kanban board, or person swimlanes.",
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
  ...DOCUMENT_TOOL_DEFS,
];
