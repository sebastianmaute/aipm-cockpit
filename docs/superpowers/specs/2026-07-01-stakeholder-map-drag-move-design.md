# Stakeholder Influence/Interest — Drag-to-move Design

**Date:** 2026-07-01
**Status:** Approved (design)

## Goal

Let the user drag a stakeholder chip between quadrants of the Influence/Interest 2×2
matrix (`stakeholder-map-panel.tsx`). A drop rewrites that stakeholder's `influence`
and `interest` attributes, which then reflect everywhere that reads live workspace
state — the stakeholders pane and the stakeholder edit modal — with no extra wiring.

## Background / constraints

- `Stakeholder.influence` and `Stakeholder.interest` are `InfluenceInterest =
  "High" | "Medium" | "Low"` (3 levels).
- The grid is 2×2. `quadrantFor(s)` (in `stakeholders.ts`) folds `Medium`+`Low` into
  the "low" bucket: only `High` counts as high.
- The mismatch (3-level store vs 2-boolean grid) is the core design decision — see
  **Drop semantics**.
- `handleSaveStakeholder(item)` (in `use-stakeholders.ts`, surfaced by `task-manager`)
  already: upserts via a functional `setStakeholders(prev=>…)` updater, stamps
  `localModifiedAt`, and logs the `stakeholder.updated` activity kind. The drag-move
  reuses it — so moves log + stamp for free, and bulk/rapid drops compose safely.
- It is already threaded through `WorkspaceSectionProps` → `workspace-section.tsx`,
  which mounts `<StakeholderMapPanel>`. It is `guardEdit`-wrapped in `task-manager`
  (no-ops in popouts).
- No new persisted `Workspace` field → no six-write-path, no golden fixtures, no
  CSV/MD/Turso changes.

## Drop semantics — "preserve-Medium" (chosen)

A quadrant asserts two booleans: `(highInfluence, highInterest)`.

```
QUADRANT_TARGET: Record<StakeholderQuadrant, readonly [boolean, boolean]>
  manage-closely → [true,  true]
  keep-satisfied → [true,  false]
  keep-informed  → [false, true]
  monitor        → [false, false]
```

Per axis:

```
axisTarget(current: InfluenceInterest, wantHigh: boolean): InfluenceInterest
  wantHigh            → "High"
  !wantHigh && High   → "Medium"          // demote out of the high band
  !wantHigh && !High  → current           // preserve Medium / Low untouched
```

Rationale: the only forced change on the low side is `High → Medium` (dragging a
stakeholder OUT of the high band). Existing `Medium`/`Low` values are preserved, so
the 2×2's coarseness never silently flattens `Medium` to `Low`.

**Documented quirk:** round-trips are not identity. A `Low`/`Low` monitor stakeholder
dragged to keep-satisfied (`High` influence) and back to monitor lands with influence
= `Medium`, not `Low`. Inherent to preserve-Medium; a unit test asserts it so the
behavior is intentional, not a regression.

**Chip visual:** chips stay plain (no level badge). The 2×2 remains a coarse
High/low map; exact levels live in the edit modal + stakeholders pane, which already
show them. (Scope decision: YAGNI.)

## Components

### 1. Pure engine — `stakeholders.ts` (i18n-free, next to `quadrantFor`)

```ts
export const QUADRANT_TARGET: Record<StakeholderQuadrant, readonly [boolean, boolean]> = {
  "manage-closely": [true, true],
  "keep-satisfied": [true, false],
  "keep-informed": [false, true],
  monitor: [false, false],
};

function axisTarget(current: InfluenceInterest, wantHigh: boolean): InfluenceInterest {
  if (wantHigh) return "High";
  return current === "High" ? "Medium" : current;
}

/** Apply a quadrant drop to a stakeholder using the preserve-Medium rule.
 *  Returns a new Stakeholder, or null when nothing would change (no-op drop). */
export function applyQuadrantMove(
  s: Stakeholder,
  quadrant: StakeholderQuadrant,
): Stakeholder | null {
  const [hi, ht] = QUADRANT_TARGET[quadrant];
  const influence = axisTarget(s.influence, hi);
  const interest = axisTarget(s.interest, ht);
  if (influence === s.influence && interest === s.interest) return null;
  return { ...s, influence, interest };
}
```

- What it does: maps a drop target to new attribute values.
- Depends on: `Stakeholder`, `InfluenceInterest`, `StakeholderQuadrant` types only.
- `null` no-op means a drop into the chip's own quadrant with nothing to demote
  writes nothing — no `localModifiedAt` churn or spurious activity entry.

### 2. Panel — `stakeholder-map-panel.tsx` (native HTML5 DnD, no lib; mirrors the Kanban board)

- New optional prop: `onSaveStakeholder?: (s: Stakeholder) => void`.
- **Editable gate:** `const editable = !!onSaveStakeholder`. Drag affordances render
  only when `editable` (same pattern the panel already uses for `onOpenStakeholder`).
- **Chip:** keep the existing click→edit `<button>` (unchanged keyboard behaviour).
  When `editable`, add `draggable` + `onDragStart` that sets
  `e.dataTransfer.setData("text/plain", String(s.id))` and
  `e.dataTransfer.effectAllowed = "move"`. A native drag suppresses the click, so the
  button stays both draggable and clickable.
- **Quadrant cell:** when `editable`, add `onDragOver` (`e.preventDefault()`,
  `dropEffect="move"`) + an `onDragEnter`/`onDragLeave` counter driving a highlight
  ring (`ring-2 ring-AIPM-green` over the existing tint — token-only, palette-safe),
  and `onDrop`:

  ```ts
  function onDropInto(q: StakeholderQuadrant, e: React.DragEvent) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const s = stakeholders.find((x) => x.id === id);
    if (!s) return;
    const moved = applyQuadrantMove(s, q);
    if (moved) onSaveStakeholder?.(moved);
  }
  ```

- Non-editable (read-only popout mirror): chips remain plain text / non-draggable;
  cells are not drop targets. Unchanged from today.

### 3. Wiring — `workspace-section.tsx`

At the existing `<StakeholderMapPanel>` mount, add
`onSaveStakeholder={isPopout ? undefined : handleSaveStakeholder}` (same `!isPopout`
gate as `onOpenStakeholder`). `handleSaveStakeholder` is already a prop on
`WorkspaceSectionProps`; no new prop threading beyond the panel itself.

## Data flow

drop → `applyQuadrantMove` → `handleSaveStakeholder(moved)` →
`setStakeholders(prev=>…)` (functional, stamps `localModifiedAt`, logs
`stakeholder.updated`) → live workspace state → stakeholders pane + edit modal
re-render with the new levels. Storage persists via the existing single-item save
path (no new codec/backend work).

## Error handling / edge cases

- Unknown/stale dragged id (`stakeholders.find` miss) → drop is a silent no-op.
- No-op drop (same quadrant, nothing to demote) → `applyQuadrantMove` returns `null`
  → no save, no log.
- Non-numeric `dataTransfer` payload → `Number(...)` is `NaN` → `find` miss → no-op.
- Popout / read-only → no handler → drag disabled entirely.

## Accessibility

- The stakeholder-map view is **not** in the axe `A11Y_VIEWS` gate.
- Drag is a mouse enhancement. The keyboard path to change influence/interest is the
  edit modal's existing High/Med/Low `<select>`s (mirrors the Kanban board's per-card
  status select being the keyboard path). No new keyboard-only control is required.
- Chips keep their labeled edit `<button>` (`aria-label` `${edit} – ${name}`),
  unchanged.
- Eye-verify the drop-target highlight uses only brand tokens (`ring-AIPM-green` over
  the existing quadrant tint) — no off-palette colour, no shadow/gradient.

## Testing

- **`stakeholders.test.ts` — `applyQuadrantMove`:**
  - each quadrant sets the expected `(influence, interest)` from a `Low`/`Low` start;
  - preserve-Medium: dropping a `Medium`/`Medium` monitor stakeholder into monitor →
    `null` (no-op); a `Medium` interest dropped into keep-satisfied keeps interest
    `Medium`;
  - `High → Medium` demotion when dragged out of the high band;
  - round-trip quirk: `Low`/`Low` → keep-satisfied → monitor yields influence
    `Medium` (asserted intentional).
- **`stakeholder-map-panel.test.tsx`:**
  - editable: `fireEvent.drop` on a quadrant cell with a `dataTransfer` stub carrying
    a stakeholder id → `onSaveStakeholder` called once with the moved stakeholder;
  - no-op drop (same quadrant) → `onSaveStakeholder` not called;
  - no handler (read-only) → chips have no `draggable` attribute and cells accept no
    drop.
- Run `npx tsc --noEmit` after editing tests (test-only type errors pass vitest+build
  but fail CI tsc).

## Out of scope (YAGNI)

- Chip level badges / any new grid visual beyond the transient drop highlight.
- Touch-drag (pointer events) — native HTML5 DnD only, matching the Kanban board.
- New i18n strings — no user-facing copy is added.
