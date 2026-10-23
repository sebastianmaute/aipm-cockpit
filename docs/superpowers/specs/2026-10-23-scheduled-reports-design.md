# Scheduled jobs that name their project, take an instruction, and keep their reports (§772, #860)

Status: draft for owner approval, 2026-10-23 (revised after the design review the same day).

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
7. **Deleting a job keeps its reports.**

Everything else below marked *(designer's call)* is the designer's ruling, open to the owner's correction.

## Goals

- A job carries a project, an optional instruction, a time zone and a permanent key; a run analyses that project
  and no other.
- Every run that reaches its project writes one report row to Turso (the exceptions are listed under *Run*);
  reports survive reloads and are visible from any device that opens the same portfolio.
- A new view, **Scheduled reports**, in the Portfolio nav group directly below Portfolio health, shows every
  report of the portfolio: a vertical tab list (newest first) and the selected report beside it.
- The analysis context for both scheduled runs and the Action Center's *Analyze with AI* button is the wider
  digest, within a fixed character bound.
- No run is billed twice for the same scheduled time, whichever devices have the app open.
- The two help texts stop calling this a "portfolio analysis" of the open project.

## Non-goals

- Runs while the app is closed (approach B).
- More than one project per job, or an "all projects" scope.
- Sending a report into the chat (§768, #856 — the peer's; this work stays clear of it).
- Acting on a report's suggestions from the report (opening the entity, creating a task). A report names an
  entity as text (for example "Task #12: …"); jumping there would need a project switch first.
- Deleting reports by hand, and a "Run now" button. Both are reasonable follow-ups; retention bounds the list.
- File-mode or single-database Turso support.

## Anti-goals (would make it a failure even if it works)

- A job silently analysing a project other than the one it names (including the open one as a fallback).
- One scheduled time billed twice because two devices, or two tabs, both ran it.
- A report table that a workspace save wipes, or that keeps rows for a project after that project is deleted.
- Reports that cannot tell two runs apart in the list.
- The AI key, a response body or raw server error text reaching a report, a log, or an error message.
- A report that presents an entity id the model made up as fact.

## Constraints from the codebase

- **Runner:** `use-scheduled-job-runner.ts` ticks every 5 minutes, on becoming visible and when enabled; it runs
  due jobs sequentially with `isRunningRef` as the re-entry guard. Keep that shape. It records runs through the
  injected `recordRun`, awaited and best-effort (`settle`): a rejected write never fails the run.
- **Job store writes lose updates:** every job write goes through `mutate` (`use-scheduled-jobs.ts`), which loads
  the list, transforms it and saves it with `saveScheduledJobs` — `DELETE FROM scheduled_jobs_v2` then one INSERT per
  job, in a separate request from the load (`scheduled-jobs-store.ts`). A write from another device in between
  is overwritten. **So nothing that must not be lost — in particular the run claim — may live in the job
  store.** (Fixing the store itself is out of scope; Settings edits keep today's behaviour.)
- **Job store shape:** the whole job is a JSON blob per row (row id `String(job.id)`), so new fields need no
  column migration — but `sanitizeJob` rebuilds each job from a fixed field list (and checks `type` against the
  literal `"portfolioAnalysis"`), and `createJob` lists its fields one by one, so both must learn the new fields
  or they are dropped on every load and save. The `type` literal stays as it is: renaming it would make
  `sanitizeJob` drop every stored job. (Review cr3 made `sanitizeJob` forward-compatible: unknown job fields are carried
  in `extra` and written back, and a job with an unknown type or cadence, or with no numeric id, becomes a read-only
  `foreign` job that holds its stored JSON verbatim, is listed in Settings with a "created by a newer version" note,
  is deletable, and never runs.)
- **Job ids are reused:** `createJob` mints `max + 1`, so deleting the newest job and creating another reuses its
  id. Reports must not refer to a job by that id.
- **Slots are local time today:** `currentSlot` (`scheduled-jobs/schedule.ts`) uses the device's local
  `setHours`, while Settings shows times in the display time zone. Two devices in different zones compute
  different slots for the same job.
- **Analysis call:** `runJobAnalysis` (`scheduled-job-analysis.ts`) is shared with the Action Center
  (`use-action-analysis.ts`). Keep one call; add the instruction to the USER message as its own section, never to
  the cached system prompt. The operating guides the runner reads today (the `"jobAnalysis"` target) still apply.
- **Consumers of the digest:** `buildAiContext` (`use-ai-orchestration.ts`) is now only the AI weight-suggestion
  context's digest (`buildWeightSuggestionContext`); the Action Center button and the scheduled runner use the wide
  digest (`buildProjectDigest` over `buildProjectAnalysisInput`).
- **Next actions input:** `buildActionInput` (`next-actions-input.ts`) already assembles `ActionInput`; only the
  dashboard model, comms reminders and workload alerts come from hooks (`use-next-actions.ts`). The queue is
  i18n descriptors translated with `actionText(lang, …)`.
- **Grounding:** the live button grounds the model's `entity` with `buildGroundingIndex` / `groundEntity`
  (`use-ai-orchestration.ts`).
- **Loading another project:** `new TursoBackend(tursoConfig, id).load()`, as `use-portfolio-health.ts` does. Its
  DDL runs outside the write lock, so a load can collide with the open project's autosave or a Portfolio health
  refresh and fail with `SQLITE_BUSY`. An unknown project id does NOT fail: `loadTenant` returns an empty
  workspace, so "missing" is decided against the project lists (`listProjectRefs`, `turso-portfolio.ts`).
- **Turso pipelines:** a plain pipeline keeps executing after a failing statement (AGENTS.md, §637); an atomic
  write uses `runTursoPipeline`'s batch form (BEGIN first, COMMIT last, no DDL before BEGIN).
- **Turso gating:** check `tursoConfig !== null`, not only `storageConfig.kind` (AGENTS.md). The view goes into
  `TURSO_ONLY_VIEWS`, which prunes by `storageKind === "turso"` only, so the panel and the Settings section also
  check the full availability rule at runtime. Being Turso-only, the view stays OUT of axe `A11Y_VIEWS`; its a11y
  is pinned by unit tests.
- **New Turso table:** not workspace data, so OUT of `TABLE_NAMES`; it carries `project_id`, so it goes into
  `project-side-tables.ts` so `hardDeleteProject` sweeps it (its guard test fails otherwise). TEXT id.
- **Size ratchet:** `task-manager.tsx` has zero headroom (`docs/baselines/file-sizes.json`). This work must not
  add a line to it; the section and the runner read the project list themselves (`listProjectRefs`, one
  pipeline for both lists, and `loadPortfolioMode()`), the view reads no project list (its names come from the
  reports), and none goes through `usePortfolioProjects`, which is task-manager's
  own orchestration hook.
- **New-view checklist:** `AppView` + `NAV_GROUPS` + `TURSO_ONLY_VIEWS` (`nav-config.ts`), `VIEW_AI_SCOPE` (a total
  Record), the nav icon Record (`nav-icons.tsx`), a help entry (`help-content.ts`, stating the Turso condition),
  the lazy panel (`workspace-panels.tsx`) and its branch in `workspace-section.tsx`. Update the ungated counts in
  AGENTS.md the new panel changes (the tabpanel count) and regenerate `operating-guide-builtin.generated.ts` if the
  help text it quotes changes.
- **i18n:** every new string in EN and DE; DE edited by node utf8 script.

## Design

### Availability

Scheduled jobs (the Settings section and the runner) and the Scheduled reports view are available only when
`tursoConfig !== null` and the portfolio is a Turso portfolio (`loadPortfolioMode() === "turso"`). Otherwise the
Settings section shows one line saying scheduled jobs need a Turso portfolio, the runner is not enabled, and the
view (reachable on single-database Turso through the nav) says the same.

The runner additionally needs AI on and a key, as today. The view does NOT: existing reports stay readable with
AI off.

Jobs already stored where they no longer run — localStorage in file mode, the jobs of a single-database Turso — are
left in place and do not run. Wherever a Turso config is present, a single-database Turso included, the first load
migrates and switches that database's legacy `scheduled_jobs` rows off, which is what stops an older client's runner. (Review cr2 changed where jobs live: the new job shape is in
`scheduled_jobs_v2`, migrated once from the pre-§772 `scheduled_jobs`, whose rows are then switched off and which
an updated client never writes again, because an older client rebuilds every job from a fixed field list and would
strip the new fields.) The CHANGELOG entry says that scheduled jobs now need a
Turso portfolio and that every existing job needs a project chosen before it runs again.

### Job model

`ScheduledJob` gains:
- `projectId: string | null` — existing jobs load with `null`;
- `instruction?: string` — trimmed, capped at `TEXTAREA_MAX`;
- `timeZone: string | null` — the IANA zone its `timeOfDay` is read in; existing jobs load with `null`;
- `key: string | null` — a uuid, never reused; existing jobs load with `null`.

*(designer's call)* A job without a `projectId` never runs, so its key and time zone are minted in the SAME save
that sets its project: `key = crypto.randomUUID()`, `timeZone = resolveTimezone(settings.timezone, undefined)` of
the device making the choice. New jobs get all three when created. This avoids minting a key on load (which would
give a legacy job a new key on every load until a save lands). The time zone is shown and editable beside the
time.

Reports refer to a job only by `key`; the numeric `id` stays for the Settings UI.

**Deleting a job keeps its reports** (owner). They stay in Scheduled reports with the job's name as it was when
each ran.

### Settings → Scheduled jobs

Per job, beside today's name, cadence, weekday, time and on/off:
- **Project:** a select of the portfolio's active projects by name, storing the id. A job without one shows
  "Choose a project" in the row's run-status line. *(designer's call)* After the upgrade, a one-time note at the top
  of the section says the jobs need a project.
- **Time zone:** the job's zone, defaulting as above.
- **Instruction:** an optional textarea ("What should this job look for, and what should it ignore?").
- A job disabled because its project was archived shows why (see *Run*).

### Slots

*(designer's call)* A job's slot is computed in the job's `timeZone`, not the device's, and stored as the UTC
instant of that slot (ISO). Every device therefore computes the same slot for the same job. A job is due when the
current slot has no report row (see *Claiming*) and its CADENCE PERIOD has no report. **Owner decision: a job runs at
most once per period** — once per local calendar day (daily) or once per local ISO week, Monday to Sunday (weekly),
both in the job's CURRENT zone — so no later edit of its time or zone can make it bill again within that period. The
period begins at local midnight of the day (daily) or of the Monday (weekly), computed with the same zone-correct
helpers as the slot (`periodStartFor`), so a 23- or 25-hour day on a DST change still starts at the right instant. The
pre-claim check is therefore "any report of this job whose slot is at or after the start of the current period"; the
UNIQUE claim still guards the exact slot. The job store's `lastRunAt` is not the guard that makes a slot due: the report
table is. The runner keeps ONE secondary use of it, so a legacy job that already ran today under a pre-§772 runner does
not bill again the moment it is given a project: a job whose newest run record carries a slot (`run.slot`: the slot it
ran FOR, never when it ended, which can be past local midnight) at or after the start of the period is not run; a
record from an older version has no slot and is judged by its `lastRunAt` against the current slot (a `project-missing`
record never counts, it wrote no report). That check can only skip a run, never cause one.

### Claiming

*(designer's call)* The claim is the report row itself. Before any billed call, the runner inserts
`(id, project_id, job_key, slot, status='running', ran_at, claimed_by)` with
`INSERT … ON CONFLICT (job_key, slot) DO NOTHING RETURNING id`, as ONE statement. Only a device that gets a row
back runs the job; every other device skips it. No compare-and-set on the job store is involved, so its lost
updates cannot erase a claim. The statement also carries the period limit, so two devices holding DIFFERENT slots of
one period cannot both win: `INSERT … SELECT … WHERE NOT EXISTS (a report of this job at or after the period start)
ON CONFLICT (job_key, slot) DO NOTHING RETURNING id`, still one statement. The separate pre-check
(`hasReportAtOrAfter`) stays only as a cheap early exit that saves the project-list reads and the claim. *Owed:* the build verifies `RETURNING` through the app's Turso pipeline against a
live database before relying on it (an `e2e:live-destructive` probe, as `turso-ddl-probe-live.spec.ts` does).

A `running` row older than 30 minutes is shown as failed ("interrupted": the tab closed or the device slept
mid-run) and never re-run.

### Run

For each due job, in order:

1. **Check the project** against the active and archived lists (`listProjectRefs`, one pipeline) — before claiming, so no row is written
   for a project that is gone.
   - *Hard-deleted* (in neither list): no row is written; the job's `projectId` is cleared through the hook's
     `mutate` (it returns to "Choose a project") and its run history records `project-missing`.
   - *Archived:* the job is claimed, one failed report is written (`project-archived`), and the job is disabled
     through `mutate`, so an archived project produces one report, not one per slot until retention pushes out
     the real ones. Re-enabling is a manual step after the project is restored.
2. **Claim** (above).
3. **Load** the project. A storage failure here (BUSY, unreachable, an HTTP 429 or 5xx from Turso) is transient: the claim row is deleted, no
   report is written and nothing is billed; the next tick tries again.
   Any OTHER Turso step or SQL error is deterministic: the report is finished as failed with token `turso`, because
   retrying it would claim, fail and release on every tick for ever.
   Immediately before the claim the runner re-reads the live state: the job as it is NOW in the job store (a fresh
   read, not the copy this tab loaded at mount, so another tab's or device's delete, switch-off, re-point or re-time
   is honoured), still enabled with the same key, project, cadence and zone; scheduled jobs and AI on with a key;
   same portfolio. It skips without claiming otherwise, and a store that cannot be read counts as "no". The same
   check runs once more right before the billed call, because the project load in between takes seconds.
   Right after the claim it checks the project once more, so a project hard-deleted in between leaves no orphan row.
4. **Build** the wide digest from the loaded workspace (below).
5. **Analyse** with `runJobAnalysis(context, …)`, the instruction in its own user-message section.
6. **Ground** every `entity` against the LOADED workspace with `buildGroundingIndex` / `groundEntity`; drop an
   ungrounded reference from the action (keep the action's text).
7. **Finish** the row in one atomic batch: `BEGIN; UPDATE scheduled_reports SET status, ok, data … WHERE id=?;
   DELETE … WHERE job_key=? AND id NOT IN (SELECT id … WHERE job_key=? ORDER BY slot DESC LIMIT 50); COMMIT`.
   Table DDL is sent in its own call first, never before BEGIN.
8. **Record** the run in the job's history through `mutate`, as today (Settings run list), and notify (title: job
   name, body: project name + summary).

A failure in steps 4–6 finishes the row as failed. Errors are stored only as a closed set of tokens: `limit`,
`401`, `403`, `parse`, `storage-unreachable`, `turso`, `project-archived`, `project-missing`, `interrupted`,
`error` — never `e.message`, because Turso errors carry server text.

### Wide digest

A pure, i18n-free builder takes the loaded `Workspace`, today, the effective settings for that project (device
settings merged with the loaded workspace's `settingsOverrides` — Next actions thresholds, time zone, the same
merge the app applies to the open project), and the already-translated queue, and returns the context text. The
queue comes from `buildActionInput` + `computeNextActions` over the loaded workspace, without per-device snooze or
learned bias, translated with `actionText(lang, …)` before it is passed in. `mode` and enabled modules come from
the effective settings for that project.

Per category it keeps `CONTEXT_CAP_PER_CATEGORY` and the `view#id` grounding format. *(designer's call)* Only open
or active items fill the cap (not Done, Cancelled or Closed), overdue first, then by nearest date. Each line adds:
- tasks: status, priority, assignee, due date, `overdue`;
- RAID: category, severity, status, owner, due date, last-touched (review) date, `overdue`;
- milestones: date, done or `overdue`;
- changes: status, decision date when decided;
- stakeholders: role or organisation;
- one budget line from the dashboard model: planned, actual and forecast at completion in the plan currency.

Titles are cut at 120 characters as today, and the whole context is cut at **24,000 characters**, ending with a
"…(truncated)" line. The Action Center button uses the same builder over the live workspace. The AI
weight-suggestion context keeps today's narrow digest *(designer's call)*.

### Report storage

Table `scheduled_reports` (portfolio-wide, `CREATE TABLE IF NOT EXISTS`):
`id TEXT PRIMARY KEY` (uuid), `project_id TEXT`, `job_key TEXT`, `slot TEXT` (UTC ISO), `status TEXT`
(`running` | `done`), `ok INTEGER`, `ran_at TEXT`, `claimed_by TEXT`, `data TEXT` (JSON: `jobName`, `projectName`,
`instruction`, `summary`, `actions` (title, why, severity, grounded entity or none), `error`), with
`UNIQUE (job_key, slot)`. Retention: at most 50 rows per `job_key`, applied in step 7; a deleted job's reports are
never pruned further. `claimed_by` is a per-device label: a random id minted once per device and kept in localStorage under `aipm-cockpit:device-label`; the view shows it as "this device" when it matches.

**Who can read and who pays** *(stated, not new)*: anyone holding the portfolio's Turso config can read every
report, as with every other table of a tenant portfolio — there are no per-project access rules. A job runs on
whichever open device has scheduled jobs switched on, billed to that device's Anthropic key, even for a project
that user never opens; `claimed_by` makes that visible. A report keeps the instruction it ran with after the job
is deleted.

### Scheduled reports view

- Nav: Portfolio group, after `portfolio-health`; label "Scheduled reports"; in `TURSO_ONLY_VIEWS`.
- Left: a vertical `tablist` (`aria-orientation="vertical"`, roving tabindex with Up, Down, Home and End,
  `aria-controls` to the panel), newest first. Each tab shows the run time in the app's time zone (for example
  "Mon 27 Oct 2026, 08:00"), the project name and the job name beneath; a failed or interrupted run is marked by an
  icon and text, not colour alone. Accessible names are unique per row.
- Above the list: a project filter, default "All projects", listing every project that has reports — archived
  ones included, with the name from the newest report. The options come from a query of their own
  (`listReportProjects`), and choosing one reads that project's rows from the database (`listReports(config,
  projectId)`), so neither is limited to the newest rows of the whole table.
- Right: the selected report: job name, project, run time, who ran it, the instruction it ran with, the summary,
  and the suggested actions (severity, title, why, entity as text). All report text renders as plain text, never
  HTML: it is model output steered by project content.
- Empty state when there are no reports yet, pointing to Settings → Scheduled jobs.
- Refresh: the list reloads when the view mounts, on window focus, and when the runner finishes a run.

### Text changes

`scheduledJobsHelp` and the AI help body describe a job as an analysis of the project it names, kept as a report
under Scheduled reports, available with a Turso portfolio. The CHANGELOG entries (Added and Changed) carry the upgrade note.

### Register

§772's entry (index row + entry, Work item #860) is added and closed by the PR that ships this work, as agreed
with the peer. §772 is reserved only once it is on `origin/main`; the issue title already carries it.

## Left to the builder

- Component and hook names, file split (panel split rule: rows/toolbar presentational before ~700 lines).
- Exact digest line format, within the fields above.
- Whether the report list is paged or loads all rows (retention bounds it at 50 per job).
- How the runner signals "run finished" to the view (an event or a shared store), within the refresh rule above.
