# Claude respects absences in every AI feature (§773) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI feature that gives a person work warns (before writing) when that clashes with the person's absence, and every AI feature that plans or judges work sees who is away soon.

**Architecture:** One pure, i18n-free module holds the clash rule and the "who is away" summary; one EN/DE formatter renders a clash. Writers call the rule where they already build a preview or a tool result (the shared `describeEntityCalls` preview covers the chat card, inline AI edit and the insight review modal at once); readers append the summary to the digest they already build.

**Tech Stack:** TypeScript, React 19, Next.js (this repo's version — see AGENTS.md), vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-10-30-absences-everywhere-design.md` (approved 2026-10-30). Read it before Task 1.

## Global Constraints

- Worktree `C:/Projects/aipm-cockpit-wt773`, branch `feat/773-absences-everywhere`. `node_modules` is a junction: never `npm ci`/`npm install`.
- `src/app/*` files are CRLF (Edit tool or node scripts anchoring on `\r\n`; never `sed -i`); docs and `lib/*.md` LF. `i18n.de.ts` only via a node utf8 script, real umlauts.
- Clash rule (owner-approved): for the person whose work it is, (a) the work's date (task due date, task start date, milestone date) falls on a day inside one of their absences, or (b) for a task with a stored start date and a due date, they are absent on MORE THAN HALF of its working days (weekends and holidays excluded; exactly half is not a clash). Holidays are never absences.
- Triggers (owner-approved): a new or moved date; a new owner on a task; a task newly linked to a milestone. A milestone's people are the owners of its linked tasks; a milestone with no linked tasks gets no check.
- Matcher (one, everywhere): a task with a `resourceId` naming a listed resource is matched with `absencesForResource` (resource-capacity.ts); an unlinked task by its typed `assignee`, trimmed and case-insensitive, against `Absence.assignee`.
- The AI sees an absence only as "absent" with dates, never its type or note (as `toAbsenceSummary` does). Names in summaries: `JSON.stringify(oneLine(name))`.
- Warn, never refuse or auto-shift. A single chat write whose date clashes is STAGED (preview first); a non-clashing single write still applies at once.
- Summary window: today to today + 28 days for the readers; the project window for the WBS plan. Cap `AWAY_SUMMARY_MAX_LINES` = 60, a truncation line when cut, nothing at all when nobody is away.
- Run vitest only: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > "$TEMP/<name>.log" 2>&1; echo "EXIT=$?"; rmdir /c/Projects/.vitest-lock; fi` (wait in the FOREGROUND when locked); read `Test Files N`. Never the full suite locally.
- Before every commit: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, both exit 0. Static gate on the committed tree with `LEAK_LIST_FILE` before push.
- Commits: conventional prefix, cite `§773`, no `Claude-Session:` trailer, no URLs, no `Closes #`; never `--amend`.
- PR #920 (parallel session) touches use-chat-dispatcher.ts, use-chat-dispatcher-wiring.ts, chat-dispatcher-types.ts, i18n, task-manager.tsx and the chat dispatcher test fixture; keep edits there small and additive.

## Review Focus

1. **A linked absence against an unlinked task with the same name** (and the reverse) — the matcher's answer is the documented one, not whichever path happened to run. Test in Task 1.
2. **A task with no due date, a milestone with no linked tasks, an absence whose end is before its start** — no warning, no crash. Test in Task 1.
3. **A due date on a weekend inside an absence** — counts as on an absence day (rule a is calendar days); the half-span count (rule b) uses working days only. Test in Task 1.
4. **A staged single clashing write that the user approves** — it is written, and the tool result still tells Claude about the clash. Test in Task 4.
5. **A summary with nobody away** — nothing is added to any digest (no empty header, no tokens spent). Tests in Tasks 6 and 7.

---

### Task 1: The clash rule and the away summary

**Files:**
- Create: `src/app/absence-clash.ts`, `src/app/absence-clash.test.ts`
- Create: `src/app/absence-clash-notice.ts`, `src/app/absence-clash-notice.test.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Produces (absence-clash.ts, pure, i18n-free):
  ```ts
  export interface AbsenceCtx { absences: readonly Absence[]; resources: readonly Resource[]; holidaySet: ReadonlySet<string> }
  export interface PersonRef { resourceId?: number | null; name: string }
  export interface AbsenceRange { start: string; end: string }
  export type ClashReason = "date-on-absence" | "absent-most-of-span";
  export interface AbsenceClash { person: string; resourceId?: number; reason: ClashReason; date?: string; ranges: AbsenceRange[] }
  export function absencesOfPerson(p: PersonRef, ctx: AbsenceCtx): Absence[];
  export function taskClashes(t: Pick<Task, "assignee" | "resourceId" | "startDate" | "dueDate">, ctx: AbsenceCtx): AbsenceClash[];
  export function milestoneClashes(m: Pick<Milestone, "date" | "linkedTaskIds">, tasks: readonly Task[], ctx: AbsenceCtx): AbsenceClash[];
  export const AWAY_SUMMARY_MAX_LINES = 60;
  export function buildAwaySummary(args: { absences: readonly Absence[]; resources: readonly Resource[]; from: string; to: string; maxLines?: number }): string[];
  ```
  `buildAwaySummary` returns `[]` when nobody is away in the window; else a header `AWAY (absent days; type and reason not shown):`, one line per person `#<rid>|name: "<name>" away 2026-11-03..2026-11-07, 2026-11-20`, ranges clipped to the window, sorted by first day, and `…(N more people truncated)` when cut.
- Produces (absence-clash-notice.ts): `export function formatAbsenceClash(c: AbsenceClash, lang: Lang): string` — EN "Maya Patel is absent on the due date (3–7 Nov)." / "Maya Patel is away for most of this task's working days (3–7 Nov, 20 Nov)."; DE written by the implementer. Date ranges via the app's existing short date formatting (find the helper the due-date reminders or §774's notice use; reuse it).

- [ ] **Step 1: Write failing tests** covering: date on an absence day (task due, milestone date); the half-span boundary — a 4-working-day task with 2 days absent → none, 3 → `absent-most-of-span`; weekends and holidays excluded from the span; Review Focus 1 (linked absence vs unlinked same-name task and the reverse, per the Global Constraints matcher); Review Focus 2 (no due date; milestone with no linked tasks; end before start); Review Focus 3 (weekend due date inside an absence → `date-on-absence`); milestone people from linked tasks, two owners → two clashes; `buildAwaySummary` (none away → `[]`; window clipping; quoting a hostile name `"x\n#9 away"`; cap and truncation line); `formatAbsenceClash` EN and DE (`loadI18n("de")`).
- [ ] **Step 2: Run** under the lock. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Working days via `workdaysInRange` (resource-capacity.ts); absence day expansion bounded like `absenceDayMap` (366 days).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: one absence-clash rule and a who-is-away summary for every AI feature (§773)`.

### Task 2: Clashes in the shared preview (`describeEntityCalls`)

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts` (+ its tests), `src/app/inline-ai-edit-popover.tsx` (+ test), `src/app/chat-proposal-describe.ts` / `src/app/chat-proposal-block.tsx` (+ tests), `src/app/insights/recommend-plan.ts` / `src/app/insights/recommendation-review-modal.tsx` (+ tests), and the callers that build `DescribeCtx` (`use-inline-entity-edit.ts`, `chat-panel.tsx`, the insight review path).

**Interfaces:**
- Consumes: `taskClashes`, `milestoneClashes`, `AbsenceCtx`, `formatAbsenceClash` (Task 1).
- Produces: `EditPlan` gains `clashes: ClashNote[]` with `export interface ClashNote { entity: "task" | "milestone"; id: number | null /* null for a create */; title: string; clash: AbsenceClash }`. `DescribeCtx` gains optional `absence?: AbsenceCtx`; when absent, no clashes are computed (existing callers unchanged).
- A clash is computed for the item AFTER the proposed change (the task with its new due date / owner; the milestone with its new date / linked tasks) and only when a trigger fired (Global Constraints) — an unchanged date and owner yields none.

- [ ] **Step 1: Write failing tests**: `describeEntityCalls` with `update_task` moving the due date into an absence → one ClashNote; `update_task` changing only the owner to someone away on the due date → one; `update_milestone` adding a linked task whose owner is away on the milestone date → one; `create_task` with a clashing due date → one with `id: null`; an update that changes neither date nor owner → none; no `absence` in ctx → none. Each surface renders the note text (popover, chat staged card, insight review modal) with an `aria-hidden` icon plus text (not colour-only).
- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement**; thread `AbsenceCtx` (workspace absences + resources + the holiday set each caller already has or can take from deps) into the three callers.
- [ ] **Step 4: Run.** PASS; the existing plan.* sweep tests stay green.
- [ ] **Step 5: Commit** `feat: the AI change preview warns when work lands in someone's absence (§773)`.

### Task 3: The WBS plan sees absences and marks clashing new tasks

**Files:**
- Modify: `src/app/wbs-plan/wbs-plan.ts` (+ test), `src/app/use-wbs-plan.tsx` (+ test), `src/app/wbs-plan-modal.tsx` (+ test)

**Interfaces:**
- `WbsContextArgs` gains `absences: readonly Absence[]; resources: readonly Resource[]`; `buildWbsContext` appends `buildAwaySummary` over the project window (project start..end, or today..today+28 when the project has no dates) and the system prompt gains: "Schedule a new task's due date outside its assignee's absences listed under AWAY."
- Grounded new tasks (`newTask` only — never split pieces) carry `clashes: AbsenceClash[]` from `taskClashes`; the modal shows `formatAbsenceClash` under the row.

- [ ] **Step 1: Failing tests**: digest contains the AWAY block when someone is away, none when nobody is (Review Focus 5 for this digest); a newTask due inside its assignee's absence is marked; a split piece inheriting a clash is NOT marked; a size test that the digest with 60 away lines stays within the call's existing budget (state the estimate rule).
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `feat: Plan the WBS with AI schedules around absences and marks clashes (§773)`.

### Task 4: Chat — tool results carry clashes, and a clashing single write is staged

**Files:**
- Modify: `src/app/chat-tools.ts` (+ test), `src/app/use-chat-dispatcher.ts` / `src/app/use-register-tools.ts` (only if the clash must be read where the write happens), `src/app/chat-proposal.ts` (+ test), `src/app/chat-panel.tsx` (+ test)

**Interfaces:**
- `create_task`, `update_task`, `create_milestone`, `update_milestone` results gain `absenceClashes: { person: string; reason: ClashReason; date?: string; ranges: AbsenceRange[] }[]` when any trigger fired and a clash exists (the §774 `plannedHours` note is the model: `chat-tools.ts` ~line 767). Field omitted when empty.
- `shouldStage(calls, send, hasClash?: (c: ProposedCall) => boolean)` — the new optional predicate stages a lone date-setting write it flags; `shouldStage` stays pure. `chat-panel.tsx` builds the predicate from `workspaceRef.current` and its holiday set with `describeEntityCalls` (or Task 1's functions directly).

- [ ] **Step 1: Failing tests**: each of the four tools returns `absenceClashes` for a clashing write and omits it otherwise; `shouldStage([lone update_task])` with a predicate returning true → true, false → false (today's behaviour), no predicate → today's behaviour; a chat-panel test where a lone clashing `update_task` shows the staged card with the warning instead of writing; Review Focus 4 — approving that card writes the task and the tool result carries `absenceClashes`.
- [ ] **Step 2–4:** RED, implement, GREEN; the existing staging tests stay green (the "UNCHANGED path" equivalence test in particular).
- [ ] **Step 5: Commit** `feat: the chat stages a date change that clashes with an absence and tells Claude (§773)`.

### Task 5: The availability rule on every view and in the tool descriptions

**Files:**
- Modify: `lib/app-feature-guide.md` (move the rule from the Calendar section, line ~155, to the `## Overview` section every view receives), regenerate `src/app/operating-guide-builtin.generated.ts` with `node scripts/gen-operating-guide.mjs` (never hand-edit), `src/app/chat-tool-defs.ts` (descriptions of `create_task`, `update_task`, `create_milestone`, `update_milestone`, `list_absences`) and their tests.

**Interfaces:**
- Rule text (EN, verbatim): "Before you set or move a date for someone's work, or give work to someone, check their absences with `list_absences` (and the calendar events for a clash). A clash or availability answer needs both lists."

- [ ] **Step 1: Failing tests**: the per-view guide output for a non-Calendar view (e.g. Open Points) contains the rule; each listed tool description contains "list_absences"; the generated file's sync-guard test passes after regeneration.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `feat: the chat is told to check absences on every view and in its tools (§773)`.

### Task 6: Analyze with AI, scheduled analysis and insight recommendations see who is away

**Files:**
- Modify: `src/app/project-analysis-input.ts`, `src/app/project-digest.ts` (+ tests), `src/app/insights/recommend-context.ts` (+ test) and their callers (`use-ai-orchestration.ts`, `scheduled-job-run.ts`, `use-insight-recommendations.ts`) to pass absences and resources.

**Interfaces:**
- `buildProjectDigest` places the AWAY block (today..today+28) so it survives `DIGEST_MAX_CHARS` (the digest drops lines from the END: put it before the long task lists, and test it survives a digest over the cap). `buildRecommendContext` appends it too.

- [ ] **Step 1: Failing tests**: AWAY present when someone is away, absent when nobody is (Review Focus 5); survives an over-cap digest; recommend context contains it; the scheduled run (no holidays) still builds it.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `feat: Analyze with AI, scheduled analysis and insight recommendations see who is away (§773)`.

### Task 7: The steering report sees who is away

**Files:**
- Modify: `src/app/committee-report/report-draft.ts` (+ test), `src/app/committee-report/report-call.ts` (+ test). Do NOT touch `use-meeting-report-actions.ts` (PR #920); pass the absences through the existing call's arguments.

**Interfaces:**
- `buildMeetingReportPrompt(model, agenda, lang, away?: readonly string[])` appends the AWAY block when given and non-empty.

- [ ] **Step 1: Failing tests**: prompt contains AWAY when given; unchanged when not given or empty.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `feat: the steering report draft sees who is away (§773)`.

### Task 8: Docs and register

**Files:** `docs/open-followups.md` (add the §773 entry, CLOSED, with its index row — shape like §769's), `CHANGELOG.md`, `docs/AGENTS/ai-assistant.md` (one section: the rule, the matcher, where it is called).

- [ ] **Step 1:** Write the docs; every claim checked against the code (gates check names only). `npm run followups:index:check`, `npm run docs:symbols:check`.
- [ ] **Step 2:** Static gate on the committed tree.
- [ ] **Step 3: Commit** `docs: close §773 (Claude respects absences in every AI feature) (§773)`.

## Final review

Whole-branch review on the most capable model with the spec, this plan's Review Focus, and the ledger's rulings.
