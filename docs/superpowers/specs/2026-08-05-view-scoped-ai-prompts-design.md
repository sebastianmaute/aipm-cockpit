# View-scoped AI prompts — design

**Date:** 2026-08-05
**Status:** approved, not yet planned
**Baseline:** 0.215.0 "Friedman"

## Problem

The AI assistant is view-blind in every way that matters, and the gap is three-layered.

**Suggested prompts.** `ASK_CLAUDE_PROMPTS` (`ask-claude-prompts.ts`) carries a tailored set for
**14 of the 34 `AppView`s**. The other 20 fall through to the four `FOUNDATIONAL_PROMPTS`. Sub-tabs
are hit hardest: `resources` has prompts, but `workload` / `planning` / `calendar` / `directory` are
their own views and get nothing, as do the three report sub-views and `raci`.

**System prompt.** `buildSystemPrompt` (`chat-api.ts`) mentions the view exactly once, as an
interpolated `Current view:` line inside the volatile suffix. `selectActiveGuides` does scope by
view, but the `OperatingGuide`s it filters are **user-authored** in Settings — the app ships none, so
out of the box there is no view-scoped guidance at all.

**Inline AI edit.** `INLINE_DESCRIPTORS` (`inline-ai-edit/entity-descriptor.ts`) is properly scoped,
but per **entity** (task · raid · change · milestone · stakeholder), not per window.

Consequence: on a view like Workload the model answers about the whole project rather than the
surface in front of the user, and on several views it could not answer specifically even if it tried,
because no tool reads that data.

## Decisions

| Question | Decision |
|---|---|
| Scope | Both the mechanism and the surface — view-scoped prompt *and* chips |
| Driver | Generic answers are the real problem; blank entry points are the visible symptom |
| Coverage | Purpose line for **all 34** views; chips for **26**; none for **8** |
| Mechanism | Model is **told where to look** everywhere, and **handed what's on screen** for 4 views |
| Architecture | Separate `view-ai-scope` module — *not* folded into the user-guide store |
| Discoverability | Read-only disclosure in Settings → AI |
| Read-tool gaps | Ship 3 workspace-resident tools; defer timelog + activity |

### Why a separate module rather than built-in `OperatingGuide`s

Reusing the guide engine is a smaller diff — scoping, assembly, char-count and the view filter all
exist. It was rejected on one property: `settings.ai.groundInGuides` gates the entire guide block, so
built-in guides would let a **user customization toggle switch off shipped product behavior**, with
no visible symptom. Same class as a `disabled` prop that styles nothing.

Two invariants follow, and both are load-bearing:

1. **View scope is not gated by `groundInGuides`.** That toggle governs user guides only.
2. **View scope is outside `GUIDE_CHAR_BUDGET`.** That budget warns the user their *own* guides are
   too long; counting built-in text into it makes the app blame the user for text they did not write.

## Architecture

### New modules

**`view-ai-scope.ts`** — pure, i18n-free, English-only. The registry:

```ts
interface ViewScope {
  purpose: string;        // "Workload shows capacity vs allocation per resource."
  toolHints?: string[];   // ["list_resources", "list_allocations"]
  reading?: string;       // "overload = allocated > capacity"
}
export const VIEW_AI_SCOPE: Record<AppView, ViewScope>;
```

Total by type, so adding an `AppView` is a typecheck error until it is described. No React, no DOM,
no i18n.

**`view-ai-digest.ts`** — pure. `Partial<Record<AppView, DigestFn>>`, deliberately partial. Only the
four views where the screen *is* the question: `workload` · `gantt` · `budget` · `open-points`. Each
returns a short text block from the workspace slice plus effective filters.

**`view-ai-scope-block.ts`** — pure. Formats registry entry + optional digest into prompt strings.
Split from the registry so the registry stays data and the formatting stays independently testable.

**`settings-sections/ai-view-scope-disclosure.tsx`** — read-only Settings surface. Its own file
because `ai-section.tsx` has almost no headroom (see Constraints).

### Changed

**`chat-api.ts` `buildSystemPrompt`** — **no signature change.** Its `snapshot` argument already
carries `currentView`, and the digest arrives on the same snapshot, so both new blocks derive from
what the function is already given. This matters: the call site is in `chat-panel.tsx`, which is
size-locked.

**`ask-claude-prompts.ts`** — `ASK_CLAUDE_PROMPTS` extended toward 26 views. No structural change; it
already holds `TranslationKey`s only.

**`use-chat-dispatcher.ts` `getSnapshot()`** — returns `viewDigest?: string`. Computed internally
from what the dispatcher already holds: `useWorkspace()` for `effectiveFilters` and entity lists, and
the existing `getBudgetRollup` / `getAllocationsSnapshot` ref getters. **No new dispatcher argument**,
therefore no change to `task-manager.tsx`, which is size-locked.

`viewDigest` is optional so `inline-ai-edit-call.ts` — the other `buildSystemPrompt` caller — never
sets it and is behaviorally unchanged.

### Prompt block order

```
── cached prefix (cache_control: ephemeral) ──
  stableInstructions                     unchanged
  VIEW SCOPE — purpose + toolHints + reading      NEW
  guideBlock                             user guides, unchanged
── volatile suffix ───────────────────────────
  today / language / storage / counts / groups / labels
  APP CONTEXT (mode, modules, current view)
  VIEW STATE — digest                             NEW, 4 views only
  insightsBlock
```

**The digest must stay in the volatile suffix.** It is per-message filtered state; in the cached
prefix it would invalidate on every filter change rather than only on view switches.

Per-view content in the cached prefix is *not* new — `guideBlock` is already view-filtered and
already inside the `cache_control` block. Built-ins generalize that cost from users-with-guides to
all users.

### Precedence

Stated in the prompt text so the model can act on it: **view scope describes what the surface is;
user guides describe how the user wants to work. On conflict the user guide wins.** This is the
inverse of the existing guide-vs-guide rule ("earlier wins; later guides refine but do not override
unless explicit"), so it must be said explicitly — a reader will otherwise assume the existing rule
extends.

### Inline AI edit

Receives purpose + hints (one line, keeps it oriented). Never the digest — it already receives the
entity's stored content, and a digest would restate it.

## Prerequisite: split `use-chat-dispatcher.ts`

**Lands as a separate refactor-only commit, before the feature work. No version bump.**

Every AI-adjacent file is at its ceiling. Measured 2026-08-05 — reproduce with
`wc -l src/app/use-chat-dispatcher.ts src/app/task-manager.tsx src/app/chat-panel.tsx src/app/ai-section.tsx src/app/chat-api.ts`:

| File | Lines | Headroom to the 800 ratchet |
|---|---|---|
| `use-chat-dispatcher.ts` | 799 | **1** |
| `task-manager.tsx` | 2972 (baselined) | **0** — baselined files may not grow |
| `chat-panel.tsx` | 977 (baselined) | **0** |
| `ai-section.tsx` | 779 | 21 |
| `chat-api.ts` | 276 | 524 |

The ratchet (`scripts/check-file-sizes.mjs`) fails on a NEW file over 800 or a **baselined file that
grew**; files under 800 may grow up to the limit. `docs/baselines/file-sizes.json` holds only the
five already-oversized files.

Split `use-chat-dispatcher.ts` into the orchestration hook plus a `chat-read-tools.ts` leaf holding
the `list_*` / `get_*` handlers. This follows the repo's own split-before-crossing convention (gantt,
reports, raid precedent) and is what makes both the digest wiring and the new read tools fit at all.

## Chips

**26 views get chips. 8 do not**, each for a stated reason:

| View | Why no chips |
|---|---|
| `chat` | Is the chat surface — `chat-prompt-chips.tsx` already shows foundational + chat-only |
| `settings` · `help` | Nothing to ask about project data |
| `activity` · `history` | Audit trails; no tool reads them (and the activity tool is deferred) |
| `projects` | Portfolio switcher; a useful chip needs cross-project reads that do not exist |
| `learning-insights` | Deep-link target, not a nav destination — the one view `LABEL_KEYS` excludes |
| `timelog` | Its read tool is deferred (below); chips would be dead prompts |

Chips for the 26 = the 14 that have them today + **12 new**: `insights` · `directory` · `workload` ·
`calendar` · `planning` · `manage-roles` · `budget-report` · `raid-report` · `change-report` ·
`raci` · `stakeholder-map` · `portfolio-health`.

**Volume: 12 views × 2 defs × 2 keys × 2 languages = 96 new strings.** This is the bulk of the work
and it is mechanical, not hard.

Key naming follows the existing abbreviated convention — `aiPromptWorkloadOverloadLabel` / `…Body`,
matching `aiPromptBudCpi*`, `aiPromptStkGaps*`, `aiPromptMsAtRisk*`.

### i18n landmines

- `i18n.de.ts` is **CRLF**, and the Edit tool corrupts umlauts and curls double-quotes there. Patch
  via a node utf8 write anchored on `\r\n`, then grep-verify. An LF-anchored replace silently no-ops.
- The `i18n-encoding` test bans ASCII substitutes (`fuer`/`druecken`) **and** `\u00XX` escapes.
- EN/DE key parity is enforced by `tsc`, not by the test suite — a missed DE key passes `test:run`
  and fails only in CI typecheck.
- Serialize all i18n edits into one pass. Concurrent edits to that file have bitten this repo
  repeatedly.

## Read tools

### Ship now — workspace-resident

Reachable from `useWorkspace()` inside the dispatcher. No new wiring, no network.

| Tool | Source | Note |
|---|---|---|
| `list_knowledge_items` | `Workspace.knowledgeItems` | |
| `list_calendar_events` | `Workspace.calendarEvents` | return the series definition, not an expansion |
| `list_budget_buckets` | `Workspace.budgets` | per-bucket detail only |

Constraints:

- **They land in `chat-read-tools.ts`** — the file the prerequisite split creates.
- **Rich text is projected, never dumped.** Anything returning a description goes through
  `descriptionText`. A raw HTML dump floods the context and hands the model markup it will echo back.
- **`list_budget_buckets` must say when *not* to use it** — its description points at
  `get_dashboard_snapshot` for the rollup, or the model calls both and reconciles two views of the
  same money. `get_dashboard_snapshot`'s own description is the precedent for this style of negative
  instruction.

Standing cost: tool definitions travel in every request, so 30 → 33 tools adds tokens to every
message, including those that never touch these views.

### Deferred — record as numbered `docs/open-followups.md` entries

- **Timelog entries.** Not in `Workspace` — it holds only `timelogLinks` (user→resource,
  project→bucket). Real entries come over the `/api/timelog` proxy, SSRF-guarded and authenticated
  with the device-sealed `timelogApiToken`. A tool here makes the model trigger a live authenticated
  external call — a different risk class and a different failure mode (upstream timeout, already hit
  once in this repo).
- **Activity log.** `activity-log-context.tsx` exposes a **writer only** (`LogActivityFn`); the log
  is not in the workspace. Reading it needs new wiring through size-locked files.

## Settings disclosure

`settings-sections/ai-view-scope-disclosure.tsx` — read-only list of all 34 views showing purpose,
tool hints, and whether the view contributes a digest.

- **The displayed prompt text is English even in a German UI.** That is correct — it is what is
  actually sent, and `stableInstructions` has always been English. Label it as such. Only the
  surrounding chrome (heading, explanation) takes EN/DE keys.
- **34 rows of expanders is the duplicate-accessible-name trap.** N identical "Show" controls is a
  WCAG 2.4.6 failure that axe can pass when only one row renders at scan time. Each control takes a
  row-unique name: `` `${t(lang,"show")} – ${viewLabel}` ``.
- **Use `ToggleButton`**, never a hand-rolled `aria-pressed` — the primitive carries the non-colour
  pressed marker and its test; a hand-rolled control gets neither.
- `Settings` is in `A11Y_VIEWS` but the gate scans **General**, so the AI section is not reached.
  Verify contrast and labels by hand — the Calendar sub-tab shipped an AA failure under a full
  85/85 axe pass for exactly this reason.

## Testing

Current state: `chat-api.test.ts` has **no** `buildSystemPrompt` coverage (only token caps and
tool-use repair); `chat-panel.test.tsx` exercises it indirectly. The prompt assembly is close to
untested before this work.

New tests, highest value first:

1. **Cache-boundary.** The digest appears in the block *without* `cache_control`; purpose and hints
   in the block *with* it. This is the only regression here that is completely invisible — moving the
   digest into the prefix breaks nothing visible and silently raises cost.
2. **No dead hints.** Every `toolHints` entry names a tool that exists in `chat-tool-defs.ts`. This
   is what stops a hint pointing at the deferred `list_timelog_entries`.
3. **Chip ↔ capability coherence.** Every view with chips has tool hints or a digest. Prevents
   re-introducing the dead-prompt class this design exists to remove.
4. **Digest determinism.** Each of the four digest functions is pure and clock-free — `today` is
   passed in, never read.

Deliberately **not** written: a totality test for `VIEW_AI_SCOPE`. `Record<AppView, ViewScope>` makes
a missing view a typecheck error, so such a test could not fail.

`ask-claude-prompts.test.ts` already asserts "every label/body key resolves in EN and DE" — it
extends to the 96 new strings automatically. No new i18n test needed.

## Gates

| Gate | Risk |
|---|---|
| `size:check` | The prerequisite split exists for this. Re-run after the split *and* after the read tools land. |
| `dup:check` | 26 structurally-identical chip literals + 34 registry entries; jscpd is per-format and blocking. |
| `test:coverage` | New pure `.ts` engines are coverage-gated (lines 92 / funcs 91 / branch 80). The disclosure `.tsx` is excluded; registry and block builder are not. |
| `npx tsc --noEmit` | The only thing enforcing EN/DE parity. |
| `docs:symbols:check` | Any new symbol named in AGENTS.md must exist. |

**Run gates serially.** Running `dup:check` alongside `test:coverage` produced a worker start timeout
that exited 1 with every test passing.

## Out of scope

- Per-view narrowing of the *tool set* offered to the model. The scope tells the model which tools
  are relevant; it does not remove the others.
- Digests for views beyond the four named. `view-ai-digest.ts` is `Partial` on purpose.
- Translating system-prompt text. It is English by existing precedent.
- Cross-project / portfolio-level reads.
