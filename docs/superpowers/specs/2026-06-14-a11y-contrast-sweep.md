# A11y Contrast Sweep + Gate Extension — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete)
**Branch:** `feat-a11y-contrast-sweep`

## Goal

Fix the brand-color text/chip contrast that fails WCAG AA, using the existing `AIPM-green-strong` token; fix the RACI chips with a palette-safe pattern; add a guard so green-text can't regress; and extend the e2e axe gate to the currently-unscanned views so contrast regressions are caught in CI.

## Why
- `AIPM-green` #84BD00 as text on white ≈ 2:1 (fails AA 4.5:1). A darker `AIPM-green-strong` #4D7000 (light) / #84BD00 (dark) token already exists but is used only 2×; plain `text-AIPM-green` appears ~54× (mostly info text/icons, only 1 `aria-hidden`).
- RACI chips (`raci-chip-picker.tsx`) fail: A `bg-AIPM-green text-white` (2.1), I `bg-AIPM-medium-grey text-white` (2.6), and off-state colored text (green 2.1, purple 3.8, grey 3.0). They live on the **Stakeholders view, which the axe gate does NOT scan** (`A11Y_VIEWS` = Dashboard/Open-Points/Gantt/Resources/Budget/RAID/Settings).

## Scope (full: sweep + guard + gate extension)

### ① Green-text sweep → `AIPM-green-strong`
Replace `text-AIPM-green` (the bare token, NOT `text-AIPM-green-strong`) → `text-AIPM-green-strong` across `src/app/*.tsx`. Use a negative-lookahead match `/\btext-AIPM-green(?!-)/g` so `green-strong` is never double-suffixed. `green-strong` is dual-mode-correct (dark #4D7000 on light; bright #84BD00 on dark). After the blanket replace, spot-check for any green-on-dark-fill case where #4D7000 reads too dark in light mode (rare — most are on `surface`); if found, exempt that one back to `text-AIPM-green` + `aria-hidden` and allowlist it in the guard. Keep `bg-/border-/ring-/from-/hover:bg-AIPM-green` (fills/accents) UNCHANGED — only `text-` foreground is the contrast problem.

### ② RACI chips (`raci-chip-picker.tsx`) — palette-safe
- **On/selected** = white text on a dark-enough brand fill (uniform):
  - R `bg-AIPM-dark-blue text-white` (keep), C `bg-AIPM-purple text-white` (keep, 4.6),
  - A `bg-AIPM-green text-white` → **`bg-AIPM-green-strong text-white`** (7:1),
  - I `bg-AIPM-medium-grey text-white` → **`bg-AIPM-dark-grey text-white`** (5.3).
  - Borders follow the fill (`border-AIPM-green-strong`, `border-AIPM-dark-grey`).
- **Off/unselected** = colored border keeps category identity, text → `text-foreground` (AA-safe dark):
  - all four: `border-AIPM-<cat> text-foreground` (drop the failing colored text). Keep the `border-AIPM-dark-blue/green-strong/purple/dark-grey` to signal the role.

### ③ Guard — `green-text-contrast.test.ts` (new)
Mirror the sweep guards: scan every `src/app/*.tsx` (excl `.test.`), assert NO `/\btext-AIPM-green(?!-)/` (i.e. bare `text-AIPM-green`). Include detection self-tests (flags `text-AIPM-green`, allows `text-AIPM-green-strong` + `bg-AIPM-green` + `border-AIPM-green`). If a genuine decorative exemption exists, the guard reads an inline `// a11y-allow-green:` marker on that line (keep the allowlist tiny / ideally empty).

### ④ Extend the axe gate + fix-what-it-flags
Add `"Stakeholders", "Changes", "Milestones", "Reports", "Activity"` to `A11Y_VIEWS` in `e2e/a11y.spec.ts`. Run `npx playwright test e2e/a11y.spec.ts` locally; for each NEW `critical`/`serious` violation, fix with the **no-new-token** patterns:
- green text → `green-strong` (already swept; catches any missed).
- white-on-pink/purple/grey small text → either `text-foreground`/`text-AIPM-dark-blue` on a tinted bg, OR a darker existing brand fill (`green-strong`/`dark-grey`/`dark-blue`), OR border-only identity. **Do NOT add a new palette color.**
- If a violation needs a genuine brand-design call (e.g. the `bg-AIPM-pink text-white` nav badge at ~3.9:1 — pink is a fixed brand value with no `-strong`), STOP and surface it for a decision rather than inventing a color.
Loop until `e2e/a11y.spec.ts` is green locally.

> Known candidate the extension may surface: the now-tier nav badge `bg-AIPM-pink text-white` (~3.9:1). If axe flags it, the minimal fix is bumping the badge text weight/size into the large-text 3:1 bracket OR a darker treatment — flagged for decision if it comes up.

## Version & testing
- **Version:** patch **0.79.2** (a11y; no codename change). CHANGELOG entry. No new i18n keys.
- **Testing:** the new green-text guard (RED→GREEN); `npx tsc --noEmit`; `npx eslint src/app --max-warnings=0`; full `npx vitest run` green; `npx playwright test e2e/a11y.spec.ts` green with the 5 added views; CI e2e green.

## Out of scope
- Adding new palette colors (purple-strong/pink-strong) — the 9-color constraint holds; failures get no-new-token patterns or are surfaced for a decision.
- Non-contrast a11y (roles/labels/landmarks) beyond what the extended gate already checks.
- Reworking `bg-/border-/ring-AIPM-green` fill/accent uses (not a contrast problem).

## File summary
**New:** `green-text-contrast.test.ts`.
**Modified:** ~`text-AIPM-green` across many `src/app/*.tsx` (script-driven), `raci-chip-picker.tsx`, `e2e/a11y.spec.ts`, plus whatever ④ flags, `version.ts`, `CHANGELOG.md`.
