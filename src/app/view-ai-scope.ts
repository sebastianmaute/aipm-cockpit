// src/app/view-ai-scope.ts
// Pure, i18n-free registry describing each app view to the AI assistant.
// ENGLISH ONLY and deliberately so: the whole system prompt is English
// regardless of UI language (see `stableInstructions` in chat-api.ts); the
// model is told the active language code and answers in the user's language.
//
// ★ This is NOT an OperatingGuide and must never become one. OperatingGuide
//   carries a `builtIn` flag that makes routing built-ins through the guide
//   store look natural — but the whole guide block is gated by
//   `settings.ai.groundInGuides`, so doing that would let a user preference
//   silently switch off shipped product behavior. Keep these separate.
import type { AppView } from "./nav-config";

export interface ViewScope {
  /** What this surface is and what it shows. One or two sentences. */
  purpose: string;
  /** Tools most relevant here. Every entry MUST name a real tool in TOOL_DEFS
   *  — pinned by view-ai-scope.test.ts. */
  toolHints?: string[];
  /** Domain gloss: how to read what the view displays. */
  reading?: string;
}

/** Total by construction: adding an AppView is a typecheck error until it is
 *  described here. That is why there is no "every view is present" test — it
 *  could not fail. */
export const VIEW_AI_SCOPE: Record<AppView, ViewScope> = {
  projects: {
    purpose:
      "Projects lists every project in the portfolio and lets the user switch which one is active.",
    reading: "All other views show the ACTIVE project only. Tools read the active project's data.",
  },
  "portfolio-health": {
    purpose:
      "Portfolio health compares RAG status and progress across all projects. Turso-only.",
    toolHints: ["get_dashboard_snapshot"],
    reading:
      "get_dashboard_snapshot covers the active project only — there is no tool for cross-project comparison. Say so rather than presenting single-project figures as a portfolio answer.",
  },
  dashboard: {
    purpose:
      "Dashboard is the landing cockpit: RAG status, completion progress, earned-value metrics, KPI tiles and the delta strip.",
    toolHints: ["get_dashboard_snapshot", "list_tasks"],
    reading:
      "When a money figure is null, costUnknownReason says why. Report it as unknown, never as zero.",
  },
  actions: {
    purpose:
      "Next actions ranks what to do now, grouped into Now / Soon / Monitor tiers with a reason per signal.",
    toolHints: ["list_tasks", "list_raid"],
    reading: "Tier reflects urgency; the why-line explains which signal fired.",
  },
  insights: {
    purpose:
      "Insights shows detected project signals and their lifecycle (detected, reconciled, recommended, resolved).",
    toolHints: ["list_tasks", "list_raid"],
  },
  trends: {
    purpose: "Trends charts KPI movement over time from stored snapshots. Turso-only.",
    toolHints: ["get_dashboard_snapshot"],
    reading: "A trend needs at least two snapshots; with one the direction is unknown, not flat.",
  },
  history: {
    purpose: "Version history lists prior saved versions of the workspace. Turso-only.",
  },
  chat: {
    purpose: "The chat surface itself — the user is talking to you directly here.",
  },
  gantt: {
    purpose:
      "Gantt shows the schedule as bars over a date axis, with dependencies, the critical path, baselines and milestones.",
    toolHints: ["list_tasks", "list_milestones"],
    reading:
      "A dependency arrow means finish-to-start unless stated. Critical path = zero slack.",
  },
  milestones: {
    purpose: "Milestones is the register of key dates and their sign-off state.",
    toolHints: ["list_milestones"],
    reading: "A milestone is achieved only when achievedDate is set.",
  },
  resources: {
    purpose: "Resources is the people area: directory, workload, calendar, planning and roles.",
    toolHints: ["list_resources"],
  },
  directory: {
    purpose: "Directory is the roster of people with role, discipline, grade and contact details.",
    toolHints: ["list_resources", "get_resource"],
    reading:
      "Assigning a task to a name does NOT add that person here — the directory is its own register.",
  },
  workload: {
    purpose: "Workload shows capacity versus allocation per person over time.",
    toolHints: ["list_resources", "list_allocations"],
    reading:
      "Overload = allocated exceeds capacity. periodCapacityHours is hours ALREADY ALLOCATED, not hours available.",
  },
  calendar: {
    purpose: "Resource calendar shows meetings and absences on a date grid.",
    toolHints: ["list_calendar_events", "list_resources"],
    reading: "Recurring events are stored once as a series; occurrences are derived from the rule.",
  },
  planning: {
    purpose: "Planning is the allocation grid: planned hours per person per period.",
    toolHints: ["list_allocations", "list_resources"],
  },
  "manage-roles": {
    purpose: "Manage roles maintains the role, discipline and grade reference data.",
    toolHints: ["list_resources"],
  },
  budget: {
    purpose:
      "Budget is the planner: buckets of planned hours per role per period, with cost and margin.",
    toolHints: ["list_budget_buckets", "get_dashboard_snapshot"],
    reading:
      "list_budget_buckets is per-bucket detail; get_dashboard_snapshot is the project rollup. Do not sum buckets to derive a rollup.",
  },
  "budget-report": {
    purpose: "Budget report summarizes planned versus actual spend and earned value.",
    toolHints: ["get_dashboard_snapshot", "list_budget_buckets"],
  },
  raid: {
    purpose:
      "RAID is the register of Risks, Assumptions, Issues and Dependencies, each with an owner and a category-specific status.",
    toolHints: ["list_raid"],
    reading: "Status must match the category. Severity and the probability×impact score drive ranking.",
  },
  "raid-report": {
    purpose: "RAID report aggregates the register by category, severity and owner.",
    toolHints: ["list_raid"],
  },
  changes: {
    purpose: "Changes is the change-control register: requests, their impact and their decisions.",
    toolHints: ["list_changes"],
  },
  "change-report": {
    purpose: "Change report aggregates change requests by state, type and impact.",
    toolHints: ["list_changes"],
  },
  stakeholders: {
    purpose:
      "Stakeholders is the register of people and organizations with influence and interest levels.",
    toolHints: ["list_stakeholders"],
  },
  raci: {
    purpose:
      "RACI maps stakeholders to milestones as Responsible, Accountable, Consulted or Informed.",
    toolHints: ["list_stakeholders", "list_milestones"],
    reading: "Exactly one Accountable per milestone is the norm; more than one is a finding.",
  },
  "stakeholder-map": {
    purpose:
      "Stakeholder map plots stakeholders on an influence-versus-interest grid to show engagement strategy.",
    toolHints: ["list_stakeholders"],
    reading: "High influence + high interest = manage closely; low/low = monitor.",
  },
  knowledge: {
    purpose:
      "Knowledge is the library of standalone documents, Confluence pages and URLs, optionally cross-linked to tasks.",
    toolHints: ["list_knowledge_items"],
  },
  reports: {
    purpose: "Reports summarizes tasks by group, label and assignee with completion statistics.",
    toolHints: ["list_tasks", "get_dashboard_snapshot"],
    reading:
      "Cancelled work is a third bucket: neither open nor completed, and never overdue.",
  },
  activity: {
    purpose: "Activity is the audit log of recent changes made in the app.",
    reading: "You cannot read this log — there is no tool for it. Say so rather than guessing.",
  },
  "open-points": {
    purpose:
      "Open Points is the main task table: every task with status, assignee, due date, priority, blockers, group and labels.",
    toolHints: ["list_tasks", "get_task"],
    reading:
      "Done and Cancelled are both closed, but only Done counts as delivered. Cancelled is never overdue.",
  },
  settings: {
    purpose: "Settings configures the app: modules, appearance, storage, integrations and AI.",
    toolHints: ["get_app_state"],
  },
  help: {
    purpose: "Help explains what the app does and how to use it.",
    reading:
      "This is static explanatory content with no project data behind it and no tool to read it. Answer questions about the user's actual project from tools, not from this view.",
  },
  "learning-insights": {
    purpose:
      "Learning insights shows what the next-actions engine has learned from the user's accept and dismiss decisions.",
  },
  "steering-committee": {
    purpose:
      "Steering committee holds board membership, meeting cadence and the information-pack schedule.",
    toolHints: ["list_stakeholders", "list_milestones"],
  },
  timelog: {
    purpose: "Timelog links external time-tracking entries to resources and budget buckets.",
    reading:
      "You cannot read booked time entries — there is no tool for it. Say so rather than estimating.",
  },
};
