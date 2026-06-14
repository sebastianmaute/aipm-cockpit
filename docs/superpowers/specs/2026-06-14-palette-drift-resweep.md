# Palette-Drift Re-Sweep — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete)
**Branch:** `feat-palette-drift-resweep` (TBD at execution)

## Goal

Realign the legacy `AIPM-*-grey` **chrome** utilities that drifted back into ~10 components added/changed *after* the 0.16.0 palette sweep ([[design-system-batch]]) onto the semantic surface tokens. This is palette hygiene **plus** a dark-mode-correctness fix (the fixed `AIPM-light-grey`/`AIPM-dark-grey` values render wrong on dark surfaces) **plus** a minor a11y win (`text-AIPM-medium-grey` #939598 fails AA as text; `text-muted-foreground` #636362 passes). Add a guard test so the chrome greys can't drift again.

## Context (verified)
- `shell-palette-guard.test.ts` only scans 6 shell files and only forbids raw hex + shadow/gradient — it does NOT catch `AIPM-*-grey` chrome utilities (even `top-bar.tsx`, which it scans, drifted on `text-AIPM-dark-grey`). So this class is entirely unguarded.
- Token equivalences (light mode): `AIPM-light-grey` #E3E6E6 = `surface-muted`; `AIPM-dark-grey` #636362 = `foreground` = `muted-foreground`. The `AIPM-*-grey` values are FIXED (no dark variant) → wrong on dark surfaces; the semantic tokens flip correctly.
- DESIGN-TOKENS.md sanctions `AIPM-medium-grey` for the calendar "other" absence cell (a documented category, NOT drift).

## Scope: full audit (every grey hit classified)

### ① REPLACE — chrome (palette + dark-mode + a11y)
Map `text-AIPM-dark-grey [dark:text-AIPM-medium-grey]` → `text-muted-foreground` (preserve any `hover:text-AIPM-dark-blue` / `focus:ring-AIPM-green` / `dark:hover:text-AIPM-light-grey` accents on the same element):
- `app-header.tsx` — L65 (subtitle `<p>`), L88, L103, L123 (icon buttons).
- `top-bar.tsx` — L32, L51, L64 (icon buttons).
- `modal-header.tsx` — L73 (close ×).
- `outlook-import-modal.tsx` — L75 (close ×).
- `outlook-calendar-import-modal.tsx` — L103 (close ×).
- `project-switcher.tsx` — L112 (chevron `text-AIPM-dark-grey dark:text-AIPM-medium-grey` → `text-muted-foreground`).

Background / border chrome:
- `project-switcher.tsx` — L97 `hover:bg-AIPM-light-grey` → `hover:bg-surface-muted` (leave the rest of the className intact).
- `app-modals.tsx` — L203 `border-AIPM-light-grey … dark:border-zinc-800` → `border-line` (removes the off-palette `zinc-800` too).
- `resource-calendar.tsx` — L257 weekend `hover:bg-AIPM-medium-grey/20 dark:hover:bg-AIPM-medium-grey/20` → `hover:bg-surface-muted` (the cell base is already `bg-surface-muted`; the hover should be a token).

### ② REMAP — low-emphasis tints → `bg-surface-muted` (dark-mode correctness)
Replace `bg-AIPM-light-grey/NN` (and any `dark:bg-AIPM-medium-grey/NN` partner) with `bg-surface-muted` (drop the alpha; `surface-muted` already IS the light value and flips correctly in dark — confirm visually that the un-alpha'd tint reads acceptably; if too strong, keep a `/NN` on `bg-surface-muted`):
- `influence-interest-matrix.tsx` — L23 `bg-AIPM-light-grey/30 hover:bg-AIPM-light-grey/40`, L24 `hover:bg-AIPM-light-grey/30`.
- `stakeholder-map-panel.tsx` — L63 `bg-AIPM-light-grey/20 dark:bg-AIPM-medium-grey/25`.
- `stakeholders-panel.tsx` — L69 `bg-AIPM-light-grey/40 … dark:bg-AIPM-medium-grey/30` (keep the `text-foreground dark:text-AIPM-light-grey` text part).

### ③ KEEP — deliberate, documented category/status greys (NO change)
- `resource-calendar.tsx` — L67 "other" absence cell + L321 "Other" legend chip (`bg-AIPM-medium-grey/45…`) — DESIGN-TOKENS-sanctioned category.
- `action-row.tsx` — L19 `monitor` tier dot `bg-AIPM-medium-grey` (deliberate de-emphasized tier; decorative `aria-hidden` dot).
- `sidebar-footer.tsx` — L72 storage-not-ready dot `bg-AIPM-medium-grey` (neutral status vs `bg-AIPM-green` ready).
- `raci-chip-picker.tsx` — L18 RACI "I" = grey (intentional category, consistent with R/A/C on/off pattern).

### a11y note (OUT OF SCOPE — flagged)
RACI "I" *on* chip is white-on-`AIPM-medium-grey` (~2.6:1). But R/A/C off-states are equally low-contrast colored-text-on-white — RACI contrast is a pre-existing *whole-component* concern, not drift. Left for a separate dedicated pass.

## ④ Guard test — `palette-chrome-sweep.test.ts` (new)
Mirror `table-head-sweep.test.ts`: read every `src/app/*.tsx` (exclude `*.test.*`) and assert NONE contains the chrome-only grey utilities — regex forbidding `\b(?:bg|border|divide)-AIPM-light-grey\b` and `\btext-AIPM-dark-grey\b`. These have ZERO legitimate uses after the sweep. **Do NOT** forbid `AIPM-medium-grey` (legit category uses remain: tier dot, status dot, calendar "other", RACI). Include self-tests for the detection regex (flags `bg-AIPM-light-grey`, allows `bg-surface-muted` / `bg-AIPM-medium-grey`). The test must fail before the sweep and pass after.

## Version & testing
- **Version:** patch **0.79.1** (token hygiene + dark-mode/a11y fix; no feature, no new codename — 0.79.x stays "Willis"). CHANGELOG entry under `## [0.79.1]`. No new i18n keys; no version-highlight key (patch).
- **Testing:** the new guard test (red→green); `npx tsc --noEmit`; `npx eslint src/app --max-warnings=0`; full `npx vitest run` green; the existing per-file two-grep verification from [[design-system-batch]] (legacy-chrome regex = 0 in each swept file; duplicate-utility scan). e2e a11y green (now deterministic). Manual: spot-check the swept components in BOTH light and dark mode — no visual change in light, dark renders correctly.

## Out of scope
- RACI whole-component contrast (separate pass).
- `AIPM-medium-grey` category greys (kept by design).
- Any non-grey palette work / new components.

## File summary
**New:** `palette-chrome-sweep.test.ts`.
**Modified:** `app-header.tsx`, `top-bar.tsx`, `modal-header.tsx`, `outlook-import-modal.tsx`, `outlook-calendar-import-modal.tsx`, `project-switcher.tsx`, `app-modals.tsx`, `resource-calendar.tsx`, `influence-interest-matrix.tsx`, `stakeholder-map-panel.tsx`, `stakeholders-panel.tsx`, `version.ts`, `CHANGELOG.md`.
