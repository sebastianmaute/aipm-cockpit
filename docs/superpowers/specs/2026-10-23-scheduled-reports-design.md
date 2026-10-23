# Scheduled jobs that name their project, take an instruction, and keep their reports (§772, #860)

Status: draft for owner approval, 2026-10-23.

## Intent

A scheduled job should do what its name promises. Today it cannot be told what to look at or what to do, it
analyses whichever project happens to be open when it is due, it sees only titles and the Next actions queue,
and it throws its suggestions away (a run keeps a one-line summary and a count). The owner wants a job to name
its project, carry its own instruction, see enough of the project to say something new, and leave a report that
can be read later in one place for the whole portfolio.

## Decisions (owner, 2026-10-23)

1. **One project per job, by name.** The job always analyses that project, whichever project is open.
2. **Turso only.** The project must live in Turso; without it, scheduled jobs are not available.
3. **Results are reports in a new view under Portfolio health**, listing the reports of all jobs across all
   projects, newest on top, as tabs down the side named with the run's timestamp.
4. **A free-text instruction per job** is enough to start with.
5. **The wider project digest is part of this work.**
6. **Approach A:** the browser runs jobs as today (while the app is open), loading the job's project from Turso.
   A server-side runner (approach B) was rejected: the AI key is device-sealed in the browser, and every
   deployment would need a scheduler.

## Goals

- A job carries `projectId` and an optional `instruction`; a run analyses that project and no other.
- Each run, successful or failed, writes one report row to Turso; reports survive reloads and are visible from
  any device that opens the same portfolio.
- A new view, **Scheduled reports**, in the Portfolio nav group directly below Portfolio health, shows every
  report of the portfolio: a vertical tab list (newest first; tab = run timestamp, project name beneath) and the
  selected report beside it.
- The analysis context for both scheduled runs and the Action Center's *Analyze with AI* button is the wider
  digest (dates, status, owner and overdue state per item; budget figures), within a token bound.
- The two help texts stop calling this a "portfolio analysis" of the open project.

## Non-goals

- Runs while the app is closed (approach B).
- More than one project per job, or an "all projects" scope.
- Sending a report into the chat (§768, #856 — the peer's, and it must stay clear of this work).
- Acting on a report's suggestions from the report (opening the entity, creating a task). A report names an
  entity as text (for example "Task #12: …"); jumping there would need a project switch first.
- File-mode or single-database Turso support.

## Anti-goals (would make it a failure even if it works)

- A job silently analysing a project other than the one it names (including the open one as a fallback).
- A report table that a workspace save wipes, or that survives the deletion of its project.
- Reports that cannot tell two runs of different projects apart in the list.
- The AI key or a response body reaching a report, a log, or an error message.

## Constraints from the codebase

- **Runner:** `use-scheduled-job-runner.ts` ticks every 5 minutes, on becoming visible and when enabled; it runs
  due jobs sequentially with `isRunningRef` as the re-entry guard, and records each run through `recordRun`.
  Keep that shape.
- **Analysis call:** `runJobAnalysis` (`scheduled-job-analysis.ts`) is shared with the Action Center
  (`use-action-analysis.ts`). Keep one call; add the instruction to the USER message as its own section, never
  to the cached system prompt. The operating guides the runner reads today (the `"jobAnalysis"` target,
  `use-ai-orchestration.ts`) still apply.
- **Three consumers of today's digest:** `buildAiContext` (`use-ai-orchestration.ts`) feeds the Action Center
  button, the scheduled runner, and the AI weight-suggestion context (`buildWeightSuggestionContext`).
- **Loading another project:** `use-portfolio-health.ts` already does it: `new TursoBackend(tursoConfig, id).load()`,
  one project at a time (parallel loads contend and return `SQLITE_BUSY`). The runner loads only the due job's
  project, sequentially per due job.
- **Next actions for a loaded project:** `computeNextActions` (`next-actions/index.ts`) is pure but needs a full
  `ActionInput` (dashboard model, comms reminders, workload alerts, settings thresholds), which
  `use-next-actions.ts` assembles from live hooks. The builder extracts a pure assembler from a `Workspace` +
  settings that both paths can call; the report path does NOT apply per-device snooze or learned bias.
- **Job store:** `scheduled-jobs-store.ts` is a global dual-backend store (localStorage when `tursoConfig` is null,
  else the `scheduled_jobs` table, out of `TABLE_NAMES`). The whole job is a JSON blob, so new fields need no
  column migration — BUT `sanitizeJob` rebuilds each job from a fixed field list (and checks `type` against one
  literal), and `createJob` (`use-scheduled-jobs.ts`) lists its fields one by one, so both must learn
  `projectId` and `instruction` or the fields are dropped on every load and save.
- **Turso gating:** check `tursoConfig !== null`, not only `storageConfig.kind` (AGENTS.md). The view goes into
  `TURSO_ONLY_VIEWS` (`nav-config.ts`) and therefore stays OUT of axe `A11Y_VIEWS`; its a11y is pinned by unit
  tests. `TURSO_ONLY_VIEWS` prunes by `storageKind === "turso"` only, so the panel and the Settings section also
  check the full availability rule below at runtime (a single-database Turso setup shows the nav entry but the
  panel says the feature needs a Turso portfolio).
- **Loading a deleted project does not fail:** `TursoBackend` returns an empty workspace for an unknown project id
  (`loadTenant`), so "missing" is decided against the project list, never by a load error.
- **Job ids are reused:** `createJob` mints `max + 1`, so deleting the newest job and creating another reuses its id.
- **New Turso table:** not workspace data, so OUT of `TABLE_NAMES`; it carries `project_id`, so it goes into
  `project-side-tables.ts` so `hardDeleteProject` sweeps it (the guard test fails otherwise). A string `id`
  needs TEXT, not the INTEGER rowid alias (AGENTS.md, `idKind`).
- **i18n:** every new string in EN and DE; DE edited by node utf8 script.
- **Background writer:** the runner writes only to the report table and the job store, never to the open
  workspace, so the load hold (`loadPending`) and scope epoch do not apply to the report write. It must still not
  start a run while the Turso config is absent.

## Design

### Job model

`ScheduledJob` gains `projectId: string | null`, `instruction?: string` (trimmed, capped at the app's
`TEXTAREA_MAX`) and `key: string`, a uuid minted when the job is created and never reused. Existing jobs load
with `projectId: null` and are given a key on first load (persisted on the next save). The numeric `id` stays
for the Settings UI; reports refer to a job only by `key`, because numeric ids are reused (see Constraints).

**Deleting a job keeps its reports** (owner, 2026-10-23). They stay in Scheduled reports, still showing the
job's name as it was when each report ran; retention stops applying to them, so a deleted job keeps at most the
50 reports it had.

- A job with `projectId: null` never runs; Settings shows it with a "Choose a project" prompt in place of its
  next-run time. Nothing is recorded for it.
- The project is checked against the portfolio's project list before loading. *(Builder-check rulings, the
  designer's calls:)*
  - **Archived** (in the archived list): the run is recorded as failed (`error: "project-archived"`) with a
    report row, and nothing is analysed.
  - **Hard-deleted** (in neither list): no report row is written (a row would carry a `project_id` the
    deletion sweep has already passed). The job's `projectId` is cleared, so it returns to "Choose a project",
    and its run history records `error: "project-missing"`. `hardDeleteProject` also clears `projectId` on jobs
    naming the project, so this path is only a fallback.

### Availability

Scheduled jobs (the Settings section, the runner, and the Scheduled reports view) are available only when
`tursoConfig !== null` and the portfolio is a Turso portfolio (`loadPortfolioMode() === "turso"`). Otherwise the
Settings section shows one line saying scheduled jobs need a Turso portfolio, and the runner is not enabled.
Jobs already in localStorage are left in place, untouched.

### Settings → Scheduled jobs

Per job, beside today's name, cadence, weekday, time and on/off:
- **Project**: a select of the portfolio's active projects by name (`usePortfolioProjects`), storing the id.
- **Instruction**: an optional textarea ("What should this job look for, and what should it ignore?").

### Run

For each due job, in order: **claim the slot** → check the project → load it → build the wide digest →
`runJobAnalysis(context, …)` → write the report row → append to the job's `history` (kept, for the Settings run
list) → desktop notification (title: job name, body: project name + summary). A failure after the claim records a
failed run and a failed report with a status-only error.

*Claiming (designer's call):* jobs are portfolio-wide, but the runner switch is per device, so two open copies of
the app can find the same job due. Before any billed call, the runner advances the job's `lastRunAt` in Turso
with a conditional update (only if `lastRunAt` still holds the value it read); a copy whose update changes no row
skips the job. The report table additionally carries a unique `(job_key, slot)` constraint as a second guard.

### Wide digest

A new pure, i18n-free builder takes a `Workspace` (plus today and the next-actions queue) and returns the
context text. Per category it keeps the existing cap (`CONTEXT_CAP_PER_CATEGORY`) and the `view#id` grounding
format, and adds per line:
- tasks: status, priority, assignee, due date, `overdue` flag;
- RAID: category, severity, status, owner, due or review date, `overdue` flag;
- milestones: date, done or `overdue`;
- changes: status, decision date when decided;
- stakeholders: role or organisation;
- a budget line from the dashboard model: planned, actual and forecast-at-completion in the plan currency.

Each line stays bounded (titles cut at 120 characters as today). *Rows (designer's call):* only open or active
items fill the per-category cap (not Done, Cancelled or Closed ones), ordered overdue first, then by nearest
date. The Action Center button uses the same builder over the live workspace, so those two paths cannot drift.
The AI weight-suggestion context keeps today's narrow digest: it asks a different question, and widening it
would raise its token cost for nothing.

### Report storage

Table `scheduled_reports` (portfolio-wide, `CREATE TABLE IF NOT EXISTS`):
`id TEXT PRIMARY KEY` (uuid), `project_id TEXT`, `job_key TEXT`, `slot TEXT` (the scheduled run time the claim
advanced to, ISO), `ran_at TEXT` (ISO), `ok INTEGER`, `data TEXT` (JSON: `jobName`, `projectName`,
`instruction`, `summary`, `actions` (title, why, severity, entity), `error`), with `UNIQUE (job_key, slot)`.
Retention: at most 50 reports per `job_key`; the insert's pipeline deletes the oldest beyond that. Reads list
rows newest first.

### Scheduled reports view

- Nav: Portfolio group, after `portfolio-health`; label "Scheduled reports"; in `TURSO_ONLY_VIEWS`.
- Left: a vertical tab list, newest first. Each tab reads the run time in the app's time zone (for example
  "Mon 27 Oct 2026, 08:00") with the project name beneath; a failed run's tab is marked as failed (not by colour
  alone). Tab accessible names are unique per row (timestamp + project + job).
- Above the list: a project filter, default "All projects".
- Right: the selected report: job name, project, run time, the instruction it ran with, the summary, and the
  suggested actions (severity, title, why, entity as text). A failed report shows why it failed.
- Empty state when there are no reports yet, pointing to Settings → Scheduled jobs.

### Text changes

`scheduledJobsHelp` and the AI help body describe a job as an analysis of the project it names, kept as a report
under Scheduled reports, available with a Turso portfolio.

### Register

Add §772's entry to `docs/open-followups.md` (index row + entry, Work item #860), closed by this work.

## Left to the builder

- Component and hook names, file split (panel split rule: rows/toolbar presentational before ~700 lines).
- Exact digest line format, within the fields above.
- Whether the report list is paged or loads all rows (retention bounds it at 50 per job).
- Help-system entry wiring for the new view, following `docs/AGENTS/ui-shell.md`.
