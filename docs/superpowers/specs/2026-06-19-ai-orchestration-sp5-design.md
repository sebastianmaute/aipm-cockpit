# AI Orchestration SP5 — Scheduled Claude jobs

**Date:** 2026-06-19
**Status:** Approved (brainstorming complete)
**Part of:** the "AI orchestration" roadmap (6 sub-projects). This is **SP5**, the final slice. Builds on **SP0** (context-aware core, v0.97.0), reuses **SP4**'s forced-tool analysis contract (`action-ai.ts` / `use-action-analysis.ts`, v0.104.0) and the v0.94.0 desktop-notification plumbing (`action-notifications.ts`).

## Roadmap context

| # | Sub-project | Status |
|---|---|---|
| SP0 | Context-aware Claude core | ✅ 0.97.0 |
| SP1 | Foundational prompts + Ask-Claude buttons | ✅ 0.98.0 |
| SP2 | Write tools + doc ingestion | ✅ 0.102.0 |
| SP3 | AI project-creation wizard | ✅ 0.103.0 |
| SP4 | Action Center AI suggestions | ✅ 0.104.0 |
| **SP5** | **Scheduled Claude jobs** (this spec) | — |

SP5 closes the roadmap.

## Goal

Let a user define **recurring, advisory "portfolio analysis" jobs** that run on a cadence and surface a result — reliably on **all** browsers (run on app-open / catch-up), with an **optional true-background bonus** on installed Chromium via Periodic Background Sync. Advisory only: jobs never write to the workspace.

## The hard constraint (why the design is shaped this way)

A browser-only app has **no server cron**. A job can only execute while *some* runtime is alive. True background execution while the app is closed is possible **only** via the **Periodic Background Sync API**, which is **Chromium-only, installed-PWA-only, browser-throttled to ~daily, and engagement-gated**. Push is out (needs a push server we don't have). So the honest, universal mechanism is **due-on-open + catch-up**; background sync is a progressive-enhancement layer that does nothing on unsupported platforms and must degrade silently.

## Locked decisions (from brainstorming)

1. **Execution model = hybrid.** Baseline = **due-on-open / catch-up** (the real scheduler, all browsers). Optional layer = **Periodic Background Sync** for installed Chromium, running the *same* due-check in the SW. Degrades silently to baseline.
2. **Job content = built-in periodic analysis/digest.** Reuses SP4's forced-tool `report_analysis` contract. No free-form user prompt (nothing untrusted to validate beyond what SP4 already handles).
3. **Result surfacing = desktop notification + in-app digest history.** On run: fire a notification (reuse `action-notifications` plumbing + dedup) AND append to a per-job, capped run history shown in a new in-app "Scheduled jobs" panel.
4. **Advisory only — never writes** (no write tools; reuses SP4 read-only analysis). Holds in both baseline and background.
5. **Gating: master toggle `ai.scheduledJobs`, default OFF** (recurring *billed* unattended calls → opt-in, unlike SP0/SP4 default-ON). Requires a configured Anthropic key.
6. **Cadence = daily | weekly** only (no hourly — background sync is ~daily-throttled regardless; keeps the model simple).
7. **PWA/SW background phase is the last, cuttable phase** — baseline ships independently.

## Section 1 — Pure engine `scheduled-jobs/` (i18n-free, no React)

A new i18n-free subdir mirroring `next-actions/`.

```ts
// scheduled-jobs/types.ts
export type JobCadence =
  | { kind: "daily"; timeOfDay: string }                 // "HH:MM" local
  | { kind: "weekly"; dayOfWeek: number; timeOfDay: string }; // 0=Sun..6=Sat

export interface ScheduledJobRun {
  ranAt: string;        // ISO timestamp
  summary: string;      // short digest text (from the analysis)
  actionCount: number;  // # of AI actions surfaced
  ok: boolean;          // false if the run errored (status-only)
  error?: string;       // status/token only, never key/body
}

export interface ScheduledJob {
  id: number;
  name: string;
  type: "portfolioAnalysis";   // only type in SP5; union leaves room
  cadence: JobCadence;
  enabled: boolean;
  lastRunAt: string | null;    // ISO; null = never run
  history: ScheduledJobRun[];  // capped, newest-first
}

export const JOB_HISTORY_CAP = 10;
```

```ts
// scheduled-jobs/schedule.ts  (pure, deterministic — `now` is always passed in)
// next scheduled fire at/after `from` for the cadence
export function nextRunAt(cadence: JobCadence, from: Date): Date;
// a job is due if enabled and its previous scheduled slot is <= now and
// it has not already run for that slot (compares lastRunAt to the slot start)
export function isDue(job: ScheduledJob, now: Date): boolean;
// select due jobs from a list (pure)
export function dueJobs(jobs: readonly ScheduledJob[], now: Date): ScheduledJob[];
```

- **No `Date.now()`/`new Date()` inside the engine** — callers pass `now` (keeps it pure + testable; respects the render-purity rule when called from React).
- `isDue` semantics (catch-up): for a daily job with `timeOfDay`, the slot for `now` is today at `timeOfDay`; job is due if `now >= slot` AND (`lastRunAt` is null OR `lastRunAt < slot`). Missed-while-closed → fires once on next open. Never double-fires the same slot.
- `appendRun(job, run)` helper: returns a new job with `history` capped to `JOB_HISTORY_CAP` and `lastRunAt` set. Immutable.

## Section 2 — Store `scheduled-jobs-store.ts` + hook `use-scheduled-jobs.ts`

- **GLOBAL store**, like `operating_guides` / `comm_templates` / `action_learning`:
  - Turso table `scheduled_jobs` (`SqlArg.value` string-only) **kept OUT of `TABLE_NAMES`** (guard test enforces — else workspace save's per-table DELETE wipes it). Turso-gated (`tursoConfig !== null`).
  - **localStorage fallback** (`lop-app:scheduled-jobs`) when Turso is not configured — so the feature works file/IndexedDB-backed too. (No new persisted `Workspace` field; no six-write-path change.)
- `useScheduledJobs()` → `{ jobs, createJob, updateJob, deleteJob, recordRun }`. `recordRun` runs a job's result through `appendRun` and persists. Mirrors the existing global-store hooks.

## Section 3 — Baseline runner `use-scheduled-job-runner.ts`

Lives **above the view** (in `task-manager.tsx`, like SP4's analysis hook) so it survives view remounts and runs regardless of which view is open.

- On mount (app load) and on a **light while-open interval** (e.g. every 5 min) and on `visibilitychange→visible`: compute `dueJobs(jobs, now)` (now captured in the effect/callback, not render).
- For each due job: run the SP4 analysis (reuse `useActionAnalysis` / `buildAnalysisContext` over the live workspace), then `recordRun(job, {summary, actionCount, ok})`, then fire a desktop notification (reuse `action-notifications`; respect its permission + a new dedup key `lop-app:scheduled-notified`).
- Errors: status/token only into `run.error`; never throw into render; never log key/body. A failed run still records (`ok:false`) so the user sees it in history.
- Serialize runs (one at a time) to avoid concurrent Turso writes (existing serialize-promise-chain pattern).
- Gated: only active when `ai.scheduledJobs !== false-default` (default OFF → must be explicitly ON) **and** an Anthropic key is present.

## Section 4 — UI

- **Settings → new "Scheduled jobs" section** (`settings-sections/scheduled-jobs-section.tsx`): master toggle (with a one-line **cost note** — "runs a billed analysis on each cadence"); list of jobs with enable/disable, name, cadence editor (daily/weekly + time/day), add/delete. Gated on key present (offer "Configure AI assistant" like SP3 empty-state when no key).
- **Results history**: per-job, show last run summary + timestamp + expandable past runs (capped). Either inside the section or a compact panel — section is simplest and keeps it in one place.
- **a11y:** Action Center / chat / Settings-subsections — the new section's controls must have accessible names; per-row job controls need **row-unique** labels (qualify by job name — the single-seeded-row axe trap). Settings→General is axe-gated; verify the new section by eye + targeted axe run if it lands under a scanned view.

## Section 5 — Optional PWA / background layer (last, cuttable phase)

Only after baseline is green. Progressive enhancement, fully feature-detected.

- Add minimal PWA foundation: `manifest.webmanifest` (name, icons — reuse `icc_logo_192.png`, `display: standalone`, theme/bg from AIPM palette) + a **service worker** registered client-side (forked-Next-compatible registration; confirm fork's static-asset + SW-scope handling before building).
- Register **Periodic Background Sync** (`registration.periodicSync.register("scheduled-jobs", { minInterval })`) **only** when: `"periodicSync" in registration`, the PWA is installed, and the `periodic-background-sync` permission is granted. Otherwise no-op (baseline still covers it).
- SW `periodicsync` handler runs the **same** `dueJobs` check, reading jobs + workspace from IndexedDB and the **device-key-sealed** secret (WebCrypto in SW). **Passphrase-wrapped keys → cannot run in background**; skip + leave for on-open (documented).
- SW fetch to `api.anthropic.com` (+ Turso host if Turso-backed) must be reachable from SW context (verify CSP/SW-scope; the page CSP lives in `src/proxy.ts`).
- Background runs: advisory only, notification only — **no writes**.
- If any precondition fails, the whole layer silently degrades to baseline. Document the support matrix in the section UI ("background runs supported on installed Chrome/Edge only").

## Section 6 — Gating, errors, i18n, release

- **Gating:** `ai.scheduledJobs` added to `AiConfig` (`settings-types.ts`), default treated as OFF (opt-in). Runner + section gate on it + key present. Background layer adds install + permission + device-seal gates.
- **Errors:** all paths surface status/generic inline or as a failed run record; nothing throws into render; key/body never logged.
- **i18n:** new EN + DE keys — section title, master toggle + help, cost note, cadence labels (daily/weekly/time/day), add/delete/enable (row-unique), run-history labels (last run / never run / N actions / failed), notification title/body, background-support note. DE via **node UTF-8 write** (real umlauts; CRLF; Edit corrupts umlauts). `t()` interpolation 0-based `{0}`.
- **Release:** `version.ts` bump (APP_VERSION + new milestone codename) + `CHANGELOG.md` entry + new `versionHighlightScheduledJobs` key appended to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings). Verify the highlight key name is not already taken.

## Testing

- **Pure engine** (`scheduled-jobs/schedule.test.ts`): `nextRunAt` daily/weekly; `isDue` not-yet-due / due-now / overdue-catch-up / already-ran-this-slot (no double-fire) / disabled; day-boundary + weekly day-of-week; `appendRun` caps history + sets lastRunAt immutably.
- **Store/hook** (`use-scheduled-jobs.test.tsx`): create/update/delete; Turso-gated vs localStorage fallback; `scheduled_jobs` is OUT of `TABLE_NAMES` (extend the existing guard test).
- **Runner** (`use-scheduled-job-runner.test.tsx`): due → runs analysis → records run → notifies; not-due → skip; disabled/toggle-off → skip; key absent → skip; failed analysis → records `ok:false`, no throw; dedup; serialized runs.
- **Section** (`scheduled-jobs-section.test.tsx`): toggle gating; cadence editor; row-unique a11y labels; cost note present; history rendering; empty/no-key state.
- **Background layer**: feature-detect guards (absent `periodicSync` → no-op); graceful when uninstalled / permission denied / passphrase-wrapped key. (SW itself is hard to unit-test in jsdom — test the registration-guard logic as a pure function.)

## Out of scope

- Free-form custom-prompt jobs (built-in analysis only).
- Background **writes** (auto-create tasks) — advisory only.
- Push API / any server component.
- Hourly/minute cadences.
- Making background runs reliable on Safari/Firefox/uninstalled (impossible without a backend; baseline covers them on next open).

## Precondition

Implement on a fresh branch off `main` (`ai-orchestration-sp5-scheduled-jobs`). The `refactor/safe-dedup-batch` branch (A2 + B2) is independent and parked; merge order does not matter.
