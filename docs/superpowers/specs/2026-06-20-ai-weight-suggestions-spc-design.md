# SP-C — AI-Suggested Next-Actions Weight Adjustments — Design

**Date:** 2026-06-20
**Status:** Approved (design); spec pending user review
**Target release:** v0.109.0 "Leckie"

> Third slice of the 6-part roadmap ([[task-status-kanban-roadmap]]). Independent of SP-A/SP-B.
> Reuses the SP4 forced-tool one-shot AI pattern (`action-ai.ts` / `use-action-analysis.ts`)
> and the existing next-actions confidence weights + action-learning data.

## Goal

In the next-actions settings, let Claude analyze the project, snapshot trends, and the user's
act/snooze/dismiss history, then suggest numeric adjustments to the next-actions prioritization
weights — shown as a second "AI suggested" column with a per-row **Accept** button. Advisory only.

## Non-goals (SP-C)

- SP-D (project from file/URL), SP-E (steering committee), SP-F (tour) — later slices.
- No agentic loop (one forced-tool call). No new persisted Workspace field.
- The AI never auto-applies a change — the user clicks Accept.
- No changes to the deterministic `next-actions/` engine itself (only the user-tunable config).

## Decisions (locked during brainstorming)

1. **Targets:** by default the 3 confidence weights — `clarityBonus`, `semiClarityBonus`,
   `staticPenalty`. An optional per-device setting `ai.suggestAllNextActionThresholds`
   (default OFF) expands targets to all 10 `NextActionsConfig` fields (the 7 firing thresholds).
2. **Learning = input, not target.** The action-learning history (act/snooze/dismiss per signal)
   is a key INPUT. If `nextActionsLearning.enabled` is OFF, the panel surfaces a one-click
   **"Enable learning"** recommendation (so data starts accruing). `NextActionsLearningConfig`
   has no numeric knobs, so it is never a numeric suggestion row.
3. **Ephemeral** result (in-memory, re-runnable), advisory; the user accepts per-row.
4. **Augment the existing** next-actions settings section (not a new panel).

## Architecture

### Pure contract — `next-actions-tuning.ts` (NEW, i18n-free)
- `WeightSuggestion = { field: TunableField; current: number; suggested: number; rationale: string }`
  where `TunableField` is the union of suggestable `NextActionsConfig` keys.
- `WEIGHT_FIELDS` = `["clarityBonus","semiClarityBonus","staticPenalty"]`;
  `ALL_TUNABLE_FIELDS` = those + the 7 thresholds (the full `NextActionsConfig` key list).
- `parseWeightSuggestions(input: unknown, current: NextActionsConfig, scope: "weights" | "all"):
  WeightSuggestion[]` — validates untrusted model output:
  - keep only objects whose `field` is in the scope's allowed set;
  - **clamp `suggested` through the SAME per-field validator** the config uses
    (`intMin0` for the 3 weights; `intMin1`/`ratio` for the thresholds) so an out-of-bounds or
    hallucinated value can never be accepted — reuse/export the per-field coercers from
    `settings-types.ts` (extract them if currently inline in `resolveNextActionsConfig`);
  - drop a suggestion whose clamped `suggested === current` (no-op);
  - `rationale` = sanitized short string (cap length, strip control chars);
  - tolerate missing/extra keys; never throw; cap the list length.
- `applyWeightSuggestion(config, suggestion): NextActionsConfig` — pure, returns a new config
  with the one field set to `suggestion.suggested`.

### Forced-tool AI call — `weight-suggestion-ai.ts` (NEW, mirrors `action-ai.ts`)
- `SUGGEST_TOOL` definition (`name: "suggest_weights"`), input schema = an array of
  `{ field, suggested, rationale }` + an optional `overallRationale` + `recommendEnableLearning`
  boolean. `tool_choice: { type: "tool", name: "suggest_weights" }` — model always emits it,
  no loop.
- `buildSuggestionPrompt(context)` returns the system/user blocks: stable instructions first
  (cacheable), volatile data after (today, current weights, learning history, trends, scope).
  Instruction: "reason over what the user acts on vs snoozes/dismisses; only propose a field if
  the data supports a change; give a one-sentence rationale each."
- `parseSuggestionResponse(toolInput, current, scope)` → delegates to `parseWeightSuggestions`
  (+ extracts `recommendEnableLearning`, `overallRationale`).

### Hook — `use-weight-suggestions.ts` (NEW, mirrors `use-action-analysis.ts`)
- `useWeightSuggestions({ ai, context })` → `{ run, suggestions, overallRationale,
  recommendEnableLearning, status, error, clear }`. `run()` makes the one forced-tool call,
  bundles inputs (workspace summary via `buildAiContext`, action-learning history, Turso-gated
  trends summary), and stores the parsed result in memory. Key never logged/thrown.
- Gated on a configured AI key. Advisory; result ephemeral; `clear()` resets.

### Inputs bundled by the hook
- **Project/workspace summary** — reuse `buildAiContext` (the shared context builder used by SP4/SP5).
- **Action-learning history** — act/snooze/dismiss counts per `kind` from the `action_learning`
  store (read-only; if learning disabled or empty, pass an empty summary + set the Enable-learning
  hint context).
- **Trends summary** — Turso-gated snapshot deltas if `tursoConfig !== null`; omitted otherwise
  (the prompt notes trends are unavailable).

### UI — next-actions settings section (`settings-view.tsx`)
- A **"Suggest with AI"** button (gated on configured key) runs the hook; shows a spinner while
  `status === "loading"`; on error shows a sanitized message (no key/body leakage).
- A second **"AI suggested"** column on each tunable config row: when a suggestion exists for that
  field, show `suggested` value + an info tooltip with the rationale + an **Accept** button.
  Accept applies via `setSettings` (→ `writeSettings`) using `applyWeightSuggestion` and removes
  that row's suggestion. **Accept all** convenience applies every current suggestion.
- The **optional toggle** `ai.suggestAllNextActionThresholds` (default OFF) shown in the section;
  it controls the `scope` passed to the run + which rows can show a suggestion.
- If `recommendEnableLearning` (and learning is off): a one-click **"Enable learning"** control
  that sets `nextActionsLearning.enabled = true` via `setSettings`.
- Per-row Accept buttons need **row-unique accessible names** (`${t(lang,"accept")} – ${fieldLabel}`)
  — Settings IS in the axe `A11Y_VIEWS` 12-view gate.

### Settings model
- `ai.suggestAllNextActionThresholds?: boolean` (default OFF) added to the `ai` settings group +
  sanitizer (`=== true`). Per-device; no Workspace field.

## Error handling
- `parseWeightSuggestions` never throws; clamps every value; drops no-ops and unknown fields.
- The AI call wraps errors → `status: "error"` + a sanitized message; never leaks apiKey/body.
- Accept only ever writes a clamped, validated value through `setSettings` (the sole settings writer).
- Empty learning history / no Turso trends → the call still runs with a reduced input + a prompt note.

## Testing (TDD)
Pure first:
- `parseWeightSuggestions` — valid parse; clamps out-of-bounds per field; drops unknown fields;
  drops no-ops (suggested===current); respects `scope` (weights vs all); caps list; sanitizes rationale.
- `applyWeightSuggestion` — sets one field immutably.
Then:
- `weight-suggestion-ai.ts` — tool def shape; `buildSuggestionPrompt` puts stable content first;
  `parseSuggestionResponse` maps tool input + `recommendEnableLearning`.
- `use-weight-suggestions.ts` — key-gated; ephemeral result; error path sanitized (mock Anthropic).
- settings UI — column renders a suggestion + Accept applies via setSettings; Accept-all; the
  `suggestAllNextActionThresholds` toggle widens scope; Enable-learning control; row-unique labels.
- `npx tsc --noEmit` (EN/DE parity) after editing tests; axe gate for Settings
  (`npx playwright test e2e/a11y.spec.ts -g "Settings"`).
- EN+DE i18n (DE via node UTF-8 write, real umlauts).

## i18n / release
- New EN+DE keys: button labels (`weightSuggestRun`, `weightSuggestColumn` "AI suggested",
  `accept`, `acceptAll`, `weightSuggestEnableLearning`), status/error strings, the toggle label,
  per-field already-labeled rows reused, and `versionHighlightWeightSuggest`.
- Bump `version.ts` (0.109.0 "Leckie"), append the highlight key to `APP_HIGHLIGHT_KEYS`,
  add `CHANGELOG.md` entry.

## File map
- `next-actions-tuning.ts` (NEW pure) — fields, `parseWeightSuggestions`, `applyWeightSuggestion`.
- `weight-suggestion-ai.ts` (NEW) — forced-tool contract + prompt.
- `use-weight-suggestions.ts` (NEW) — hook.
- `settings-types.ts` — export the per-field coercers; `ai.suggestAllNextActionThresholds` flag.
- `settings-view.tsx` — second column + Suggest/Accept/Accept-all/Enable-learning UI.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
- (Read-only consumers: `buildAiContext`, the `action_learning` store reader, the Turso trends summary.)
