# AI Orchestration SP5 — Scheduled Claude jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recurring advisory "portfolio analysis" jobs that run on a cadence — universally via due-on-open/catch-up, with an optional Periodic-Background-Sync bonus on installed Chromium. Advisory only; never writes.

**Architecture:** Pure i18n-free `scheduled-jobs/` engine (cadence math, due-detection) → global `scheduled_jobs` store (Turso OUT of `TABLE_NAMES` + localStorage fallback) → a runner hook above the view (reuses SP4 analysis + v0.94 notifications) → a Settings section → optional PWA/SW layer (cuttable).

**Tech Stack:** Forked Next.js 16, React 19, TypeScript strict, vitest, ESLint `--max-warnings=0`. Reuses `action-ai.ts`/`use-action-analysis.ts` (SP4), `action-notifications.ts` (v0.94), global-store pattern (`operating-guide-store.ts`/`use-operating-guides.ts`).

**Spec:** `docs/superpowers/specs/2026-06-19-ai-orchestration-sp5-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/scheduled-jobs/types.ts` (new) | `ScheduledJob`, `JobCadence`, `ScheduledJobRun`, `JOB_HISTORY_CAP` |
| `src/app/scheduled-jobs/schedule.ts` (new) | Pure `nextRunAt`, `isDue`, `dueJobs`, `appendRun` (no `Date.now()`) |
| `src/app/scheduled-jobs/schedule.test.ts` (new) | Engine unit tests |
| `src/app/scheduled-jobs-store.ts` (new) | Persistence: Turso `scheduled_jobs` (OUT of TABLE_NAMES) + localStorage fallback. Mirror `operating-guide-store.ts` |
| `src/app/scheduled-jobs-store.test.ts` (new) | Store tests + TABLE_NAMES guard assertion |
| `src/app/use-scheduled-jobs.ts` (new) | `{ jobs, createJob, updateJob, deleteJob, recordRun }`. Mirror `use-operating-guides.ts` |
| `src/app/use-scheduled-jobs.test.tsx` (new) | Hook tests |
| `src/app/scheduled-job-analysis.ts` (new) | Plain async `runJobAnalysis(context, ai)` — the SP4 fetch as a NON-hook callable (so the runner can loop) |
| `src/app/use-scheduled-job-runner.ts` (new) | Runner above the view: due-check on load/tick/visible → run → record → notify |
| `src/app/use-scheduled-job-runner.test.tsx` (new) | Runner tests |
| `src/app/settings-sections/scheduled-jobs-section.tsx` (new) | Settings UI: toggle + cost note + job CRUD + history |
| `src/app/settings-sections/scheduled-jobs-section.test.tsx` (new) | Section tests |
| `src/app/settings-types.ts` (modify) | `AiConfig.scheduledJobs?: boolean` (default OFF) |
| `src/app/task-manager.tsx` (modify) | Mount runner above view; thread section config |
| `src/app/settings-view.tsx` + `nav-config.ts` (modify) | Register the new section |
| `src/app/i18n.ts` + `i18n.de.ts` (modify) | New keys |
| `src/app/version.ts` + `CHANGELOG.md` (modify) | Release |
| PWA phase (Phase 6, cuttable) | `public/manifest.webmanifest`, SW registration, `scheduled-jobs-bg.ts` guard logic |

---

## Phase 1 — Pure engine

### Task 1: Job types

**Files:** Create `src/app/scheduled-jobs/types.ts`

- [ ] **Step 1: Write the types**

```ts
// scheduled-jobs/types.ts — pure, i18n-free, no React.
export type JobCadence =
  | { kind: "daily"; timeOfDay: string } // "HH:MM" local 24h
  | { kind: "weekly"; dayOfWeek: number; timeOfDay: string }; // 0=Sun..6=Sat

export interface ScheduledJobRun {
  ranAt: string; // ISO
  summary: string;
  actionCount: number;
  ok: boolean;
  error?: string; // status/token only — never key/body
}

export interface ScheduledJob {
  id: number;
  name: string;
  type: "portfolioAnalysis";
  cadence: JobCadence;
  enabled: boolean;
  lastRunAt: string | null;
  history: ScheduledJobRun[]; // newest-first, capped
}

export const JOB_HISTORY_CAP = 10;
```

- [ ] **Step 2: Commit** — `git add src/app/scheduled-jobs/types.ts && git commit -m "feat(sp5): scheduled-job types"`

### Task 2: Cadence + due-detection engine (TDD)

**Files:** Create `src/app/scheduled-jobs/schedule.ts`, `src/app/scheduled-jobs/schedule.test.ts`

- [ ] **Step 1: Write the failing tests** (`schedule.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { nextRunAt, isDue, dueJobs, appendRun } from "./schedule";
import type { ScheduledJob } from "./types";

function daily(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return { id: 1, name: "Daily", type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true, lastRunAt: null, history: [], ...over };
}

describe("isDue (daily, catch-up)", () => {
  it("not due before the slot time", () => {
    const now = new Date("2026-06-19T08:00:00"); // local
    expect(isDue(daily(), now)).toBe(false);
  });
  it("due once after the slot when never run", () => {
    const now = new Date("2026-06-19T09:30:00");
    expect(isDue(daily(), now)).toBe(true);
  });
  it("not due again the same slot once it has run", () => {
    const now = new Date("2026-06-19T10:00:00");
    const job = daily({ lastRunAt: new Date("2026-06-19T09:05:00").toISOString() });
    expect(isDue(job, now)).toBe(false);
  });
  it("due next day even though it ran yesterday (catch-up)", () => {
    const now = new Date("2026-06-20T09:30:00");
    const job = daily({ lastRunAt: new Date("2026-06-19T09:05:00").toISOString() });
    expect(isDue(job, now)).toBe(true);
  });
  it("disabled is never due", () => {
    const now = new Date("2026-06-19T10:00:00");
    expect(isDue(daily({ enabled: false }), now)).toBe(false);
  });
});

describe("isDue (weekly)", () => {
  const weekly = (): ScheduledJob => daily({
    cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "09:00" }, // Monday
  });
  it("not due on the wrong weekday", () => {
    expect(isDue(weekly(), new Date("2026-06-19T10:00:00"))).toBe(false); // Fri
  });
  it("due on the right weekday after the time", () => {
    expect(isDue(weekly(), new Date("2026-06-22T09:30:00"))).toBe(true); // Mon
  });
});

describe("dueJobs", () => {
  it("returns only enabled, due jobs", () => {
    const now = new Date("2026-06-19T09:30:00");
    const a = daily({ id: 1 });
    const b = daily({ id: 2, enabled: false });
    expect(dueJobs([a, b], now).map((j) => j.id)).toEqual([1]);
  });
});

describe("appendRun", () => {
  it("prepends newest, caps history, sets lastRunAt immutably", () => {
    let job = daily();
    for (let i = 0; i < 12; i++) {
      job = appendRun(job, { ranAt: `2026-06-${10 + i}T09:00:00.000Z`, summary: `r${i}`, actionCount: i, ok: true });
    }
    expect(job.history).toHaveLength(10);
    expect(job.history[0].summary).toBe("r11");
    expect(job.lastRunAt).toBe("2026-06-21T09:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `npx vitest run src/app/scheduled-jobs/schedule.test.ts` → FAIL (module missing)

- [ ] **Step 3: Implement `schedule.ts`**

```ts
import { JOB_HISTORY_CAP, type JobCadence, type ScheduledJob, type ScheduledJobRun } from "./types";

function parseHM(timeOfDay: string): { h: number; m: number } {
  const [h, m] = timeOfDay.split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

/** The most recent scheduled slot at or before `now` for this cadence, as a
 *  local-time Date. Returns null if no slot has occurred yet today/this week. */
function currentSlot(cadence: JobCadence, now: Date): Date | null {
  const { h, m } = parseHM(cadence.timeOfDay);
  const slot = new Date(now);
  slot.setHours(h, m, 0, 0);
  if (cadence.kind === "daily") {
    return now >= slot ? slot : null;
  }
  // weekly: slot is the most recent `dayOfWeek` at timeOfDay, at/before now
  if (now.getDay() === cadence.dayOfWeek && now >= slot) return slot;
  return null;
}

/** Next scheduled fire strictly after `from`. */
export function nextRunAt(cadence: JobCadence, from: Date): Date {
  const { h, m } = parseHM(cadence.timeOfDay);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (cadence.kind === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  // weekly
  let delta = (cadence.dayOfWeek - next.getDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  next.setDate(next.getDate() + delta);
  return next;
}

export function isDue(job: ScheduledJob, now: Date): boolean {
  if (!job.enabled) return false;
  const slot = currentSlot(job.cadence, now);
  if (slot === null) return false;
  if (job.lastRunAt === null) return true;
  return new Date(job.lastRunAt) < slot; // not yet run for this slot
}

export function dueJobs(jobs: readonly ScheduledJob[], now: Date): ScheduledJob[] {
  return jobs.filter((j) => isDue(j, now));
}

export function appendRun(job: ScheduledJob, run: ScheduledJobRun): ScheduledJob {
  return {
    ...job,
    lastRunAt: run.ranAt,
    history: [run, ...job.history].slice(0, JOB_HISTORY_CAP),
  };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/app/scheduled-jobs/schedule.test.ts` → PASS
- [ ] **Step 5: Lint + tsc** — `npx eslint --max-warnings=0 src/app/scheduled-jobs/*.ts && npx tsc --noEmit`
- [ ] **Step 6: Commit** — `git commit -am "feat(sp5): pure cadence/due engine + tests"`

---

## Phase 2 — Store + hook

### Task 3: Global store `scheduled-jobs-store.ts`

**Files:** Create `src/app/scheduled-jobs-store.ts`, `src/app/scheduled-jobs-store.test.ts`. **Read first:** `src/app/operating-guide-store.ts` (mirror its Turso-gated + localStorage-fallback shape, schema constant, load/save).

- [ ] **Step 1:** Mirror `operating-guide-store.ts`: a `SCHEDULED_JOBS_TABLE = "scheduled_jobs"` constant; `loadScheduledJobs(...)` / `saveScheduledJobs(...)` that use Turso when `tursoConfig !== null` else `localStorage["lop-app:scheduled-jobs"]`; JSON-serialize `ScheduledJob[]` (history inline). `SqlArg.value` string-only (`String(v)` for ids). Validate/sanitize on load (drop malformed jobs; clamp `history` to `JOB_HISTORY_CAP`; coerce cadence kind).
- [ ] **Step 2: Tests** (`scheduled-jobs-store.test.ts`): round-trip Turso vs localStorage; malformed input dropped; **assert `scheduled_jobs` is NOT in `TABLE_NAMES`** (mirror the guard in `operating-guide-schema.test.ts` / `learning-store-turso.test.ts`).
- [ ] **Step 3:** Lint + tsc + `npx vitest run src/app/scheduled-jobs-store.test.ts`
- [ ] **Step 4: Commit**

### Task 4: Hook `use-scheduled-jobs.ts`

**Files:** Create `use-scheduled-jobs.ts`, `use-scheduled-jobs.test.tsx`. **Read first:** `use-operating-guides.ts`.

- [ ] **Step 1:** Mirror `use-operating-guides.ts`: `useScheduledJobs()` → `{ jobs, createJob, updateJob, deleteJob, recordRun }`. `createJob` assigns `id = max+1`; `recordRun(jobId, run)` applies `appendRun` (from the engine) and persists. Turso-gated load via the store; localStorage fallback. Serialize writes (existing promise-chain pattern) to avoid concurrent Turso saves.
- [ ] **Step 2: Tests:** create/update/delete; `recordRun` caps history + sets lastRunAt; localStorage fallback when no Turso.
- [ ] **Step 3:** Lint + tsc + vitest. **Commit.**

---

## Phase 3 — Runner

### Task 5: Non-hook analysis callable `scheduled-job-analysis.ts`

**Files:** Create `scheduled-job-analysis.ts`. **Read first:** `use-action-analysis.ts` (the SP4 hook) + `action-ai.ts`.

- [ ] **Step 1:** Extract the SP4 Anthropic call into a plain async function (the hook can't be called per-job in a loop):

```ts
import { ANALYZE_TOOL, buildAnalysisSystemPrompt, parseAnalysis, type ActionAnalysis } from "./action-ai";
// Mirror use-action-analysis.ts's fetch exactly: forced tool_choice report_analysis,
// max_tokens ~2048, anthropic-version "2023-06-01", browser-direct header.
// Errors: throw new Error(String(res.status)) on !ok; parse failure → "parse".
// NEVER include the apiKey or response body in a thrown message.
export async function runJobAnalysis(
  context: string,
  ai: { apiKey: string; model: string },
): Promise<ActionAnalysis> { /* ...copied fetch... returns parseAnalysis(toolInput) or throws */ }
```

Then refactor `use-action-analysis.ts` to call `runJobAnalysis` (DRY — single source for the call; this realizes the B1 backlog idea narrowly). Keep the hook's public API unchanged; its tests must still pass.

- [ ] **Step 2: Tests** (`scheduled-job-analysis.test.ts`): success → parsed analysis; HTTP error → throws status only (assert key/body absent); malformed → "parse". Re-run `use-action-analysis.test.tsx` (must stay green).
- [ ] **Step 3:** Lint + tsc + vitest. **Commit.**

### Task 6: Runner hook `use-scheduled-job-runner.ts`

**Files:** Create `use-scheduled-job-runner.ts`, `use-scheduled-job-runner.test.tsx`. **Read first:** SP4 wiring in `task-manager.tsx` (how `buildAnalysisContext` input is built) + `action-notifications.ts`.

- [ ] **Step 1:** Hook signature:

```ts
useScheduledJobRunner({
  enabled: boolean;            // ai.scheduledJobs === true AND key present
  jobs, recordRun,             // from useScheduledJobs
  buildContext: () => string;  // closes over live workspace (SP4 buildAnalysisContext)
  ai: { apiKey; model };
  notify: (title: string, body: string) => void; // reuse action-notifications path
  now?: () => Date;            // injectable for tests; default () => new Date()
});
```

- [ ] **Step 2:** Behavior: on mount, on `visibilitychange→visible`, and on a 5-min interval, compute `dueJobs(jobs, now())` (now captured in the effect/callback — NOT render; respects the purity rule). For each due job, **serially**: `runJobAnalysis(buildContext(), ai)` → `recordRun(job.id, {ranAt, summary, actionCount, ok:true})` → `notify(...)` (dedup via `lop-app:scheduled-notified`). On error: `recordRun(..., {ok:false, error: statusOrToken})`, no throw, no notify-failure-spam. Skip entirely when `!enabled`.
- [ ] **Step 3: Tests:** due → runs → records → notifies (inject `now`, mock `runJobAnalysis`/`fetch`); not-due → no run; disabled job → skip; `enabled:false` → nothing; failed analysis → records `ok:false`, no throw; second tick same slot → no double-run; serialized (no overlapping runs).
- [ ] **Step 4:** Lint + tsc + vitest. **Commit.**

---

## Phase 4 — Settings + gating + i18n

### Task 7: `AiConfig.scheduledJobs` flag

**Files:** Modify `settings-types.ts`. **Read first:** lines around `actionSuggestions` (29–62).

- [ ] **Step 1:** Add `scheduledJobs?: boolean;` to `AiConfig` with a comment: default **OFF** (recurring billed calls). In the sanitizer/loader, parse as `obj.scheduledJobs === true` (opt-in — opposite of `actionSuggestions`'s `!== false`). Default object: omit or `false`.
- [ ] **Step 2:** tsc (i18n parity unaffected) + lint. Update any settings-types test asserting the shape. **Commit.**

### Task 8: Settings section `scheduled-jobs-section.tsx`

**Files:** Create `settings-sections/scheduled-jobs-section.tsx` + test. **Read first:** `settings-sections/ai-section.tsx` (toggle + no-key empty-state pattern from SP3/SP4).

- [ ] **Step 1:** Section: master toggle bound to `ai.scheduledJobs === true`; a one-line **cost note** (i18n) under it. When key absent → "Configure AI assistant" affordance (reuse SP3 `BackendConfigModal` children / `AiSection hideUsage`). Job list: per job — name input, cadence editor (daily/weekly select + `<input type="time">` + weekday select when weekly), enable checkbox, delete. Add-job button. Per-job **history** block: last run summary + timestamp (or "never run"), expandable past runs.
- [ ] **Step 2: a11y:** per-row controls get **job-name-qualified** labels (`aria-label={`${t(lang,"delete")} – ${job.name}`}`) — the single-seeded-row axe trap. Toggle/inputs labelled. Verify by eye + targeted axe run if it lands under a scanned view.
- [ ] **Step 3: Tests:** toggle gating; cadence editor switches daily↔weekly fields; row-unique labels; cost note present; history rendering; no-key empty-state. Use `lang="en-US"`; `loadI18n("de")` in `beforeAll` for any DE assertion.
- [ ] **Step 4:** Lint + tsc + vitest. **Commit.**

### Task 9: i18n keys

**Files:** Modify `i18n.ts` (EN) + `i18n.de.ts` (DE via **node UTF-8 write**, CRLF, real umlauts).

- [ ] **Step 1:** Add keys: `scheduledJobsTitle`, `scheduledJobsToggle`, `scheduledJobsHelp`, `scheduledJobsCostNote`, `scheduledJobsAdd`, `cadenceDaily`, `cadenceWeekly`, `cadenceTime`, `cadenceDay`, `scheduledJobName`, `scheduledJobEnabled`, `scheduledJobLastRun`, `scheduledJobNeverRun`, `scheduledJobActionsN` (`{0}`), `scheduledJobFailed`, `scheduledJobNotifyTitle`, `scheduledJobNotifyBody` (`{0}`,`{1}`), `scheduledJobsBgNote` (background-support note), `versionHighlightScheduledJobs`. Keep EN/DE key sets identical (tsc enforces). Verify `versionHighlightScheduledJobs` not already taken.
- [ ] **Step 2:** `npx tsc --noEmit` (parity) + `i18n-encoding` test (DE umlauts) + lint. **Commit.**

### Task 10: Wire into task-manager + settings nav

**Files:** Modify `task-manager.tsx`, `settings-view.tsx`, `nav-config.ts`. **Read first:** how SP4's analysis hook + the AI section config are threaded.

- [ ] **Step 1:** In `task-manager.tsx`: instantiate `useScheduledJobs()` and `useScheduledJobRunner({ enabled: keyPresent && settings.ai?.scheduledJobs === true, ... , buildContext: () => buildAnalysisContext(...), ai, notify, now })` — **above the view** so it survives remounts; `isPopout ? skip` (popouts never run jobs). Thread the jobs + CRUD into the Settings section (mirror SP3's `config` prop threading task-manager→SettingsView→section).
- [ ] **Step 2:** Register the section in `settings-view.tsx` + `nav-config.ts` settings rail (alphabetical, gated like other AI surfaces).
- [ ] **Step 3:** tsc + lint + targeted vitest (`task-manager` / settings tests). If the section renders under an axe-scanned settings view, run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`. **Commit.**

---

## Phase 5 — Release (baseline ship)

### Task 11: Version + changelog

**Files:** Modify `version.ts`, `CHANGELOG.md`.

- [ ] **Step 1:** Bump `APP_VERSION` (next minor) + new milestone codename (verify unused); append `versionHighlightScheduledJobs` to `APP_HIGHLIGHT_KEYS`; add `CHANGELOG.md` entry.
- [ ] **Step 2:** `npm run build` (prebuild script-docs sync) + `npm run test:run` (full) + `npx tsc --noEmit` + `npm run lint`. **Commit.**

> **Baseline (Phases 1–5) is independently shippable.** Phase 6 is optional and cuttable.

---

## Phase 6 — Optional PWA / background layer (cuttable)

> Only start after baseline is green + merged or on a sub-branch. Research-first: confirm the forked Next.js's static-asset + service-worker registration story BEFORE building (it may differ from stock Next).

### Task 12: PWA foundation (research + manifest)

- [ ] **Step 1: Research** — `node_modules/next/dist/docs/` + repo for SW/manifest handling in the fork; confirm how to serve `manifest.webmanifest` + register a SW (scope, `public/`). Document findings before coding.
- [ ] **Step 2:** Add `public/manifest.webmanifest` (name, `icc_logo_192.png` icon, `display: standalone`, AIPM palette theme/bg) + link it; verify installability. No behavior change for non-installers.
- [ ] **Step 3:** Confirm CSP allows the SW + its fetch to `api.anthropic.com` (page CSP in `src/proxy.ts`; SW-context CSP separate — verify at runtime). **Commit.**

### Task 13: SW + Periodic Background Sync (guarded, advisory-only)

- [ ] **Step 1:** `scheduled-jobs-bg.ts` — a PURE guard function `canRegisterBgSync(reg, perm, installed): boolean` (feature-detect `"periodicSync" in reg`, permission granted, installed) + tests. Register only when true; else no-op (baseline covers it).
- [ ] **Step 2:** SW `periodicsync` handler runs the SAME `dueJobs` check, reading jobs + workspace from IndexedDB and the **device-key-sealed** secret via WebCrypto; **passphrase-wrapped key → skip** (leave for on-open). Advisory only — notification, **no writes**.
- [ ] **Step 3:** Section UI note (`scheduledJobsBgNote`): "Background runs supported on installed Chrome/Edge only." Document the support matrix.
- [ ] **Step 4:** Tests for the guard logic (SW itself not unit-testable in jsdom). Lint + tsc + full vitest + build. **Commit.**

---

## Self-Review (run before handing off)

1. **Spec coverage:** Phases 1–6 map to spec Sections 1–6. Engine (1), store+hook (2), runner+analysis (3), settings+gating+i18n (4), release (5), PWA (6). ✓
2. **Type consistency:** `ScheduledJob`/`JobCadence`/`ScheduledJobRun` used identically across engine, store, hook, runner. `recordRun(jobId, run)` signature consistent (Task 4 + 6). `runJobAnalysis(context, ai)` consistent (Task 5 + 6). ✓
3. **Landmine coverage:** `scheduled_jobs` OUT of `TABLE_NAMES` (Task 3 guard); `scheduledJobs` opt-in `=== true` not `!== false` (Task 7); `now` injected/captured-in-effect, no `Date.now()` in render (Tasks 2, 6); DE node-UTF8 write (Task 9); row-unique a11y labels (Task 8); popouts skip runner (Task 10); apiKey never in thrown/logged messages (Task 5). ✓
4. **No placeholders:** engine code complete; glue tasks reference exact files to mirror + concrete signatures/behavior. ✓
