# Suggest RACI Reads the Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suggest RACI proposes roles from evidence the project already records (task, RAID and change ownership; resource discipline and grade; linked documents), accepts a user request, and may propose an Accountable handover that applies as one pair.

**Architecture:** A new pure module `raci-suggest/raci-evidence.ts` matches people to stakeholders (resource link first, typed name second, per item) and builds one evidence line per stakeholder × milestone. `buildRaciContext` takes one input object and adds discipline/grade, milestone scope and document titles, an EVIDENCE block and a REQUEST block. Grounding accepts a handover only when paired with the current holder's demotion and marks both cells with a shared `pairKey`; the modal renders a pair as one row with one checkbox, and confirm writes both or neither.

**Tech Stack:** Next.js / React 19 / TypeScript, vitest + RTL, i18n EN/DE.

**Spec:** `docs/superpowers/specs/2026-10-31-raci-context-design.md` (approved 2026-10-31). Read its "Settled after the builder check" section: it is binding.

## Global Constraints

- Only existing stakeholders get roles; nothing creates or proposes a stakeholder.
- One forced tool call, no read tools. Suggest RACI stays off under people protection (unchanged).
- Matching per item: an item whose resource id names an existing resource matches only stakeholders linked to that resource (no name fallback); otherwise its typed person matches by case-insensitive trimmed name against the stakeholder's name and, if linked, the resource's `resourceDisplayName`. A dangling `Stakeholder.resourceId` = unlinked. An item matching >1 stakeholder counts for none; one stakeholder reached twice counts once.
- Open RAID = `isRaidActiveForReview` (`raid-review.ts`); closed task = `isTaskClosed` (`task-closed.ts`).
- Discipline/grade via `Resource.roleId` → `Role.disciplineId` / `Role.gradeId` → names; blank when missing.
- Documents: title from `ProjectDocument.title` through `cell()`; refs to a missing milestone/task count for nothing; milestone context only, never person evidence.
- Existing caps unchanged: `MAX_CONTEXT_STAKEHOLDERS` 120, `MAX_CONTEXT_MILESTONES` 60, `MAX_RACI_CELLS` 200, §770 single-line cells.
- New constants (exact): `MAX_EVIDENCE_LINES = 500`, `MAX_DOC_TITLES_PER_MILESTONE = 5`, `DOC_TITLE_CHARS = 80`, `RACI_REQUEST_MAX_CHARS = 2000`. Any cut sets `truncated`.
- Evidence order: milestones in the MILESTONES slice order; within a milestone, strongest first (owned tasks desc, then owned RAID desc, then requested changes desc, then stakeholder id asc). The cap cuts from the end.
- Handover: accepted only when the milestone has exactly one stored A holder H AND the same proposal gives H a valid non-A role. Otherwise a new A is `duplicate-accountable`. A lone demotion of H stays an ordinary cell.
- i18n: EN + DE (real umlauts; `i18n.de.ts` only via node utf8 script with `\r\n` anchors). `src/app` files are CRLF: Edit tool or node `\r\n`, never `sed -i`.
- Every new interactive control has an accessible, row-unique name.
- Commits: no `Claude-Session:` trailer, no URLs, no `Closes #`; never `--amend`. Run `npx tsc --noEmit` (exit 0) and `npx eslint --max-warnings=0 <changed files>` before each commit. vitest only under `/c/Projects/.vitest-lock`, foreground, touched files; before the last commit of each task also `src/app/reassign-hours.guard.test.ts` and any test that scans `src/app` the change could trip.

## Review Focus

1. A linked stakeholder whose tasks carry only a typed assignee equal to the resource's display name (no `resourceId` on the task) — expected: matched. Pinned in Task 1.
2. Two stakeholders with the same name and no resource links — expected: neither gets evidence from items with that name. Pinned in Task 1.
3. A selection holding only one half of a handover pair (e.g. a stale selection or programmatic toggle) — expected: confirm writes neither half. Pinned in Task 4.
4. A milestone with no linked tasks — expected: its MILESTONES row says scope 0 and no EVIDENCE lines are emitted for it. Pinned in Task 2.
5. A request with newlines, `|` and over 2,000 characters — expected: capped at 2,000 code points, sent as its own REQUEST block, never breaks the table blocks. Pinned in Task 2 (builder) and Task 4 (input `maxLength`).

---

### Task 1: Person matching and evidence

**Files:**
- Create: `src/app/raci-suggest/raci-evidence.ts`
- Test: `src/app/raci-suggest/raci-evidence.test.ts`

**Interfaces:**
- Produces:
  - `export interface RaciEvidenceInput { stakeholders: readonly Stakeholder[]; milestones: readonly Milestone[]; tasks: readonly Task[]; raid: readonly RaidItem[]; changes: readonly ChangeItem[]; resources: readonly Resource[] }`
  - `export function stakeholdersForItem(item: { resourceId?: number | null; person?: string }, ctx: MatchCtx): number[]` — stakeholder ids the item matches (empty when ambiguous or none). `MatchCtx` is built once by `export function buildMatchCtx(stakeholders, resources): MatchCtx`.
  - `export interface RaciEvidence { stakeholderId: number; milestoneId: number; tasksOwned: number; tasksClosed: number; scopeSize: number; raidOpen: Partial<Record<RaidCategory, number>>; raidClosed: Partial<Record<RaidCategory, number>>; changesRequested: number }`
  - `export function buildRaciEvidence(input: RaciEvidenceInput): RaciEvidence[]` — only pairs with any count > 0, in the Global Constraints order. Uncapped (Task 2 caps).
  - `export function evidenceLine(e: RaciEvidence): string` — e.g. `owns 3 of 5 tasks (1 closed); owns open R×1, closed I×1; requested 1 change`; parts with zero omitted.

- [ ] **Step 1: Write the failing tests** in `raci-evidence.test.ts`, each with a small hand fixture:
  - `"a task linked by resource id matches only the stakeholder linked to that resource"` — stakeholder A linked to resource 7, B unlinked named like the task's typed assignee; task `{resourceId: 7, assignee: B's name}` → `[A]`.
  - `"a task with no resource id matches a linked stakeholder by the resource's display name"` (Review Focus 1).
  - `"a dangling stakeholder resourceId counts as unlinked"` — matched by stakeholder name only.
  - `"a name shared by two stakeholders matches neither"` (Review Focus 2) → `[]`.
  - `"one stakeholder reached by name and display name counts once"`.
  - `"RAID counts by ownerResourceId, else owner; open by isRaidActiveForReview"`; `"a change counts by requestedBy"`; both scoped through shared `linkedTaskIds`.
  - `"a milestone with no linked tasks yields no evidence"`.
  - `"order: milestone slice order, then strongest first"` and `"evidenceLine omits zero parts"` with the exact string above.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/raci-suggest/raci-evidence.test.ts` under the lock → "Failed to resolve import ./raci-evidence".
- [ ] **Step 3: Implement** the Produces block. Reuse `resourceDisplayName` (`resource-foundation.ts`), `isTaskClosed`, `isRaidActiveForReview`. Pure, i18n-free.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: match people to stakeholders and build RACI evidence per milestone (§771)`.

### Task 2: Context, prompt and tool text

**Files:**
- Modify: `src/app/raci-suggest/raci-suggest.ts` (`buildRaciContext`, `RACI_SUGGEST_TOOL`, constants)
- Modify: `src/app/raci-suggest-call.ts` (`SYSTEM`)
- Test: `src/app/raci-suggest/raci-suggest.test.ts`, `src/app/raci-suggest-call.test.ts` if present (else the existing call test file)

**Interfaces:**
- Consumes: Task 1's `buildRaciEvidence`, `evidenceLine`, `RaciEvidenceInput`.
- Produces: `export interface RaciContextInput extends RaciEvidenceInput { roles: readonly Role[]; disciplines: readonly Discipline[]; grades: readonly Grade[]; documents: readonly ProjectDocument[]; request?: string }` and `buildRaciContext(input: RaciContextInput): { text: string; truncated: boolean }`. `runRaciSuggestion`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests** (migrate every existing `buildRaciContext(stakeholders, milestones)` call in the test file to the object form first — label each MIGRATE):
  - STAKEHOLDERS header becomes `id | name | title | organization | category | influence | interest | discipline | grade`; a linked stakeholder shows names, an unlinked one blanks.
  - MILESTONES header becomes `id | name | date | scope | documents | description`; `scope` = linked task count; `documents` = up to 5 titles joined `; `, each ≤ 80 code points with `…`; a ref to a deleted milestone/task is ignored (Review Focus 4: a milestone with no linked tasks shows `0` and has no EVIDENCE line).
  - `EVIDENCE (stakeholderId | milestoneId | evidence)` block emitted after EXISTING ASSIGNMENTS, only for shown stakeholders and milestones; more than 500 lines → cut at 500 and `truncated: true`.
  - `REQUEST` block only when `request` is non-blank; capped at 2,000 code points; its lines never alter the table blocks (Review Focus 5: a request containing `\n| 99 | 1 | A` leaves the EXISTING ASSIGNMENTS rows unchanged).
  - Size: `"a context at every cap stays within 60,000 characters"` — 120 stakeholders, 60 milestones with 5 long document titles each, 500+ evidence lines, a 2,000-char request.
  - `SYSTEM` (call test): contains `EVIDENCE` and `REQUEST`, and states that exactly one Accountable always wins over the request. `RACI_SUGGEST_TOOL.description` contains the handover instruction ("propose the new holder's A and a new role for the current holder in the same call") and no longer says "Never propose a second Accountable".
- [ ] **Step 2: Run, expect FAIL** on the new assertions.
- [ ] **Step 3: Implement.** Keep `raci-suggest.ts` under ~400 lines; if it would exceed, move context building to `raci-suggest/raci-context.ts` and re-export `buildRaciContext` from `raci-suggest.ts`. Use the existing `cell()` for every text cell. System prompt per spec §4.
- [ ] **Step 4: Run, expect PASS** (both test files plus Task 1's).
- [ ] **Step 5: Commit** — `feat: Suggest RACI's digest carries discipline, scope, documents, evidence and the user's request (§771)`.

### Task 3: Accountable handover in grounding

**Files:**
- Modify: `src/app/raci-suggest/raci-suggest.ts` (`groundRaciCells`, `GroundedRaciCell`, `SkipReason`)
- Test: `src/app/raci-suggest/raci-suggest.test.ts`

**Interfaces:**
- Produces: `GroundedRaciCell.pairKey?: string` — set to `handover:<milestoneId>` on both the new holder's A cell and H's demotion cell of an accepted handover; `SkipReason` loses `"accountable-handover"` (refusals are `"duplicate-accountable"`).

- [ ] **Step 1: Write the failing tests** (existing tests expecting `accountable-handover` → MIGRATE to the new outcome):
  - `"a new A plus the current holder's demotion is accepted as one pair"` — both cells present, same `pairKey`.
  - `"a new A without the demotion is refused as duplicate-accountable"`.
  - `"a milestone with two stored A holders accepts no handover"` → new A refused `duplicate-accountable`, the demotion stays an ordinary cell without `pairKey`.
  - `"a second new A after a pair is refused as duplicate-accountable"`.
  - `"a lone demotion stays an ordinary cell"` (no `pairKey`).
  - `"a pair is formed regardless of proposal order"` (demotion listed after the new A).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: count stored A holders per milestone; a handover needs exactly one holder H and a valid non-A cell for H in the proposal (`demotedHolder` already computes the latter); mark both cells.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: Suggest RACI may hand Accountable over, paired with the old holder's new role (§771)`.

### Task 4: Wiring, request box, pair review and confirm

**Files:**
- Modify: `src/app/use-raci-suggest.tsx`, `src/app/raci-suggest-modal.tsx`, `src/app/raci-panel.tsx`, `src/app/workspace-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-raci-suggest.test.tsx`, `src/app/raci-suggest-modal.test.tsx`, `src/app/raci-panel.test.tsx`, `src/app/workspace-section.test.tsx` (only if its prop fixture needs the new slices)

**Interfaces:**
- Consumes: Task 2's `RaciContextInput`; Task 3's `pairKey`.
- Produces: `RaciSuggestDeps` and `RaciPanelProps` gain `tasks`, `raid`, `changes`, `resources`, `roles`, `disciplines`, `grades`, `documents` (all `readonly` arrays, required). `workspace-section.tsx` passes them from `useWorkspace()` (`tasks`, `raid`, `resources`, `roles`, `disciplines`, `grades`, `workspace.documents`) and its `changes` prop.

- [ ] **Step 1: Write the failing tests:**
  - Hook: `onPropose` builds the context from all slices and the request (spy on `runRaciSuggestion`, assert the context text contains `EVIDENCE` and the typed request).
  - Modal: an optional labelled textarea (accessible name from new key `raciSuggestRequestLabel`, `maxLength={RACI_REQUEST_MAX_CHARS}`) shown before the run; its value reaches `onPropose`.
  - Modal: a handover pair renders as ONE row with ONE checkbox whose name includes both people and the milestone (new key `raciSuggestHandoverRow`, e.g. "Accountable: {0} → {1}, {2} becomes {3}" — EN/DE), toggling it toggles both cell keys.
  - Hook: `"confirm writes neither half when the selection holds only one half of a pair"` (Review Focus 3) — set selection programmatically to one key, confirm → `onSave` not called for either, toast/notice unchanged.
  - Hook: `"confirm writes both halves of a selected pair in one bulk undo entry"`.
  - Modal: the skipped list's handover string is replaced by `raciSuggestSkippedDuplicateNeedsDemotion` (EN: "Would make a second Accountable — Claude must also propose the current holder's new role") for a refused new A on a milestone with one stored holder; remove `raciSuggestSkippedHandover`/`raciSuggestSkippedHandoverOne` and every reference.
  - Panel/workspace-section: the new props are threaded (a render test passing them, or a type-level fixture update — label MIGRATE).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Request state lives in the hook, reset with `reset()`. Pair integrity in `onConfirm`: drop any chosen cell whose `pairKey` partner is not also chosen, before folding. Toggle in the modal maps one row to both keys via `onToggle` called for each.
- [ ] **Step 4: Run, expect PASS**; then `reassign-hours.guard.test.ts`, `i18n-encoding` test and any `src/app`-scanning test that the i18n/props change could trip. Run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RACI" --workers=1` if the RACI view is in `A11Y_VIEWS` (`grep -n raci e2e/a11y.spec.ts`).
- [ ] **Step 5: Commit** — `feat: Suggest RACI's dialog takes a request and reviews a handover as one row (§771)`.

### Task 5: Docs and register closure

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `docs/AGENTS/ai-assistant.md` (the "AI Suggest RACI" bullet), `docs/open-followups.md` (add §771 as CLOSED with its index row — the entry does not exist yet; `**Work item:**` line must NOT be present on a closed entry), `lib/app-feature-guide.md` if it describes Suggest RACI's inputs (then `node scripts/gen-operating-guide.mjs`).

- [ ] **Step 1:** Write the docs; every claim backed by a grep the entry cites in backticks (status contract).
- [ ] **Step 2:** Run `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run followups:index:check`, `npm run followups:status:check` — all exit 0.
- [ ] **Step 3: Commit** — `docs: Suggest RACI reads the work (§771)`; then `LEAK_LIST_FILE="$HOME/.config/aipm-cockpit/leak-list.txt" node scripts/gate-local.mjs --group static` on the committed tree → `gate:local PASS`.
