# Demo Trends History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the demo project a 12-month story and, on Turso, a seeded Trends history; present the demo as a card on the empty state that guides a user without Turso, and add a second entry point in the Projects panel.

**Architecture:** The sample master is re-authored to 12 months with `DEMO_AS_OF` unchanged. A build-time script replays the master week by week through the live snapshot engines into a committed `sample-demo-snapshots.json`. At load, a demo orchestrator creates a Turso project from the shifted workspace and writes the shifted records in one batch, or falls back to today's local path. The empty state gets three cards and a localStorage intent that survives the portfolio-switch reload.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + RTL, Turso (Hrana pipeline), `node:sqlite` for statement tests.

**Spec:** `docs/superpowers/specs/2026-10-09-demo-trends-history-design.md`

## Global Constraints

- Worktree `C:/Projects/aipm-cockpit-wt24`, branch `feat/demo-trends-main`. Never push, PR or merge without the owner's word. Never `--amend`. Commits carry no `Claude-Session:` trailer and no `Closes #`.
- `DEMO_AS_OF` stays `"2026-09-18"`; `FROZEN_NOW` (`e2e/seed.ts`) and `VISUAL_FROZEN_NOW` (`e2e/visual.spec.ts`) stay unchanged.
- Plan span: `startDate "2026-03-02"`, `endDate "2027-02-26"`, `granularity "month"`. `project.startDate`/`endDate` match.
- Demo project name: `t(lang, "demoProjectName", ws.project.name)` → EN `"{0} (demo)"`, DE `"{0} (Demo)"`.
- Snapshot records: `cadence "weekly"`, `trigger "auto"`, captured each Friday at `T17:00:00.000Z`, from the second Friday after `startDate` through the last Friday strictly before `DEMO_AS_OF`; the first record `isBaseline: true`, all others `false`.
- Week counts in copy come from the snapshot file's length at run time, never a literal.
- Turso is "usable" exactly when `portfolioMode === "turso" && tursoConfig !== null` (AGENTS.md "Turso-gated features").
- Demo intent key: `"aipm-cockpit:demo-intent"`, value `"turso-setup"`. It lives in `aipm-cockpit:*`, so `clearAppConfig` already wipes it.
- i18n: every key in `i18n.ts` AND `i18n.de.ts`; edit `i18n.de.ts` with a node utf8 write matching `\r\n` (never the Edit tool), real umlauts. Exact copy is in Task 6.
- No new component sizes or tones: shared `Button`, existing surface tokens (`border-line bg-surface`), per the §684–§695 decision.
- `src/app/*.ts(x)` are CRLF: edit with the Edit tool or node with `\r\n`; never `sed -i`.
- Gates before each commit: `npx eslint --max-warnings=0 <changed files>` (with `--diff-filter=d`), `npx tsc --noEmit` unpiped, exit 0 with zero errors. Targeted vitest only, under the lock: `until mkdir /c/Projects/.vitest-lock 2>/dev/null; do sleep 5; done; npx vitest run --maxWorkers=2 <files> > <scratch log> 2>&1; echo EXIT=$?; rm -rf /c/Projects/.vitest-lock`, then read `Test Files N passed` from the log. No full vitest, e2e or build locally.
- `size:check` LIMIT is 1600 lines (`wc -l` + 1); `task-manager.tsx` has zero headroom (§491), so new logic goes into new modules, and task-manager gains only call sites that replace existing lines.

## Review Focus

1. **Month-shift collisions in the seeded records.** A month shift can clamp two Fridays into the same ISO week, and the user would see two points for one week. Expected: one record per `bucket` after shifting (latest wins). Pinned in Task 3.
2. **Series `period` keys not shifted.** `"2026-03"` is neither a date nor a timestamp, so the generic walker leaves it alone, and the burndown would sit months before the shifted dates. Expected: every `series[].period` moves by the same months. Pinned in Task 3.
3. **StrictMode double-invoking the intent read.** A read-and-clear inside a `useState` initializer runs twice, and the second read is empty, so the connected note never shows. Expected: read in the initializer, clear in an effect. Pinned in Task 7.
4. **Turso create succeeds but returns no id.** Then the snapshots go nowhere, or to the wrong project. Expected: `createTursoProject` returns the new id or `null`, and seeding runs only with a non-null id. Pinned in Task 5.
5. **Demo created while Turso is configured but in file portfolio mode.** Expected: the local demo, with no attempt to write to Turso. Pinned in Task 5.

---

### Task 1: Re-author the sample master to 12 months

**Files:**
- Modify: `sample-workspace-small.json`
- Regenerate: `sample-workspace-big.json`, `sample-workspace-huge.json` (`npx vite-node scripts/generate-sample-workspace.ts`), `src/app/__fixtures__/golden-*` (`npx vite-node scripts/regen-golden-fixtures.ts`)
- Modify as each verdict requires: the 35 files from `git grep -l sample-workspace-small -- src e2e scripts`

**Interfaces:** Produces the master that Task 2 replays. No code interfaces.

- [ ] **Step 1: Write the verdict table.** For each of the 35 files, record in `.superpowers/sdd/<plan>/task-1-verdicts.md` one of: UNAFFECTED (reads structure only), RECOMPUTE (asserts a count, total or date the change moves; name the assertion), or MIGRATE (fixture path or shape). Grep each file for literal numbers and dates near its use of the master.
- [ ] **Step 2: Re-author the master** to the span in Global Constraints with this story:
  - milestones (about 6): Kickoff 2026-03-06, Design sign-off 2026-05-29, MVP target 2026-07-17 slipping to a forecast in August, Pilot 2026-10-23, Rollout 2026-12-11, Closure 2027-02-26;
  - a RAID risk "Identity vendor SDK delivery late", raised 2026-07-01, linked to the MVP tasks;
  - the existing September changes stay, and one of them is the approved re-plan;
  - add early-phase tasks with `status "Done"` and `completedDate`s from March to August, some finishing after their due dates in July;
  - monthly budget periods from 2026-03 to 2027-02, with actuals from 2026-03 to 2026-09;
  - activity-log entries spread from March to September.
  - Keep every existing id where the entity stays; new ids continue past the current maximum.
- [ ] **Step 3: Regenerate** big/huge and the golden fixtures with the two commands above. Check `git diff --stat` shows only the expected files.
- [ ] **Step 4: Apply the RECOMPUTE and MIGRATE verdicts.** Each new expected value is computed from the new master by the reasoning the test already uses, never copied from a failing run's "Received".
- [ ] **Step 5: Run the affected unit tests** (every non-e2e RECOMPUTE/MIGRATE file, plus `golden-workspace.test.ts`, `demo-workspace.test.ts`, `shift-workspace-dates.test.ts`, `sample-workspace-*.test.ts`) under the lock. Expected: all `Test Files` pass.
- [ ] **Step 6: Visual and a11y.**
  - Re-baseline the visual shots: `npx playwright test --project=visual --update-snapshots`, one invocation.
  - Inspect each changed PNG and record what moved.
  - Run axe once on Dashboard, Gantt and Reports: `npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Dashboard|Gantt|Reports"`.
- [ ] **Step 7: Commit** `test: the sample project spans 12 months, from March 2026 to February 2027`.

### Task 2: Replay the master into weekly snapshots

**Files:**
- Create: `src/app/demo-snapshots.ts`, `src/app/demo-snapshots.test.ts`, `scripts/generate-demo-snapshots.ts`, `sample-demo-snapshots.json`

**Interfaces:**
- Produces:
  - `workspaceAsOf(ws: Workspace, asOf: string): Workspace`
  - `demoSnapshotFridays(startDate: string, asOf: string): string[]`
  - `buildDemoSnapshots(ws: Workspace, asOf: string): SnapshotRecord[]`

- [ ] **Step 1: Write failing tests** in `demo-snapshots.test.ts`:
  - `workspaceAsOf` on a fixture with rows on both sides of `"2026-07-10"`:
    - a task with `completedDate "2026-08-01"` comes back with `status` not `"Done"` and no `completedDate`;
    - one completed on `"2026-07-01"` is unchanged;
    - a budget actual for period `"2026-08"` is dropped, `"2026-07"` is kept;
    - RAID, change and activity rows dated after `asOf` are removed, earlier ones kept;
    - the input object is unchanged (`structuredClone` compare).
  - `demoSnapshotFridays("2026-03-02", "2026-09-18")`:
    - the first element is `"2026-03-13"`;
    - the last is `"2026-09-11"`;
    - every element is a Friday;
    - consecutive elements are 7 days apart;
    - length is 27.
  - `buildDemoSnapshots(master, DEMO_AS_OF)`:
    - length equals `demoSnapshotFridays(...)`'s length;
    - exactly the first record has `isBaseline` true;
    - every `capturedAt` ends `T17:00:00.000Z`;
    - `cadence "weekly"`, `trigger "auto"`;
    - `pctComplete` is non-decreasing across the first 10 records;
    - at least one record from July has `spi < 1`.
  - Committed file: `JSON.parse(readFileSync("sample-demo-snapshots.json"))` deep-equals `buildDemoSnapshots(master, DEMO_AS_OF)`.
- [ ] **Step 2: Run them; expect FAIL** (module missing).
- [ ] **Step 3: Implement** in `demo-snapshots.ts`.
  - The `computeDashboard(buildLiveDashboardInput(entities, ctx, null))` context:
    - `workdayHours: 8` (the `settings-types.ts` default);
    - an empty `holidaySet`;
    - `status: ws.status`;
    - `activity: ws.activityLog`;
    - `today: new Date(friday + "T17:00:00.000Z")`;
    - `budgetHistory: []`.
  - Then call `buildSnapshot` with `capturedAt`, `cadence "weekly"`, `trigger "auto"`, and `bucket` from `bucketKey`.
  - The module is pure and i18n-free.
- [ ] **Step 4: Write the script** `scripts/generate-demo-snapshots.ts`. It reads the master the way `scripts/generate-sample-workspace.ts` does (same jsdom import order) and writes `sample-demo-snapshots.json` with 2-space JSON and a trailing LF. Run `npx vite-node scripts/generate-demo-snapshots.ts`.
- [ ] **Step 5: Run the tests; expect PASS.**
- [ ] **Step 6: Commit** `feat: replay the sample project into a weekly Trends history`.

### Task 3: Shift, thin and batch-write the records

**Files:**
- Modify: `src/app/shift-workspace-dates.ts` (export two helpers), `src/app/snapshot-store.ts`
- Create: `src/app/demo-snapshot-shift.ts`, `src/app/demo-snapshot-shift.test.ts`
- Test: extend `src/app/turso-schema.execute.test.ts`, or add `snapshot-store.execute.test.ts` beside it using the same `node:sqlite` harness

**Interfaces:**
- Produces:
  - `shiftDatesIn<T>(value: T, n: number, unit: PlanGranularity): T` (the existing `walk`, exported);
  - `shiftPeriodKey(key: string, n: number, unit: PlanGranularity): string` (the existing `shiftKey`'s month/week branch, exported);
  - `shiftDemoSnapshots(recs: readonly SnapshotRecord[], n: number, unit: PlanGranularity): SnapshotRecord[]`;
  - `thinForCadence(recs: readonly SnapshotRecord[], cadence: SnapshotCadence): SnapshotRecord[]`;
  - `appendSnapshots(config: TursoConfig | null, recs: readonly SnapshotRecord[], projectId: string): Promise<void>`.

- [ ] **Step 1: Write failing tests:**
  - `shiftDemoSnapshots` by `n = 1` month:
    - every `capturedAt`, `forecastEndDate`, `planEndDate`, milestone `target`/`forecast` moves one month;
    - every `series[].period` moves `"2026-03"` → `"2026-04"`;
    - `id === capturedAt` and `bucket === bucketKey(new Date(capturedAt), "weekly")` after the shift;
    - the Fridays `"2026-01-23T17:00:00.000Z"` and `"2026-01-30T17:00:00.000Z"` shifted by `n = 1` land on 2026-02-23 and 2026-02-28 (clamped), the same ISO week, and one record per bucket remains, the one from the later source (Review Focus 1, 2);
    - `n = 0` returns equal records.
  - `thinForCadence`:
    - `"weekly"` and `"daily"` return the input;
    - `"monthly"` keeps the last record of each calendar month;
    - the first kept record carries `isBaseline: true` even when the original baseline was thinned away.
  - `appendSnapshots` against `node:sqlite`:
    - 27 records insert in one pipeline call (spy on `runTursoPipeline`: 2 calls total, the PRAGMA head and the batch);
    - a reload through `loadSnapshots` returns 27 rows, exactly one with `isBaseline`;
    - `recs = []` makes no call.
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Implement.** `appendSnapshots` mirrors `appendSnapshot`: one PRAGMA head, then one `runTursoPipeline` with `recs.flatMap((r) => appendStatements(r, projectId, ensure))`. The `ensure` statements are placed once, at the front. Keep each record's own `isBaseline`.
- [ ] **Step 4: Run them; expect PASS.** Then run `shift-workspace-dates.test.ts` and `snapshot-store` tests to confirm the exports changed nothing.
- [ ] **Step 5: Commit** `feat: shift, thin and batch-write the demo's Trends history`.

### Task 4: `createTursoProject` returns the new id

**Files:**
- Modify: `src/app/use-storage-turso-ops.ts`, `src/app/use-turso-projects.ts`, the `createTursoProject` type in `use-turso-projects.ts`'s result interface
- Test: the existing tests of those files

**Interfaces:**
- Produces: `createTursoProject(meta: ProjectMeta, opts?: NewProjectOpts) => Promise<string | null>`. Returns the id on success, and `null` when `guardTurso()` fails, the flush is refused, or the create throws (still reported through `reportProjectError`).

- [ ] **Step 1: Write failing tests:** the success path resolves to the id passed to `portfolioCreate`; a throwing `portfolioCreate` resolves `null` and still calls `reportProjectError` once.
- [ ] **Step 2: Run; expect FAIL.** **Step 3: Implement.** Existing callers ignore the value. **Step 4: Run them plus `use-turso-projects` tests; expect PASS.**
- [ ] **Step 5: Commit** `refactor: createTursoProject reports the id it created`.

### Task 5: The demo orchestrator

**Files:**
- Create: `src/app/demo-project.ts`, `src/app/demo-project.test.ts`
- Modify: `src/app/task-manager.tsx` (`loadDemo` body only: replace the `createDemoProject(ws)` call with `createDemo(...)`, net ≤ 0 lines)

**Interfaces:**
- Consumes:
  - `buildDemoWorkspace` (existing);
  - `demoShiftFor` (existing);
  - `shiftDemoSnapshots`, `thinForCadence`, `appendSnapshots` (Task 3);
  - `createTursoProject` (Task 4).
- Produces:
  - `type DemoOutcome = "turso" | "local" | "local-after-turso-failure" | "turso-without-history"`
  - `createDemo(deps: { ws: Workspace; records: readonly SnapshotRecord[]; today: string; tursoUsable: boolean; cadence: SnapshotCadence; tursoConfig: TursoConfig | null; projectName: string; createTursoProject: (meta: ProjectMeta, opts: NewProjectOpts) => Promise<string | null>; createLocal: (ws: Workspace) => Promise<void>; appendSnapshots: typeof appendSnapshots }): Promise<DemoOutcome>`

- [ ] **Step 1: Write failing tests** with fakes:
  - `tursoUsable false` → `createLocal` called once, `createTursoProject` never, returns `"local"` (Review Focus 5);
  - usable, and create resolves `"id-1"` → `appendSnapshots` called once with `projectId "id-1"`, records shifted by `demoShiftFor(DEMO_AS_OF, today, "month")` and thinned by `cadence`, returns `"turso"`; the meta passed has `name === projectName` and `opts.importedWorkspace === ws`;
  - create resolves `null` → `createLocal` called, `appendSnapshots` never, returns `"local-after-turso-failure"` (Review Focus 4);
  - `appendSnapshots` rejects → returns `"turso-without-history"`, `createLocal` never.
  - with `today "2026-10-02"`, the month shift would put the last records after today. Every record whose `bucket` is at or after `bucketKey(new Date(today + "T00:00:00Z"), "weekly")` is dropped before writing, so the current week is left to the live capture.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `createDemo`. Then rewrite `loadDemo`:
  - lazy-import both JSON files;
  - call `createDemo` with `tursoUsable = portfolioMode === "turso" && tursoConfig !== null`, `cadence = (settings.snapshots ?? defaultSnapshotSettings).cadence`, `projectName = t(lang, "demoProjectName", ws.project.name)` (keys land in Task 6), `createLocal = createDemoProject`;
  - map the outcome to toasts: `"local-after-turso-failure"` → info `demoCreatedLocallyToast`; `"turso-without-history"` → info `demoTrendsSeedFailedToast`;
  - then `startTour()` as today.
  - In local mode `createDemoProject` keeps its Turso→file switch for the "Turso mode, config not usable" case.
- [ ] **Step 4: Run** `demo-project.test.ts` and `task-manager` tests touching the demo (`git grep -l "loadDemo\|tourLoadDemo" -- 'src/app/*.test.tsx'`); expect PASS. Run `npm run size:check`; expect exit 0.
- [ ] **Step 5: Commit** `feat: create the demo as a Turso project with its Trends history when Turso is in use`.

### Task 6: i18n copy

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

The keys, EN | DE:
- `demoProjectName`: `"{0} (demo)"` | `"{0} (Demo)"`
- `emptyStartNewTitle`: `"New project"` | `"Neues Projekt"`
- `emptyStartNewBody`: `"Start empty or from a template."` | `"Leer oder mit einer Vorlage beginnen."`
- `emptyStartOpenTitle`: `"Open existing"` | `"Vorhandenes öffnen"`
- `emptyStartOpenBody`: `"From a file or your Turso database."` | `"Aus einer Datei oder Ihrer Turso-Datenbank."`
- `demoCardTitle`: `"Explore the demo"` | `"Demo erkunden"`
- `demoCardBody`: `"Customer Identity Platform: a 12-month project, 7 months in. Tasks, RAID, budget, Gantt and a guided tour."` | `"Customer Identity Platform: ein Projekt über 12 Monate, im 7. Monat. Aufgaben, RAID, Budget, Gantt und eine geführte Tour."`
- `demoCardTrendsNeedsTurso`: `"Trends, which shows how the project moved week by week, needs Turso, the optional cloud database that also syncs projects across devices. Set it up first to get {0} weeks of Trends history in the demo."` | `"Trends zeigt, wie sich das Projekt Woche für Woche entwickelt hat, und braucht Turso, die optionale Cloud-Datenbank, die Projekte auch geräteübergreifend synchronisiert. Richten Sie Turso zuerst ein, um {0} Wochen Trends-Verlauf in der Demo zu erhalten."`
- `demoCardTrendsIncluded`: `"Includes {0} weeks of Trends history. Adds \"{1}\" to your Turso database; delete it any time."` | `"Enthält {0} Wochen Trends-Verlauf. Legt „{1}“ in Ihrer Turso-Datenbank an; Sie können es jederzeit löschen."`
- `demoCardSetUpTurso`: `"Set up Turso first"` | `"Zuerst Turso einrichten"`
- `demoTursoConnectedNote`: `"Turso connected. Explore the demo to include {0} weeks of Trends history."` | `"Turso ist verbunden. Erkunden Sie die Demo, um {0} Wochen Trends-Verlauf einzuschließen."`
- `demoCreatedLocallyToast`: `"Turso could not be reached, so the demo was created as a local project without Trends history."` | `"Turso war nicht erreichbar, daher wurde die Demo als lokales Projekt ohne Trends-Verlauf angelegt."`
- `demoTrendsSeedFailedToast`: `"The demo project was created, but its Trends history could not be added."` | `"Das Demo-Projekt wurde angelegt, aber sein Trends-Verlauf konnte nicht hinzugefügt werden."`

- [ ] **Step 1:** Add the keys. **Step 2:** `npx tsc --noEmit` (key parity) exit 0, then run `i18n-encoding` and the i18n parity tests under the lock; expect PASS. **Step 3: Commit** `feat: copy for the demo card and its outcomes`.
- This task may run before Task 5. If so, Task 5 consumes the keys.

### Task 7: The demo card, the intent and the guided path

**Files:**
- Create: `src/app/demo-intent.ts` (+ test), `src/app/demo-start-card.tsx` (+ test)
- Modify:
  - `src/app/project-empty-state.tsx` (three cards; the wizard opens at a step);
  - `src/app/backend-setup-wizard.tsx` (add `initialStep?: number`, used as the `useState` seed);
  - `src/app/task-manager.tsx` (pass the new props, net ≤ 0 lines; move any added logic into `demo-intent.ts`);
  - `src/app/project-empty-state.test.tsx`

**Interfaces:**
- Produces:
  - `DEMO_INTENT_KEY = "aipm-cockpit:demo-intent"`
  - `readDemoIntent(): "turso-setup" | null` (try/catch; null on any error or other value)
  - `setDemoIntent(): void`
  - `clearDemoIntent(): void`
  - `DemoStartCard` props:
    ```ts
    {
      lang: Lang;
      variant: { kind: "local" } | { kind: "turso"; projectName: string };
      weeks: number;
      connectedNote: boolean;
      onExplore: () => void;
      onSetUpTurso?: () => void;
    }
    ```
  - `ProjectEmptyState` gains:
    - `demoVariant: { kind: "local" } | { kind: "turso"; projectName: string }`
    - `demoWeeks: number`
    - `demoConnectedNote: boolean`
- The Storage step's index: read it from `BACKEND_SETUP_STEPS` by id (`findIndex`), never a literal.

- [ ] **Step 1: Write failing tests:**
  - `demo-intent`:
    - set → read gives `"turso-setup"`; clear → `null`;
    - a stored `"x"` reads `null`;
    - a throwing `localStorage` reads `null` and `set`/`clear` do not throw.
  - `DemoStartCard`:
    - local variant renders `demoCardTrendsNeedsTurso` with the weeks number and both buttons, with names `demoCardTitle` and `demoCardSetUpTurso`;
    - turso variant renders `demoCardTrendsIncluded` with the weeks and the project name, and no setup button;
    - `connectedNote` renders `demoTursoConnectedNote`;
    - each button calls its handler once.
  - `ProjectEmptyState`:
    - three cards with headings `emptyStartNewTitle`, `emptyStartOpenTitle`, `demoCardTitle`;
    - "Set up Turso first" calls `setDemoIntent` and opens the wizard on the Storage step's heading;
    - closing the wizard clears the intent;
    - the existing create, load and archived behaviours still pass.
  - Mount-time behaviour, in a small hook `useDemoIntentOnBoot(deps)` in `demo-intent.ts`:
    - with the intent stored and the empty state showing, `connectedNote` is true and the intent is cleared after mount;
    - with projects present, `showToastAction("info", demoTursoConnectedNote text, { labelKey: "tourLoadDemo", run: loadDemo })` fires once and the intent is cleared;
    - under `reactStrictMode: true` (RTL option, not a wrapper; see `strictmode.meta.test.tsx`), the note still shows (Review Focus 3).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
  - The note shows only in Turso mode with a usable config.
  - The cards use the shared `Button` (`primary` for each card's main action, `secondary` for the others) and `rounded-md border border-line bg-surface p-4`.
  - Each card is a `<section aria-labelledby>` with an `<h3>`.
- [ ] **Step 4: Run** all files above plus `backend-setup-wizard` tests; expect PASS. Run `npm run size:check`; exit 0.
- [ ] **Step 5: Eye-verify** with a seeded Playwright spec in scratch (pattern: `eye-verify-with-a-seeded-playwright-spec`): empty state in file mode and in Turso mode with a stubbed config, light and dark. Save the screenshots in the scratchpad.
- [ ] **Step 6: Commit** `feat: the demo card on the start screen, and a guided path to Turso`.

### Task 8: Projects panel entry

**Files:**
- Modify:
  - `src/app/projects-panel.tsx` (an "Explore a demo project" `Button` `secondary` after the `projectsNew` button);
  - `src/app/workspace-section-types.ts` + `src/app/workspace-section.tsx` (thread `onLoadDemo?: () => void` to `ProjectsPanel`);
  - `src/app/task-manager.tsx` (pass `loadDemo`, one line);
  - `src/app/projects-panel.test.tsx`

**Interfaces:** Consumes `loadDemo` (Task 5). Produces `ProjectsPanelProps.onLoadDemo?: () => void`; the button renders only when it is passed.

- [ ] **Step 1: Write failing tests:** the button named `tourLoadDemo` renders after `projectsNew` (`expectButtonOrder` from `src/test/toolbar-order.ts`) and calls `onLoadDemo` once; it is absent without the prop and in a popout.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS) the tests above plus `workspace-section.test.tsx`; `npm run size:check` exit 0.
- [ ] **Step 5: Commit** `feat: explore the demo from the Projects panel`.

### Task 9: Docs, CHANGELOG and the owed live check

**Files:**
- Modify:
  - `docs/AGENTS/features.md` ("Guided tour + demo": the Turso branch, the snapshot file and its generator, the intent);
  - `CHANGELOG.md` (`### Added` under `## [Unreleased]`);
  - `docs/open-followups.md` (one entry: the live-Turso demo check, owed);
- Read before writing the register entry:
  - the register max on `origin/main`: `git fetch origin && git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1`;
  - skip §684–§695, which the peer holds.

- [ ] **Step 1:** Write the docs. The features.md text names `createDemo`, `buildDemoSnapshots`, `appendSnapshots`, `DEMO_INTENT_KEY` and states the accepted approximation (effort is not dated per task).
- [ ] **Step 2:** Run `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run followups:index:check` (after `node scripts/rebuild-followup-index.mjs`) and `npm run changelog:check`; each exits 0.
- [ ] **Step 3: Commit** `docs: the demo's Trends history, its generator and the guided path`.
