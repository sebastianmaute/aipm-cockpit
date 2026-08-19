# App Feature Guide

Per-view reference for the AI assistant: what each surface does and what the assistant can or cannot do there via its tools.

## Overview

- Covers portfolio and project delivery: open points (tasks), action center, insights, dashboards, trends, RAID, change control, milestones and Gantt, stakeholders and RACI, steering committee, reports, budget, resources and capacity, calendar, knowledge links, documents, time bookings, the activity log, version history, the portfolio-health rollup, and settings.
- Established: task status model + Table/Board (Kanban) toggle, steering committee, guided tour with demo data, timezones (incl. the calendar world-clock strip), AI weight suggestions / report analysis / opt-in scheduled jobs, create-project from a description / file / SharePoint / Confluence, editable communication templates, the Timelog time-booking integration, the Turso-only portfolio-health rollup, view-aware AI, rate-card day rates, a planning capacity column with a hide-external toggle, dashboard tile tooltips, and a RACI people-column filter.
- Newest: a **Documents** view that authors project documents and exports each one as a web page, Word, PowerPoint or PDF; an **Insights** view carrying the detect -> recommend -> outcome loop; **saved AI chat threads** with a sidebar, plus tools that search this project's earlier chats and its activity history; an **activity log that belongs to the project** rather than to the browser, recording who made each change; an **arrangeable dashboard** where every tile can be picked up and moved; **multi-step undo**; a **note log on changes** as well as tasks and RAID items; and one **unified rich-text editor** across every formatted field, whose headings, lists and alignment now survive export to Word, HTML and PDF.
- Formatted text: seven fields take rich formatting — a task's description, a RAID item's description and mitigation, a change's description, impact description and resolution notes, and a milestone's description. One editor serves all seven: bold, italic, underline, strikethrough, inline code and code blocks, highlight, superscript and subscript, headings 1-4, quotes, horizontal rules, bulleted, numbered and checkable task lists, left/centre/right alignment, and links. Markdown shortcuts work while typing. Character limits count visible text, not markup. Older plain-text values stay valid and are upgraded when read, so a project can hold both shapes at once.
- Note log: tasks, RAID items and changes each carry dated notes in a separate floating window (a `🗒 N` badge on the row). Notes are NOT the same field as the description. You have no tool that can read or write a note — if the user asks about notes, say so and point them at the window rather than guessing from the description.
- Tip for the user: most views have an "Ask Claude" button (and an "Explain this" prompt) that opens this assistant with a view-aware question.

## Open Points

<!-- views: open-points -->

- The task list ("Open Points") for the active project, with a Table/Board (Kanban) toggle.
- Status model: To Do, In Progress, On Hold, In Review, Cancelled, Done — Done auto-stamps a completed date.
- Tasks can link to RAID items (a task may resolve a risk, issue, or dependency).
- Jira-synced tasks (those with a Jira key): tasks from the primary project are editable; tasks from read-only extra projects have their Jira fields locked until the next sync.
- The assignee / group / label filters self-heal: if the value you filtered by stops existing (because you reassigned or re-labelled the last task carrying it), the filter falls back to "All" rather than hiding every row. Undoing the edit brings the filter back — the choice is remembered, not discarded.
- Clearing an assignee with the ✕ in the picker clears the whole field (name, email and the directory link together), not just the link.
- Inline "Ask Claude" edit: an in-place popover on a task row/card (or its row menu) takes a short instruction (e.g. "push this out a week and add a risk for the vendor delay"); it previews the proposed field changes and any related items it would create before anything is applied, and only writes them once the user confirms. Not available on Jira-synced tasks or in a pop-out window.
- Deduplicate & unify tasks: a toolbar action (shown when the AI assistant is enabled, outside pop-outs, with at least two tasks) asks the AI to propose which tasks look like duplicates and how to merge each group into one. You review every proposed group and can deselect any before confirming — nothing changes until you confirm, and a confirmed merge is a single undo step that folds the duplicates into the kept task and applies its unified fields.
- A task's Description takes the full formatting set (see Overview); the character counter measures visible text, so markup does not eat into the limit. Separately, each task has a dated note log in its own window, reached from the `🗒 N` badge on the row or the "Notes (N)" button in the editor.
- The dependency editor links both directions: a task can name what it waits on AND what waits on it, and linking several successors in one save is a single undo step. There is no inline relations pencil on the table any more — the dependencies cell is read-only there and is edited in the task editor.
- Undo keeps a history rather than a single step: the caret beside Undo lists recent actions so you can walk back several at once. A bulk edit is one entry, and undoing it leaves alone any note or Outlook link written since it ran.
- "Send inquiry" is a visible button on a row rather than an item hidden in the row menu.
- AI: create/update tasks including setting status; cannot toggle the Board view or change a Jira-synced task's status (explain + point to Jira). It CAN write a task's Description, and may write it as plain text or as simple HTML (bold/italic/lists/links) — anything outside that set is stripped on save. It CANNOT read or write the note log: there is no tool for notes, so never answer a question about a task's notes from its description. Via the inline edit popover specifically, it can change task fields and create a linked RAID item, change item, milestone, or stakeholder as part of one instruction — always preview-then-confirm, never applied without the user's confirmation. Via the "Deduplicate & unify tasks" action it can propose task merges for your review, but merges are only applied after you confirm.

## Action Center

<!-- views: actions -->

- Ranked "suggested next actions" derived from project signals, each with one-click CTAs (create task, assign owner, escalate, draft message, re-baseline).
- The single most-urgent action is promoted to a focus "Do this first" card at the top; below it, actions stay grouped by urgency tier (Now / Soon / Monitor), each capped with a show-more control so the list stays short.
- All signals for one item are grouped into a single row with a "+N more reasons" expander. Each row is action-first — it leads with its real next step (assign, reschedule, clear blocker, re-baseline, draft…) and folds the rest into a "⋮" overflow; urgency reads from a coloured tier dot and left stripe. The Center flags unassigned, stale, blocked, and dependency-blocked tasks.
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
- Conversations are saved as threads on a Turso project: a sidebar lists them, you can rename, delete and switch between them, and its width is draggable. On file storage the panel is a single unsaved conversation with no sidebar.
- Two recall tools, both individually switchable in Settings → AI and both defaulting ON: one searches this project's ACTIVITY HISTORY (when a milestone moved, who changed a field), the other searches this project's EARLIER CHATS. Turning either off removes the tool from the model's offered set AND refuses to serve it, so it can never advertise off while serving on.
- A one-sentence recap of the last seven days of project activity is supplied as context, so the assistant opens knowing what has been going on. It is switchable off too.
- Knows which view you are on and what that view is for, and on Open Points, Workload, Gantt and Budget it is also told what the current filters are showing. Where it has no way to read something it says so instead of guessing.
- AI: I am told the active view and, on those four, a short summary of what is on screen. Trust that summary only for what it explicitly claims: on Gantt, Workload and Budget the counts are project totals, because those panes apply their own filters I cannot see.
- AI: that's me — I can create/update/delete tasks, RAID items, change items, milestones, stakeholders, resources and project DOCUMENTS, change a small set of settings, send an inquiry about a task, and read everything else. I can search past chats and the activity log when those tools are enabled.
- AI: the activity history I can search is capped and project-scoped, so "I found nothing" means nothing in the window I can see — say that rather than asserting it never happened.
- AI: usage limits are advisory and never block a message. If you hit Claude's own weekly or rate limit a notice is appended to this transcript and you can retry after it resets; if you hit your own token cap (set in Settings → AI) you get a notice too, but the assistant keeps working.

## Dashboard

<!-- views: dashboard -->

- Project health RAG, completion percentage, budget summary, and EVM (earned-value) metrics.
- A landing "cockpit": a greeting + "since you last looked" delta strip, the ranked top-actions queue, a milestone-horizon strip ("what's coming"), at-a-glance KPI tiles with trend arrows vs the last visit, a completion-trend sparkline, and a coaching card on a blank project. The four RAG ratings can be overridden under "Adjust health ratings".
- The board is arrangeable: every tile carries a drag handle, so a tile can be picked up and moved or hidden. The layout is a grid, it is saved per project, and the handles are keyboard-operable. Most tiles/chips click through to the underlying view or record.
- Density (Comfortable/Compact) lives in Settings → Appearance; it is no longer a control on the dashboard itself.
- The cockpit KPI/summary tiles carry explanatory tooltips that spell out how each figure is derived.
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
- Description and Mitigation both take the full formatting set (see Overview); limits count visible text, not markup. RAID items also carry a dated note log in its own window, separate from those fields.
- AI: full create/update/delete of RAID items, including owner and severity. It can write Description and Mitigation as plain text or HTML (anything outside the allowed tag set is stripped on save), and a field it does not mention is left untouched rather than blanked. It CANNOT read or write the note log — there is no tool for notes.

## Changes

<!-- views: changes,change-report -->

- Change-control register: requested changes with status, impact, and approvals.
- Items can carry stakeholder links for comms reminders.
- Description, Impact description and Resolution notes all take the full formatting set (see Overview); limits count visible text, not markup. Changes also carry a dated note log, in the same shared window as tasks and RAID items.
- A change's status can be set straight from the table — the status column is an inline dropdown — and setting a status to approved or rejected records the decision date, in bulk as well as one at a time.
- AI: full create/update/delete of change-control items, including the three formatted fields (plain text or HTML; a field it does not mention is left untouched rather than blanked). It CANNOT read or write the note log — there is no tool for notes.

## Milestones & Gantt

<!-- views: milestones,gantt -->

- Project timeline: milestones with dates plus the Gantt view; "Add milestone" available from the Gantt.
- Hovering a milestone marker on the Gantt shows a label with its formatted date.
- A milestone's Description takes the full formatting set (see Overview); the limit counts visible text, not markup.
- "Achieved" is a toggle button in both the milestones table and the editor, so its pressed state says which way it is set.
- The Gantt day axis stacks the short weekday over the day number. A View menu in its toolbar collects the display toggles — dependencies, holidays, absences, grid, critical path, baseline, show-milestones and inline milestone placement.
- The Gantt status filter starts with every status ticked. Unticking all of them shows nothing, which is the honest reading of the control rather than a bug.
- Milestones can be pushed to Outlook as calendar events.
- AI: create/update/delete milestones; cannot push a milestone to Outlook (user action via the calendar/milestone control).

## Stakeholders

<!-- views: stakeholders,raci,stakeholder-map -->

- Stakeholder register, the RACI matrix, and the stakeholder (influence/interest) map.
- The RACI matrix has an additive type-to-filter that narrows which people columns are shown.
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
- AI: can explain the calendar and timezone strip, and can LIST recurring meetings (`list_calendar_events` returns each series definition plus its skip/move exceptions, never an expanded occurrence list). It cannot add or change events or zones. ABSENCES are not readable by any tool even though the grid shows them beside meetings, so any clash or availability answer covers meetings only — say so rather than implying otherwise.

## Settings

<!-- views: settings -->

- Storage backend, timezone (default, per-project, and additional clock zones), AI configuration, opt-in scheduled jobs, guided-tour replay, and next-action weights. Appearance holds the colour scheme and the Comfortable/Compact density. Operating guides, Views and Scheduled jobs are each their own settings section, and "This project" is called Overrides.
- Beacon is the default colour scheme on a fresh install: a light-only theme. Harbor, Meridian and Umber each have a light and a dark variant.
- Secrets (Anthropic API key, Turso auth token, Jira and Timelog tokens) are stored encrypted at rest.
- Turso database URLs: use the URL exactly as `turso db show` prints it. A region-qualified host (for example `<db>-<org>.aws-eu-west-1.turso.io`) is valid and must not have its region segment removed.
- AI features are gated by an "Enable AI assistant" master switch in Settings → AI (off by default). The first time any integration/AI feature is enabled (AI, Jira, Microsoft 365, Turso or Timelog), a one-time security & responsibility note is shown and acknowledged once per device.
- The AI model dropdown lists the live models available on the user's Anthropic account (with an offline fallback list when they can't be fetched), and a malformed API key is rejected as it is entered.
- Settings → AI also holds usage controls: a maximum number of assistant turns per message (how many tool-use rounds one request may take, default 12) and a token-counting multiplier (scales how heavily usage counts against your own caps, default 5), plus the optional session/weekly token caps themselves. These caps are your own advisory limits and never block a request; Claude's own weekly/rate limit is a separate notice.
- Integrations panel holds storage, Turso, Microsoft 365, Timelog, and Jira together. Jira lives inside Integrations: its configuration fields appear only after the "Enable Jira sync" checkbox is ticked. Configure a primary Jira project (two-way sync) and optionally add extra projects to sync read-only (pull-only — edits never push back); each extra project has a per-project read-only toggle (default ON). The task Jira badge shows a padlock for read-only vs sync-arrows for two-way, and the task editor shows a read-only warning for watched projects.
- A **guided backend setup wizard** (Settings → Integrations → "Run setup wizard") steps through Storage & connections (storage, Turso, M365, Timelog), AI, and Jira, then a Review step summarising what is configured. The same wizard is reachable from the new-project window. Steps are skippable, and the flat Integrations panel can be used to adjust any setting later.
- **Settings → Functions** lists the feature modules (Dashboard, Trends, Gantt, Milestones, Resources, Budget, RAID, Changes, Stakeholders, History, Knowledge, Timelog) as toggles, with Simple / Modular / Advanced presets that flip whole sets at once. Each toggle now carries a short description of what the function does and when to enable it, so choosing what a project uses is self-explanatory. Enabling or disabling a module changes which views and automation appear, per project.
- **Settings → AI → "What Claude is told about each view"** lists, read-only, the exact description the assistant receives for every view, so you can see what it does and does not know before asking.
- AI: can explain where each setting lives and what it does; cannot open or run the setup wizard (it is a UI affordance only).
- AI: can explain what each feature function does and recommend which to enable for a given project from those descriptions; it cannot toggle the functions for you (that is a Settings action).
- AI: your session and weekly token caps in Settings → AI are advisory notices you set yourself — reaching one shows a notice but never blocks a request; the token multiplier (default 5) scales how usage is counted against those caps, and the max-turns-per-message setting (default 12) bounds how many tool-use rounds one request may take. Claude's own weekly/rate limit is separate: it shows a distinct notice and you retry after it resets.

## Budget

<!-- views: budget -->

- Project budget plan: blended or detailed (per-resource) cost, a week- or month-grained period plan, and per-period allocations.
- Effort/cost actuals can be applied from the Timelog integration.
- The bucket tiles are contribution margin, cost burn, cost performance (CPI) and consumption. "Cost burn" is budgeted cost divided by cost to date — above 100% means less has been spent than budgeted so far; it is deliberately NOT an EVM Cost Performance Index, since it has no percent-complete term and so reads high early in a project simply because little has been spent. "Cost performance (CPI)" IS the real EVM figure — earned value divided by actual cost — and only shows a number when progress is knowable.
- A bucket's percent-complete (and so its earned value and CPI) comes from either linking tasks to it in the bucket editor (the share of linked tasks that are finished) or a manual "% complete" override, which always wins when set. With neither, progress is unknown and the CPI tile reads "—" rather than guessing. The whole-project CPI only totals when every budgeted bucket has a known figure — one bucket with unknown progress blanks the project-level number too, same anti-approximation stance as the cost/margin tiles below.
- Cost, margin and burn all derive from internal rates. When a bucket's roles carry no internal rate those tiles read "—" rather than a figure, because a cost of 0 for want of a rate card would otherwise render as a perfect 100% margin. A notice points to Resources → Roles. A T&M bucket's win/loss runs on external rates and stays valid regardless.
- A per-period cell scores amber when the period has closed with nothing booked against a real budget; an untouched future period stays green.
- Each role line in a bucket expands to show the people assigned to that role, with their own hours per period; those figures line up under the role's own figures rather than against the far edge of the column.
- Optional EUR overrides for non-EUR rates; the budget report (a separate view) shares this data for sharing/export.
- AI: read-only here — there is no budget write tool. It can LIST the planner buckets (name, status, dates and per-role budget hours); for spend, margin and CPI use the dashboard snapshot instead, which carries the computed figures. To change anything, point the user to this budget view (plan, allocations, actuals).

## Resources & capacity

<!-- views: resources,directory,workload,planning,manage-roles -->

- Resource directory (people and their identity), workload/utilisation, capacity planning and allocations, and the roles/disciplines/grades reference data.
- Capacity is computed from allocations against working time (holidays, absences, shifts); over-allocation surfaces in the workload view and feeds Action Center signals.
- Rate cards accept DAY rates (internal/day, external/day): the day rate is the source of truth and the hourly rate is auto-calculated from the configured workday hours. Only one unit is editable at a time — clear the filled field to switch which unit you enter.
- Both the planning and workload views have a "Hide external" toggle, and the row count beside the Workload heading follows it. Hiding externals is a display filter only: they stay available as reassignment targets in the overdue-task triage popover, so hiding someone never removes a valid assignment.
- The workload view is actionable: the "Util (now)" column edits a resource's near-term utilisation inline (the same period the over-allocation signal flags), and the overdue-task count opens a triage popover to reassign (owner) or reschedule (due date) that resource's overdue tasks in place. Jira-synced tasks are read-only there.
- AI: can create/update/delete/list resources (name, contact fields, external flag, and a rate-card role via roleId). It CANNOT set day or hourly rate values, and cannot create or edit roles/disciplines/grades — assigning a resource to an existing role via roleId inherits that role's rates, but entering rates (including the new day rate) is a UI action. Allocation and utilisation edits are also UI actions.

## Knowledge

<!-- views: knowledge -->

- A standalone register of project knowledge links — documents, Confluence pages, and general web URLs; entities (RAID, changes, milestones, stakeholders, etc.) can also carry their own knowledge links.
- A link can be added three ways: a SharePoint document (when Microsoft 365 / SharePoint is configured), a Confluence page URL, or any general web URL; every link is validated as a safe http(s) URL and shows a kind-appropriate icon.
- AI: can LIST the library's links (name, URL, kind, and which tasks each is linked to) but has no knowledge WRITE tool — it cannot add links here. It reads the link record, never the linked document's contents. In chat it can read documents you attach (PDF/image/text) natively and extract records from them.

## Documents

<!-- views: documents -->

- Project documents authored in the app: each has a title, a stack of typed blocks, and the dates it was created and last changed. The list shows every document in the project.
- One document exports four ways: a web page, Word (.docx), PowerPoint (.pptx) and PDF. Nothing is stored as a file — a document is held as structured content and the bytes are produced when you export, so the project never carries a blob.
- A document can embed a live data section: the section renders from the project's current records at export time using the same builder the workspace export uses, so an embedded table cannot drift from what the exporter would emit.
- A document can name the parts of the project it is about (tasks, RAID items, milestones, stakeholders and so on) under "Linked items". If a linked entity is later deleted the reference keeps the name it had, so the document still reads correctly.
- Every document write keeps a before-image, so a per-row "History" button shows earlier states and can restore one. A deleted document stays recoverable from a show-deleted toggle until its retained history is trimmed. Restoring writes a stored snapshot back verbatim — there is no diff-replay.
- Documents travel with the project on every storage backend. If a project is loaded that exceeds the document size cap, the excess is disclosed rather than silently dropped and saving pauses so a truncated load cannot overwrite what is on disk.
- AI: I have full document tools — list, read, create, update and delete. Document text I write is sanitized on save the same way a description is. ★ Document writes take NO undo capture; the before-image history above is the safety net, so a mistaken write is recovered from History, not from Undo.

## Insights

<!-- views: insights -->

- Automatically detected project signals with a lifecycle: milestone slip, stalled or no-progress work, budget aging, RAID aging, and an overdue trend. Each detected insight carries a severity and a plain-language summary.
- An insight moves through active -> acknowledged / acted / dismissed -> resolved. Acting on one records the metric it stood at, so when the signal later clears the app can say whether it improved, worsened or was unchanged.
- Detection is deterministic and runs from the live project; nothing here is a model judgement. Severity rides a coloured dot, never tinted text.
- The dashboard carries an insights card; this view is the full list.
- AI: read-only — there is no insights tool. I am told the currently surfaced insights and the recent measured OUTCOMES of ones you already acted on, so I do not keep recommending something you have already done. To change an insight's state, point the user at this view.

## Time bookings

<!-- views: timelog -->

- The Timelog integration: fetched time-tracking actuals aggregated per project and period, shown as a read-only overlay.
- Fetching is two-step: "Load people" pulls the Timelog directory only, a filter box narrows it and you tick who you need, then "Fetch bookings" pulls timesheets for the ticked people only (org scope). A loading window shows progress with a Cancel button; "Clear all" resets the fetched data.
- "Load my projects" loads the projects you are Project Manager for in Timelog (with "Include closed projects", or a customer picker to load one client's projects) so you can match them to budgets before fetching any bookings.
- A resource's hours count as booked only when its Timelog user is linked to a resource AND the booking's project is linked to a budget bucket; otherwise they show as unattributed (a banner explains this).
- "Apply to budget" is the one write. Each person's hours go to the allocation line they belong to — matched by the line's named resources, else by their role in the directory (for a blended bucket, that role's discipline) — so people on different roles are costed at their own rates. Hours that match no line (an unlinked person, no role set, or a role the bucket has no line for) are withheld rather than charged to another role, and a notice reports how many buckets and hours were held back. The period key must match the plan granularity (week/month).
- Because actual hours can also be typed by hand, the confirm step lists every row it will write — bucket, line, period, and the current → new value — instead of a bare count, and refuses to apply if the budget changed while the confirmation was open.
- Self-scoped to the token owner by default; org-wide reads need the right Timelog privilege. Reads page through all results and go through a same-origin proxy that retries automatically when rate-limited.
- With the Timelog integration switched off the page explains what it would do and where to switch it on, rather than showing an empty grid.
- Linking a person or a project in Timelog re-attributes hours that were ALREADY fetched; you do not have to fetch again. A fetch that only partly succeeds leaves the hours it could not refresh alone instead of reducing them.
- AI: read-only — there is no Timelog tool. It can explain the actuals overlay and the apply-to-budget flow; fetching and applying are UI actions.

## Portfolio health

<!-- views: portfolio-health -->

- A Turso-only cross-project rollup: per-project RAG, completion, open-RAID count, and milestone health, plus aggregate portfolio KPIs.
- Each project is loaded and run through the same health computation as the single-project dashboard.
- AI: read-only — there is no portfolio tool. Available only on a Turso backend; on file storage the view is hidden.

## Version history

<!-- views: history -->

- Confluence-style point-in-time versions of the project with compare and restore; Turso storage only.
- "Compare with current" scrolls straight to its diff output and states plainly when a version is identical to the current state. Select all / Deselect all and "Restore this state" controls manage the version list.
- Versions are captured by the user; restoring rolls the workspace back to a saved version.
- AI: read-only — it can describe what changed between versions but cannot capture or restore a version (UI actions).

## Activity log

<!-- views: activity -->

- A chronological feed of project activity (task, RAID, Jira sync, bulk, document and general events), filterable by type; timestamps render in the active display timezone.
- The log belongs to the PROJECT, not to the browser it was recorded in: it travels with the project across every storage backend and is visible to whoever opens it. It is deliberately never exported — an entry's diff carries the old and new values, which is internal audit detail rather than something to put in a client-facing document.
- Every entry records WHO made the change: you (the name set in Settings), the assistant, or an integration such as a Jira or Outlook sync.
- A read-only audit trail; entries are written by the app as records change. Update events record a per-field diff (which fields changed, before → after) shown beneath the entry. An entry of an unfamiliar type is shown generically rather than breaking the view.
- Activity recorded before the log moved into the project is not carried forward.
- AI: I can SEARCH this log when the history-search tool is enabled in Settings → AI, and I am given a short recap of the last seven days. I never write log entries. The searchable window is capped, so "I found nothing" means nothing within what I can see.
