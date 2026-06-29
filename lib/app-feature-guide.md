# App Feature Guide

Per-view reference for the AI assistant: what each surface does and what the assistant can or cannot do there via its tools.

## Overview

- Covers portfolio and project delivery: open points (tasks), action center, dashboards, trends, RAID, change control, milestones and Gantt, stakeholders and RACI, steering committee, reports, budget, resources and capacity, calendar, documents, time bookings, version history, the portfolio-health rollup, and settings.
- Recent additions: task status model + Table/Board (Kanban) toggle, steering committee, guided tour with demo data, timezones (incl. the calendar world-clock strip), AI weight suggestions / report analysis / opt-in scheduled jobs, create-project from a description / file / SharePoint / Confluence, editable communication templates, the Timelog time-booking integration, and the Turso-only portfolio-health rollup.
- Tip for the user: most views have an "Ask Claude" button (and an "Explain this" prompt) that opens this assistant with a view-aware question.

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
- All signals for one item are now grouped into a single row, with a "+N more reasons" expander; each tier caps its rows with a show-more control so the list stays short.
- Each row carries a colour-coded urgency stripe and a "⋮" overflow menu, and the Center now flags unassigned, stale, blocked, and dependency-blocked tasks.
- You can resolve items in place — assign an owner, mark done, clear the blocker, or reschedule — without leaving the Center.
- "Analyze with AI" runs a one-off advisory portfolio analysis.
- The ranking engine is deterministic; AI analysis is advisory and adds no automatic changes.
- AI: advisory only here, but can act on a suggested record using the task and RAID tools (e.g. create the task a suggestion describes, or update its owner/status). The in-row resolve buttons are user UI actions, not separate AI tools.

## AI assistant

<!-- views: chat -->

- This chat. Ask about the project, get explanations, or have records created/updated.
- All AI features are gated by an "Enable AI assistant" master switch in Settings → AI (off by default); a Claude API key is still required on top.
- Attach documents (PDF, image, text) — they are read natively and records can be extracted from them.
- Reads the live workspace via list tools for grounded answers.
- AI: that's me — I can create/update/delete tasks, RAID items, change items, milestones, and stakeholders, and read everything else.

## Dashboard

<!-- views: dashboard -->

- Project health RAG, completion percentage, budget summary, and EVM (earned-value) metrics.
- A landing "cockpit": a greeting + "since you last looked" delta strip, the ranked top-actions queue, a milestone-horizon strip ("what's coming"), at-a-glance KPI tiles with trend arrows vs the last visit, a completion-trend sparkline, and a coaching card on a blank project. The four RAG ratings can be overridden under "Adjust health ratings".
- A Comfortable/Compact density toggle (also in Settings → Appearance) and most tiles/chips click through to the underlying view or record.
- Read-only for records: nothing is edited here except the manual RAG overrides.
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
- Secrets (Anthropic API key, Turso auth token, Jira and Timelog tokens) are stored encrypted at rest.
- AI features are gated by an "Enable AI assistant" master switch in Settings → AI (off by default). The first time any integration/AI feature is enabled (AI, Jira, Microsoft 365, Turso or Timelog), a one-time security & responsibility note is shown and acknowledged once per device.
- The AI model dropdown lists the live models available on the user's Anthropic account (with an offline fallback list when they can't be fetched), and a malformed API key is rejected as it is entered.
- Integrations panel holds storage, Turso, Microsoft 365, Timelog, and Jira together. Jira lives inside Integrations: its configuration fields appear only after the "Enable Jira sync" checkbox is ticked.
- A **guided backend setup wizard** (Settings → Integrations → "Run setup wizard") steps through Storage & connections (storage, Turso, M365, Timelog), AI, and Jira, then a Review step summarising what is configured. The same wizard is reachable from the new-project window. Steps are skippable, and the flat Integrations panel can be used to adjust any setting later.
- AI: can explain where each setting lives and what it does; cannot open or run the setup wizard (it is a UI affordance only).

## Budget

<!-- views: budget -->

- Project budget plan: blended or detailed (per-resource) cost, a week- or month-grained period plan, and per-period allocations.
- Effort/cost actuals can be applied from the Timelog integration; EVM (CPI/SPI, cost/schedule variance) is derived from the plan and actuals.
- Optional EUR overrides for non-EUR rates; the budget report (a separate view) shares this data for sharing/export.
- AI: read-only here — there is no budget write tool. To change figures, point the user to this budget view (plan, allocations, actuals).

## Resources & capacity

<!-- views: resources,directory,workload,planning,manage-roles -->

- Resource directory (people and their identity), workload/utilisation, capacity planning and allocations, and the roles/disciplines/grades reference data.
- Capacity is computed from allocations against working time (holidays, absences, shifts); over-allocation surfaces in the workload view and feeds Action Center signals.
- AI: read-only — there is no resource/allocation write tool. It can explain over-allocation and capacity gaps; assignment and allocation edits are UI actions.

## Documents

<!-- views: documents -->

- A standalone register of project document links; entities (RAID, changes, milestones, stakeholders, etc.) can also carry their own document links.
- SharePoint picker adds links when Microsoft 365 / SharePoint is configured; links are validated as safe http(s) URLs.
- AI: no document write tool — it cannot add links here. In chat it can read documents you attach (PDF/image/text) natively and extract records from them.

## Time bookings

<!-- views: timelog -->

- The Timelog integration: fetched time-tracking actuals aggregated per project and period, shown as a read-only overlay.
- Fetching is two-step: "Load people" pulls the Timelog directory only, a filter box narrows it and you tick who you need, then "Fetch bookings" pulls timesheets for the ticked people only (org scope). A loading window shows progress with a Cancel button; "Clear all" resets the fetched data.
- "Load my projects" loads the projects you are Project Manager for in Timelog (with "Include closed projects", or a customer picker to load one client's projects) so you can match them to budgets before fetching any bookings.
- A resource's hours count as booked only when its Timelog user is linked to a resource AND the booking's project is linked to a budget bucket; otherwise they show as unattributed (a banner explains this).
- "Apply to budget" is the one write — it writes each period's total into the matching budget allocation's actual hours; the period key must match the plan granularity (week/month).
- Self-scoped to the token owner by default; org-wide reads need the right Timelog privilege. Reads page through all results and go through a same-origin proxy that retries automatically when rate-limited.
- AI: read-only — there is no Timelog tool. It can explain the actuals overlay and the apply-to-budget flow; fetching and applying are UI actions.

## Portfolio health

<!-- views: portfolio-health -->

- A Turso-only cross-project rollup: per-project RAG, completion, open-RAID count, and milestone health, plus aggregate portfolio KPIs.
- Each project is loaded and run through the same health computation as the single-project dashboard.
- AI: read-only — there is no portfolio tool. Available only on a Turso backend; on file storage the view is hidden.

## Version history

<!-- views: history -->

- Confluence-style point-in-time versions of the project with compare and restore; Turso storage only.
- Versions are captured by the user; restoring rolls the workspace back to a saved version.
- AI: read-only — it can describe what changed between versions but cannot capture or restore a version (UI actions).

## Activity log

<!-- views: activity -->

- A chronological feed of project activity (task, RAID, Jira sync, bulk, and general events), filterable by type; timestamps render in the active display timezone.
- A read-only audit trail; entries are written by the app as records change.
- AI: read-only — it can summarize recent activity but does not write log entries.
