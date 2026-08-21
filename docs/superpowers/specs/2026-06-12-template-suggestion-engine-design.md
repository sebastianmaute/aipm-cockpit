# Template Suggestion Engine — Design Spec

> **Status:** Approved (brainstorming complete, 2026-06-12). Sub-project #4 of 4 (final).
> **Storage note:** `docs/superpowers/` is gitignored — this spec lives locally, not committed.

## Context — the 4-part feature

1. Modal field-visibility framework — SHIPPED v0.70.0 "Heinlein".
2. Templates entity — SHIPPED v0.71.0 "Bear".
3. Creation wiring + per-project functions — SHIPPED v0.72.0 "Zelazny" (the 3-step creation wizard).
4. **Template suggestion engine** *(this spec)* — at project creation, suggest which template to use from
   the project's basic parameters (team size, complexity, persons involved, other available data points).

This spec covers **#4 only** — the final, smallest sub-project. It plugs into the wizard's Step 2
(template selection) from sub-project #3.

## Goal

A pure, deterministic heuristic that scores the project's `ProjectMeta` (collected in wizard Step 1)
and suggests the best-matching template, preselecting it in Step 2 with a "Suggested" badge and a
localized one-line reason. The user remains free to pick any template or Blank.

---

## Architecture

### Decision: deterministic heuristic (not LLM)

Suggestion from a handful of meta fields is rule-shaped, not ML-shaped. A pure scoring function is
deterministic, fast, fully unit-testable, and needs no AI consent / token cost / network. (The app
has an AI assistant, but using it here would be non-deterministic and harder to test — rejected.)

### 1. Engine — `src/app/template-suggest.ts` (pure)

```ts
import type { ProjectMeta } from "./types";
import type { ProjectTemplate } from "./templates";
import type { TranslationKey } from "./i18n";

export type SuggestTier = "simple" | "modular" | "advanced";

export interface SuggestReason { key: TranslationKey; args?: (string | number)[]; }

export interface TemplateSuggestion {
  templateId: string;        // the suggested template's id (always resolves — built-ins guarantee non-empty)
  tier: SuggestTier;         // the computed target tier
  reasons: SuggestReason[];  // localized reason fragments (the fired signals)
}

export function suggestTemplate(
  meta: ProjectMeta,
  templates: readonly ProjectTemplate[],
): TemplateSuggestion;
```

Internal pure helpers (same file, not exported unless tested directly):
- `complexityScore(meta): { score: number; reasons: SuggestReason[] }` — applies the weights below.
- `tierForScore(score): SuggestTier`.
- `pickTemplateForTier(tier, templates): string` — returns the chosen template id.

### 2. Scoring (approved weights — in a `SUGGEST_WEIGHTS` constants block for easy tuning)

| Signal | Source | Points |
|--------|--------|--------|
| Team size | `keyStakeholdersInternal.length + keyStakeholdersExternal.length` (+1 each if `sponsor`/`projectManager` set) | 0–2:+0 · 3–7:+1 · 8+:+2 |
| Regulated | `regulatory.length > 0` | +1 |
| Deployment | `deployment` | Cloud:+0 · On-premise:+1 · Hybrid:+2 |
| Duration | `endDate − startDate` (months) | <3:+0 · 3–12:+1 · >12:+2 |
| Scale | `identityCount` or `products` count above a threshold | +1 |

Each non-zero signal contributes a `SuggestReason` (its i18n key + args), so the reason string lists
exactly what fired. Missing/invalid fields contribute 0 (no throw).

**Score → tier:** `0–1 → simple` · `2–4 → modular` · `5+ → advanced`.

Sparse meta (all signals 0) → `simple` tier, reason `suggestSignalLimited` ("limited info — start
simple").

### 3. Tier → template (`pickTemplateForTier`)

Order of preference:
1. A **built-in** template whose `deriveMode(template.features)` equals the target tier.
2. Any template (built-in or user) whose `deriveMode` equals the target tier.
3. The template whose `deriveMode` is **closest** to the target tier by rank distance
   (`simple=0, modular=1, advanced=2`); ties → built-in, then first.

`templates` always contains the 3 built-ins (Minimal=simple, Standard PM=modular, Full delivery=
advanced), so step 1 always succeeds and `templateId` always resolves — `suggestTemplate` never
returns null.

### 4. Wizard Step 2 wiring (`create-project-wizard.tsx`)

- `const suggestion = useMemo(() => suggestTemplate(meta, templates), [meta, templates])`.
- **Preselect once:** when the user first reaches Step 2 and has not manually chosen a template,
  initialize the selection to `suggestion.templateId` (via the existing `chooseTemplate`, so the
  functions step is pre-filled from it). A `userPickedRef`/flag prevents re-preselecting after the
  user touches the list (manual choice — including Blank — sticks).
- **Badge + reason:** the suggested template's row shows a `templateSuggested` badge; a one-line
  reason renders above/below the list: the joined `reasons` fragments + the target-tier label (reuse
  `modeSimple`/`modeModular`/`modeAdvanced`), e.g. "8 stakeholders · regulated · hybrid → Full
  delivery".
- Blank and all other templates remain selectable; selecting Blank or another template clears the
  badge's preselect effect (the badge still marks the suggested row, but selection follows the user).

### 5. i18n (`i18n.ts` / `i18n.de.ts`, identical key sets)

`templateSuggested` ("Suggested"), and reason fragments: `suggestSignalTeam` ("{0} people"),
`suggestSignalRegulated` ("regulated"), `suggestSignalDeployment` ("{0} deployment" or a per-value
key), `suggestSignalDuration` ("{0}-month timeline"), `suggestSignalScale` ("large scale"),
`suggestSignalLimited` ("limited info — start simple"), `suggestReasonArrow` (the "→" joiner, or
compose in code). Tier labels reuse the existing `modeSimple`/`modeModular`/`modeAdvanced`. Accurate
German for each; no curly-quote corruption in `i18n.de.ts`.

---

## Components & files

| File | Responsibility | New? |
|------|----------------|------|
| `template-suggest.ts` | pure `suggestTemplate` + scoring helpers + `SUGGEST_WEIGHTS` | new |
| `create-project-wizard.tsx` | Step 2 preselect + badge + reason | modify |
| `i18n.ts` / `i18n.de.ts` | badge + reason fragment keys | modify |

## Error handling & edge cases

- Missing/invalid meta fields → 0 points, no throw; sparse meta → simple.
- `templates` always has 3 built-ins → `templateId` always resolves; `suggestTemplate` never null.
- User manual pick (any template or Blank) overrides the preselect and is not re-overridden on
  re-render or step navigation.
- Deterministic: same meta + same template set → same suggestion (pure).

## Testing

- **Unit (`template-suggest.test.ts`):** each signal at its boundaries (team 2/3/8, regulated on/off,
  deployment Cloud/On-prem/Hybrid, duration 2/6/18mo, scale below/above threshold); score→tier
  boundaries (1/2/4/5); `pickTemplateForTier` (built-in preference, exact match, closest-tier
  fallback, ties); sparse meta → simple + `suggestSignalLimited`; reasons list exactly the fired
  signals.
- **Component (`create-project-wizard.test.tsx`):** Step 2 shows the badge on the suggested row and
  preselects it; a high-complexity meta suggests Full delivery, a sparse meta suggests Minimal;
  manual pick of Blank/another overrides and sticks.

## Out of scope

- LLM-based suggestion (rejected — deterministic heuristic chosen).
- Ranked list / multiple suggestions (single suggestion, by decision).
- Learning/adapting weights from user behavior (YAGNI).
