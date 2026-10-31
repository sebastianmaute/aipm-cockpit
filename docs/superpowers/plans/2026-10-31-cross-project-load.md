# Plan with AI Sees Load in Other Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In multi-project Turso, Plan with AI and the person's entry know where else a person works and how many Planning-grid hours they are booked for there; name matches need the user's reversible confirmation, stored in a shared `person_links` table.

**Architecture:** Two pure modules (`src/app/cross-project/person-match.ts`, `src/app/cross-project/elsewhere-hours.ts`) decide who matches whom and map other projects' grid hours onto this project's periods. A `person_links` store (chat-threads pattern, outside `TABLE_NAMES`) holds same / not-the-same answers. One hook in `task-manager.tsx`, `useCrossProjectPeople`, loads the other projects on request (sequentially, scope-epoch guarded) and exposes the result plus confirm / reject / undo; it is threaded to Plan with AI (digest, warning, review window) and to the resource edit modal.

**Tech Stack:** Next.js / React 19 / TypeScript, vitest + RTL, Turso (Hrana pipeline), i18n EN/DE.

**Spec:** `docs/superpowers/specs/2026-10-31-cross-project-load-design.md` (approved 2026-10-31). Its "Settled after the builder check" section is binding.

## Global Constraints

- Available only when portfolio mode is Turso with a live `tursoConfig` and more than one project in the list; otherwise nothing loads, Plan with AI's digest says other projects cannot be seen in this storage mode, the entry shows no notice.
- Other projects are loaded with `new TursoBackend(tursoConfig, projectId).load()`, SEQUENTIALLY (as `use-portfolio-health.ts`), the open project excluded. No project data is written; the only data write is to `person_links`.
- "Grid hours" = `Resource.utilization` via `periodCapacityHours` (`resource-capacity.ts`) over that project's `ResourcePlan` periods (`generatePeriods(plan.startDate, plan.endDate, plan.granularity)`), its absences, the app's `workdayHours` and `holidaySet`. A project with no stored plan contributes nothing and is named.
- Mapping onto this project's periods: by overlapping workdays (`workdaysInRange`, holidays and weekends excluded): `hours × overlapWorkdays / otherPeriodWorkdays` (0 when the other period has no workdays).
- Matching order per pair: `different` row → no; `same` row (non-stale) → matched (`via: "confirmed"`); overlapping usable email → matched (`via: "email"`); equal first + last name (case-insensitive, trimmed, non-empty) AND at least one side has no usable email → suggestion; else none. Usable email = trimmed, non-empty, contains "@"; compare case-insensitive over `email` + `emails`. A `different` row overrides an email match. A row is stale (ignored) unless both resources still carry the first + last name stored in it, or it names a project not in the list or a missing resource id.
- Two resources in one other project matching the same person: both count (hours summed). Documented in the module.
- Every resource counts (external and inactive included).
- Tasks hint: per matched person and other project, open tasks (`!isTaskClosed`) owned by `resourceId` match, else typed assignee equal to the resource's `resourceDisplayName`; count + sum of remaining hours (`estimatedHours` minus logged, as §769's digest computes remaining — reuse its helper). No titles.
- `person_links` columns: `project_a TEXT, resource_a INTEGER, project_b TEXT, resource_b INTEGER, verdict TEXT ('same'|'different'), name_a TEXT, name_b TEXT, emails_a TEXT, emails_b TEXT, decided_at TEXT, decided_by TEXT`, PRIMARY KEY (project_a, resource_a, project_b, resource_b); canonical order: `project_a < project_b` (string compare). Kept OUT of `TABLE_NAMES`. DDL runs ahead of each read/write (chat-threads pattern). Bind ints as `{type:"integer"}` only where the column is INTEGER; ids are numbers.
- Over capacity = this project's hours + elsewhere hours > available hours + `OVER_CAPACITY_TOLERANCE_HOURS`.
- Background awaiting reader: capture `getScopeEpoch()` before the first await and drop the result via `isScopeStale` / `dropStaleScopeWrite` (`scope-epoch.ts`); also gate on `loadPending`.
- i18n EN + DE (real umlauts; `i18n.de.ts` only via node utf8 script with `\r\n` anchors). `src/app` files CRLF (Edit tool or node `\r\n`, never `sed -i`).
- Every new control (Confirm, Not the same, Undo) has an accessible, row-unique name; tooltips via `InfoTooltip` (`info-tooltip.tsx`).
- Commits: no `Claude-Session:` trailer, no URLs, no `Closes #`; never `--amend`. `npx tsc --noEmit` exit 0 and `npx eslint --max-warnings=0 <changed files>` before each commit. vitest only under `/c/Projects/.vitest-lock`, foreground, touched files; before each task's last commit also `src/app/reassign-hours.guard.test.ts` and any `src/app`-scanning test the change could trip.

## Review Focus

1. Another project planned monthly while this one is weekly (or the reverse) — expected: hours split by overlapping workdays, totals preserved over the window. Pinned in Task 2.
2. A confirmed `same` row whose resource was renamed or whose id was re-minted for another person — expected: ignored, no hours. Pinned in Task 1.
3. One other project fails to load (or has no plan) — expected: the rest still count; the failing project is named. Pinned in Task 4.
4. The user switches project while other projects are loading — expected: the stale result is dropped, nothing shows for the wrong project. Pinned in Task 4.
5. File / IndexedDB / single-project mode — expected: no load, the digest's ELSEWHERE note says other projects cannot be seen in this storage mode, no entry notice. Pinned in Tasks 5 and 6.

---

### Task 1: Person matching

**Files:**
- Create: `src/app/cross-project/person-match.ts`
- Test: `src/app/cross-project/person-match.test.ts`

**Interfaces:**
- Produces:
  - `export type LinkVerdict = "same" | "different";`
  - `export interface PersonLinkRow { projectA: string; resourceA: number; projectB: string; resourceB: number; verdict: LinkVerdict; nameA: string; nameB: string; emailsA: string; emailsB: string; decidedAt: string; decidedBy: string }`
  - `export interface OtherProjectPeople { projectId: string; projectName: string; resources: readonly Resource[] }`
  - `export interface PersonRelation { projectId: string; projectName: string; resourceId: number; via: "email" | "confirmed" }`
  - `export interface PersonMatch { matched: PersonRelation[]; suggestions: Omit<PersonRelation, "via">[]; rejected: Omit<PersonRelation, "via">[] }`
  - `export function usableEmails(r: Resource): string[]` (lower-cased, trimmed, contains "@")
  - `export function canonicalPair(projectA: string, resourceA: number, projectB: string, resourceB: number): { projectA: string; resourceA: number; projectB: string; resourceB: number }`
  - `export function matchPeople(hereProjectId: string, here: readonly Resource[], others: readonly OtherProjectPeople[], links: readonly PersonLinkRow[]): Map<number, PersonMatch>` (keyed by this project's resource id; every here-resource present, possibly empty)

- [ ] **Step 1: Write the failing tests** (`person-match.test.ts`):
  - `"the same email matches automatically, across email and emails, case-insensitive"`
  - `"a different row overrides an email match"` → in `rejected`, not `matched`
  - `"equal names with no usable email on one side is a suggestion, not a match"`
  - `"two usable emails that differ give no suggestion even with equal names"`
  - `"a confirmed same row matches by name"` → `via: "confirmed"`
  - `"a same row is ignored once either resource's first+last name changed"` (Review Focus 2) → falls back to the remaining rules (here: a suggestion)
  - `"a row naming a project not in the list or a missing resource id is ignored"`
  - `"an email without @ is not usable"`
  - `"two resources in one other project both match"` → two relations
  - `"canonicalPair orders by project id"` and `matchPeople` finds a row stored in either order
- [ ] **Step 2: Run, expect FAIL** (`Failed to resolve import`).
- [ ] **Step 3: Implement.** Pure, i18n-free; use `resourceDisplayName` for the stored name compare (first + last, trimmed).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: match a person across projects by email, or by name once confirmed (§785)`.

### Task 2: Elsewhere hours and tasks hint

**Files:**
- Create: `src/app/cross-project/elsewhere-hours.ts`
- Test: `src/app/cross-project/elsewhere-hours.test.ts`

**Interfaces:**
- Consumes: Task 1's `PersonRelation`.
- Produces:
  - `export interface OtherProjectData { projectId: string; projectName: string; plan: ResourcePlan | null; resources: readonly Resource[]; absences: readonly Absence[]; tasks: readonly Task[] }`
  - `export interface ElsewhereFigure { projectId: string; projectName: string; hoursByPeriod: Record<string, number>; openTasks: number; remainingHours: number; noPlan: boolean }`
  - `export function elsewhereFor(relations: readonly PersonRelation[], others: readonly OtherProjectData[], herePeriods: readonly Period[], workdayHours: number, holidaySet: ReadonlySet<string>): ElsewhereFigure[]` — one figure per other project that has at least one relation; hours rounded to 2 decimals.
  - `export function elsewhereTotal(figures: readonly ElsewhereFigure[], periodKey: string): number`

- [ ] **Step 1: Write the failing tests:**
  - `"a weekly here and a monthly elsewhere split by overlapping workdays"` (Review Focus 1): elsewhere 40 h in a month with 20 workdays; a here-week fully inside it with 5 workdays gets 10; a week straddling two months gets the sum of both shares; the window total equals the overlapping part of the month's hours.
  - `"percent mode elsewhere uses that project's capacity"` (50 % of an 8 h × 5-day week, no absences → 20 h).
  - `"absences in the other project reduce its planned hours"` (periodCapacityHours behaviour).
  - `"a project with no plan contributes zero hours and is flagged noPlan"`.
  - `"two matched resources in one project sum"`.
  - `"tasks hint counts open owned tasks and their remaining hours, never closed ones, by resourceId else display name"`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with `generatePeriods`, `periodCapacityHours`, `absencesForResource`, `workdaysInRange`; reuse §769's remaining-hours helper (grep `alloc-plan/` for it).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: map a person's grid hours in other projects onto this plan's periods (§785)`.

### Task 3: The `person_links` store

**Files:**
- Create: `src/app/person-links-schema.ts`, `src/app/person-links-store.ts`
- Test: `src/app/person-links-store.test.ts`

**Interfaces:**
- Consumes: Task 1's `PersonLinkRow`, `canonicalPair`.
- Produces:
  - `export const PERSON_LINKS_DDL: string[]`
  - `export async function loadPersonLinks(config: TursoConfig | null): Promise<PersonLinkRow[]>` (empty for null config)
  - `export async function savePersonLink(config: TursoConfig | null, row: PersonLinkRow): Promise<void>` (INSERT OR REPLACE, canonical order enforced inside)
  - `export async function deletePersonLink(config: TursoConfig | null, pair: { projectA: string; resourceA: number; projectB: string; resourceB: number }): Promise<void>`
  - pure statement builders the tests can execute: `selectPersonLinks(): SqlStmt[]`, `upsertPersonLinkStatements(row): SqlStmt[]`, `deletePersonLinkStatements(pair): SqlStmt[]`, `rowsToPersonLinks(result): PersonLinkRow[]`

- [ ] **Step 1: Write the failing tests:** `"person_links is NOT in TABLE_NAMES"`; the DDL creates the table with the Global-Constraints columns; statements run against `node:sqlite` (copy the harness from `turso-schema.execute.test.ts`): upsert then select round-trips a row; an upsert given the pair in reverse order lands in canonical order and replaces the existing row; delete removes it; ids bound as integers read back as numbers.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** following `chat-threads-schema.ts` / `chat-threads-store.ts` (`runTursoPipeline`, DDL ahead of each call).
- [ ] **Step 4: Run, expect PASS**, plus `turso-schema.test.ts`.
- [ ] **Step 5: Commit** — `feat: store same / not-the-same person answers beside the projects (§785)`.

### Task 4: The loader hook

**Files:**
- Create: `src/app/use-cross-project-people.ts`
- Modify: `src/app/task-manager.tsx` (call it once), `vitest.config.ts` only if the hook is pure glue (it is not: test it)
- Test: `src/app/use-cross-project-people.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `export type CrossProjectStatus = "unavailable" | "idle" | "loading" | "ready";`
  - `export interface CrossProjectPeople { status: CrossProjectStatus; failures: { projectId: string; projectName: string }[]; matches: Map<number, PersonMatch>; elsewhere: (resourceId: number) => ElsewhereFigure[]; request: () => void; confirm(hereResourceId: number, rel: Omit<PersonRelation, "via">): Promise<void>; reject(hereResourceId: number, rel: Omit<PersonRelation, "via">): Promise<void>; undo(hereResourceId: number, rel: Omit<PersonRelation, "via">): Promise<void> }`
  - `export function useCrossProjectPeople(deps: { tursoConfig: TursoConfig | null; portfolioMode: PortfolioMode; projects: readonly { id: string; name: string }[]; currentProjectId: string | null; resources: readonly Resource[]; plan: ResourcePlan; workdayHours: number; holidaySet: ReadonlySet<string>; loadPending: boolean; getScopeEpoch: () => number; actorLabel?: string; load?: (config: TursoConfig, projectId: string) => Promise<Workspace> }): CrossProjectPeople` — `load` defaults to `new TursoBackend(config, id).load()` and is the test seam.
- `status` is `"unavailable"` unless Turso portfolio mode, config present and >1 project. `request()` starts a fresh load (never cached across requests); while loading, a second `request()` is ignored. Confirm/reject/undo write the store, then recompute matches from the loaded data without reloading projects.

- [ ] **Step 1: Write the failing tests** (`renderHook`, injected `load`):
  - `"unavailable outside Turso portfolio mode, and request loads nothing"` (Review Focus 5)
  - `"request loads every other project sequentially, never the open one"` (assert call order and that calls do not overlap)
  - `"a project that fails to load is skipped and named in failures; the rest still count"` (Review Focus 3)
  - `"a project switch mid-load drops the result"` (Review Focus 4: bump the scope epoch during the second load → status returns to idle, no matches)
  - `"confirm writes a same row and the suggestion becomes a confirmed match without reloading projects"`; `"reject writes a different row"`; `"undo deletes the row"` (mock the store module)
  - `"does not start while loadPending"`
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, and call it once in `task-manager.tsx` with `tursoConfig`, `portfolioMode`, `tursoProjects` (id, name), `tursoProjectId`, the live resources/plan, `settings.resources.workdayHours`, `holidaySet`, `loadPending`, `getScopeEpoch`. Pass the result down in Task 5/6.
- [ ] **Step 4: Run, expect PASS** (+ guard tests).
- [ ] **Step 5: Commit** — `feat: load a person's other projects on request, scope-guarded (§785)`.

### Task 5: Plan with AI

**Files:**
- Modify: `src/app/alloc-plan/alloc-plan.ts` (`AllocContextArgs`, `buildAllocContext`, `buildAllocSystemPrompt`), `src/app/alloc-plan/alloc-effect.ts` (`alternativeEffect`, `OverCapacity`), `src/app/use-alloc-plan.tsx` (`AllocPlanDeps`), `src/app/alloc-plan-modal.tsx`, `src/app/resources-panel.tsx`, `src/app/workspace-section.tsx` (+ its types), `src/app/task-manager.tsx` (thread `crossProject`), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `alloc-plan.test.ts`, `alloc-effect.test.ts` (or where `alternativeEffect` is tested), `use-alloc-plan.test.tsx`, `alloc-plan-modal.test.tsx`

**Interfaces:**
- Consumes: Task 4's `CrossProjectPeople`; Task 2's `elsewhereTotal`.
- Produces: `AllocContextArgs.elsewhere?: { status: CrossProjectStatus; figuresFor: (resourceId: number) => ElsewhereFigure[]; failures: { projectName: string }[] }`; `alternativeEffect` ctx gains `elsewhereHours?: (resourceId: number, periodKey: string) => number`; `OverCapacity.elsewhereHours: number`. `AllocPlanDeps.crossProject?: CrossProjectPeople`.

- [ ] **Step 1: Write the failing tests:**
  - Digest: per person with figures, a line `ELSEWHERE <project>: <periodKey>=<h>… · open tasks <n> (<h> h left)`; a no-plan project says `no plan`; failures listed as `could not be read: <names>`; status `unavailable` → one line `ELSEWHERE: other projects cannot be seen in this storage mode` (Review Focus 5); status `ready` with no figures → nothing per person. Only shown periods appear.
  - System prompt says elsewhere hours are booked time the proposal must respect and cannot change.
  - `alternativeEffect`: a value under capacity alone but over with elsewhere hours is flagged, with `elsewhereHours` filled; without the ctx function behaviour is unchanged (existing tests stay green).
  - Hook: `onOpen` calls `crossProject.request()`; Run waits while status is `loading` (the run button shows a loading label and is disabled), then sends a digest containing ELSEWHERE.
  - Modal: the over-capacity row shows the elsewhere hours with an `InfoTooltip` (new keys `allocElsewhereLabel`, `allocElsewhereTip` EN/DE); an unconfirmed suggestion for a person in the proposal shows Confirm / Not the same buttons with row-unique names (`allocElsewhereConfirm`, `allocElsewhereReject`, each naming person + project); clicking Confirm calls `crossProject.confirm` with the right relation.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Thread `crossProject` task-manager → workspace-section → resources-panel → `useAllocPlan` (resources-panel is memo'd: add the object to its props without reading context; if its function props go through `useStableHandlers`, follow that). Keep the digest within its existing caps (shown periods only).
- [ ] **Step 4: Run, expect PASS** + guard tests + `i18n-plural.test.ts` (`--testTimeout=60000`) + `i18n-encoding*.test.ts` + `resources-panel` / `workspace-section` tests touched by the new prop.
- [ ] **Step 5: Commit** — `feat: Plan with AI counts and shows a person's hours in other projects (§785)`.

### Task 6: The person's entry and help

**Files:**
- Modify: `src/app/resource-edit-modal.tsx`, `src/app/app-modals.tsx` (+ its props source), `src/app/task-manager.tsx` (thread), `src/app/help-content.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `resource-edit-modal.test.tsx`, `help-content` tests (the entry count test: `grep -c "^  { id: " src/app/help-content.ts`)

**Interfaces:**
- Consumes: Task 4's `CrossProjectPeople`.
- Produces: `ResourceEditModal` prop `crossProject?: CrossProjectPeople` (absent → nothing shown).

- [ ] **Step 1: Write the failing tests:**
  - Opening an existing resource calls `crossProject.request()`; a loading line shows while `loading`.
  - Matched projects render "Works in project <name>" (`resourceWorksInProject`), a confirmed one with an Undo button (`resourceLinkUndo`, row-unique name with project).
  - Suggestions render with Confirm / Not the same (`resourceLinkConfirm`, `resourceLinkReject`), calling `confirm` / `reject`.
  - Rejected pairs render "Not the same as <name> in <project>" (`resourceLinkRejected`) with Undo calling `undo`.
  - An `InfoTooltip` (`resourceLinksTip`) beside the section explains the rule.
  - New resource (`isNew`) or status `unavailable` → no section, no request (Review Focus 5).
  - `expectRowUniqueNames` over two suggestions in two projects.
  - Help: a new `features` entry `feature-cross-project-people` (EN/DE title + body: people are separate entries per project; linked by email automatically, by name only after confirmation; "not the same" is remembered; both reversible from the person's entry; other projects only read; only in multi-project Turso). Update the entry-count assertion.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**; DE strings via node utf8 script.
- [ ] **Step 4: Run, expect PASS** + guard tests + i18n tests + help tests.
- [ ] **Step 5: Commit** — `feat: the person's entry shows where else they work and takes confirmations (§785)`.

### Task 7: Docs and register closure

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `docs/AGENTS/ai-assistant.md` (Plan with AI / allocation section), `docs/AGENTS/storage.md` or wherever out-of-`TABLE_NAMES` tables are listed (grep `chat_threads` in `docs/AGENTS`), `docs/open-followups.md` (§785 → CLOSED: Status line starts with CLOSED, date, cites executed commands in backticks; REMOVE the `**Work item:**` line; update the index row), `lib/app-feature-guide.md` if it describes what Plan with AI sees (then `node scripts/gen-operating-guide.mjs`).

- [ ] **Step 1:** Write the docs; every claim checked against the code.
- [ ] **Step 2:** `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run followups:index:check`, `npm run followups:status:check`, `npm run followups:workitems:check` — all exit 0.
- [ ] **Step 3: Commit** — `docs: Plan with AI sees a person's load in other projects (§785)`; then `LEAK_LIST_FILE="$HOME/.config/aipm-cockpit/leak-list.txt" node scripts/gate-local.mjs --group static` → `gate:local PASS`.
