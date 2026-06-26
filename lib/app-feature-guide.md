# App Feature Guide

Per-view reference for the AI assistant: what each surface does and what the assistant can or cannot do there via its tools.

## Overview

- Covers portfolio and project delivery: open points (tasks), action center, dashboards, trends, RAID, change control, milestones and Gantt, stakeholders and RACI, steering committee, reports, budget, calendar, documents, and settings.
- Recent additions: task status model + Table/Board (Kanban) toggle, steering committee, guided tour with demo data, timezones (incl. the calendar world-clock strip), AI weight suggestions / report analysis / opt-in scheduled jobs, create-project from a description / file / SharePoint / Confluence, and editable communication templates.

## Open Points

<!-- views: open-points -->

- The task list ("Open Points") for the active project, with a Table/Board (Kanban) toggle.
- Status model: To Do, In Progress, On Hold, In Review, Cancelled, Done — Done auto-stamps a completed date.
- Tasks can link to RAID items (a task may resolve a risk, issue, or dependency).
- Jira-synced tasks (those with a Jira key) are read-only here: status and assignee are managed in Jira.
- AI: create/update tasks including setting status; cannot toggle the Board view or change a Jira-synced task's status (explain + point to Jira).

## Action Center

<!-- views: actions -->

- Ranked "suggested next actions" derived from project signals, each with one-click CTAs (create task, assign owner, escalate, draft message, re-baseline).
- "Analyze with AI" runs a one-off advisory portfolio analysis.
- The ranking engine is deterministic; AI analysis is advisory and adds no automatic changes.
- AI: advisory only here, but can act on a suggested record using the task and RAID tools (e.g. create the task a suggestion describes).

## AI assistant

<!-- views: chat -->

- This chat. Ask about the project, get explanations, or have records created/updated.
- Attach documents (PDF, image, text) — they are read natively and records can be extracted from them.
- Reads the live workspace via list tools for grounded answers.
- AI: that's me — I can create/update/delete tasks, RAID items, change items, milestones, and stakeholders, and read everything else.

## Dashboard

<!-- views: dashboard -->

- Project health RAG, completion percentage, budget summary, and EVM (earned-value) metrics.
- A read-only at-a-glance view; no records are edited here.
- AI: read-only context for answers; there is no dashboard tool — point the user to the underlying entity (tasks/budget) to change figures.

## Trends

<!-- views: trends -->

- Snapshot-based trend charts (schedule, budget, health over time); Turso storage only.
- Each snapshot is a point-in-time baseline the user captures.
- AI: read-only; can summarize trends but cannot capture snapshots.

## Reports

<!-- views: reports,budget-report,raid-report,change-report -->

- Composable budget, RAID, and change reports for sharing and export.
- Layout and section ordering are user-configured per report.
- AI: can read the underlying records to answer questions; cannot change report layout (user UI action).

## RAID

<!-- views: raid,raid-report -->

- Risks, Assumptions, Issues, Dependencies — severity, owner, status, and stakeholder links.
- Items can link to tasks and feed Action Center signals (e.g. at-risk, no owner).
- AI: full create/update/delete of RAID items, including owner and severity.

## Changes

<!-- views: changes,change-report -->

- Change-control register: requested changes with status, impact, and approvals.
- Items can carry stakeholder links for comms reminders.
- AI: full create/update/delete of change-control items.

## Milestones & Gantt

<!-- views: milestones,gantt -->

- Project timeline: milestones with dates plus the Gantt view; "Add milestone" available from the Gantt.
- Milestones can be pushed to Outlook as calendar events.
- AI: create/update/delete milestones; cannot push a milestone to Outlook (user action via the calendar/milestone control).

## Stakeholders

<!-- views: stakeholders,raci,stakeholder-map -->

- Stakeholder register, the RACI matrix, and the stakeholder (influence/interest) map.
- Stakeholders drive comms reminders and can be linked from RAID and change items.
- AI: full create/update/delete of stakeholders; RACI assignments and the map are edited in the UI.

## Steering committee

<!-- views: steering-committee -->

- Committee members, scheduled meetings, info-pack reminders, and Outlook meeting push.
- User-edited content (membership and agendas are maintained here, not via tools).
- AI: can explain the area and draft agendas or summaries in chat; there is no steering-committee write tool.

## Calendar

<!-- views: calendar -->

- Resource calendar plus a live multi-timezone world-clock strip (the default zone and any additional zones the user adds).
- Zones for the strip are configured in Settings.
- AI: can explain the calendar and timezone strip; there is no calendar tool to add events or zones.

## Settings

<!-- views: settings -->

- Storage backend, timezone (default, per-project, and additional clock zones), AI configuration, opt-in scheduled jobs, guided-tour replay, and next-action weights.
- Secrets (API key, auth token) are stored encrypted at rest.
- A **guided backend setup wizard** (Settings → Integrations → "Run setup wizard") steps through storage, AI, Jira, Timelog, and shows a configured/not-configured summary — the same wizard is also reachable from the new-project window. Users can skip any integration step and return to the flat Integrations panel to adjust settings at any time.
- AI: can explain where each setting lives and what it does; cannot open or run the setup wizard (it is a UI affordance only).
