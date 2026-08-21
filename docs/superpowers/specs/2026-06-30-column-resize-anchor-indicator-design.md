# Stronger Resize-Anchor Indicator — Design

**Date:** 2026-06-30
**Status:** Approved (design); not yet implemented

## Problem

Resizable table columns have **no resting-state indicator** of where the drag anchor sits.
The shared `ColumnResizeHandle` (`src/app/task-manager-ui.tsx`) is a 4px (`w-1`) invisible
strip on the right edge of each `<th>`; it only shows a faint `hover:bg-white/30` tint when
the pointer happens to land on it. Users must hunt for the anchor by hovering. Pane/window
resize corners (`useResizable`, native CSS `resize: both`) share the same "where do I grab?"
discoverability gap — the browser's native corner grip is faint and easy to miss.

## Goal

Make the draggable anchor **discoverable at rest** for both table columns and pane corners,
with clear hover/drag feedback, within the AIPM palette + dual-CI constraints.

## Decisions (from brainstorming)

- **Resting state:** always-visible grip (vertical `⋮` dots) on each resizable column edge.
- **Grab tolerance:** tight — the visible grip *is* the grabbable zone (no wider invisible
  hit area). Visible strip widened slightly (4px → 6px) so the dots fit and it stays grabbable.
- **Scope:** table columns **and** pane/window resize corners.

## Architecture

Two files. **No call-site changes** across the ~14 panels that consume `ColumnResizeHandle`,
and **no change to `useColumnResize`/`useResizable`**.

Key mechanism: CSS `:active` matches from mousedown to mouseup on the pressed element even
after the pointer leaves it during a window-level drag — so the drag-time accent is delivered
by Tailwind's `active:` variant alone, with no React drag state.

### 1. Column grip — `ColumnResizeHandle` (`src/app/task-manager-ui.tsx`)

Replace the current body:

```tsx
className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-white/30 print:hidden"
```

New behavior:

- Strip: `absolute right-0 top-0 h-full w-1.5` (6px), `cursor-col-resize select-none print:hidden`,
  `aria-hidden="true"` (unchanged — decorative).
- Always-visible 3-dot `⋮` grip via an **inline SVG using `currentColor`**, centered vertically.
- Resting color: dim — `text-[var(--table-head-fg)]` at ~40% opacity (e.g. `opacity-40`).
- Hover **and** drag: `hover:text-[var(--table-head-accent)] active:text-[var(--table-head-accent)]`,
  plus a faint token tint on hover/active (`hover:bg-[var(--table-head-fg)]/10` —
  pre-composited / opacity on a token, no off-palette color).
- Remove `hover:bg-white/30` (off-palette white) entirely.

Grip SVG: three small circles (`fill="currentColor"`) stacked vertically inside the strip,
`aria-hidden`, sized to fit the 6px width (dots ~1.5px radius). `currentColor` lets the
`text-*` classes above drive rest/hover/active color in one place.

### 2. Pane corners — `globals.css`

Add a `::-webkit-resizer` rule so the native resize grip on every `resize` element becomes
clearly visible:

```css
::-webkit-resizer {
  background-color: var(--table-head-accent); /* or a dedicated --resizer token */
}
```

- Solid color only (no gradient/shadow → palette-safe). Pick the token that reads well on the
  light pane backgrounds; eye-verify in both CI styles + dark mode. If `--table-head-accent`
  is wrong on a light surface, introduce a small dedicated `--resizer` token in `:root` /
  `[data-style="mockup"]` / `.dark` (mirrors the existing role-token pattern).
- Applies to **all** native resizers, including resize-textareas (task form, narrative editor).
  This is intentional and consistent. If pane-only scoping is later required, gate via a class
  on the resizable containers (extra wiring) — not done now.
- Chromium/WebKit only; Firefox keeps its native grip (graceful degrade). CI e2e is chromium.

## Constraints honored

- **Palette:** only `--table-head-fg` / `--table-head-accent` (+ optional `--resizer`), all
  dual-CI tokens. No raw colors, gradients, or shadows. `palette-sweep` clean (no `box-shadow`,
  no `bg-gradient-`).
- **Print:** column grips stay `print:hidden`; `::-webkit-resizer` is irrelevant in print.
- **a11y / axe:** grip stays decorative (`aria-hidden`); no new AT-exposed interactive control,
  so no new accessible-name/keyboard obligation. Resize remains a mouse enhancement (columns
  stay usable; `ResetColWidths` exists). Re-run the axe gate on the gated table views
  (tasks/`open-points`, milestones, changes, raid, reports) to confirm no regression.
- **Dual-CI:** verify rest/hover/active grip color + resizer corner in AIPM-light, AIPM-dark,
  and Mockup-light.

## Testing

- **Unit** (`task-manager-ui` tests): `ColumnResizeHandle` renders the grip, carries
  `aria-hidden`, has `cursor-col-resize`, and invokes `onMouseDown(col, e)` on mousedown.
- **Eye-verify:** resting dots visible but quiet; hover → accent; drag (button held, pointer
  moved away) → accent persists via `:active`; pane corner clearly visible. All across
  AIPM-light / AIPM-dark / Mockup-light.
- **axe gate:** `npx playwright test e2e/a11y.spec.ts --project=chromium` on the touched table
  views — expect green (decorative grip).

## Risk / fallback

If `:active` drag-highlight proves unreliable in practice, fall back to exposing `activeCol`
state from `useColumnResize` (set on down, cleared on up) + an `active?: boolean` prop on
`ColumnResizeHandle` (touches the ~14 call sites). Ship `:active` first; verify by eye before
adopting the fallback.

## Out of scope (YAGNI)

- Keyboard-operable resize (arrow-key column sizing).
- Full-table drag guide line (live resize already shows the width change).
- Touch/pointer-event resize parity.
