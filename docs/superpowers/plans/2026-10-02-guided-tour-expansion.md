# Guided Tour Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five show-and-tell tours (working faster, resources, budget & changes, documents, help yourself), extend four existing tours, and stop tours from stepping into Turso-only views on the file backend.

**Architecture:** One pure predicate `isViewReachable` in `nav-config.ts` becomes the single rule the sidebar and the tour both use; `visibleSteps` and `useTour` take the storage kind. New `data-tour-id` anchors are placed only on always-mounted controls (or wrappers whose empty size makes the overlay fall back to a centred card). All tour content is data in `app-tour.ts` plus EN/DE strings.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-02-guided-tour-expansion-design.md`

## Global Constraints

- Show and tell only: no new `TourStepKind`, no event listeners, no step that writes settings or data. `TourStep` is unchanged.
- Existing tour ids (`getting-started`, `raid`, `reporting`, `planning`, `stakeholders`, `ai`) and every existing step id stay unchanged.
- Step body: at most two sentences, about 35 words. Name a control by its visible label. Shortcuts written `Ctrl+Z`, with `(⌘ on Mac)` once per tour.
- Every factual claim in step text is checked against the code before it is written (see the claim-check rows in Tasks 3 and 4).
- `src/**` is CRLF in the working tree: never `sed -i` it. `docs/**` is LF.
- `i18n.de.ts` is edited ONLY by a node script writing UTF-8 with `\r\n` anchors, never the Edit tool; German uses real umlauts. `i18n.ts` (EN) may use the Edit tool.
- New translation keys follow `tour<Name>Title` / `tour<Name>Desc` and `tourStep<Name>Title` / `tourStep<Name>Body`.
- NO LOCAL GATES: no `tsc`, `eslint`, `npm run` gate scripts, full vitest or e2e. Verify with single-file vitest only: `npx vitest run <file> --maxWorkers=1`. Never two vitest processes at once. CI's eight checks are the gate.
- Never read an exit code through a pipe: redirect to a file, echo `$?`/`$LASTEXITCODE`, then read the file.
- Commits: conventional prefix, cite `§N` only if relevant, NO `Claude-Session:` or `Co-Authored-By` trailer, never `--amend`.
- No push, PR or merge — the controller does that on the owner's say.

## Review Focus

1. A feature module is turned off (e.g. resources) — the new tour for it has zero visible steps and must vanish from the catalog, not show "0 steps". Pinned in Task 4 Step 1 (`hides a new tour when its module is off`).
2. A file-backend user opens Reporting — no trends/history step, and the catalog card's step count matches what plays. Pinned in Task 4 Step 1 (`useTour drops Turso-only steps on file`).
3. A fresh session with an empty undo stack — the `wf-undo` step must render as a centred card, not a spotlight on nothing. jsdom reports every rect as 0×0, so this cannot be unit-tested; it is an owner eye-check (Task 5 Step 3).
4. Board or Swimlane mode — `selectAll` is absent and `wf-select` must fall back to the centred card. Same: eye-check (Task 5 Step 3).
5. A user who finished a tour before this change — its ✓ Done badge survives. Pinned in Task 3 Step 1 (`keeps every pre-existing tour and step id`).

---

### Task 1: Storage-aware step filter

**Files:**
- Modify: `src/app/nav-config.ts` (add `isViewReachable`; `filterNavGroups` uses it)
- Modify: `src/app/app-tour.ts` (`visibleSteps` signature)
- Modify: `src/app/use-tour.ts` (`UseTourArgs.storageKind`)
- Modify: `src/app/task-manager.tsx` (the one `useTour({…})` call)
- Test: `src/app/nav-config.test.ts`, `src/app/app-tour.test.ts`, `src/app/use-tour.test.tsx`

**Interfaces:**
- Produces: `isViewReachable(view: AppView, features: readonly FeatureModuleId[], storageKind?: string): boolean` exported from `nav-config.ts`.
- Produces: `visibleSteps(steps: readonly TourStep[], features: readonly FeatureModuleId[], storageKind?: string): TourStep[]`.
- Produces: `UseTourArgs.storageKind?: string`, used for both `steps` and `catalogTours`.

- [ ] **Step 1: Write the failing tests**

`nav-config.test.ts`:
```ts
it("isViewReachable agrees with filterNavGroups for every view, backend and module set", () => {
  const views = NAV_GROUPS.flatMap((g) => g.items.flatMap((i) => [i.view, ...(i.children ?? []).map((c) => c.view)]));
  for (const features of [[...ALL_FEATURE_MODULE_IDS], []] as const)
    for (const kind of ["turso", "file", undefined]) {
      const shown = new Set(filterNavGroups(features, kind).flatMap((g) => g.items.flatMap((i) => [i.view, ...(i.children ?? []).map((c) => c.view)])));
      for (const v of views) expect(isViewReachable(v, features, kind), `${v}/${kind}`).toBe(shown.has(v));
    }
});
it("isViewReachable hides Turso-only views off Turso", () => {
  for (const v of TURSO_ONLY_VIEWS) {
    expect(isViewReachable(v, ALL_FEATURE_MODULE_IDS, "turso")).toBe(true);
    expect(isViewReachable(v, ALL_FEATURE_MODULE_IDS, "file")).toBe(false);
    expect(isViewReachable(v, ALL_FEATURE_MODULE_IDS)).toBe(false);
  }
});
```
Use whatever the all-modules constant is actually called in `feature-modules.ts` (read it; `app-tour.test.ts` already imports one as `ALL`). The second test needs every Turso-only view's module enabled — check that `ALL` does that, or the `true` row fails for the wrong reason.

`app-tour.test.ts`:
```ts
it("visibleSteps drops Turso-only views off Turso and keeps view-less steps", () => {
  const trend: TourStep = { id: "t", kind: "modal", titleKey: "tourStepReportReportsTitle", bodyKey: "tourStepReportReportsBody", view: "trends" };
  const bare: TourStep = { id: "b", kind: "modal", titleKey: "tourStepWelcomeTitle", bodyKey: "tourStepWelcomeBody" };
  expect(visibleSteps([trend, bare], [...ALL], "turso").map((s) => s.id)).toEqual(["t", "b"]);
  expect(visibleSteps([trend, bare], [...ALL], "file").map((s) => s.id)).toEqual(["b"]);
  expect(visibleSteps([trend, bare], [...ALL]).map((s) => s.id)).toEqual(["b"]);
});
```

`use-tour.test.tsx`:
```ts
it("hides a tour whose steps are all filtered out", () => {
  // features=[] disables every module-gated view; the RAID tour is all module-gated today
  const { result } = renderHook(() => useTour({ ...baseArgs, features: [] }));
  expect(result.current.catalogTours.map((t) => t.id)).not.toContain("raid");
});
```
`baseArgs` = whatever the file's existing setup object is; reuse it.

- [ ] **Step 2: Run the three files and confirm the new tests fail**

`npx vitest run src/app/nav-config.test.ts --maxWorkers=1 > $env:TEMP\t1.log 2>&1; echo "EXIT=$LASTEXITCODE"`, then the same for the other two files, one at a time.
Expected: the `isViewReachable` and `visibleSteps` tests fail (missing export / wrong length). The catalog test PASSES already (the hide exists in `useTour`) — that is expected: it pins existing behaviour. Confirm it fails when you temporarily delete `.filter(({ vis }) => vis.length > 0)` in `use-tour.ts`, then restore it, and record that in the report.

- [ ] **Step 3: Implement**

`isViewReachable` = `isViewEnabled(view, features) && (storageKind === "turso" || !TURSO_ONLY_VIEWS.includes(view))`. Replace `filterNavGroups`' local `keepView` with a call to it. `visibleSteps` keeps `s.view === undefined || isViewReachable(s.view, features, storageKind)`. `useTour` passes `storageKind` to both `visibleSteps` calls and adds it to both `useMemo` dependency lists. In `task-manager.tsx` pass `storageKind: settings.storageConfig.kind` (no `?.` — the field is non-optional).

- [ ] **Step 4: Re-run the three files**

Expected: all pass, `Test Files 1 passed` in each log.

- [ ] **Step 5: Mutation checks** (report each as killed / survived)

1. In `isViewReachable`, change `storageKind === "turso"` to `true` → both new nav-config tests and the visibleSteps test fail.
2. In `filterNavGroups`, restore the old inline predicate but with `!onTurso` → parity test fails.
Revert each mutant and show `git diff --stat` matches your intended change only.

- [ ] **Step 6: Commit**

`git add` the seven files; `git commit -m "feat: guided tour skips Turso-only views on the file backend"`.

---

### Task 2: Tour anchors

**Files:**
- Modify: `src/app/app-tour.ts` (`TOUR_ANCHORS`)
- Modify: `src/app/task-manager.tsx` (`undoControlEl`)
- Modify: `src/app/global-search-box.tsx` (root element of `GlobalSearchBox`)
- Modify: `src/app/tasks-section.tsx` (view-mode control, select-all checkbox, saved-views control)
- Modify: `src/app/sidebar-nav.tsx` (`NAV_TOUR_ID`)
- Test: `src/app/global-search-box.test.tsx`, `src/app/tasks-section.test.tsx`, `src/app/sidebar-nav.test.tsx`, `src/app/app-tour.test.ts`

**Interfaces:**
- Produces in `TOUR_ANCHORS` (keys and values exact): `undo: "tour-undo"`, `globalSearch: "tour-global-search"`, `tasksViewMode: "tour-tasks-view-mode"`, `selectAll: "tour-select-all"`, `savedViews: "tour-saved-views"`, `navResources: "tour-nav-resources"`, `navBudget: "tour-nav-budget"`, `navChanges: "tour-nav-changes"`, `navDocuments: "tour-nav-documents"`.

- [ ] **Step 1: Write the failing tests**

- `global-search-box.test.tsx`: render as the file's existing tests do; `expect(container.querySelector('[data-tour-id="tour-global-search"]')).not.toBeNull()`.
- `tasks-section.test.tsx`, table mode: `tour-tasks-view-mode`, `tour-select-all` (and that element is the `selectAllVisible` checkbox: `screen.getByRole("checkbox", { name: /select all visible/i }).closest('[data-tour-id="tour-select-all"]')` is not null — or the attribute sits on the checkbox itself), `tour-saved-views` each present exactly once.
- `sidebar-nav.test.tsx`: with all modules on and the expanded sidebar, each of the four `tour-nav-*` ids is present exactly once.
- `app-tour.test.ts`: `"places the undo anchor around the undo controls"` — read `src/app/task-manager.tsx` with `fs.readFileSync` and assert it contains `data-tour-id={TOUR_ANCHORS.undo}`. (A rendered test would need the whole orchestrator; a source check is the pattern other brittle markup tests here use.)

Read `NAV_GROUPS` first: key `NAV_TOUR_ID` by the view of the nav entry the user clicks for resources, budget, changes and documents (top-level item where one exists). Write in the report which view each key uses.

- [ ] **Step 2: Run each test file, confirm the new tests fail.**

- [ ] **Step 3: Implement**

- `undoControlEl`: wrap the existing fragment's two controls in `<span data-tour-id={TOUR_ANCHORS.undo} className="inline-flex items-center …">`, copying the gap class of the container they sit in today so spacing is unchanged. Do NOT use `contents` (it measures 0×0 always, so the spotlight could never show). The empty-stack case stays empty-sized on purpose — the overlay falls back to a centred card.
- `GlobalSearchBox`: put the attribute on its outermost element.
- Tasks section: the select-all `<input>` gets the attribute directly; wrap `<SegmentedControl …>` and `<SavedViewsControl …>` in a `<span data-tour-id=…>` unless the component already forwards a data attribute — a wrapper must not change the toolbar's flex layout (use `inline-flex` / `contents`-free).
- `NAV_TOUR_ID`: add the four entries.

- [ ] **Step 4: Re-run the four test files; all pass.**

- [ ] **Step 5: Mutation check** — delete the `data-tour-id` from the select-all input → its test fails. Revert.

- [ ] **Step 6: Commit** — `git commit -m "feat: tour anchors on undo, search, task view controls and four sidebar entries"`.

---

### Task 3: Content — working faster, help yourself, AI additions

**Files:**
- Modify: `src/app/app-tour.ts`
- Modify: `src/app/i18n.ts` (EN, next to the existing `tourStep*` keys)
- Modify: `src/app/i18n.de.ts` (via a node script in the scratchpad)
- Test: `src/app/app-tour.test.ts`

**Interfaces:**
- Consumes: Task 2's `TOUR_ANCHORS` keys `undo`, `globalSearch`, `selectAll`, `savedViews`, `tasksViewMode`.
- Produces: tours `working-faster` (icon view `open-points`) and `help-yourself` (icon view `help`), inserted in `TOURS` after `getting-started`; AI tour gains `ai-inline`, `ai-dictation` after `ai-chat`.

Steps (ids, kind, anchor, view, content) are the spec's tables, verbatim: `wf-undo`, `wf-undo-limits`, `wf-search`, `wf-select`, `wf-bulk`, `wf-inline`, `wf-table`, `wf-views`, `wf-board`, `wf-logs`; `help-icon`, `help-search`, `help-escape`, `help-popout`; `ai-inline`, `ai-dictation`.

- [ ] **Step 1: Write the failing tests**

```ts
const PRE_EXISTING: Record<string, string[]> = {
  "getting-started": ["welcome","projects","tasks","actions","chat","dashboard","reports","raid","milestones","stakeholders","steering","settings"],
  raid: ["raid-overview","raid-matrix","raid-review"],
  reporting: ["report-dashboard","report-reports","report-evm"],
  planning: ["plan-milestones","plan-gantt","plan-critical"],
  stakeholders: ["stake-register","stake-raci","stake-comms"],
  ai: ["ai-chat","ai-actions","ai-settings"],
};
it("keeps every pre-existing tour and step id", () => {
  for (const [tour, ids] of Object.entries(PRE_EXISTING))
    expect(findTour(tour)!.steps.map((s) => s.id)).toEqual(expect.arrayContaining(ids));
});
it("working-faster spotlights the controls it teaches", () => {
  const byId = Object.fromEntries(findTour("working-faster")!.steps.map((s) => [s.id, s]));
  expect(byId["wf-undo"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.undo, view: "open-points" });
  expect(byId["wf-search"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.globalSearch });
  expect(byId["wf-select"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.selectAll });
  expect(byId["wf-views"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.savedViews });
  expect(byId["wf-board"]).toMatchObject({ kind: "spotlight", anchorId: TOUR_ANCHORS.tasksViewMode });
  expect(findTour("working-faster")!.steps).toHaveLength(10);
});
it("ai tour teaches inline edit and dictation", () => {
  expect(findTour("ai")!.steps.map((s) => s.id)).toEqual(["ai-chat","ai-inline","ai-dictation","ai-actions","ai-settings"]);
});
```
Plus: `findTour("help-yourself")` exists with `help-icon`, `help-search`, `help-escape` and (unless the popout claim-check drops it) `help-popout`, all `kind: "modal"`.

- [ ] **Step 2: Run `app-tour.test.ts`; the new tests fail, the pre-existing-id test passes (it pins the current state).**

- [ ] **Step 3: Claim checks** — before writing any text, verify each and record the answer in the report:

| Step | Claim to verify | Where |
|---|---|---|
| wf-undo | undo = Ctrl/⌘+Z; redo = Ctrl/⌘+Shift+Z or Ctrl/⌘+Y; ignored in editable targets; history via the caret; control hidden on an empty stack | `use-undo-hotkey.ts`, `undo/undo-control.tsx` |
| wf-undo-limits | note and blocker writes are not undoable | `undo/write-through-fields.ts` |
| wf-search | Ctrl/⌘+K focuses search; what it searches | `global-search-box.tsx` |
| wf-bulk | only ticked fields apply; one undo reverts the bulk change | `bulk-edit-panel.tsx`, `use-bulk-operations.ts` |
| wf-inline | Enter saves, Escape cancels, blur behaviour | the inline cell editor in the task row |
| wf-table | column resize by dragging the edge; reset-columns and reset-size exist on Open Points | `tasks-section.tsx` toolbar |
| wf-board | three modes; drag changes status; Jira-synced cards are read-only (mention only if short) | `task-kanban-board.tsx` |
| wf-logs | badges show a count and open the log window | `blockers-badge-button.tsx`, notes badge |
| help-icon | view hint banner has a Learn more link; dialogs carry a `?` | `view-callout.tsx`, `modal-header.tsx` |
| help-escape | Escape closes the top-most layer | `dismissal-stack.ts` |
| help-popout | which views can open in their own window | `task-manager-ui.tsx` popout button, `broadcast-sync.ts`. If only the chat: DROP `help-popout` and say so in the report |
| ai-inline | the button's visible label is "Ask Claude" and where it appears | `inline-ai-edit-button.tsx` |
| ai-dictation | hotkey set in Settings → Dictation; works in any field | `settings-sections/dictation-section.tsx`, `dictation-target.ts` |

A claim the code contradicts: write what the code does, and note it.

- [ ] **Step 4: Implement** — step data in `app-tour.ts`; EN strings in `i18n.ts`; DE strings via a scratchpad `.cjs` that inserts after the last existing `tourStep…` line using a `\r\n` anchor, throws if the anchor is not found exactly once, and writes UTF-8. Re-read the DE insert with a node one-liner and confirm umlauts are intact.

- [ ] **Step 5: Re-run `app-tour.test.ts`, then `src/app/i18n-encoding.test.ts` (find its real path with `git ls-files | grep i18n-encoding`), one at a time. Both pass.**

- [ ] **Step 6: Commit** — `git commit -m "feat: working-faster and help-yourself tours; inline AI and dictation in the AI tour"`.

---

### Task 4: Content — resources, budget & changes, documents, and the existing-tour gaps

**Files:** same as Task 3, plus `src/app/use-tour.test.tsx`.

**Interfaces:**
- Consumes: Task 1's `storageKind` on `useTour`; Task 2's `navResources`, `navBudget`, `navChanges`, `navDocuments`.
- Produces: tours `resources` (icon `resources`), `budget-changes` (icon `budget`), `documents` (icon `documents`), inserted after `stakeholders`; final `TOURS` order: getting-started, working-faster, raid, reporting, planning, stakeholders, resources, budget-changes, documents, ai, help-yourself.

Steps are the spec's lists verbatim: `res-directory`, `res-workload`, `res-calendar`, `res-planning`, `res-roles`; `bud-plan`, `bud-evm`, `chg-log`, `chg-report`, `chg-link`; `doc-ai`, `doc-editor`, `doc-versions`; getting-started `more-tours` (last); planning `plan-gantt` view → `gantt` and new `plan-gantt-view` after it; stakeholders `stake-raci-view`, `stake-map` after `stake-raci`; reporting `report-insights`, `report-learning`, `report-activity`, `report-trends`, `report-history` after `report-evm`.

- [ ] **Step 1: Write the failing tests**

`app-tour.test.ts`:
```ts
it("every anchor is used by a step and every step anchor exists", () => {
  const values = new Set(Object.values(TOUR_ANCHORS));
  const used = new Set(TOURS.flatMap((t) => t.steps.map((s) => s.anchorId).filter(Boolean)));
  for (const a of used) expect(values.has(a as never)).toBe(true);
  for (const v of values) expect(used.has(v)).toBe(true);
});
it("the planning tour's gantt step opens the gantt view", () => {
  expect(findTour("planning")!.steps.find((s) => s.id === "plan-gantt")!.view).toBe("gantt");
});
it("hides a new tour when its module is off", () => {
  // the resources tour's every step is gated on the resources module
  expect(visibleSteps(findTour("resources")!.steps, withoutResourcesModule)).toHaveLength(0);
});
it("step ids are unique across all tours", () => {
  const ids = TOURS.flatMap((t) => t.steps.map((s) => s.id));
  expect(new Set(ids).size).toBe(ids.length);
});
```
`withoutResourcesModule` = the all-modules list minus the module that gates `directory`/`workload`/`calendar`/`planning`/`manage-roles` — read `feature-modules.ts`. If those views are split across modules, or one is core, adjust the test to the real mapping and say so; the intent is "a tour whose views are all disabled is hidden".

`use-tour.test.tsx` (the test deferred from Task 1):
```ts
it("useTour drops Turso-only steps on file", () => {
  const file = renderHook(() => useTour({ ...baseArgs, storageKind: "file" }));
  const turso = renderHook(() => useTour({ ...baseArgs, storageKind: "turso" }));
  const count = (r: typeof file) => r.result.current.catalogTours.find((t) => t.id === "reporting")!.stepCount;
  expect(count(turso) - count(file)).toBe(2);
});
```
`baseArgs.features` must enable the modules that gate `trends` and `history`; if it does not, pass the all-modules list explicitly, or the difference is 0 for the wrong reason.

- [ ] **Step 2: Run both files; the new tests fail.**

- [ ] **Step 3: Claim checks** (record answers):

| Step | Claim | Where |
|---|---|---|
| res-workload | overload is shown; overdue work can be reassigned from here | `resource-workload*.tsx`, `WorkloadOverdueTriage` |
| res-calendar | arrow keys move day/person; Home/End; PageUp/Down | `resource-calendar.tsx` |
| res-planning | allocation grid; the AI plan button's label | `PlanningToolbar` |
| bud-plan / bud-evm | plan vs actuals on Budget; earned value on the budget report | `budget-panel.tsx`, `budget-report-panel.tsx` |
| chg-link | what an approved change does to milestones or the plan | `change-*` files; if nothing automatic, say the change records impact and the decision |
| doc-ai / doc-editor / doc-versions | AI drafting from project data; block editor; export formats; version history and restore | `docs/AGENTS/documents.md`, `documents-*` |
| plan-gantt-view | dependency arrows and the View menu's toggles | `gantt-view-menu.tsx` |
| stake-map | what the map plots | `stakeholder-map-panel.tsx` |
| report-learning | what learning insights shows | the `learning-insights` view |
| report-trends / report-history | snapshots/trends and version history are Turso-only | `TURSO_ONLY_VIEWS` |

- [ ] **Step 4: Implement** (same method as Task 3 Step 4).

- [ ] **Step 5: Re-run `app-tour.test.ts`, `use-tour.test.tsx`, then the i18n encoding test — one at a time, all pass.**

- [ ] **Step 6: Mutation checks** — (1) ignore `storageKind` inside `useTour` (pass `undefined`) → the Task 4 hook test fails; (2) remove `navDocuments` from the `doc-ai` step → the anchor-usage test fails. Revert both, `git diff --stat` clean of mutants.

- [ ] **Step 7: Commit** — `git commit -m "feat: resources, budget and changes, documents tours; fill planning, stakeholder and reporting gaps"`.

---

### Task 5: Docs

**Files:**
- Modify: `docs/AGENTS/features.md` ("Guided tour + demo")
- Modify: `src/app/help-content.ts` only if it describes the tours (today `grep -n -i tour src/app/help-content.ts` — read the hits)

- [ ] **Step 1: Update `features.md`**

Replace "`TOUR_STEPS` ~12 keys-only" and "4 `data-tour-id` anchors" with the spec's reproduce commands (no numbers). Add: `isViewReachable` is the one rule shared with `filterNavGroups`, and `visibleSteps` takes the storage kind; an anchor inside conditional UI (empty undo stack, board mode) falls back to the centred card by design because the overlay treats a zero-size or missing anchor alike. Every backticked mixed-case name you add must exist in `src/` (the CI `docs:symbols:check` gate) — grep each before committing. Do not add `path:LINE` citations (`docs:claims:check` ratchet).

- [ ] **Step 2: `help-content.ts`** — if any entry lists the tours or says how many there are, update it to the new set; otherwise leave it and say so in the report.

- [ ] **Step 3: Owner eye-check list** — add nothing to the repo; put this in the report for the controller to hand on: run each new tour on the demo project in file mode and on Turso; confirm `wf-undo` is a centred card on a fresh session and a spotlight after one edit; confirm `wf-select` falls back in Board mode; confirm Reporting has no trends/history steps in file mode.

- [ ] **Step 4: Commit** — `git commit -m "docs: guided tour storage filter and conditional anchors"`.
