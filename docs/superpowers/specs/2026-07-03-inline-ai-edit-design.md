# Inline "Ask Claude" per-item edit — SP1 (tasks) — Design

**Status:** approved design (brainstorm 2026-07-03), pending implementation plan.
**Scope:** SP1 = tasks only. RAID / changes / milestones / stakeholders are follow-up SPs
reusing the same pattern.

## Goal

Let the user edit an item with a natural-language instruction **in place**, without opening
the AI Assistant chat window. Claude proposes the change, the user sees a preview, confirms,
and it is applied — reusing the existing AI CRUD tools.

## Decisions (locked in brainstorm)

1. **Interaction model:** inline per-item NL command — an affordance on the task surfaces
   opens a small popover with a free-text input scoped to *that task*.
2. **Safety:** **preview-diff-then-confirm**. Claude's proposed changes are rendered as a
   diff; nothing is written until the user clicks Apply.
3. **Command scope:** the command may touch **the item's own fields AND create related
   items** (e.g. "mark done and open a risk for the regression"). Cross-entity *creation* is
   allowed; the preview shows both.
4. **Rollout:** **tasks first** (task table rows + Kanban cards). Other entities later.
5. **Affordance placement:** **both** — a ✨ icon revealed on row/card hover (discoverability)
   **and** an entry in the row's ⋮ overflow / a Kanban card action (keyboard/always-available).
6. **Engine:** **single bounded `callClaude`** (no agentic loop). The model emits all its tool
   calls in one turn; we preview them together, then apply on confirm.

## Architecture — plan-then-apply over the existing tools

The existing chat flow executes tool calls immediately inside an agentic loop
(`chat-panel.tsx`: `stop_reason === "tool_use"` → `runTool(dispatcher, block.name,
block.input)` → loop). Inline edit **inverts** that: Claude *proposes* tool calls, we render
them as a human preview, and only execute on confirm.

Flow:

1. User clicks ✨ (hover icon or ⋮ entry) on a task → inline popover opens with an NL input.
2. On submit → **one** `callClaude` request (no loop):
   - System prompt scoped to THIS task: its id + current field values, plus the same
     workspace context the chat builds (`buildSystemPrompt`), plus an instruction to emit
     tool calls (`update_task` for this task; `create_*` for related items) and NOT to chat.
   - `tool_choice: auto` (the model may also return clarifying text and no tools).
3. **Do not execute.** Parse the returned `tool_use` blocks into an `EditPlan` via the pure
   `describeToolCalls(blocks, workspace)`:
   - `update_task` on this task → `FieldDiff[]` (field, before, after) diffed vs the live task.
   - `create_*` → a `NewItem` summary ("+ new RAID risk 'Payment timeout'").
   - `delete_*` → a `Deletion` summary.
   - If there are **no** tool_use blocks, surface the assistant's text as a clarification
     ("Claude needs more info: …") and offer no Apply.
4. **Preview UI** renders the `EditPlan` (field diffs + related creates/deletes) with
   Cancel / Apply.
5. **Apply** → run each block through `runTool(dispatcher, name, input)` — the SAME
   `ToolDispatcher` chat uses (already instantiated above chat, threaded to the tasks
   surface), non-read-only — in order. Then log an `ai.inlineEdit` activity entry and show a
   toast summarising what changed.

## Components (new, small, isolated)

- **`inline-ai-edit/plan.ts`** — pure, i18n-free. `describeToolCalls(blocks, workspace):
  EditPlan`, the `EditPlan`/`FieldDiff`/`NewItem`/`Deletion` types, and a grounding helper
  that re-validates any entity id the model references against the live workspace (mirrors
  `action-ai.groundEntity`) so a `create` linking to a hallucinated id is dropped/flagged.
  No React, no i18n — fully unit + property testable.
- **`inline-ai-edit-call.ts`** — the single bounded Claude call. Mirrors
  `weight-suggestion-call.ts` / `scheduled-job-analysis.ts` security EXACTLY: never logs or
  echoes the api key or request/response body; a thrown error carries only HTTP-status digits
  or `"parse"`. Returns `{ blocks: ToolUseBlock[], assistantText: string }`. Non-hook (so it
  can be unit-tested and reused).
- **`use-inline-ai-edit.ts`** — hook holding the state machine
  (`idle → thinking → preview → applying → done|error`), the current `EditPlan`, and the
  submit/confirm/cancel handlers. Gated: renders/acts only when
  `isAiEnabled(settings.ai) && !isPopout && !task.jiraKey` (Jira-synced tasks are Jira-owned
  and read-only). Reads live scope; applies via the threaded dispatcher.
- **`inline-ai-edit-popover.tsx`** — presentational only: NL `<input>`/`<textarea>` (with an
  `aria-label`, never placeholder-only), a thinking spinner, the preview diff, and
  Cancel/Apply. Reuses `usePopoverDismiss` + `INTERACTIVE`/`FOCUS_RING` atoms; AIPM palette
  only.

## Reuse (no new engine, no new persistence)

- `callClaude`, `buildSystemPrompt`, protocol types — `chat-api.ts`.
- `runTool` + the `ToolDispatcher` — `chat-tools.ts` + `use-chat-dispatcher.ts`
  (already instantiated in `task-manager` and threaded to chat; thread it to the tasks
  surface too).
- Tool schemas — `chat-tool-defs.ts`.
- **No new AI tools, no new `Workspace` field, no new backend write-paths.** Applied writes go
  through the dispatcher's existing per-entity `sanitizeX` (the single validator), so a
  hallucinated/out-of-bounds value cannot land.

## Wiring

- **Task table row:** ✨ hover icon (row-unique accessible name, e.g.
  `${t("inlineAiEdit")} – ${task.taskName}`) + an entry in the row's actions/overflow. The
  popover anchors to the row.
- **Kanban card:** ✨ hover action on the card. NB the board renders OUTSIDE
  `RowContextProvider`, so the affordance + its handlers take everything as props (no
  `useTaskRowContext()`), consistent with the existing board rule.
- Thread the dispatcher + gating flags from `task-manager` → the tasks surface
  (`tasks-section` is the fat pane that already owns task calendar logic, so the inline-edit
  wiring lives there, not spread across `workspace-section`).

## Safety / gating

- **Master switch:** `isAiEnabled(settings.ai)` (enabled + key present). No key → no affordance.
- **Popout:** no affordance (read-only mirror).
- **Jira-synced task** (`!!task.jiraKey`): no affordance (Jira owns its fields).
- **Preview-then-confirm:** no write occurs before Apply. Each applied block re-runs the
  entity's `sanitizeX` inside the dispatcher.
- **Grounding:** entity ids the model references are re-validated against the live workspace
  before Apply; a `create` linking to an unknown id is dropped from the plan (or the plan is
  rejected) rather than applied blindly.
- **Errors:** a call failure surfaces a sanitized inline error in the popover (status digits
  only); no partial apply. If Apply throws mid-sequence, stop and report which ops succeeded
  (they are individually sanitized + logged), do not silently continue.

## Data flow (happy path)

```
row ✨  →  hook: thinking
        →  inlineAiEditCall(task, instruction, workspaceContext)  →  { blocks, text }
        →  describeToolCalls(blocks, workspace)  →  EditPlan (idle→preview)
        →  user Apply
        →  for each block: runTool(dispatcher, name, input)  →  setX (live)
        →  logActivity("ai.inlineEdit", summary)  +  toast
```

## Testing

- **`plan.ts`** — unit + property: arbitrary tool-use blocks → a sensible `EditPlan`,
  never crashes; grounding drops bogus ids; `update_task` diffs match; empty blocks → empty
  plan.
- **`inline-ai-edit-call.ts`** — unit with a mocked fetch: sends the three Anthropic headers,
  never leaks the key/body on error, maps failures to status-digit errors, parses tool blocks.
- **`use-inline-ai-edit.ts`** — hook test with a mocked call + mocked dispatcher: preview is
  built from blocks; Apply routes each block to `runTool`; gating (aiDisabled / popout /
  jiraKey → no affordance/action); error path shows inline error, no apply.
- **a11y:** the tasks view IS in the axe gate — the ✨ affordance needs a row-unique
  accessible name and the popover input needs an `aria-label`. Verify with the Open Points
  axe scan. Kanban board is not axe-scanned → eye-verify card affordance labels.
- **i18n:** new keys EN + DE (`inlineAiEdit`, popover labels, preview headings, toast,
  clarification, error). tsc enforces parity; DE uses real umlauts.

## New i18n keys (EN + DE)

`inlineAiEdit` ("Ask Claude"), `inlineAiEditPrompt` (input aria-label / placeholder),
`inlineAiEditThinking`, `inlineAiEditPreviewTitle`, `inlineAiEditApply`,
`inlineAiEditNoChanges`, `inlineAiEditClarify`, `inlineAiEditError`, `inlineAiEditApplied`
(toast). Exact strings finalised in the plan.

## Out of scope (SP1)

- Other entities (RAID/changes/milestones/stakeholders) — follow-up SPs, same pattern.
- Command palette (⌘K) / natural-language field editing — separate features if wanted later.
- Multi-item / bulk NL edit — later.
- Agentic multi-turn inline (chained tool round-trips) — deliberately not built; single
  bounded call only.
- Undo beyond the existing activity log (preview-then-confirm is the safety mechanism).

## CI / house-rule checklist (carry into the plan)

- `--max-warnings=0`; react-hooks purity + `set-state-in-effect` bans; no `Date.now()`/
  `new Date()` in render bodies.
- AIPM palette only; no raw shadow/gradient; new toggle-ish buttons follow the interaction
  atoms.
- Coverage: pure `plan.ts` + the call module are gated engine files (keep them well-tested);
  a new render-scope `use*` hook that is pure UI glue may need `vitest.config.ts`
  `coverage.exclude`.
- New AI activation site MUST use `isAiEnabled`/`aiKeyIfEnabled`, never a raw apiKey read.
- CSP already allows `api.anthropic.com` (chat uses it) — no proxy change.
