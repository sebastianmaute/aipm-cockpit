# Scheduled Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scheduled jobs name one Turso project, carry an instruction and a time zone, claim each run in Turso so it is billed once, analyse the named project with a wider digest, and keep a report per run in a new portfolio-wide "Scheduled reports" view.

**Architecture:** The browser runner stays (`use-scheduled-job-runner.ts`) but delegates one job's run to a new plain-async orchestrator that checks the project list, claims the slot by inserting the report row, loads the project with `TursoBackend`, builds the digest from the loaded workspace, calls the shared `runJobAnalysis`, grounds and stores the result. Reports live in a new side table `scheduled_reports` (out of `TABLE_NAMES`, in `project-side-tables.ts`). A new Turso-only view lists them.

**Tech Stack:** Next.js (repo-pinned; read `node_modules/next/dist/docs` before touching framework code), React 19, TypeScript, vitest + RTL, Turso over the app's own Hrana pipeline (`runTursoPipeline`).

**Spec:** `docs/superpowers/specs/2026-10-23-scheduled-reports-design.md` (approved 2026-10-23). Read it first; this plan argues from it.

## Global Constraints

- Read `AGENTS.md` before the first edit. Its hard constraints apply to every task (i18n EN/DE parity and real umlauts; CRLF `src/app` files — edit with the Edit tool or node `\r\n` anchors, never `sed -i`; `i18n.de.ts` only via a node utf8 script; palette tokens only; icons only from `src/app/icons.ts`).
- `task-manager.tsx` must not gain a single line (size baseline has zero headroom). Wire through `use-ai-orchestration.ts`, `workspace-section.tsx` and the settings section instead.
- No `Date.now()` / `new Date()` / `Math.random()` / `crypto.randomUUID()` in a render body.
- Error strings stored or shown are only these tokens: `limit`, `401`, `403`, `parse`, `storage-unreachable`, `turso`, `project-archived`, `project-missing`, `interrupted`, `error`. Never `e.message`.
- Report text renders as plain text only (no `dangerouslySetInnerHTML`, no rich-text renderer).
- The `ScheduledJob.type` literal stays `"portfolioAnalysis"`.
- Every new string has an EN and a DE entry; the nav label is "Scheduled reports" / "Geplante Berichte".
- Constants: retention `REPORT_RETENTION_PER_JOB = 50`; stale claim `RUNNING_STALE_MS = 30 * 60 * 1000`; digest cap `DIGEST_MAX_CHARS = 24_000`; instruction cap `TEXTAREA_MAX` (`sanitize-core.ts`).
- Vitest only under the `/c/Projects/.vitest-lock` mkdir lock (`if mkdir …; then …; rmdir …; fi`), never two runs at once. Before every commit: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit` (0 errors in total).
- Commits cite §772; no `Claude-Session` trailer, no `Closes #`; never `--amend`.

## Review Focus

1. **A daylight-saving change in the job's zone** — a daily 02:30 job on the spring-forward day still runs once (at the first valid instant after the gap), and on the fall-back day runs once, not twice. Pinned in Task 1.
2. **A weekly job whose zone's weekday differs from UTC's** — a Monday 00:30 Europe/Berlin job is due on Berlin's Monday although the UTC instant is Sunday 22:30. Pinned in Task 1.
3. **Two runners claiming the same slot at once** (two tabs, one device) — exactly one claim returns an id; the other run is skipped without an AI call. Pinned in Tasks 2 and 4.
4. **A job deleted or renamed while its run is in flight** — the report row still finishes with the name captured at claim time, and the history `mutate` on a missing job is a no-op, not a crash. Pinned in Task 4.
5. **A very large project** — the digest stops at `DIGEST_MAX_CHARS` with a truncation line and never cuts a line in half. Pinned in Task 3.

---

### Task 1: Job model, slots in the job's zone, and the spec's actor correction

**Files:**
- Modify: `src/app/scheduled-jobs/types.ts`, `src/app/scheduled-jobs/schedule.ts`, `src/app/scheduled-jobs-store.ts` (`sanitizeJob`), `src/app/use-scheduled-jobs.ts` (`createJob`, new `assignProject`)
- Modify: `docs/superpowers/specs/2026-10-23-scheduled-reports-design.md` (actor sentence)
- Test: `src/app/scheduled-jobs/schedule.test.ts`, `src/app/scheduled-jobs-store.test.ts`, `src/app/use-scheduled-jobs.test.ts` (create the store/hook test files if absent)

**Interfaces:**
- Produces:
  - `ScheduledJob` adds `projectId: string | null; instruction?: string; timeZone: string | null; key: string | null`.
  - `slotFor(job: ScheduledJob, now: Date): Date | null` — the UTC instant of the job's current slot in `job.timeZone`, or `null` when not yet reached today / not the weekday / `timeZone` is null.
  - `zonedInstant(ymd: string, timeOfDay: string, tz: string): Date` — exported helper.
  - `nextRunAt(job: ScheduledJob, from: Date): Date | null` (signature changes from `cadence` to `job`; null when `timeZone` is null).
  - `isRunnable(job: ScheduledJob): boolean` — `enabled && projectId !== null && key !== null && timeZone !== null`.
  - `useScheduledJobs` adds `assignProject(id: number, projectId: string, timeZone: string): Promise<void>` — sets `projectId`, and in the SAME save mints `key = crypto.randomUUID()` and sets `timeZone` when they are null.
  - `CreateScheduledJobInput` adds `projectId: string; timeZone: string; instruction?: string`; `createJob` mints `key`.

- [ ] **Step 1: Correct the spec.** In the spec's *Report storage*, replace "`claimed_by` is the same actor label the activity log records for the device's user." with "`claimed_by` is a per-device label: a random id minted once per device and kept in localStorage under `aipm-cockpit:device-label`; the view shows it as "this device" when it matches." (The activity log records no person's name; ruling 2026-10-23.) Commit with the task.

- [ ] **Step 2: Write the failing tests** in `schedule.test.ts`:

```ts
it("computes a daily slot in the job's zone as a UTC instant", () => {
  const job = mk({ cadence: { kind: "daily", timeOfDay: "08:00" }, timeZone: "Europe/Berlin" });
  expect(slotFor(job, new Date("2026-10-23T07:00:00Z"))?.toISOString()).toBe("2026-10-23T06:00:00.000Z");
  expect(slotFor(job, new Date("2026-10-23T05:59:00Z"))).toBeNull();
});
it("finds a weekly slot on the zone's weekday, not UTC's", () => {
  const job = mk({ cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "00:30" }, timeZone: "Europe/Berlin" });
  // Monday 2026-10-26 00:30 Berlin (CET, UTC+1) = Sunday 23:30 UTC
  expect(slotFor(job, new Date("2026-10-25T23:40:00Z"))?.toISOString()).toBe("2026-10-25T23:30:00.000Z");
});
it("runs once across the spring-forward gap", () => {
  const job = mk({ cadence: { kind: "daily", timeOfDay: "02:30" }, timeZone: "Europe/Berlin" });
  expect(slotFor(job, new Date("2027-03-28T02:00:00Z"))?.toISOString()).toBe("2027-03-28T01:00:00.000Z"); // 03:00 CEST, first valid instant
});
it("runs once on the fall-back day (earlier of the two 02:30s)", () => {
  const job = mk({ cadence: { kind: "daily", timeOfDay: "02:30" }, timeZone: "Europe/Berlin" });
  expect(slotFor(job, new Date("2026-10-25T03:00:00Z"))?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
});
it("is never runnable without a project, key or time zone", () => {
  expect(isRunnable(mk({ projectId: null }))).toBe(false);
  expect(isRunnable(mk({ key: null }))).toBe(false);
  expect(isRunnable(mk({ timeZone: null }))).toBe(false);
  expect(isRunnable(mk({}))).toBe(true);
});
```

  `mk` builds an enabled job with `projectId: "p1"`, `key: "k1"`, `timeZone: "UTC"` unless overridden. In the store test: `sanitizeJob` keeps `projectId`, `instruction` (trimmed, capped at `TEXTAREA_MAX`), `timeZone` (only if `isValidTimeZone`, else null) and `key`; a legacy blob without them loads with all four null (instruction absent) and is NOT given a key. In the hook test: `assignProject` on a legacy job persists `projectId`, a non-empty `key` and the `timeZone` in one `saveScheduledJobs` call; a second `assignProject` keeps the existing key.

- [ ] **Step 3: Run them to verify they fail.** `npx vitest run src/app/scheduled-jobs src/app/scheduled-jobs-store.test.ts src/app/use-scheduled-jobs.test.ts --reporter=dot` — Expected: FAIL (`slotFor` not exported; fields dropped).

- [ ] **Step 4: Implement.** `zonedInstant` finds the instant whose `isoInZone`/`formatInZone` wall time in `tz` equals `ymd timeOfDay`: guess the UTC instant with the zone's offset at the naive time, correct once by the offset at the guess; if the wall time does not exist (gap), return the first instant after the gap; if it occurs twice, return the earlier. `slotFor` takes today's date in the zone (`todayInZone(now, tz)`), the zone weekday for weekly jobs, and returns `zonedInstant(...)` when `now >= slot`. Replace `isDue`/`dueJobs` usage by the runner in Task 4 (keep them exported until then only if a test still needs them; delete them in Task 4).

- [ ] **Step 5: Run the tests to verify they pass**, then `npx tsc --noEmit` (fix every caller of `nextRunAt`/`createJob`).

- [ ] **Step 6: Commit.** `git commit -m "feat: scheduled jobs carry a project, instruction, time zone and permanent key; slots are read in the job's zone (§772)"`

### Task 2: The report store and its side-table registration

**Files:**
- Create: `src/app/scheduled-reports-store.ts`, `src/app/scheduled-reports-store.execute.test.ts`
- Modify: `src/app/project-side-tables.ts`
- Create: `e2e/scheduled-reports-claim-live.spec.ts` (owed live probe; skips without `TURSO_THROWAWAY_*`, see `e2e/live-turso-env.ts`)

**Interfaces:**
- Produces (all take `config: TursoConfig | null` first):
  - `SCHEDULED_REPORTS_DDL: string[]` (one `CREATE TABLE IF NOT EXISTS scheduled_reports (id TEXT PRIMARY KEY, project_id TEXT, job_key TEXT, slot TEXT, status TEXT, ok INTEGER, ran_at TEXT, claimed_by TEXT, data TEXT, UNIQUE (job_key, slot))`).
  - `type ReportErrorToken = "limit" | "401" | "403" | "parse" | "storage-unreachable" | "turso" | "project-archived" | "project-missing" | "interrupted" | "error"` (the Global Constraints' closed set; `AiActionSeverity` and `GroundableView` come from `action-ai.ts`).
  - `type ReportData = { jobName: string; projectName: string; instruction?: string; summary: string; actions: { title: string; why: string; severity: AiActionSeverity; entity?: { view: GroundableView; id: string } }[]; error?: ReportErrorToken }`.
  - `type ScheduledReport = { id: string; projectId: string; jobKey: string; slot: string; status: "running" | "done"; ok: boolean; ranAt: string; claimedBy: string; data: ReportData }`.
  - `hasReport(config, jobKey: string, slot: string): Promise<boolean>`.
  - `claimReport(config, row: { id: string; projectId: string; jobKey: string; slot: string; ranAt: string; claimedBy: string; data: ReportData }): Promise<boolean>` — one `INSERT … ON CONFLICT (job_key, slot) DO NOTHING RETURNING id`; true iff a row came back. DDL goes in its own preceding call.
  - `releaseClaim(config, id: string): Promise<void>` — `DELETE … WHERE id = ? AND status = 'running'`.
  - `finishReport(config, id: string, jobKey: string, ok: boolean, data: ReportData): Promise<void>` — one atomic batch `BEGIN; UPDATE …; DELETE … retention (keep newest REPORT_RETENTION_PER_JOB by slot); COMMIT`.
  - `listReports(config): Promise<ScheduledReport[]>` — newest `slot` first; a row whose `data` does not parse is skipped.
  - `isInterrupted(r: ScheduledReport, now: Date): boolean` — `status === "running"` and `ranAt` older than `RUNNING_STALE_MS`.

- [ ] **Step 1: Write the failing tests** against `node:sqlite` the way `turso-portfolio.execute.test.ts` executes real statements:
  - `claimReport` twice for the same `(jobKey, slot)` → `true` then `false`, one row in the table.
  - `finishReport` sets `status='done'`, `ok`, and `data`; after 52 finished reports for one key, 50 remain (the two oldest slots are gone) and another key's rows are untouched.
  - `releaseClaim` deletes a `running` row and leaves a `done` row.
  - `listReports` orders by `slot` descending and skips a row with `data = "{"`.
  - `isInterrupted` true at 31 minutes, false at 29, false for `done`.
  - `PROJECT_SCOPED_SIDE_TABLES` contains `scheduled_reports`, and `projectSideTableSweepStatements("p1")` deletes its rows for `p1` only.
  - `TABLE_NAMES` does not contain `scheduled_reports`.

- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/app/scheduled-reports-store.execute.test.ts src/app/turso-side-tables.guard.test.ts --reporter=dot` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** the store with `runTursoPipeline` and `txt(...)` args (`SqlArg.value` is string-only). Read `RETURNING` rows from `PipelineResultLike.response.result.rows`. Register the table in `PROJECT_SCOPED_SIDE_TABLES` with `SCHEDULED_REPORTS_DDL`.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Write the live probe** `e2e/scheduled-reports-claim-live.spec.ts`: against the throwaway database, two concurrent `claimReport` calls through the real pipeline → exactly one `true`. It runs only via `npm run e2e:live-destructive`. Report in the task's report whether it was run; if it was not, the PR description must say the probe is owed.

- [ ] **Step 6: Commit.** `git commit -m "feat: the scheduled_reports side table — the report row is the run claim (§772)"`

### Task 3: The wide project digest and per-project analysis input

**Files:**
- Create: `src/app/project-digest.ts` (pure, i18n-free), `src/app/project-digest.test.ts`
- Create: `src/app/project-analysis-input.ts`, `src/app/project-analysis-input.test.ts`

**Interfaces:**
- Produces:
  - `buildProjectDigest(input: ProjectDigestInput): string`, where `ProjectDigestInput = { projectName: string; today: string; mode: AppMode; enabledModules: readonly string[]; tasks: readonly Task[]; raid: readonly RaidItem[]; milestones: readonly Milestone[]; changes: readonly ChangeItem[]; stakeholders: readonly Stakeholder[]; budget?: { currency: string; planned: number; actual: number; forecast: number }; queue: readonly { title: string; why: string; tier: "now" | "soon" | "monitor" }[]; instruction?: string }`.
  - `DIGEST_MAX_CHARS = 24_000`.
  - `buildProjectAnalysisInput(args: { workspace: Workspace; deviceSettings: Settings; lang: Lang; now: Date }): { digestInput: ProjectDigestInput; grounding: GroundingIndex; effectiveSettings: Settings }` — merges `resolveEffectiveSettings(deviceSettings, workspace.settingsOverrides, undefined)`, computes today with `todayInZone(now, resolveTimezone(effective.timezone, workspace.project?.operatingTimezone))`, the dashboard via `buildDashboardInput`/`computeDashboard` (as `use-portfolio-health.ts` does), comms reminders via `getStakeholderCommsItems`, workload alerts via `buildWorkloadAlerts`, the queue via `buildActionInput` + `computeNextActions` (no `dismissed`, no `learnedBias`, no `trends`), translated with `actionText(lang, …)`, and `buildGroundingIndex` over the workspace.

- [ ] **Step 1: Write the failing tests** (`project-digest.test.ts`):
  - Done/Cancelled tasks and Closed RAID are absent; an open task with a past due date is listed before one due later, and its line contains `overdue`.
  - A task line contains its status, priority, assignee and due date; a RAID line its category, severity, status and owner; a milestone line its date; a change line its status.
  - With `budget`, one line names the currency and the three figures.
  - With `instruction`, the text ends with a `## Job instruction` section holding it verbatim; without, no such heading.
  - With 2,000 long tasks the result is `<= DIGEST_MAX_CHARS`, ends with `…(truncated)`, and every line before it is a whole line from the untruncated output.
  - Lines keep the `view#id:` grounding format.
  
  (`project-analysis-input.test.ts`): a workspace whose `settingsOverrides.nextActions` raises a threshold changes the queue versus the same workspace without it; `effectiveSettings.timezone` follows the override; the queue strings are translated (no raw i18n key text).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Keep `CONTEXT_CAP_PER_CATEGORY` from `action-ai.ts` (export it if it is not exported). Truncate by dropping whole lines from the end of the category sections, then append the truncation line.

- [ ] **Step 4: Run to verify they pass**, eslint, tsc.

- [ ] **Step 5: Commit.** `git commit -m "feat: a wide, bounded project digest built from a workspace (§772)"`

### Task 4: The run orchestrator and the runner

**Files:**
- Create: `src/app/scheduled-job-run.ts`, `src/app/scheduled-job-run.test.ts`, `src/app/device-label.ts`
- Modify: `src/app/use-scheduled-job-runner.ts`, `src/app/use-scheduled-job-runner.test.ts`, `src/app/use-ai-orchestration.ts`, `src/app/scheduled-jobs/schedule.ts` (delete `isDue`/`dueJobs`)

**Interfaces:**
- Consumes: Task 1 (`slotFor`, `isRunnable`, `assignProject`/`updateJob`), Task 2 (store), Task 3 (`buildProjectAnalysisInput`, `buildProjectDigest`), `runJobAnalysis`, `groundEntity`.
- Produces:
  - `type RunOutcome = "skipped" | "claimed-elsewhere" | "project-missing" | "project-archived" | "transient" | "failed" | "done"`.
  - `runScheduledJob(job: ScheduledJob, slot: Date, deps: RunDeps): Promise<RunOutcome>` with `RunDeps = { config: TursoConfig; listActive(): Promise<{ id: string; name: string }[]>; listArchived(): Promise<{ id: string; name: string }[]>; loadWorkspace(projectId: string): Promise<Workspace>; analyse(context: string): Promise<ActionAnalysis>; deviceSettings: Settings; lang: Lang; now(): Date; newId(): string; deviceLabel: string; clearProject(jobId: number): Promise<void>; disableJob(jobId: number): Promise<void>; recordRun(jobId: number, run: ScheduledJobRun): Promise<void>; notify(title: string, body: string): void }`.
  - `getDeviceLabel(): string` (`device-label.ts`) — reads or mints (`crypto.randomUUID()`, first 8 chars) `aipm-cockpit:device-label`; try/catch around storage; falls back to `"unknown"`.
  - `useScheduledJobRunner` args: replace `buildContext` with `config: TursoConfig | null`, `available: boolean`, `deviceSettings`, `lang`, `clearProject`, `disableJob`; keep `enabled`, `jobs`, `recordRun`, `ai`, `notify`, `now`, `guidesReady`.

- [ ] **Step 1: Write the failing orchestrator tests** with fake deps (every dep a `vi.fn`):
  - project in neither list → `"project-missing"`; `clearProject` called; no `claimReport`, no `analyse`.
  - project archived → `"project-archived"`; one claim, `finishReport(ok=false, error "project-archived")`; `disableJob` called; no `analyse`.
  - `hasReport` true → `"skipped"`, nothing else called.
  - `claimReport` false → `"claimed-elsewhere"`, no `loadWorkspace`, no `analyse`.
  - `loadWorkspace` rejects with `StorageNotReadyError` → `"transient"`; `releaseClaim` called; no `finishReport`; no `recordRun`.
  - `analyse` rejects with `AiHttpError(429, "rate_limit_error")` → `"failed"`; `finishReport(ok=false, error "limit")`; error never contains the thrown message text.
  - success: `analyse` gets a context that contains the job's instruction section; an action whose `entity` id is not in the loaded workspace is stored without `entity`; a grounded one keeps it; `finishReport(ok=true)`, `recordRun`, `notify(job.name, <project name + summary>)`.
  - the job's name and project name are captured at claim time: renaming the job in the store after the claim does not change the finished report's `jobName`.
  - `recordRun` for a job deleted mid-run (dep resolves without finding it) does not throw.

- [ ] **Step 2: Write the failing runner tests:** with `available: false` no tick calls `runScheduledJob`; with two jobs due, they run sequentially; a job with `isRunnable` false is never passed; two runner instances ticking at once on the same job produce one `analyse` call (shared fake store whose `claimReport` returns true once).

- [ ] **Step 3: Run to verify they fail.**

- [ ] **Step 4: Implement** `runScheduledJob` in the spec's step order (*Run* 1–8). Map errors to tokens with one function `toErrorToken(e: unknown): ReportErrorToken` (`AiHttpError` limit → `limit`, status 401/403 → that status, `Error("parse")` → `parse`, `StorageNotReadyError` → `storage-unreachable`, `TursoStepError` / other Turso → `turso`, else `error`). In `use-ai-orchestration.ts`, compute `available = tursoConfig !== null && loadPortfolioMode() === "turso"`, pass `listProjects`/`listArchivedProjects`, `loadWorkspace = (id) => new TursoBackend(tursoConfig, id).load()`, `clearProject`/`disableJob` via `scheduledJobs.updateJob`, and `analyse = (ctx) => runJobAnalysis(ctx, ai)`. Dispatch a `window` `CustomEvent("aipm-cockpit:scheduled-report")` after each finished report (the view listens in Task 6).

- [ ] **Step 5: Run to verify they pass**, eslint, tsc, and `npm run size:check` (expect exit 0; `task-manager.tsx` untouched).

- [ ] **Step 6: Commit.** `git commit -m "feat: a scheduled run checks its project, claims the slot, analyses the loaded project and keeps the report (§772)"`

### Task 5: The Action Center uses the wide digest; Settings learns project, zone and instruction

**Files:**
- Modify: `src/app/use-ai-orchestration.ts` (`buildAiContext` → `buildProjectDigest` over the live workspace; `buildWeightSuggestionContext` unchanged)
- Modify: `src/app/settings-sections/scheduled-jobs-section.tsx` (split a `scheduled-job-row.tsx` out if it would cross ~400 lines)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-ai-orchestration.test.ts(x)` (or the existing test that covers `buildAiContext`), `src/app/settings-sections/scheduled-jobs-section.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`assignProject`, `CreateScheduledJobInput`), Task 3 (`buildProjectDigest`).
- Produces: i18n keys `scheduledJobsNeedPortfolio`, `scheduledJobsUpgradeNote`, `scheduledJobProject`, `scheduledJobChooseProject`, `scheduledJobTimeZone`, `scheduledJobInstruction`, `scheduledJobInstructionPlaceholder`, `scheduledJobArchived`.

- [ ] **Step 1: Write the failing tests.**
  - Action Center: the context sent by *Analyze with AI* includes a task's status and due date (wide digest); the weight-suggestion context does not.
  - Settings, `tursoConfig === null`: the section shows only `scheduledJobsNeedPortfolio` text and no job controls.
  - Settings, Turso portfolio: each job row has a combobox named `scheduledJobProject` listing active projects only (archived absent); choosing one calls `assignProject(id, projectId, <zone>)`; a legacy job shows `scheduledJobChooseProject` where its next run would be; a job with `enabled: false` whose project is archived shows `scheduledJobArchived`.
  - The instruction is a textbox named `scheduledJobInstruction`; typing then blurring saves the trimmed value through `updateJob`.
  - The time-zone control (named `scheduledJobTimeZone`) lists `tzZones()` and saves through `updateJob`.
  - When any job has `projectId === null`, `scheduledJobsUpgradeNote` shows once at the top.
  - Accessible names are unique per row (`buildRowTokens` with the job name).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** The section reads the project lists itself (`listProjects`/`listArchivedProjects`, `loadPortfolioMode()`), never via `usePortfolioProjects`. The default zone for a new or newly assigned job is `resolveTimezone(settings.timezone, undefined)`.

- [ ] **Step 4: Run to verify they pass**, eslint, tsc.

- [ ] **Step 5: Commit.** `git commit -m "feat: scheduled jobs pick a project, time zone and instruction; the Action Center sends the wide digest (§772)"`

### Task 6: The Scheduled reports view

**Files:**
- Create: `src/app/scheduled-reports-panel.tsx`, `src/app/scheduled-reports-list.tsx` (presentational tab list), `src/app/scheduled-reports-panel.test.tsx`
- Modify: `src/app/nav-config.ts`, `src/app/view-ai-scope.ts`, `src/app/nav-icons.tsx`, `src/app/help-content.ts`, `src/app/workspace-panels.tsx`, `src/app/workspace-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `AGENTS.md` (the tabpanel count sentence)

**Interfaces:**
- Consumes: Task 2 (`listReports`, `isInterrupted`, `ScheduledReport`), Task 4 (the `aipm-cockpit:scheduled-report` event), `getDeviceLabel`.
- Produces: `AppView` `"scheduled-reports"`; nav key `navScheduledReports`; help entry `feature-scheduled-reports` (`helpSecScheduledReportsTitle` / `helpSecScheduledReportsBody`, body states the Turso-portfolio condition); keys `scheduledReportsEmpty`, `scheduledReportsAllProjects`, `scheduledReportsFilter`, `scheduledReportsFailed`, `scheduledReportsInterrupted`, `scheduledReportsRanBy`, `scheduledReportsThisDevice`, `scheduledReportsInstruction`, `scheduledReportsSuggestions`, `scheduledReportsNeedPortfolio`.

- [ ] **Step 1: Write the failing tests** (`scheduled-reports-panel.test.tsx`, `listReports` mocked):
  - Three reports render a `tablist` with `aria-orientation="vertical"`, tabs newest-first; each tab's accessible name contains the formatted run time, the project name and the job name, and the names are unique.
  - ArrowDown/ArrowUp/Home/End move focus and selection (`userEvent.keyboard`); the selected tab has `aria-selected="true"` and `aria-controls` points at the panel's id.
  - The panel shows job name, project, run time, instruction, summary and each action's severity, title, why and entity text; a summary containing `<b>x</b>` renders as that literal text.
  - A failed report's tab shows the `scheduledReportsFailed` text and an icon (not colour alone); a `running` report older than 30 minutes shows `scheduledReportsInterrupted`.
  - The project filter defaults to `scheduledReportsAllProjects`, lists every project that has reports (including one whose project is archived) by its newest report's project name, and narrows the list.
  - `claimed_by` equal to `getDeviceLabel()` reads `scheduledReportsThisDevice`.
  - No reports → `scheduledReportsEmpty`; `tursoConfig === null` or a non-Turso portfolio → `scheduledReportsNeedPortfolio`; AI switched off → reports still render.
  - Dispatching `aipm-cockpit:scheduled-report` and a window `focus` each call `listReports` again.
  - `nav-config` places `scheduled-reports` directly after `portfolio-health` and lists it in `TURSO_ONLY_VIEWS`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Register the lazy panel like `PortfolioHealthPanel` (`workspace-panels.tsx`) and render it in `workspace-section.tsx` like the `portfolio-health` branch, deriving the Turso config the same way. Format the run time with `formatInZone` in the app zone. Count tabpanels after the change with `grep -c 'role="tabpanel"' src/app/workspace-section.tsx` and update the AGENTS.md sentence that quotes the count.

- [ ] **Step 4: Run to verify they pass**, eslint, tsc, `npm run size:check`, `npm run docs:symbols:check`.

- [ ] **Step 5: Commit.** `git commit -m "feat: the Scheduled reports view lists every run of the portfolio (§772)"`

### Task 7: Help texts, guides, CHANGELOG, docs and the register

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`scheduledJobsHelp`, the AI help body), `src/app/operating-guide-builtin.generated.ts` (regenerate with its generator if a quoted text changed), `CHANGELOG.md`, `docs/AGENTS/ai-assistant.md` (scheduled jobs section), `docs/open-followups.md`

- [ ] **Step 1: Rewrite the two help texts** (EN, then DE by node script) to say: a scheduled job analyses the project it names, its result is kept as a report under Portfolio → Scheduled reports, and scheduled jobs need a Turso portfolio. Remove "portfolio analysis".
- [ ] **Step 2: CHANGELOG** under [Unreleased]: an *Added* line for Scheduled reports, project and instruction per job; a *Changed* line: "Scheduled jobs now need a Turso portfolio, and each existing job needs a project chosen in Settings → Scheduled jobs before it runs again."
- [ ] **Step 3: `docs/AGENTS/ai-assistant.md`:** describe the claim-by-report-row rule, the slot-in-job-zone rule, the side table, and that the job store loses concurrent updates (so nothing critical may live there).
- [ ] **Step 4: Register.** Add §772 (index row + entry, Work item #860) closed by this branch, following the closure conventions of the file (a closed entry carries no work item line; see recent closures). Run `npm run followups:index:check`.
- [ ] **Step 5: Gates.** `LEAK_LIST_FILE="$HOME/.config/aipm-cockpit/leak-list.txt" node scripts/gate-local.mjs --group static` → `gate:local PASS at <sha>`. Then the touched-area suites under the lock and `npm run test:shuffle` is NOT run locally (CI runs it).
- [ ] **Step 6: Commit.** `git commit -m "docs: scheduled jobs help, CHANGELOG, AGENTS notes and the §772 register entry (§772)"`
