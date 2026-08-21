# Modal field controls → modal header

**Date:** 2026-08-06
**Status:** approved, ready for planning
**Source:** `docs/patterns/movebox.png` (in `C:\Projects\aipm-cockpit`, not this worktree) — red box around the
Simple/Advanced/Full row under the "New task" header, arrow pointing up.

## Problem

Every edit modal spends a full row of vertical chrome on a bordered strip that holds one right-aligned
segmented control plus a cog. The strip sits between the header and the form, so the first real field is
pushed down on a 900px-tall task modal and on a 560px register modal alike.

The strip is `ModalFieldControls` (`src/app/modal-field-controls.tsx`), rendered directly under
`ModalHeader` at three call sites. `ModalHeader` already exposes a `headerExtra` slot — rendered first in
the right-hand cluster, inside the `onPointerDown={stopDrag}` guard — and nothing uses it today.

## Decisions

1. **Scope: all modals.** One shared component, three call sites; every edit modal gains the row back.
   Covers task, change, raid, stakeholder, absence, milestone, resource, calendar-event, budget-bucket.
2. **The tier switch folds into the cog popover**, rather than moving into the header beside the mic.
   German labels (`Einfach` / `Erweitert` / `Vollständig`) plus a `Benutzerdefiniert` state do not fit a
   560px header that already carries mic + reset-size + close. Inside the popover, width is ours to set.
3. **The trigger carries the active tier as visible text** (`Advanced ⚙`), so folding the switch away does
   not hide which tier is active.
4. **No hand-rolled controls.** The current segments are bespoke `aria-pressed` buttons and the cog is a
   `<span>⚙</span>` in a hand-styled box. Both are replaced by existing primitives.

## Design

### `modal-field-controls.tsx`

Stops owning a bordered strip; becomes a header-mounted trigger plus its popover.

**Trigger** — `Button variant="secondary" size="xs"`, `ref` forwarded as the popover anchor:

- Visible content: the active tier label + `Cog6ToothIcon` (`h-4 w-4`, `aria-hidden`, heroicons — matching
  the rest of the app's icon set; the `⚙` glyph goes).
- Visible label is the tier: `Simple` / `Advanced` / `Full` / `Custom`.
- `aria-label={`${tierLabel} – ${t(lang, "configureFields")}`}` — the visible word comes first, so WCAG
  2.5.3 label-in-name holds. **No new i18n keys**: the string is composed at runtime from two existing
  keys, which keeps `i18n.de.ts` untouched and avoids the umlaut-corruption edit path entirely.
- `aria-haspopup="dialog"` + `aria-expanded` (`PopoverPanel` already renders `role="dialog"`).

**Popover** — the existing `PopoverPanel`, mechanics unchanged (anchor ref, `onClose`, dismissal). Content
gains the tier switch above the existing list:

```
┌────────────────────────────────┐
│ ( Simple | Advanced | Full )   │  SegmentedControl, radiogroup
│────────────────────────────────│
│ ☑ Name            (disabled)   │  existing Checkbox list
│ ☑ Priority                     │
│ ☐ Labels                       │
│      [ Reset to default ]      │  Button secondary xs, w-full
└────────────────────────────────┘
```

- Tier switch is `SegmentedControl<FieldTier>` with `ariaLabel={t(lang,"fieldViewLabel")}` — a
  `role="radiogroup"` with `aria-checked`, roving tabindex and APG arrow/Home/End navigation, none of which
  the hand-rolled version had.
- **Custom mode renders no checked radio.** The current 4th pseudo-chip (a non-interactive `<span>` that
  only ever appears in custom mode) is deleted; `SegmentedControl` already handles a `value` matching no
  option — it leaves the group unchecked and keeps the first radio as the Tab-stop, so the group is never
  keyboard-unreachable. The custom state is surfaced by the trigger text and by the checkbox list itself.
- Popover widens from `w-56` to `w-72`, since three DE tier labels at the primitive's `text-sm px-3` are
  wider than 224px. The primitive's wrapper is `flex-wrap`, so an over-wide set wraps rather than clipping.
- The reset button drops its hand-rolled class string for `Button variant="secondary" size="xs"`
  (`className="mt-3 w-full"`).
- `settings.showFieldConfig === false` still returns `null`. It now removes the trigger only — there is no
  strip left to leave an empty bordered band, which was the reason the strip was owned here. **The file's
  leading comment documents that ownership and must be rewritten**, not left to rot.

### Call sites

| File | Change |
|---|---|
| `task-form-modal.tsx` | delete the standalone element; pass it as `headerExtra` on `ModalHeader` |
| `edit-modal-chrome.tsx` (`EditModalShell`) | same — covers change / raid / stakeholder / absence / milestone / resource / calendar-event |
| `budget-bucket-modal.tsx` | same |

Resulting header cluster: `Advanced ⚙ │ 🎤 │ ⤡ │ ✕`. `headerExtra` sits inside the cluster's
`onPointerDown={stopDrag}` guard, so opening the popover cannot start a window drag. The header title
already carries `min-w-0 truncate`.

## Testing

Eleven test files mention the tier, but only `modal-field-controls.test.tsx` drives it through the UI
(3 tests). Every other modal test seeds field visibility through state, so they are untouched by this
change — verified by reading their call sites, not inferred from the grep count.

**Updated** (`modal-field-controls.test.tsx`): tier assertions move from
`getByRole("button", {name})` + `aria-pressed` to `getByRole("radio", {name})` + `aria-checked`, and each
must open the popover first.

**New:**

- Trigger's visible text tracks the active tier, including `Custom` after a hand-toggle.
- Trigger's accessible name contains its visible label (label-in-name).
- The tier radiogroup is inside the popover — absent from the DOM until the trigger is clicked.
- `showFieldConfig === false` renders nothing.
- One call-site test asserting the control is inside the `<header>` (mutation-proof: a test that only
  asserts presence passes against the unfixed layout).

**Known trap, already documented in the sibling modal tests:** with the popover open, its checkbox labels
collide with body field labels. Tests that touch a tier must close the popover before querying the body.

## Verification

Kept deliberately narrow — the change is one component plus three one-line call sites.

Per iteration:

- `npx vitest run` on the touched files only.
- `npx tsc --noEmit` (the only thing that typechecks tests).
- `npx eslint --max-warnings=0 src/app` — unpiped, exit code read directly.

Once, at the end:

- One full `npm run test:run`, redirected to a file, exit code read unpiped.
- **Browser eye-verify** — this is the check that matters and the one no gate can do: jsdom has no layout,
  so nothing in the unit suite can see whether the header fits. Look at a 560px register modal in DE, in
  Custom mode, which is the widest trigger label against the narrowest header.

Skipped, with reasons: `test:shuffle` (no cross-file state added); the axe e2e gate (it scans views, and
these modals open only on interaction, so no scanned surface changes) — the a11y properties that do change
are radiogroup semantics and label-in-name, both covered by unit tests above.

## Out of scope

- Segment styling and the `--segment-*` tokens: adopting `SegmentedControl` inherits its look as-is.
- The per-device `showFieldConfig` opt-out semantics.
- Version bump / CHANGELOG: this is user-visible, so it needs one at release time, not during the slice.
