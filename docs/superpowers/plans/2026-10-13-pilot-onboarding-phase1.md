# Pilot onboarding — phase 1 (in-app fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the in-app breaks a non-technical pilot user hit on first setup (§704–§712) before their 2026-10-22 review.

**Architecture:** Eleven independent UI/logic changes in `src/app` plus one in the Electron shell. Shared pieces are created first: the `uses` relation on feature modules (§707) and a `FunctionsPicker` extracted from the create wizard (§706), which Edit project, the wizard and the Time bookings notice then reuse. Everything else is self-contained per item.

**Tech Stack:** Next.js (repo-pinned), React, TypeScript, Vitest + Testing Library, Electron (desktop/).

**Spec:** `docs/superpowers/specs/2026-10-13-pilot-onboarding-design.md` (phase 1 sections).

## Global Constraints

- Every new string has an EN key in `src/app/i18n.ts` and a DE key in `src/app/i18n.de.ts` with real umlauts. Edit `i18n.de.ts` only by a node utf8 write anchored on `\r\n` (the Edit tool corrupts it); re-verify after.
- Line endings: `src/app/**`, `src/test/**`, `e2e/**`, `package.json`, `scripts/*.mjs` are CRLF; `docs/**/*.md`, `desktop/**` are LF. Never `sed -i`; check with `git ls-files --eol <file>`.
- Every new control has an accessible name and works by keyboard; a toggle is `ToggleButton`; per-row controls get row-unique names.
- No real personal or client names anywhere; examples use "Acme" / `acme`.
- Per-device UI state goes in localStorage under `aipm-cockpit:`, every read/write in try/catch; nothing new is added to the persisted `Workspace`.
- A component that consumes a parent request nonce seeds its last-seen value with a sentinel, never the live prop (AGENTS.md "Remount-swallow").
- File-size LIMIT is 1600 lines (`scripts/check-file-sizes.mjs`); `integrations-section.tsx` is at 1425 — new Turso UI goes in a new file.
- Vitest runs ONLY under the lock, targeted files, with `--maxWorkers=2`:
  `until mkdir /c/Projects/.vitest-lock 2>/dev/null; do sleep 5; done; npx vitest run <files> --maxWorkers=2 > "$TEMP/t.log" 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; grep -E "Test Files|Tests " "$TEMP/t.log"`
  No full suite, e2e or build locally. Before any push: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit` (exit 0, 0 errors in total).
- Commits cite §N only, carry no `Claude-Session` trailer and no URLs; never `--amend`.

## Review Focus

1. **A pasted Timelog address in an unexpected shape** (hash routing `https://app.timelog.com/acme/#/registration`, trailing newline from the clipboard, no path after the tenant) — host and tenant still parse. Pinned in Task 6.
2. **An existing Timelog config** (stored host `app2.timelog.com`, tenant set) opened after the change — the stored values show and are never rewritten by rendering. Pinned in Task 6.
3. **Edit project with functions toggled then Cancel**, and **Save with only a meta change** — features are not written in either case. Pinned in Task 3.
4. **A workspace whose field visibility hides the resource email** — the required email must still be enterable; the Needed group ignores visibility for email. Pinned in Task 8.
5. **Roles that are day-rate or have a zero rate** — "roles have rates" ticks only for a role with `internalRate > 0 || externalRate > 0` (day-rate roles carry the derived hourly value). Pinned in Task 10.

---

### Task 1: `uses` relation on feature modules (§707, pure)

**Files:**
- Modify: `src/app/feature-modules.ts` (the `FeatureModule` interface and the `timelog` row of `FEATURE_MODULES`)
- Test: `src/app/feature-modules.test.ts`

**Interfaces:**
- Produces: `FeatureModule.uses?: readonly FeatureModuleId[]`; `missingUses(id: FeatureModuleId, features: readonly FeatureModuleId[]): FeatureModuleId[]` — the declared uses of `id` not in `features`, in declaration order; `[]` when `id` declares none or is itself off.

- [ ] **Step 1: Write the failing tests** in `feature-modules.test.ts`:

```ts
describe("§707 uses", () => {
  it("only timelog declares uses: resources then budget", () => {
    expect(FEATURE_MODULES.filter((m) => m.uses).map((m) => m.id)).toEqual(["timelog"]);
    expect(FEATURE_MODULES.find((m) => m.id === "timelog")!.uses).toEqual(["resources", "budget"]);
  });
  it("every declared use is a real module id", () => {
    for (const m of FEATURE_MODULES) for (const u of m.uses ?? []) expect(ALL_MODULE_IDS).toContain(u);
  });
  it("missingUses names what is off, in order", () => {
    expect(missingUses("timelog", ["timelog"])).toEqual(["resources", "budget"]);
    expect(missingUses("timelog", ["timelog", "resources"])).toEqual(["budget"]);
    expect(missingUses("timelog", ["timelog", "resources", "budget"])).toEqual([]);
  });
  it("is empty when the module itself is off or declares nothing", () => {
    expect(missingUses("timelog", [])).toEqual([]);
    expect(missingUses("budget", ["budget"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** under the lock: `npx vitest run src/app/feature-modules.test.ts --maxWorkers=2` — Expected: FAIL (`missingUses` not exported).
- [ ] **Step 3: Implement** `uses` on the interface, `uses: ["resources", "budget"]` on the timelog row, and `missingUses` in `feature-modules.ts`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: declare that Time bookings uses Resources and Budget (§707)`.

### Task 2: `FunctionsPicker` extracted from the wizard, with the §707 notice (§706, §707)

**Files:**
- Create: `src/app/functions-picker.tsx`
- Modify: `src/app/create-project-wizard.tsx` (step 3 body → `<FunctionsPicker>`), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/functions-picker.test.tsx`; existing `create-project-wizard*.test.tsx` stay green unchanged

**Interfaces:**
- Consumes: `missingUses` (Task 1).
- Produces: `FunctionsPicker({ lang, features, onChange }: { lang: Lang; features: readonly FeatureModuleId[]; onChange: (next: FeatureModuleId[]) => void })` — renders the mode badge, the Simple/Advanced preset buttons and the module checkboxes exactly as the wizard's step 3 does today (same i18n keys, same aria-labels), plus, under each module whose `missingUses` is non-empty, a `UsesNotice`.
- Produces: `UsesNotice({ lang, moduleId, missing, onTurnOn }: { lang: Lang; moduleId: FeatureModuleId; missing: readonly FeatureModuleId[]; onTurnOn: () => void })` — exported from the same file for Task 5.

Copy (EN; DE translated):
- `functionsUsesTimelog`: "Time bookings uses Resources (to match bookings to people) and Budget (to cost them)."
- `functionsUsesMissingOne`: "{0} is off." · `functionsUsesMissingBoth`: "Both are off."
- `functionsUsesTurnOn`: "Turn on" — button accessible name `functionsUsesTurnOnLabel`: "Turn on {0}" with the missing module names joined by " and ".

- [ ] **Step 1: Write failing tests** in `functions-picker.test.tsx`: (a) presets call `onChange([])` / `onChange(ALL_MODULE_IDS)`; (b) with `features=["timelog"]` the notice reads the uses sentence + "Both are off." and **Turn on** calls `onChange` with `["timelog","resources","budget"]` (set equality); (c) with `["timelog","resources"]` it reads "Budget is off." and adds only budget; (d) with all three on, or timelog off, no notice (`queryByText(/uses Resources/)` null); (e) the button's accessible name is "Turn on Resources and Budget".
- [ ] **Step 2: Run** `npx vitest run src/app/functions-picker.test.tsx --maxWorkers=2` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `functions-picker.tsx`; replace the wizard's step-3 badge/presets/fieldset with `<FunctionsPicker lang={lang} features={features} onChange={setFeatures} />` (the seed checkbox stays in the wizard); add the i18n keys.
- [ ] **Step 4: Run** `npx vitest run src/app/functions-picker.test.tsx src/app/create-project-wizard --maxWorkers=2` — Expected: PASS, wizard tests unchanged and green.
- [ ] **Step 5: Commit** `feat: share the Functions picker and say what Time bookings needs (§706, §707)`.

### Task 3: Functions in Edit project (§706)

**Files:**
- Modify: `src/app/project-edit-modal.tsx`, `src/app/projects-panel.tsx`, `src/app/workspace-section.tsx` (ProjectsPanel mount), i18n files
- Test: `src/app/project-edit-modal.test.tsx` (create if absent), `src/app/projects-panel.test.tsx`

**Interfaces:**
- Consumes: `FunctionsPicker` (Task 2).
- Produces: `ProjectEditModalProps` gains `features: readonly FeatureModuleId[]`, `focusFunctions?: boolean` (scrolls the Functions part into view and focuses its heading on mount) and changes `onSubmit` to `(meta: ProjectMeta, features: FeatureModuleId[] | null) => void` — `null` when the features equal `initialFeatures` as a set.
- Produces: `ProjectsPanelProps` gains `features: readonly FeatureModuleId[]` and `onCommitFeatures: (features: FeatureModuleId[]) => void`; `handleEditSubmit(meta, features)` calls `onUpdateCurrent(meta)` then, when `features !== null`, `onCommitFeatures(features)`.
- The Functions part is a `<section aria-labelledby>` with heading `editProjectFunctionsHeading` ("Functions"), below the existing form fields, holding the `FunctionsPicker` over a local draft seeded from `features`.

- [ ] **Step 1: Write failing tests:** modal — (a) toggling a module then Save calls `onSubmit(meta, <new set>)`; (b) Save without touching functions calls `onSubmit(meta, null)` (Review Focus 3); (c) toggling then Cancel calls `onCancel` and never `onSubmit`; (d) `focusFunctions` moves focus to the Functions heading. Panel — Save with changed functions calls both `onUpdateCurrent` and `onCommitFeatures`; Save with unchanged functions calls `onCommitFeatures` zero times.
- [ ] **Step 2: Run** `npx vitest run src/app/project-edit-modal.test.tsx src/app/projects-panel.test.tsx --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement**; thread `features={settings.features}` and `onCommitFeatures={onCommitFeatures}` (already on the workspace-section props) into `<ProjectsPanel>`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat: choose a project's functions in Edit project (§706)`.

### Task 4: Settings "Mode" becomes a Functions pointer (§706)

**Files:**
- Modify: `src/app/settings-view.tsx` (`SECTIONS` label, `EXPERT_IDS`, the `active === "mode"` branch), `src/app/settings-sections/mode-section.tsx`, `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/workspace-section-types.ts`, `src/app/projects-panel.tsx`, i18n files
- Test: `src/app/settings-sections/mode-section.test.tsx`, `src/app/settings-view*.test.tsx`, `src/app/projects-panel.test.tsx`

**Interfaces:**
- Consumes: `ProjectEditModal.focusFunctions` (Task 3).
- Produces: the section id stays `"mode"` (persisted deep links keep working); its rail label key `settingsSectionMode` now reads "Functions" / "Funktionen"; `"mode"` leaves `EXPERT_IDS`.
- Produces: `ModeSection` renders: text `settingsFunctionsPointer` ("Functions are chosen per project.") + button `settingsFunctionsOpen` ("Open this project's functions") calling a new prop `onOpenProjectFunctions: () => void`; the version-retention block renders only when `expertMode` is on; the presets, checkboxes and Save/Discard are removed (they live in Edit project now). The button is disabled with hint `noCurrentProject` copy when there is no current project.
- Produces: in task-manager, `openProjectFunctions()` sets the active view to `"projects"` and bumps a monotonic `projectFunctionsRequest: number | null`; `ProjectsPanel` takes `projectFunctionsRequest` + `onProjectFunctionsRequestConsumed`, and on a new non-null value (render-time reconcile, last-seen seeded `null`) opens the edit modal with `focusFunctions` and calls the consume callback, which resets the request to `null`.

- [ ] **Step 1: Write failing tests:** (a) with expert mode OFF the rail lists the Functions section and the pane shows the pointer button; (b) retention field absent without expert, present with it; (c) the button calls `onOpenProjectFunctions`; (d) ProjectsPanel MOUNTED FRESH with a pending non-null request opens the edit modal focused on Functions and calls the consume callback once (remount-swallow guard); (e) a re-render with the same request does not reopen after close.
- [ ] **Step 2: Run** `npx vitest run src/app/settings-sections/mode-section.test.tsx src/app/settings-view src/app/projects-panel.test.tsx --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement**; delete tests in `mode-section.test.tsx` that pin the removed presets/checkboxes/Save (their behaviour is now pinned by Tasks 2–3) — list each deleted test name in the commit body.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Settings points to each project's functions instead of hiding them in expert mode (§706)`.

### Task 5: The Time bookings view says what it needs (§707)

**Files:**
- Modify: `src/app/timelog-panel.tsx`, `src/app/workspace-section.tsx` (TimelogPanel mount)
- Test: `src/app/timelog-panel.test.tsx`

**Interfaces:**
- Consumes: `UsesNotice`, `missingUses` (Tasks 1–2).
- Produces: `TimelogPanel` props gain `features: readonly FeatureModuleId[]` and `onCommitFeatures?: (f: FeatureModuleId[]) => void` (omitted in popouts). While `missingUses("timelog", features)` is non-empty the panel shows `UsesNotice` at the top; **Turn on** calls `onCommitFeatures([...features, ...missing])`. With `onCommitFeatures` undefined the notice shows without the button.

- [ ] **Step 1: Write failing tests:** notice shown with budget off and with both off; hidden with both on; Turn on commits the union; popout (no callback) shows no button.
- [ ] **Step 2: Run** `npx vitest run src/app/timelog-panel.test.tsx --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement**; pass `features={features}` and `onCommitFeatures={isPopout ? undefined : onCommitFeatures}` from workspace-section.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat: show the Resources/Budget notice in the Time bookings view (§707)`.

### Task 6: Timelog address field and a specific 404 (§704, §709)

**Files:**
- Create: `src/app/timelog-address.ts`
- Modify: `src/app/timelog-settings.tsx`, `src/app/timelog-types.ts` (`defaultTimelogConfig.host` → `""`), `e2e/seed.ts` only if a spec relies on the default (it sets the host explicitly — leave it), i18n files
- Test: `src/app/timelog-address.test.ts`, `src/app/timelog-settings.test.tsx`

**Interfaces:**
- Produces: `parseTimelogAddress(raw: string): { host: string; tenant: string } | null` — trims; requires `https:`; lowercases the host; requires the host to be `timelog.com` or end with `.timelog.com` and to contain no `@` or `:` (mirror `normalizeHost` in `api/timelog/_helpers.ts`; do not import server code); tenant = first non-empty path segment, decoded; ignores query and hash. `null` otherwise.
- UI: a first field `timelogAddress` ("Your Timelog address", hint `timelogAddressHint`: "Open Timelog in your browser, copy the address bar, paste it here.", placeholder `https://app.timelog.com/acme/…`). Local state only, never persisted. On change: a parse result calls `set({ host, tenant })`; a non-empty unparseable value shows `FieldError` `timelogAddressInvalid` ("This is not a Timelog address."). Host and tenant fields move under a `<details>` "Edit host and tenant separately" (`timelogAddressEditSeparately`), open by default when the stored host or tenant is non-empty. Tenant hint `timelogTenantHint`: "The part after the host in your Timelog address." (§709).
- 404: in `test()`, `status === 404` shows `timelogTest404` ("Timelog has no tenant \"{0}\" on {1}. Timelog serves regions from different addresses — check the address bar while logged in.") with the effective tenant and host; other statuses keep `timelogTestFail`.

- [ ] **Step 1: Write failing tests.** Parser table:

```ts
it.each([
  ["https://app.timelog.com/acme/registration/week", { host: "app.timelog.com", tenant: "acme" }],
  ["https://APP2.timelog.com/acme", { host: "app2.timelog.com", tenant: "acme" }],
  ["https://app.timelog.com/acme/#/registration", { host: "app.timelog.com", tenant: "acme" }],
  ["  https://app.timelog.com/acme/?x=1\n", { host: "app.timelog.com", tenant: "acme" }],
])("parses %s", (raw, want) => expect(parseTimelogAddress(raw)).toEqual(want));
it.each([
  "http://app.timelog.com/acme", "https://app.timelog.com/", "https://eviltimelog.com/acme",
  "https://app.timelog.com.attacker.com/acme", "https://evil.com@app.timelog.com/acme",
  "https://app.timelog.com:8080/acme", "acme", "",
])("rejects %s", (raw) => expect(parseTimelogAddress(raw)).toBeNull());
```

  Form: pasting fills host+tenant via `onChange`; an invalid paste shows the error and does not call `onChange`; rendering a stored config `{host:"app2.timelog.com", tenant:"acme"}` calls `onChange` zero times and shows both values (Review Focus 2); a rejected test with `status: 404` shows the 404 text naming tenant and host; status 500 keeps the generic text; `defaultTimelogConfig.host === ""`.
- [ ] **Step 2: Run** `npx vitest run src/app/timelog-address.test.ts src/app/timelog-settings.test.tsx --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus every file that names the old default: `npx vitest run src/app/timelog-address.test.ts src/app/timelog-settings.test.tsx src/app/timelog-api.test.ts src/app/timelog-panel.test.tsx src/app/use-timelog-sync.test.ts src/app/api/timelog --maxWorkers=2` — Expected: PASS (a test that asserted the `app2` default is updated to the explicit value it needs, and named in the commit body).
- [ ] **Step 5: Commit** `feat: read the Timelog host and tenant from the pasted address, and explain a 404 (§704, §709)`.

### Task 7: Match Timelog users on every email of a person (§708)

**Files:**
- Modify: `src/app/timelog-match.ts` (`autoMatchUsers`)
- Test: `src/app/timelog-match.test.ts`

**Interfaces:**
- Produces: `autoMatchUsers` email rule matches `u.email` against `[r.email, ...(r.emails ?? [])]`, case-insensitive and trimmed. A resource whose PRIMARY email matches wins over one whose extra email matches. Initials and name rules, and manual-link precedence, are unchanged.

- [ ] **Step 1: Write failing tests:** match on an extra email; primary beats extra when two resources qualify (order the extra-match resource FIRST in the array so `find` order cannot fake it); a manual link still wins; blank extra entries never match a blank Timelog email.
- [ ] **Step 2: Run** `npx vitest run src/app/timelog-match.test.ts --maxWorkers=2` — Expected: FAIL on the extra-email case.
- [ ] **Step 3: Implement** (two passes: primary, then extra).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `fix: match Timelog users on any of a person's emails (§708)`.

### Task 8: Resource form — Needed on top, email required (§708)

**Files:**
- Modify: `src/app/resource-edit-modal.tsx`, `src/app/resource-directory.tsx`, i18n files
- Test: `src/app/resource-edit-modal.test.tsx`, `src/app/resource-directory.test.tsx`

**Interfaces:**
- Form: a "Needed" group (`resourceNeededHeading`) holding first name, last name and email — email ALWAYS rendered here regardless of `isVisible("email")` (Review Focus 4); email hint `resourceEmailTimelogHint`: "Matches Timelog bookings, calendar and contacts — use the address the person signs into Timelog with." The remaining fields (job title, company, department, location, phone, extra emails, external, birthday, notes — each still subject to `isVisible`) go inside `<details>` "More details" (`resourceMoreDetails`), `open` initially when any of them has a value in the draft.
- Save: after the name check, an empty trimmed email sets `resourceErrorEmailRequired` ("Enter the person's email — it is how Timelog bookings reach them.") and returns. Other create paths are untouched: the picker quick create (`use-resource-quick-create.ts`) still creates a person with no email.
- Directory: a row whose resource has no primary and no extra email shows a muted marker `resourceNoEmailMarker` ("No email — cannot match Timelog") in the email cell.

- [ ] **Step 1: Write failing tests:** quick create without an email still succeeds (in `use-resource-quick-create.test.ts`, which then joins the Step 2/4 run); Save without email shows the error and does not call `onSave`; with email saves; with field visibility hiding email the email input is still present; More details closed for a new person, open when editing one with a job title; directory marker for a no-email resource and absent for one with only an extra email.
- [ ] **Step 2: Run** `npx vitest run src/app/resource-edit-modal.test.tsx src/app/resource-directory.test.tsx --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement.** Existing tests that save a resource without an email get an email added to their fixture; name each in the commit body.
- [ ] **Step 4: Run** the same plus `src/app/use-resource-directory` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: put the fields Timelog needs first and require an email in the resource form (§708)`.

### Task 9: Turso setup as numbered steps (§711)

**Files:**
- Create: `src/app/settings-sections/turso-setup-steps.tsx`, `src/app/turso-setup-state.ts`
- Modify: `src/app/settings-sections/integrations-section.tsx` (wrap the existing URL, token and test blocks — no field logic changes), `src/app/version.ts`, i18n files
- Test: `src/app/turso-setup-state.test.ts`, `src/app/settings-sections/turso-setup-steps.test.tsx`, `src/app/settings-sections/integrations-section.test.tsx`

**Interfaces:**
- Produces: `INSTALL_GUIDE_URL = \`${APP_REPO_URL}/blob/main/docs/desktop-rollout.md\`` in `version.ts` (phase 2 reuses it).
- Produces: `tursoSetupState({ url, token, urlFromEnv, tokenFromEnv, testConfirmed }): { urlDone: boolean; tokenDone: boolean; testDone: boolean }` — `urlDone = urlFromEnv || isUsableTursoUrl(url)`, `tokenDone = tokenFromEnv || token.trim() !== ""`, `testDone = testConfirmed`.
- Produces: `TursoSetupSteps({ lang, state, urlStep, tokenStep, testStep })` — an `<ol>` of four `<li>`: 1 static (`tursoStepCreate`: "Create a free database at turso.tech ↗" linking `https://turso.tech/`, sub-text `tursoStepCreateHint`: "Pick a location near you (EU for European projects). Keep the tab open."), 2 `tursoStepUrl` ("Database URL — copy it from the database's page") + `urlStep` node, 3 `tursoStepToken` ("Auth token — create one without an expiry, then paste it here") + `tokenStep`, 4 `tursoStepTest` ("Test connection, then Apply") + `testStep`. A done step shows ✓ with visually hidden text `tursoStepDone` ("done"). Below the list: link `tursoStepGuide` ("Step-by-step guide with pictures ↗") to `INSTALL_GUIDE_URL`.
- `integrations-section.tsx` passes its existing URL, token and test JSX as the three nodes and `testConfirmed = tursoTestConfirmed`; the URL tooltip stays.

- [ ] **Step 1: Write failing tests:** state table (env URL counts, unusable URL does not, whitespace token does not); component — ordered list with four items, ✓ per state independently, no-expiry text present, guide link href equals `INSTALL_GUIDE_URL`; integrations-section — the existing Turso field tests still find their fields (run them), and the list renders when Turso is enabled.
- [ ] **Step 2: Run** `npx vitest run src/app/turso-setup-state.test.ts src/app/settings-sections/turso-setup-steps.test.tsx src/app/settings-sections/integrations-section --maxWorkers=2` — Expected: FAIL on the new files.
- [ ] **Step 3: Implement.** Confirm the section stays under the LIMIT: `node -e "console.log(require('fs').readFileSync('src/app/settings-sections/integrations-section.tsx','utf8').split('\n').length)"` < 1600.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat: lay out the Turso setup as numbered steps, token without expiry (§711)`.

### Task 10: Budget setup checklist (§710)

**Files:**
- Create: `src/app/budget-setup.ts`, `src/app/budget-setup-checklist.tsx`
- Modify: `src/app/budget-panel.tsx` (the `report.buckets.length === 0` branch and a collapsed line above the table), `src/app/workspace-section.tsx` (BudgetPanel mount), i18n files
- Test: `src/app/budget-setup.test.ts`, `src/app/budget-setup-checklist.test.tsx`

**Interfaces:**
- Produces: `budgetSetupSteps({ roles, resources, buckets }): { ratesDone: boolean; peopleDone: boolean; bucketDone: boolean; bookingsDone: boolean; next: 1 | 2 | 3 | 4 | null }` — `ratesDone` = some role with `internalRate > 0 || externalRate > 0`; `peopleDone` = `resources.length > 0`; `bucketDone` = `buckets.length > 0`; `bookingsDone` = some bucket allocation with any `actualHours` value > 0; `next` = first not-done step (4 counts, being optional, only after 1–3), `null` when all done.
- Produces: `BudgetSetupChecklist({ lang, steps, collapsed, onAddBucket, onGo, onStartTour, onLoadDemo, onDismiss })` where `onGo: (view: "manage-roles" | "directory" | "timelog") => void`. Expanded: four rows (`budgetSetupRates`, `budgetSetupPeople`, `budgetSetupBucket`, `budgetSetupBookings` + `budgetSetupOptional` "optional"), the `next` row highlighted, row 3 holding the existing "+ Add bucket…" button, then links `budgetSetupTour` (starts tour id `"budget-changes"`) and `budgetSetupDemo`. Collapsed: one line `budgetSetupCollapsed` ("Budget setup: {0} of 4 · show") with a show toggle and a ✕ (`budgetSetupDismiss`, accessible name "Hide budget setup").
- Panel: no buckets → expanded checklist; buckets but `!bookingsDone` and not dismissed → collapsed line above the table; dismissed when localStorage `aipm-cockpit:budget-setup-dismissed:<projectKey>` is `"1"`. `onGo` uses workspace-section's `setActiveTab`; `onLoadDemo` is the existing workspace-section prop; both undefined in a popout (links hidden).

- [ ] **Step 1: Write failing tests:** state table including a day-rate role with `internalRate` derived > 0 (done), a role with both rates 0 (not done) (Review Focus 5), bookings only from `actualHours` > 0; component — highlight follows `next`, optional label on step 4, links call the right callbacks, collapsed line shows the count and ✕ calls `onDismiss`; panel — collapsed after a bucket exists, hidden after a booking, hidden after dismiss and still hidden after re-render with a fresh mount (localStorage read).
- [ ] **Step 2: Run** `npx vitest run src/app/budget-setup.test.ts src/app/budget-setup-checklist.test.tsx src/app/budget-panel --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat: guide an empty budget through its setup steps (§710)`.

### Task 11: Demo banner and Help entry (§712)

**Files:**
- Create: `src/app/demo-banner.tsx`
- Modify: `src/app/dashboard-panel.tsx` or its workspace-section mount (banner above the grid), `src/app/help-menu.tsx`, `src/app/action-menus.tsx`, `src/app/shell-chrome.tsx`, `src/app/app-header.tsx`, `src/app/task-manager.tsx` (wrap `loadDemo` so it also marks the banner done), i18n files
- Test: `src/app/demo-banner.test.tsx`, `src/app/help-menu.test.tsx`

**Interfaces:**
- Produces: `DEMO_BANNER_DONE_KEY = "aipm-cockpit:demo-banner-done"`; `readDemoBannerDone(): boolean`, `markDemoBannerDone(): void` (try/catch) in `demo-banner.tsx`.
- Produces: `DemoBanner({ lang, onExplore })` — hidden when `readDemoBannerDone()`; text `demoBannerText` ("New here? See every function on a fully populated sample project first. It opens as a separate project — your own stays as it is, and you can switch back any time from Projects."), button `demoBannerExplore` ("Explore the demo") calling `markDemoBannerDone()` then `onExplore()`, ✕ (`demoBannerDismiss`, "Hide demo suggestion") calling `markDemoBannerDone()` and hiding.
- Opening the demo marks the banner done, so on this device it never shows on the demo itself (spec: "never shown on the demo").
- task-manager: every call site of `loadDemo` already goes through two lambdas; route both through one `exploreDemo = () => { markDemoBannerDone(); void loadDemo(); }`.
- Help: `HelpMenu` takes `onLoadDemo?: () => void`; the footer gains a button `helpExploreDemo` ("Explore the demo project") before the licence link, rendered only when the prop is set. `ActionMenus` takes and forwards it; BOTH header mounts (`buildShellChrome` and `AppHeader`) pass `exploreDemo`, and neither passes it in a popout.

- [ ] **Step 1: Write failing tests:** banner visible by default; ✕ hides it and a fresh mount stays hidden; Explore marks done and calls `onExplore`; banner absent in a popout dashboard; Help footer button present with the prop and absent without; clicking it calls the callback. A test that the modern AND classic header both pass `onLoadDemo` (assert on the rendered Help panel in each layout's existing test harness).
- [ ] **Step 2: Run** `npx vitest run src/app/demo-banner.test.tsx src/app/help-menu.test.tsx src/app/action-menus src/app/app-header --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `src/app/dashboard-panel` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: suggest the demo on the dashboard and in Help (§712)`.

### Task 12: First start says what it is doing (§705)

**Files:**
- Create: `desktop/src/lib/splash-status.ts`
- Modify: `desktop/splash.html` (status markup + a tiny setter script outside the SVG; update the header comment, which says the page adds no status line), `desktop/src/main.ts` (`start()`)
- Test: `desktop/src/lib/splash-status.test.ts`

**Interfaces:**
- Produces: `SPLASH_SLOW_MS = 10_000`; `splashMessages(locale: string): { starting: string; opening: string; slow: string }` — German when `locale` starts with `de`, else English. EN: "Starting the background service…", "Opening…", "Still starting. The first start after installing or updating can take up to a minute — please wait." DE: "Hintergrunddienst wird gestartet…", "Wird geöffnet…", "Startet noch. Der erste Start nach der Installation oder einem Update kann bis zu einer Minute dauern – bitte warten."
- Produces: `splashScript(kind: "status" | "slow", text: string): string` — returns `window.__splash && window.__splash.${kind}(<JSON-escaped text>)`; the text is passed through `JSON.stringify` (no string concatenation of raw text).
- splash.html: `<p id="splash-status" role="status">` and `<p id="splash-slow" hidden>` styled to the artwork's palette, plus `window.__splash = { status(t){…textContent=t}, slow(t){…textContent=t; hidden=false} }`.
- main.ts: after `loadFile`, send `starting`; start a `setTimeout(SPLASH_SLOW_MS)` that sends `slow`; before `loadURL(APP_ORIGIN)` send `opening`; clear the timer before `loadURL` and in every `fail(...)` path. Locale from `app.getLocale()`. Send through `win.webContents.executeJavaScript(splashScript(...)).catch(log)`.

- [ ] **Step 1: Write failing tests:** messages per locale (`de-DE`, `de`, `en-GB`, `fr-FR` → EN); `splashScript` output for a text containing `"` and `</script>` round-trips through `JSON.parse` of its argument; DE strings contain real umlauts.
- [ ] **Step 2: Run** `npx vitest run desktop/src/lib/splash-status.test.ts --maxWorkers=2` — Expected: FAIL.
- [ ] **Step 3: Implement.** `desktop/src/main.ts` is outside the root tsc program — compile-check it with `npm --prefix desktop run build` (`tsc -p tsconfig.json`; Expected: EXIT=0), and eye-verify on a packaged build before the release.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat: say what the desktop app is doing while it starts (§705)`.

### Task 13: Register, CHANGELOG, final gates

**Files:**
- Modify: `docs/open-followups.md` (§704–§712 → CLOSED with date and witness; drop their `**Work item:**` lines), `CHANGELOG.md`, `docs/AGENTS/features.md` (demo entry points now include the dashboard banner and Help) and `docs/AGENTS/integrations.md` (Timelog address field) where they describe the changed behaviour
- Test: gates only

- [ ] **Step 1:** Close each register entry; run `node scripts/rebuild-followup-index.mjs`; run `npm run followups:index:check`, `npm run docs:claims:check`, `npm run docs:symbols:check` — Expected: each EXIT=0.
- [ ] **Step 2:** Add the user-facing CHANGELOG entry under `## [Unreleased]`. Do not bump `version.ts` — the release is the owner's call.
- [ ] **Step 3:** `npx eslint --max-warnings=0 <every changed file>` and `npx tsc --noEmit` — Expected: EXIT=0, 0 errors.
- [ ] **Step 4: Commit** `docs: close the pilot onboarding findings shipped in phase 1 (§704–§712)`. The PR description carries `Closes #693` … `Closes #701` (not #702/#703, which stay open for phases 2 and the follow-up).
