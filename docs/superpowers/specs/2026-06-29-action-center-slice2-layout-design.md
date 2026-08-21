# Action Center Roadmap — Slice 2: Layout & Scannability — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Roadmap position:** Slice 2 of 4 (Ranking/noise ✓ → **Layout** → New providers → Inline CTAs)
**Branch:** `feat-action-center-slice2` (off `feat-action-center-slice1`, which is not yet merged)

## Problem

The Action Center rows are cramped and hard to scan: up to ~4 inline CTA buttons per row (Open + one contextual + Create-task + Snooze), a small RAG dot that's easy to miss, and the slice-1 "+N more reasons" line is static (can't see what the other reasons are).

Slice 2 is **layout only** — no engine/ranking change, no new signals, no new CTAs.

## Goals

1. Make urgency scannable: a RAG-colored left stripe per row (replacing the dot).
2. Declutter row actions: keep `Open` inline; fold the simple secondary actions into one `[⋮]` overflow popover.
3. Make "+N more reasons" expandable to reveal the other signals' text.
4. Tighter default row density.

## Non-Goals

- No `role=menu` roving-tabindex widget — reuse the existing snooze-popover pattern (plain buttons in a `usePopoverDismiss` popover; Tab/Enter/Escape). The `actions` view is NOT in the axe gate (`A11Y_VIEWS` has 14 views, Action Center is not one) → a11y is unit-tested + eye-verified.
- No full fold of the contextual popovers. Assign/Escalate/Re-baseline are self-contained popover components and are **mutually exclusive** (≤1 per row, gated by source+reason); they stay as their own inline button. (Folding them would mean refactoring `escalate-popover.tsx`/`rebaseline-popover.tsx`/the assign dialog — deferred/declined.)
- No per-reason CTA in the expanded list (that's slice 4). Expanded reasons are read-only text.
- No density toggle — single tighter default (YAGNI).
- No `actions-panel` tier/cap change (slice-1 behavior unchanged).

## Design

### `src/app/action-row.tsx`

**1. RAG left stripe replaces the dot.**
- Remove the dot `<span>` (`healthDot[TIER_RAG[action.tier]]`).
- Add a `border-l-4` colored stripe to the row root via a new map (same `--rag-*` tokens `healthDot` uses, so it reflows under the dual-CI style switch and is palette-safe):
  ```ts
  const TIER_STRIPE: Record<ActionTier, string> = {
    now: "border-l-[var(--rag-red)]",
    soon: "border-l-[var(--rag-amber)]",
    monitor: "border-l-[var(--rag-green)]",
  };
  ```
- Row root className adds `border-l-4 ${TIER_STRIPE[action.tier]}` (the existing `border border-line` stays for the other three sides; `border-l-4` widens the left, the token recolors it).

**2. `[⋮]` overflow popover (partial fold).**
- Replace the current standalone Snooze popover with a single `[⋮]` ("more actions") popover that contains, as plain `<button>` items, every APPLICABLE simple action:
  - Draft message — when `canDraft`
  - Create task — when `onCreateTask && action.source !== "task-due"`
  - Snooze 1h / Snooze 1d — when `onSnooze`
- The trigger is a `[⋮]` button: `aria-haspopup`, `aria-expanded`, and a **row-unique** `aria-label` = `` `${t(lang,"actionMoreActions")} – ${title}` `` (label-collision guard, since the panel renders many rows).
- The popover reuses `usePopoverDismiss` (already imported) + the existing Escape/outside-click handling. Each item: `onClick` does `e.stopPropagation()`, runs the handler, closes the popover.
- **Render the `[⋮]` only when ≥1 item applies** (with `onSnooze` present it effectively always has the snooze items; if a popout passes no handlers it won't render — no empty menu).
- The contextual popovers stay exactly as today, each as its own inline button BEFORE the `[⋮]`: `EscalatePopover` (canEscalate), `RebaselinePopover` (canRebaseline*), and the inline Assign dialog (canAssign). `Open` stays the inline primary, first.
- Net row tail: `[Open] [contextual popover?] [⋮]` — ≤3 controls.

**3. Expandable "+N more reasons".**
- Replace the `extraReasonsCount?: number` prop with `extraReasons?: readonly SuggestedAction[]` (the group's `extra`).
- Render a toggle `<button>` (when `extraReasons?.length`): label `t(lang,"actionMoreReasons", extraReasons.length)` with a `▸`/`▾` chevron, `aria-expanded`, `aria-controls` → a list `<div id>`. `e.stopPropagation()` so it doesn't trigger the row's `Open`.
- Expanded: a list, one line per extra signal showing its translated `why` (`t(lang, ex.why.key, ...ex.why.params)`), muted text. Read-only.
- Local `useState` `reasonsOpen`. (No persistence; collapses on remount — acceptable, matches the panel's show-more.)

**4. Density.** Row root padding `px-3 py-2` → `px-3 py-1.5`; the tail `gap-1` and the content `gap-3` → `gap-2`. (Visual tightening only; no token/font/contrast change.)

### `src/app/actions-panel.tsx`
- Change the `ActionRow` prop from `extraReasonsCount={g.extra.length}` to `extraReasons={g.extra}`. No other change (grouping/cap/tiers unchanged from slice 1).

### i18n
New key `actionMoreActions`, EN + DE:
| Key | EN | DE |
|---|---|---|
| `actionMoreActions` | `More actions` | `Weitere Aktionen` |

(DE has no umlaut here, but still write via node utf8 to avoid the Edit tool's curly-quote corruption on `i18n.de.ts`; verify parity via `npx tsc --noEmit`.) Reuse existing keys: `actionMoreReasons` (toggle label), `actionDraftMessage`, `actionCreateTask`, `actionSnooze1h`, `actionSnooze1d`.

## Testing

- **`action-row.test.tsx`** (update the slice-1 `extraReasonsCount` test + add):
  - RAG stripe: row root carries the tier's `border-l-[var(--rag-*)]` class; the old dot span is gone.
  - `[⋮]` menu: trigger has a row-unique aria-label; opening shows only the APPLICABLE items (e.g. a task-due row shows Draft + Snooze, no Create-task; a raid-severity row shows Create-task + Snooze + the Escalate button stays inline); clicking Snooze 1h calls `onSnooze` with `SNOOZE_1D`/`SNOOZE_1H` and closes; Draft calls `onDraftMessage`; Escape/outside-click closes.
  - Contextual popover unchanged: a canEscalate row still renders the Escalate trigger as its own button (not inside `[⋮]`).
  - Expandable reasons: with `extraReasons` of length 2, the toggle shows "+2 more reasons"; clicking reveals both `why` texts and flips `aria-expanded`; clicking the toggle does NOT fire row `onOpen` (stopPropagation).
- **`actions-panel.test.tsx`**: the collapse test now asserts the expanded reasons text is reachable (toggle → extra why visible), and that `extraReasons` is threaded (one row, expand shows the second signal's reason).
- `npx tsc --noEmit`, `npm run lint`, `npm run test:run`.
- **Eye-verify** (not axe-gated): the `[⋮]` menu keyboard path + the RAG stripe contrast in AIPM light/dark + Mockup, at the `actions` view.

## Acceptance

- Each row shows a colored left stripe (red/amber/green by tier), no dot.
- Row tail is `Open` + (≤1 contextual button) + `[⋮]`; the simple actions live in the `[⋮]` popover with a row-unique label.
- "+N more reasons" expands to show the other signals' text; collapses again; never triggers row Open.
- Slice-1 grouping/cap/tiers behavior unchanged.
- All gates green.
