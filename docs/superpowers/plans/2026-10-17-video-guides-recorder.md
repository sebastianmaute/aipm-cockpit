# Video guides recorder (§715 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-video Acme recorder with a recorder that takes each of the 43 video guides with its own command, on the demo project, on the throwaway Turso database.

**Architecture:**
- **Data, not code paths.** Every video is an entry in `videos.mjs`. A small take runner (`take.mjs`) runs one entry. Setup happens off camera in the same browser page: connect Turso and the key, Explore the demo, seed device state, replay earlier days. Recording then starts with `page.screencast.start`.
- **Pure parts are unit-tested in vitest:** argument parsing, selection, output paths, exit codes, the definitions' structure, the cleanup statements, the seeded device state, and the replay facts against E's `applyDemoWeek`.
- **Live parts are proven by `--rehearse` runs** against a dev server and the throwaway database.

**Tech Stack:** Node ESM (`.mjs`), Playwright 1.64 (`chromium`, `page.clock`, `page.screencast`), vitest, the app's own TS engines for the pinned fixtures.

**Spec:**
- `docs/superpowers/specs/2026-10-16-video-guides-recorder-design.md` (A). It is authoritative for the clips, the constraints and the decisions.
- `docs/superpowers/specs/2026-10-16-demo-week-story-design.md` (the week). It replaces A's big video, chapters and `T0`, and adds "What changes in A".

## Global Constraints

**Videos, output and exit codes**
- 43 videos: 1 big + 7 chapters + 15 AI clips + 20 feature clips.
  - `ch1-install` is a hand-recorded placeholder: listed by `--list` and skipped, so `--all` records 42.
- Commands:
  - `node scripts/demo-video/record.mjs --video <id> | --tier <big|chapters|ai|features> | --all | --list`
  - flags `--rehearse` (no recording) and `--with-ai` (rehearse also makes the AI calls). `--probe` stays.
- Output: `<OUT>/<tier>/<NN>-<id>.webm`, where `NN` is the 1-based position in its tier, zero-padded to 2. `OUT` = `DEMO_VIDEO_DIR` or `.superpowers/tmp/demo-video`.
- Exit codes: `--all` and `--tier` record every video whose preconditions pass and list the ones skipped. Any skip, failure or warning makes the exit code 1.

**Browser and clock**
- Playwright headless Chromium, 1280×720, `locale: en-US`, `timezoneId: Europe/Berlin`. The clock is installed with `page.clock.install`.
- `T0` = Monday `2026-09-21T08:30:00+02:00`.
  - Each later day of the week is 08:30 +02:00 on its date (Tue 22 … Fri 25 September 2026), set with `page.clock.setSystemTime` and a reload.
  - Clips run at `T0`.

**Every take**
- It starts clean: delete earlier demo projects and the recorder's global rows from the throwaway database, use a fresh browser context, connect Turso and the Anthropic key through the app's own setup wizard (off camera except in `ch2-connect` and `big`), then Explore the demo.
- Clip shape: the opening text in the existing caption bar with the app visible → the steps live → a closing beat that holds the last frame about 2 s with the clip title in the caption bar. No full-screen cards.

**AI steps**
- Wait on UI state, never on text. Check structure, not wording.
- If the structure is empty, retry once, then fail the take with the clip id.
- `--rehearse` skips the AI calls unless `--with-ai` is given.

**Chapters 3–7**
- Off camera, replay the manual steps of the earlier days, fast, with no AI calls.
- An AI step's replay applies a FIXED outcome, written beside the step.
- The page clock follows the replay day by day.

**Device state**
- Right after the demo is created, before a Dashboard visit counts, write `aipm-cockpit:landing-state` for the new project id: `lastVisitAt` Friday 2026-09-18 plus Friday's RAG and metrics.
- Write `aipm-cockpit:digest-state` with a `nextDueAt` after Friday 25 September, and switch the digest on in Settings (off camera).
- Monday's and Friday's takes press **Generate now** themselves.

**Security and data**
- Only `TURSO_THROWAWAY_*` and `ANTHROPIC_API_KEY` are read from `.env.local`, masked in every output line.
- No secret may appear in a frame, a log line or a probe screenshot. The libsql host is blurred on screen.
- `guardTurso` aborts any other Turso host and counts it as a warning.
- Never run beside `e2e:live-*` on the same database.
- Fictional names only (repo is public). `@example.com` emails.

**Repo rules for every commit**
- `git commit --only <paths>`.
- Cite `§715` in the subject.
- No `Claude-Session` trailer and no URLs in any commit.
- No `--amend`, no `sed -i` on repo files.
- `scripts/**` and `src/**` are CRLF in the working tree; `docs/**/*.md` and `scripts/demo-video/README.md` are LF.

**Vitest**
- Only targeted files, under the lock:
  `until mkdir /c/Projects/.vitest-lock 2>/dev/null; do sleep 20; done; npx vitest run <files> --maxWorkers=2 > <log> 2>&1; echo EXIT=$?; rm -rf /c/Projects/.vitest-lock`
- Never read an exit code through a pipe.

**Before a push**
- `npx eslint --max-warnings=0 <changed files>`
- `npx tsc --noEmit` → 0 errors
- `node scripts/gate-local.mjs --group static --keep-going --allow-dirty`

**Live runs**
- Need the dev server of `scripts/demo-video/README.md` "What it needs" (port 3300, deployment defaults blanked).
- The throwaway database must hold no other projects.

## Review Focus

1. **A secret reaching a recorded frame or a log line on a path the masks miss.** Examples: a toast quoting the URL, a Playwright error message echoing a `fill()` argument, an AI response that repeats the key. Expected: no raw secret appears anywhere. Pinned in Task 5: the runner scans its own collected output for the raw values after every take and counts a hit as a warning; the scan is unit-tested.
2. **A take that passes only because an earlier take left state behind.** Examples: a scheduled job, a learning history, versions, landing or digest state. Expected: any single `--video` run works on a fresh database. Pinned in Task 2: cleanup deletes the global `scheduled_jobs` and `action_learning` rows; device state dies with each fresh context.
3. **The replayed week drifting from the data E pinned.** For example, a replay that approves only one change, or sets the MVP target to a different date. Expected: chapter N opens on the same state the big take reaches. Pinned in Task 1 by `DAY_FACTS` against `applyDemoWeek`; in Task 6, `--rehearse` checks those facts against the live database after each replayed day.
4. **The landing seed written after the Dashboard has already saved its own Monday record.** In that case the strip shows nothing, silently. Expected: Monday's strip shows the change since Friday. Pinned in Task 5: the seed is written after the app's first save, followed by a reload, and the rehearsal asserts the strip is visible.
5. **An AI step whose busy state never ends.** Examples: network stall, a consent dialog. Expected: the take fails with the clip id inside the per-call upper bound, not after the 30-minute Playwright default. Pinned in Task 5 by `waitForAi`'s timeout path in `take.test.mjs`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/demo-video/week-story.mjs` (new) | The story's names and dates, shared by the recorder and E's tests. Also `DAY_FACTS`: what the database must say after each day. |
| `src/test/demo-week.ts` (modify) | Imports its exported constants from `week-story.mjs` instead of defining them. |
| `scripts/demo-video/lib.mjs` (modify) | `T0`, `atDay`, env reading, Turso guard, `settle`, `openView` (kept), `query`/`pipeline` (moved here from cleanup). |
| `scripts/demo-video/cleanup.mjs` (modify) | Exports `cleanup()` and the pure `cleanupStatements(ids, tables)`; still runnable as a CLI. |
| `scripts/demo-video/fixtures/device-state.json` (new) | Friday's landing state and the digest seed. |
| `scripts/demo-video/cli.mjs` (new) | Pure: `parseArgs`, `selectVideos`, `outPath`, `exitCode`, `findSecrets`. |
| `scripts/demo-video/ui.mjs` (new) | Overlay, `caption`, `moveTo`, `click`, `type`, `nav`, `skipTour`, `closingBeat`: lifted from today's `record.mjs`. |
| `scripts/demo-video/setup.mjs` (new) | Off-camera setup: `connect`, `exploreDemo`, `seedDeviceState`, `enableDigest`, `currentProjectId`. |
| `scripts/demo-video/take.mjs` (new) | `runTake(def, opts)` and `waitForAi`. |
| `scripts/demo-video/steps/week.mjs` (new) | Prologue and Monday–Friday steps, each with a `replay`. |
| `scripts/demo-video/steps/ai.mjs`, `steps/features.mjs` (new) | Clip steps and preconditions. |
| `scripts/demo-video/videos.mjs` (new) | The 43 definitions. |
| `scripts/demo-video/record.mjs` (rewrite) | Entry: args → list, or run each selected take with cleanup between. |
| `scripts/demo-video/README.md` (rewrite) | How to take, rehearse, list; what each file does. |

Tests:
- `scripts/demo-video/week-story.test.ts`
- `scripts/demo-video/cleanup.test.mjs`
- `scripts/demo-video/device-state.test.ts`
- `scripts/demo-video/cli.test.mjs`
- `scripts/demo-video/videos.test.mjs`
- `scripts/demo-video/take.test.mjs`

---

### Task 1: Shared story constants and the replay facts

**Files:**
- Create: `scripts/demo-video/week-story.mjs`, `scripts/demo-video/week-story.test.ts`
- Modify: `src/test/demo-week.ts` (the `export const DEMO_*` and `DEMO_WEEK_DATES` lines)

**Interfaces:**
- Produces (all from `week-story.mjs`):
  - `DEMO_WEEK_DATES`
  - `DEMO_DUPLICATE_PAIRS`
  - `DEMO_CRM_TASK`
  - `DEMO_GDPR_ISSUE`
  - `DEMO_NEW_MEMBER`
  - `DEMO_DPO`
  - `DEMO_LICENCE_RISK`
  - `DEMO_MAYA_RELIEVED_HOURS`
  - `DAY_FACTS: Record<'mon'|'tue'|'wed'|'thu'|'fri', Fact[]>`, where
    `Fact = { collection: 'tasks'|'milestones'|'raid'|'changes'|'stakeholders'|'resources'|'budgets', key: string, value: string, field: string, expected: string | number | null }`
- `src/test/demo-week.ts` re-exports the same names, so every existing import keeps working.

- [ ] **Step 1: Write the failing test** `scripts/demo-video/week-story.test.ts`:
  - `"E's fixture and the recorder share one set of names"`: `import * as story from "./week-story.mjs"` and `import * as week from "../../src/test/demo-week"`. For each of the eight names above, `expect(week[name]).toBe(story[name])`. This is identity, not equality, so a copy fails.
  - `"every replay fact holds in applyDemoWeek on its day"`: read `sample-workspace-small.json`. For each day `d` and each fact `f` in `DAY_FACTS[d]`, take `applyDemoWeek(master, d)`, find the row in `f.collection` whose `f.key` equals `f.value`, and assert `row[f.field] ?? null` equals `f.expected`.
  - `"each day carries at least one fact"`: every day has `DAY_FACTS[d].length > 0`.

- [ ] **Step 2: Run it, expect FAIL.** It fails on the missing module `./week-story.mjs`.
  `npx vitest run scripts/demo-video/week-story.test.ts --maxWorkers=2` (under the lock).

- [ ] **Step 3: Implement `week-story.mjs`.** Move the eight constants verbatim from `src/test/demo-week.ts` and freeze the objects.

  `DAY_FACTS` is the state the replay must reach, chosen from `applyDemoWeek`'s own steps. It holds at least these 13 facts:

  | Day | Collection | Row | Field | Expected |
  |---|---|---|---|---|
  | mon | tasks | `taskName` = CRM task | `blockers` | `"CRM API rejects erasure calls"` |
  | mon | tasks | `taskName` = CRM task | `dueDate` | `"2026-09-24"` |
  | tue | tasks | `taskName` = CRM task | `status` | `"In Progress"` |
  | tue | milestones | `name` = "MVP re-demo" | `date` | `"2026-10-02"` |
  | tue | tasks | `taskName` = "MVP demo to the customer" | `dueDate` | `"2026-10-02"` |
  | wed | resources | `lastName` = "Brandt" | `firstName` | `"Lukas"` |
  | wed | tasks | `taskName` = pair 1's second task | `assignee` | `"Lukas Brandt"` |
  | thu | raid | `title` = GDPR issue | `owner` | `"Noah Bennett"` |
  | thu | changes | `title` = "Add a CRM provisioning connector" | `status` | `"Approved"` |
  | thu | changes | `title` = "Add MFA to SSO scope" | `status` | `"Approved"` |
  | thu | milestones | `name` = "MVP target" | `date` | `"2026-10-01"` |
  | fri | tasks | `taskName` = CRM task | `status` | `"Done"` |
  | fri | raid | `title` = GDPR issue | `status` | `"Resolved"` |

  `src/test/demo-week.ts` then reads: `export { DEMO_WEEK_DATES, … } from "../../scripts/demo-video/week-story.mjs";` and imports the names it uses internally.

- [ ] **Step 4: Run the new test and E's tests, expect PASS.**
  `npx vitest run scripts/demo-video/week-story.test.ts src/test/demo-week.test.ts src/app/demo-week-signals.test.ts src/app/demo-week-master.test.ts --maxWorkers=2`.
  Then `npx tsc --noEmit` → 0 errors. The `.mjs` import must type-check under `allowJs`.

- [ ] **Step 5: Commit.**
  `git commit --only scripts/demo-video/week-story.mjs scripts/demo-video/week-story.test.ts src/test/demo-week.ts -m "feat: share the demo week's names between E's tests and the recorder (§715)"`

### Task 2: Clock, database helper and a cleanup that leaves nothing behind

**Files:**
- Modify: `scripts/demo-video/lib.mjs`, `scripts/demo-video/cleanup.mjs`
- Create: `scripts/demo-video/cleanup.test.mjs`

**Interfaces:**
- Produces from `lib.mjs`:
  - `T0: Date`
  - `atDay(day: 'mon'|'tue'|'wed'|'thu'|'fri'): Date`
  - `pipeline(stmts)`
  - `query(sql, args?)`, which throws on an error result
  - kept: `readEnv`, `throwaway`, `guardTurso`, `settle`, `openView`, `navItems`, `day`
- Produces from `cleanup.mjs`:
  - `cleanupStatements(ids: string[], tables: string[]): {sql: string, args?: object[]}[][]`, which returns the ordered batches
  - `async cleanup(): Promise<{ projects: number, mine: number }>`

- [ ] **Step 1: Write the failing test** `cleanup.test.mjs`:
  - `"child rows first, then the project rows"`: `cleanupStatements(['a','b'], ['tasks','snapshot'])`. Batch 0 deletes from both child tables with `project_id IN (?,?)` and args `a`, `b`; the last batch deletes from `projects`.
  - `"clears the recorder's global stores"`: some batch holds `DELETE FROM "scheduled_jobs"` and `DELETE FROM "action_learning"` with no `WHERE`. These are global tables; the throwaway database belongs to the recorder.
  - `"no ids, no project deletes"`: `cleanupStatements([], ['tasks'])` holds only the two global deletes.
  - `"atDay is 08:30 in Berlin"`: `atDay('mon').toISOString()` is `'2026-09-21T06:30:00.000Z'` and `atDay('fri')` is `'2026-09-25T06:30:00.000Z'`. `T0.getTime() === atDay('mon').getTime()`.

- [ ] **Step 2: Run it, expect FAIL.** `cleanupStatements` and `atDay` are not exported.

- [ ] **Step 3: Implement.**
  - **`lib.mjs`:**
    - `T0 = new Date('2026-09-21T08:30:00+02:00')`, with a comment: September is Berlin summer time (+02:00).
    - `atDay` builds from `DEMO_WEEK_DATES` (imported from `week-story.mjs`) plus `T08:30:00+02:00`.
    - Move `pipeline`/`query` here from `cleanup.mjs`, unchanged. The throwaway host and token are read once, lazily.
  - **`cleanup.mjs`:**
    - Keep the `MINE` name match on the demo's name only. The Acme flow is gone; `Acme Website Relaunch` stays matched so old leftovers are still removed.
    - A missing global table (`no such table`) is not an error.
    - Keep the CLI entry: run `cleanup()` when the file is the main module (`import.meta.url === pathToFileURL(process.argv[1]).href`), printing counts only.

- [ ] **Step 4: Run, expect PASS.** Then run once live: `node scripts/demo-video/cleanup.mjs` → prints `projects N mine M others K` and exits 0.

- [ ] **Step 5: Commit.**
  `git commit --only scripts/demo-video/lib.mjs scripts/demo-video/cleanup.mjs scripts/demo-video/cleanup.test.mjs -m "feat: the recorder's week clock and a cleanup that clears its global rows (§715)"`

### Task 3: Friday's device state as a pinned fixture

**Files:**
- Create: `scripts/demo-video/fixtures/device-state.json`, `scripts/demo-video/device-state.test.ts`

**Interfaces:**
- Produces: `device-state.json` with this shape:
  ```
  { "landing": { "lastVisitAt", "rag": {overall,schedule,budget,scope}, "metrics": {complete,overdue,openRaid} },
    "digest":  { "lastRunAt", "nextDueAt", "priorRag", "priorMetrics": {overdue,openRaid} } }
  ```
  The take runner (Task 5) writes `landing` under the new project id in `aipm-cockpit:landing-state`, and `digest` under it in `aipm-cockpit:digest-state`.

- [ ] **Step 1: Write the failing test** `device-state.test.ts`. Compute Friday's model the way the Dashboard does, through the app's own functions:
  - the workspace: `buildDemoWorkspace(master, "2026-09-18")`;
  - the model: `computeDashboard(buildLiveDashboardInput(entities, ctx, { active: false, snapshots: [] }))`, built as in `src/test/demo-next-actions.ts`.

  Tests:
  - `"the landing seed is Friday's dashboard"`:
    - `landing.lastVisitAt === "2026-09-18T15:00:00.000Z"`;
    - `landing.rag` equals the model's four `.effective` values;
    - `landing.metrics` equals `{ complete: model.progress.percent, overdue: model.overdue.length, openRaid: model.openRaidCount }`.
  - `"the digest seed was run on Friday and is not due before the week ends"`:
    - `digest.priorRag === landing.rag.overall`;
    - `digest.priorMetrics` equals `{ overdue, openRaid }` from the landing metrics;
    - `Date.parse(digest.nextDueAt) > Date.parse("2026-09-25T23:59:59+02:00")`.
  - `"the app accepts both seeds"`, in jsdom:
    - `localStorage.setItem("aipm-cockpit:landing-state", JSON.stringify({ p1: landing }))` → `loadLandingState("p1")` deep-equals `landing`;
    - `localStorage.setItem(DIGEST_STATE_KEY, JSON.stringify({ p1: digest }))` → `loadDigestState("p1")` deep-equals `digest`.
  - `"Monday's strip has something to show"`: `computeDelta({ prior: landing, activity: [], currentRag: <Monday's model RAG>, overdue: <Monday's model.overdue>, today: "2026-09-21" })` reports at least one newly overdue task or one RAG flip. Monday's model is built the same way at `"2026-09-21"`. Write the exact expected strip in the test's comment; the week spec asks the builder to state it.

- [ ] **Step 2: Run, expect FAIL** (fixture missing).

- [ ] **Step 3: Generate the fixture.**
  - Write the values the test computes into `device-state.json`, 2-space JSON, CRLF.
  - `lastRunAt` = `"2026-09-18T15:00:00.000Z"`.
  - `nextDueAt` = `"2026-09-28T06:00:00.000Z"`: after Friday 25th, so the digest never generates by itself during the week.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit.**
  `git commit --only scripts/demo-video/fixtures/device-state.json scripts/demo-video/device-state.test.ts -m "feat: Friday's landing and digest state for the demo week takes (§715)"`

### Task 4: Command line, selection and the 43 definitions

**Files:**
- Create: `scripts/demo-video/cli.mjs`, `scripts/demo-video/cli.test.mjs`, `scripts/demo-video/videos.mjs`, `scripts/demo-video/videos.test.mjs`, `scripts/demo-video/steps/week.mjs`, `scripts/demo-video/steps/ai.mjs`, `scripts/demo-video/steps/features.mjs`

**Interfaces:**
- **`cli.mjs` produces:**
  - `parseArgs(argv: string[]) → { list: boolean, video?: string, tier?: Tier, all: boolean, rehearse: boolean, withAi: boolean, probe: boolean }`. It throws `Error('choose one of --video, --tier, --all, --list')` unless exactly one is given, and `Error('unknown tier <x>')` for a bad tier.
  - `selectVideos(defs, args) → Def[]`. It throws `Error('unknown video <id>')`.
  - `outPath(out: string, def: Def, defs: Def[]) → string`.
  - `exitCode({ warnings, skipped, failed }) → 0|1`.
  - `findSecrets(text: string, secrets: string[]) → number`: occurrences of any non-empty secret.
- **`videos.mjs` produces** `TIERS = ['big','chapters','ai','features']` and `VIDEOS: Def[]`, where:
  ```
  Def = { id, tier, title, opening, handRecorded?: true, clock?: 'mon'|'tue'|'wed'|'thu'|'fri', replayThrough?: Day,
          prologueOnCamera?: true, preconditions: Precondition[], steps: Step[] }
  Step = { id, caption?, ai?: true, setup?: true, trigger?: (ctx) => Locator, run: (ctx) => Promise<void>,
           replay?: (ctx) => Promise<void>, check?: (ctx) => Promise<string|null> }
  Precondition = { what: string, check: (ctx) => Promise<boolean> }
  ```
- **Steps:** `steps/*.mjs` export the step and precondition objects. In this task each `run` is a stub that throws `Error('step <id> not written yet')`. Tasks 6–9 replace the stubs.

- [ ] **Step 1: Write the failing tests.**
  `cli.test.mjs`:
  - `"--video picks one"`: `selectVideos(VIDEOS, parseArgs(['--video','f-gantt']))` maps to `['f-gantt']`.
  - `"--all skips the hand-recorded chapter"`: `--all` selects 42 videos and none is `ch1-install`.
  - `"--tier ai is the 15 AI clips in order"`: the ids equal the spec's tier-3 table order.
  - `"exactly one selector"`: `parseArgs(['--all','--video','x'])` and `parseArgs([])` throw.
  - `"output path numbers within the tier"`: `outPath('/o', f-open-points)` ends with `features/01-f-open-points.webm`; `ch3-monday` is `chapters/03-ch3-monday.webm` (`ch1-install` is 01, so the placeholder keeps its number).
  - `"exit code"`: `exitCode({warnings:0,skipped:0,failed:0})` → 0; any of the three at 1 → 1.
  - `"findSecrets"`: `findSecrets('a TOKEN b', ['TOKEN', ''])` → 1; an empty secret never matches.

  `videos.test.mjs`:
  - `"43 videos, ids unique, tiers 1/7/15/20"`.
  - `"ids are the spec's"`:
    - big: `big`;
    - chapters: `ch1-install, ch2-connect, ch3-monday, ch4-tuesday, ch5-wednesday, ch6-thursday, ch7-friday`;
    - ai: the 15 ids of A's tier-3 table;
    - features: the 20 ids of A's tier-4 table, in table order.
  - `"every video but ch1-install has an opening text, a title and at least one step"`.
  - `"every AI step in a chapter has a replay"`: for each `chN` and `big`, every step with `ai: true` has a `replay` function.
  - `"only ch2-connect and big show the prologue on camera"`: exactly those two have `prologueOnCamera: true`.
  - `"chapters replay the days before them"`: `ch3-monday` has no `replayThrough`; `ch4-tuesday`…`ch7-friday` have `replayThrough` `'mon'`…`'thu'` and `clock` `'tue'`…`'fri'`.
  - `"f-gantt follows the owner's script"`: its step ids, in order, are `dedup, drag-bar-move, drag-bar-end, drag-bar-start, drag-milestone, filter-completed, view-dependencies, view-absences, view-critical-path, view-milestones, view-inline-milestones`.
  - `"opening texts are the spec's"`: `f-gantt` opening equals A's fixed text, and `ai-dedup` equals A's draft. For the `(banner)` features, `opening` is read at take time from the view's hint text, so the definition holds `opening: { banner: '<view>' }`; check that shape for `f-open-points`.

- [ ] **Step 2: Run both, expect FAIL** (modules missing).

- [ ] **Step 3: Implement** `cli.mjs` (pure, no Playwright import) and `videos.mjs` with all 43 entries.
  - Titles and opening texts come verbatim from the two spec tables.
  - Chapter titles: "Monday — a milestone slipped", "Tuesday — re-plan", "Wednesday — people", "Thursday — risks, stakeholders, money", "Friday — close the week".
  - `big` composes the prologue and the five days' steps (the same step objects, not copies), with `clock` changes between days.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit.**
  `git commit --only scripts/demo-video/cli.mjs scripts/demo-video/cli.test.mjs scripts/demo-video/videos.mjs scripts/demo-video/videos.test.mjs scripts/demo-video/steps -m "feat: the recorder's command line and its 43 video definitions (§715)"`

### Task 5: The take runner, off-camera setup and the new entry point

**Files:**
- Create: `scripts/demo-video/ui.mjs`, `scripts/demo-video/setup.mjs`, `scripts/demo-video/take.mjs`, `scripts/demo-video/take.test.mjs`
- Rewrite: `scripts/demo-video/record.mjs`
- Modify: `scripts/demo-video/steps/features.mjs` (only `f-open-points`, the pilot clip)

**Interfaces:**
- **`ui.mjs`:** today's `OVERLAY`, `caption`, `moveTo`, `click`, `type`, `nav` and `skipTour`, taking a `ctx` (`{ page, rehearse, mask, log }`) instead of module globals. Plus `closingBeat(ctx, title)`: the caption shows `title` and holds 2000 ms; 150 ms in rehearse.
- **`setup.mjs`:**
  - `connect(ctx, { onCamera })`: today's wizard steps 2.2 and 2.4.
  - `exploreDemo(ctx)`: clicks **Explore the demo**, then `skipTour`. It fails if `getByText('changed in another tab')` is present (the §740 regression check).
  - `currentProjectId(ctx)`: reads `localStorage['aipm-cockpit:turso-current-project']`.
  - `seedDeviceState(ctx, id)`.
  - `enableDigest(ctx)`: the Settings checkbox bound to `settings.digest.enabled`, in `integrations-section.tsx`.
  - `goToDay(ctx, day)`: `setSystemTime(atDay(day))`, reload, settle.
- **`take.mjs`:**
  - `runTake(def, opts) → { status: 'ok'|'skipped'|'failed', warnings: number, file?: string, missing?: string[] }`
  - `waitForAi(ctx, { busy: Locator, done: Locator, timeoutMs = 120000, label })`, which throws `Error('<clip id>: AI step <label> timed out')`.
  - `withAiRetry(ctx, step)`: runs `step.run`, then `step.check`; on a non-null result, one more `run`; on a second non-null result, it throws.
- **`record.mjs`:** `parseArgs` → `--list` prints `tier  NN  id  title`. Otherwise, for each selected video: `await cleanup()`, then `runTake`. At the end it prints `RESULT ok N skipped N failed N WARNINGS N` and the skipped ids with their missing preconditions, and sets `process.exitCode = exitCode(...)`.

- [ ] **Step 1: Spike `page.screencast`.** It records mid-session in this repo's Playwright.
  - In a scratch script: launch chromium, `goto('about:blank')`, `waitForTimeout(1000)`, `screencast.start({ path, size: {width:1280,height:720} })`, set `document.body.style.background='red'` for 2 s, `stop()`.
  - Expected: the file exists and is above 10 kB, and `ffprobe -v error -show_entries format=duration` reports 1.5–3 s, so the second before `start` is not in it.
  - If it fails, stop and report: the off-camera design rests on it.

- [ ] **Step 2: Write the failing tests** `take.test.mjs`, with `runTake`'s collaborators injected (a fake `ctx` and fake setup functions; no browser):
  - `"order: cleanup is the caller's; setup, preconditions, then recording"`: the recorded call order is
    1. `connect`
    2. `exploreDemo`
    3. `seedDeviceState`
    4. `enableDigest`
    5. the preconditions
    6. `screencast.start`
    7. the `caption` with the opening text
    8. the steps
    9. `closingBeat`
    10. `screencast.stop`
  - `"a failed precondition skips the take before recording"`: `status: 'skipped'`, `missing: ['<what>']`, and `screencast.start` is never called.
  - `"rehearse never starts the screencast"`.
  - `"the prologue is on camera for ch2-connect and big"`: with `prologueOnCamera: true`, the recorded call order is
    1. `screencast.start`
    2. `connect` with `{ onCamera: true }`
    3. `exploreDemo`
    4. `seedDeviceState`
    5. `enableDigest`
    6. the remaining steps

    For every other video, `connect` gets `{ onCamera: false }` and comes before `screencast.start`.
  - `"rehearse without --with-ai runs no AI step and checks its trigger is enabled instead"`: an `ai: true` step's `run` is not called; its `trigger` locator's `isEnabled` is.
  - `"chapters replay before recording"`: for `replayThrough: 'tue'`, the calls `goToDay('mon')`, each Monday step's `replay ?? run`, `goToDay('tue')`, each Tuesday step's `replay ?? run`, and `goToDay(def.clock)` all happen before `screencast.start`.
  - `"a secret in the take's log is a warning"`: when a fake step logs the raw token, `runTake` returns `warnings >= 1`. Uses `findSecrets` over the collected log.
  - `"waitForAi times out with the clip id"`: with a `busy` locator that never hides and `timeoutMs: 50`, it rejects with a message containing the clip id.
  - `"an empty AI result is retried once, then fails"`: `check` returns `'no pairs'` twice → the step's `run` is called 2 times and the take is `failed`.

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement** `ui.mjs`, `setup.mjs`, `take.mjs`, and the new `record.mjs`. Delete the Acme flow. Write the pilot clip `f-open-points` (add a task · sort · filter by assignee · set a status), with selectors found on the live demo; `--probe` prints the nav items after the demo opens.
  - **Device state:** after `exploreDemo`, wait until `aipm-cockpit:landing-state` holds the new id (the Dashboard's own first save, about 4 s after mount, `ADVANCE_DELAY_MS`). Then overwrite it with the fixture's `landing`, write `digest`, enable the digest and reload. Rehearsal asserts the delta strip is visible on Monday's Dashboard.
  - **Logging:** every console line goes through `mask`; the take collects its own lines for `findSecrets`.

- [ ] **Step 5: Run the tests, expect PASS.** Then live (dev server and throwaway database as in the README):
  - `node scripts/demo-video/record.mjs --list` → 43 lines.
  - `node scripts/demo-video/record.mjs --video f-open-points --rehearse` → `RESULT ok 1 … WARNINGS 0`, exit 0.
  - `node scripts/demo-video/record.mjs --video f-open-points` → `features/01-f-open-points.webm` exists. Its first frame shows the demo with the opening caption, not the wizard: check it by extracting frame 1 with `ffmpeg -i <file> -frames:v 1 first.png` and reading it.

- [ ] **Step 6: Commit.**
  `git commit --only scripts/demo-video/ui.mjs scripts/demo-video/setup.mjs scripts/demo-video/take.mjs scripts/demo-video/take.test.mjs scripts/demo-video/record.mjs scripts/demo-video/steps/features.mjs -m "feat: one take per video, set up off camera and recorded from the first step (§715)"`

### Task 6: Prologue, Monday and Tuesday (`ch2-connect`, `ch3-monday`, `ch4-tuesday`)

**Files:**
- Modify: `scripts/demo-video/steps/week.mjs`, `scripts/demo-video/videos.mjs` (preconditions only)

**Interfaces:**
- Consumes: `ui.mjs`, `setup.mjs` (Task 5), `DAY_FACTS` (Task 1).
- Produces: `PROLOGUE`, `MONDAY`, `TUESDAY`: arrays of `Step`.
  - Each AI step has `ai: true`, a `check` (structure), and a `replay` that applies the fixed outcome by hand through the UI.
  - Exported `checkDayFacts(ctx, day)` → a list of mismatches, read from the throwaway database (`query`) for the current project id. Rehearsal runs it after each replayed or recorded day; a mismatch is a warning.

- [ ] **Step 1: Write the rows of "The week" as steps**, in the spec's order, against the live demo (selectors by discovery; `--probe` helps).
  - **Prologue:** connect on camera, then the wizard to its last step with AI proposal → cancel → Explore the demo.
  - **Monday:**
    - Dashboard hero and delta strip, then **Generate now**.
    - Next actions, then **Analyze with AI**.
    - Table: open the CRM task, add the blocker `"CRM API rejects erasure calls"`, due Thursday 2026-09-24.
    - Knowledge: search "CRM".
    - Next actions: Draft message on "Update stakeholder: Elena Fischer", then the AI Assistant "Stakeholder update" starter.
  - **Tuesday:**
    - Board: drag the CRM task to In Progress.
    - Delete pair 1's first task by hand, then **Deduplicate & unify**.
    - New change "Add a CRM provisioning connector" + **Ask Claude** on impact.
    - Maya's Draft message + the AI update.
    - Milestone "MVP re-demo" 2026-10-02, linked to task 25; task 25 due 2026-10-02; **Ask Claude** on the description.
    - Budget bucket "Identity Platform – T&M", then **Import forecast…** with `fixtures/replan-forecast.csv` and **Ask Claude**.

  Fixed replay outcomes:
  - **Dedup:** delete the second task of pairs 2 and 3, which is what `applyDemoWeek` does.
  - **Impact:** `"Licence cost and about one week of integration work; removes the failing custom sync."`
  - **Re-demo description:** `"The MVP demo to the customer, re-run once provisioning to the CRM works end to end."`
  - **Forecast:** import with the explicit mapping `person 0, periods 2–3`.
  - The two Draft-message rows replay as nothing (mail client; no data change).
  - **★ Draft message opens a `mailto:`.** In headless Chromium that may navigate the page away or open a popup, and either one breaks the take.
    - Find out which in discovery. Then stop it at the context level (`context.route` / `page.on('popup')` closing the popup), and assert the page URL is unchanged after the step.
    - Write the result into the step's comment.
  - The chat and Analyze steps replay as nothing (no data change).

  Checks:
  - **Dedup:** at least one pair proposed.
  - **Ask Claude:** the field is non-empty after accepting.
  - **Import:** at least one row mapped.
  - **Digest / Analyze / chat:** a result region is present.

- [ ] **Step 2: Rehearse each, expect PASS.**
  `node scripts/demo-video/record.mjs --video ch3-monday --rehearse`, then `ch4-tuesday` (its replay covers Monday), then `ch2-connect`. Each run ends with `WARNINGS 0`, including `checkDayFacts('mon')` and `('tue')`.

- [ ] **Step 3: Rehearse the AI path once,** with `--with-ai`, for `ch3-monday` and `ch4-tuesday`. Expected: each AI `check` passes on the first or second call.

- [ ] **Step 4: Commit.**
  `git commit --only scripts/demo-video/steps/week.mjs scripts/demo-video/videos.mjs -m "feat: the demo week's prologue, Monday and Tuesday takes (§715)"`

### Task 7: Wednesday to Friday and the big video (`ch5`–`ch7`, `big`)

**Files:**
- Modify: `scripts/demo-video/steps/week.mjs`, `scripts/demo-video/videos.mjs`

**Interfaces:**
- Produces: `WEDNESDAY`, `THURSDAY`, `FRIDAY` in the same `Step` shape as Task 6.

- [ ] **Step 1: Write the remaining days' rows**, in the spec's order.
  - **Wednesday:**
    - Add discipline "Integration Engineer", then the role × Senior with internal 100 and external 160.
    - New member `DEMO_NEW_MEMBER` (`lukas.brandt@example.com`).
    - Noah's vacation 2026-09-28 → 2026-10-02.
    - Maya's "Util (now)" cell lowered to `DEMO_MAYA_RELIEVED_HOURS`.
    - Planning for Lukas, then **Plan with AI**.
    - Swimlanes: **Add person lane** Lukas, then drag pair 1's second task into it.
  - **Thursday:**
    - GDPR issue: owner Noah, In Progress; **Ask Claude** on mitigation.
    - Risk `DEMO_LICENCE_RISK`, Medium.
    - Stakeholder `DEMO_DPO`; RACI cell C on "MVP re-demo", then **Suggest RACI**.
    - Map: drag the DPO to high/high.
    - Steering meeting 2: both changes Approved, then **Draft with AI**.
    - Bucket "CRM connector (CR)".
    - Task "Order the connector licence"; the chat creates "Confirm licence delivery" (due 2026-10-09).
    - Gantt: drag MVP target to 2026-10-01 (project D's milestone drag).
  - **Friday:**
    - Table: CRM task Done; GDPR issue Resolved.
    - Dashboard hero = "Update stakeholder: Northwind DPO", then Draft message and the AI update.
    - Insights, then **Generate recommendation** and act on it.
    - Split task 34 "Pilot feedback fixes" into two linked tasks, then **Optimize with AI**.
    - Trends, Activity, History (Monday's version against today's).
    - **Generate now**.
    - Help.

  Fixed replays:
  - **Plan with AI:** Lukas at 40 % in September and 80 % in October, as `applyDemoWeek`.
  - **Suggest RACI:** the DPO's C cell only.
  - **Mitigation:** `"Route erasure through the provisioning connector and verify end to end before the re-demo."`
  - **Chat task:** add "Confirm licence delivery" by hand.
  - **Recommendation:** dismiss it.
  - **Optimize:** nothing beyond the hand split. Friday is the last day and nothing replays after it.
  - **History:** needs Monday's version. Versions are captured by the app as the replay saves under the moving clock.
  - **Precondition** of `ch7-friday`: at least two rows in `project_versions` for the current project id.

- [ ] **Step 2: Rehearse** `ch5-wednesday`, `ch6-thursday` and `ch7-friday`. Expected: `WARNINGS 0`, with `checkDayFacts` for `wed`, `thu` and `fri` clean. On Friday the hero caption check reads "Update stakeholder: Northwind DPO".

- [ ] **Step 3: Rehearse** `big` (all days in one take, no replay). Expected: `WARNINGS 0`, with `checkDayFacts` clean after every day.

- [ ] **Step 4: Rehearse** `--with-ai` once for `ch5`–`ch7`.

- [ ] **Step 5: Commit.**
  `git commit --only scripts/demo-video/steps/week.mjs scripts/demo-video/videos.mjs -m "feat: the demo week's Wednesday to Friday and the big video (§715)"`

### Task 8: The 15 AI clips

**Files:**
- Modify: `scripts/demo-video/steps/ai.mjs`, `scripts/demo-video/steps/week.mjs` (its helpers exported for the clips), `scripts/demo-video/videos.mjs`, `scripts/demo-video/setup.mjs`

**Interfaces:**
- Produces one entry per id in A's tier-3 table. Each holds steps with `ai: true`, a structure `check`, and preconditions.

- [ ] **Step 1: Write the clips from A's tier-3 table** (Where / Opening / Steps). Reuse week steps where they are the same action; for example, `ai-dedup` uses Tuesday's dedup step object.
  Structure checks:
  - **dedup:** at least one pair.
  - **wbs:** at least one change.
  - **raci:** at least one filled cell.
  - **alloc:** at least one allocation row.
  - **forecast-import:** at least one mapped row.
  - **inline-task / inline-entity:** field non-empty.
  - **next-actions / insight / digest / steering / scheduled / chat / proposal:** a result region present.
  - **weights:** at least one suggestion row.

  Off-camera setup inside the clip's first step (before `screencast.start`, via a `setup` step flag that `runTake` runs before recording):
  - `ai-weights`: turn on next-actions learning in Settings, then act on and snooze rows until the learning view lists a history.
  - `ai-scheduled`: create one scheduled job in Settings → Scheduled jobs.

  Preconditions, as in A's "What A needs from project E" table, re-checked against the reworked data:
  - `ai-dedup`: both tasks of pair 2 open.
  - `ai-wbs`: at least 8 open tasks.
  - `ai-raci`: the matrix has an empty cell.
  - `ai-alloc`: Maya over-allocated in September.

  `runTake` gains `setup` steps: run before the preconditions, never recorded, AI-free.

- [ ] **Step 2: Rehearse the tier,** `node scripts/demo-video/record.mjs --tier ai --rehearse` → `RESULT ok 15 skipped 0 failed 0 WARNINGS 0`.

- [ ] **Step 3: Rehearse with AI,** `--tier ai --rehearse --with-ai` → the same result line. This makes about 15–25 real calls; the owner accepts the cost.

- [ ] **Step 4: Commit.**
  `git commit --only scripts/demo-video/steps/ai.mjs scripts/demo-video/steps/week.mjs scripts/demo-video/setup.mjs scripts/demo-video/videos.mjs scripts/demo-video/take.mjs scripts/demo-video/take.test.mjs -m "feat: the 15 AI clips (§715)"`
  If `take.mjs` changed for `setup` steps, add the test `"setup steps run before preconditions and are never recorded"` to `take.test.mjs` first, and watch it fail.

### Task 9: The 20 feature clips

**Files:**
- Modify: `scripts/demo-video/steps/features.mjs`, `scripts/demo-video/videos.mjs`, `scripts/demo-video/steps/week.mjs` (dedup from the view it is on; helpers exported), `scripts/demo-video/record.mjs` (a sub-view banner names its path)

**Interfaces:**
- Produces one entry per id in A's tier-4 table. `opening: { banner: '<view>' }` is resolved at take time: the runner opens the view and reads its hint text from the page.

- [ ] **Step 1: Write the clips from A's tier-4 table.** `f-gantt` follows the owner's fixed script exactly; its step ids are fixed by `videos.test.mjs`.
  - Its milestone drag uses project D's control.
  - Its View menu toggles each carry a caption naming the toggle.
  - Dedup runs live in `f-gantt` (owner).

  Preconditions, re-checked on the reworked data:
  - **`f-gantt`:**
    - an absence overlapping an open task bar of its assignee;
    - a dependency chain ending in a milestone;
    - Done tasks inside the visible window;
    - at least one near-duplicate pair.
  - **`f-workload`:** an over-allocated person.
  - **`f-history`:** at least two versions. `f-history`'s setup step makes two edits at two clock times so the app captures them.
  - **`f-trends`:** at least two snapshot rows for the project.

- [ ] **Step 2: Rehearse the tier,** `--tier features --rehearse` → `RESULT ok 20 skipped 0 failed 0 WARNINGS 0`.

- [ ] **Step 3: Commit.**
  `git commit --only scripts/demo-video/steps/features.mjs scripts/demo-video/steps/week.mjs scripts/demo-video/videos.mjs scripts/demo-video/record.mjs -m "feat: the 20 feature clips (§715)"`

### Task 10: Docs, the full take, and the hand-off

**Files:**
- Rewrite: `scripts/demo-video/README.md` (LF)
- Modify: `CHANGELOG.md` (Unreleased → Changed, LF)

- [ ] **Step 1: Rewrite the README.**
  - **What it needs:** the dev server command (unchanged), the throwaway pair, the key.
  - **Commands:** the five forms and the two flags.
  - **What a take does:** cleanup → fresh context → setup off camera → preconditions → recording → closing beat.
  - **Output layout.**
  - **The week's clock and the replay.**
  - **The device-state fixture and its test.**
  - **Exit codes.**
  - **When a re-take breaks:**
    - the old four entries, updated;
    - "a precondition is missing" = E's data is short, not a selector;
    - "an AI step timed out".
  - The files table lists every module of the File structure above.
  - Keep the "Fixtures" section.

- [ ] **Step 2: Add a CHANGELOG line:** "**Video guides recorder (§715).** One command per video for the 43 guides …".

- [ ] **Step 3: Take everything:** `node scripts/demo-video/record.mjs --all`.
  - Expected: `RESULT ok 42 skipped 0 failed 0 WARNINGS 0`, exit 0. The `ch1-install` placeholder is listed as hand-recorded, not as skipped for missing data.
  - List the files with their durations (`ffprobe`).
  - Extract one mid-take frame of three videos (`big`, `ai-dedup`, `f-gantt`) and look at each for a readable host, token or key. None may appear.

- [ ] **Step 4: Run every check before the push:**
  - eslint on the changed scripts;
  - `npx tsc --noEmit`;
  - the six new test files and E's tests under the lock;
  - the static gate.

- [ ] **Step 5: Commit.**
  `git commit --only scripts/demo-video/README.md CHANGELOG.md -m "docs: how to take the video guides (§715)"`
