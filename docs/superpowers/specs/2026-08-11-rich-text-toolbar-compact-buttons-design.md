# Rich-text toolbar: compact borderless buttons, tiptap simple-editor match

## Goal

`rich-text-toolbar.tsx` already went icon-only (see the earlier
`2026-08-11-rich-text-toolbar-icons-design.md` slice), matching the tiptap
"Simple" template's *icon set*. This slice matches its *button chrome*: drop
the pressed-state checkmark, shrink the buttons, remove their border — so the
toolbar looks like https://tiptap.dev/docs/ui-components/templates/simple-editor
(reference source: `ueberdosis/tiptap-ui-components`,
`apps/web/src/components/tiptap-ui-primitive/button/{button,button-colors}.scss`).

## Why not just restyle the shared `ToggleButton`

`ToggleButton` (`src/app/toggle-button.tsx`) is used by ~25 other call sites
(Gantt View menu, Settings rows, dashboard chips) that keep today's bordered
chip look. This slice adds a new toolbar-local component,
`rich-text-toolbar-button.tsx`, used only by `rich-text-toolbar.tsx`.
`toggle-button.tsx` is not touched.

## Why not a pure background-color pressed state (matching tiptap exactly)

Tiptap's own reference toggles pressed state via background tint + icon-hue
change alone, no separate marker. Measured against this app's real tokens
(`node -e` relative-luminance script, `blend(surface, accent, alpha)` per
scheme):

| Scheme | min tint alpha for 3:1 (light) | solid accent vs dark surface |
|---|---|---|
| Harbor | 55% | 1.10:1 |
| Meridian | 55% | 1.17:1 |
| Umber | 55% | 1.31:1 |

Two problems: (1) 55% opacity reads as a solid chip, not tiptap's pale tint —
not actually a visual match; (2) in dark mode `--ui-dark-blue` sits at
~1.1-1.3:1 against the dark surface **even at 100% opacity** — the token has
no lightness headroom, so no tint amount clears WCAG 1.4.1's ≥3:1 lightness-
delta bar. This is the same class of defect `data-pressed-marker` was added
to close (AGENTS.md, `rich-text-toolbar.tsx` header comment) — reintroducing
it silently would be a known regression, not an oversight.

Resolution: keep a non-color cue, but make it far smaller than today's
checkmark (which is why "smaller/narrower" and "no glyph" aren't in tension
here — the marker shrinks, it doesn't disappear).

## Component: `rich-text-toolbar-button.tsx`

One presentational component, replacing every control in the toolbar (12
mark/block toggles, the heading-level trigger, Link, Unlink):

```ts
interface ToolbarButtonProps {
  active?: boolean;                 // drives the pressed/expanded visual
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  lang?: Lang;                      // on/off tooltip suffix, "toggle" kind only
  stateKind?: "toggle" | "disclosure" | "action"; // default "action"
  accent?: "dark-blue" | "pink";
  preventFocusSteal?: boolean;
  children: ReactNode;              // icon only
}
```

`stateKind` selects the aria attribute (`aria-pressed` / `aria-expanded` /
neither); `active` drives the shared visual regardless of which. Link and
Unlink use `stateKind="action"` and never pass `active` (no pressed/expanded
state exists for them — always the default/hover visual, no marker). The heading
trigger becomes `stateKind="disclosure"` `active={headingMenuOpen}` — tiptap's
own CSS paints an open dropdown trigger with the same active style as a
pressed toggle (`data-state="open"` shares `--tt-button-active-*` with
`data-active-state="on"`), so this mirrors that.

`preventFocusSteal` carries over the existing per-control split unchanged:
the 12 toggles and Link/Unlink opt in (acting on the editor's selection);
the heading trigger does not (opening a popover doesn't blur the
contenteditable the way stealing focus for a mark command does — see the
existing AGENTS.md note on why `setLevel` needs no `.chain().focus()`).

## Visual spec

Sizing: tiptap's own "small" preset (their docs define two sizes; small is
built for tight toolbars, which is what "narrower and smaller" maps to):

- Box: `h-6 w-6` (24px square), `rounded-lg` (8px radius), **no border**
- Icon: `h-3.5 w-3.5` (14px), down from today's 16px (`ICON_CLASS`)
- Gap between controls: `gap-0.5` (was `gap-1`)
- `ToolbarDivider` margin tightened to match

Color states reuse today's already-tested per-scheme/per-accent tokens
verbatim — this is deliberate, not a new palette:
- Default: transparent background, `text-foreground`
- Hover: `hover:bg-surface-muted` (existing neutral hover token)
- Active/pressed (light): `bg-ui-dark-blue/10 text-ui-dark-blue` (or the
  `pink` accent family for Highlight), `hover:bg-ui-dark-blue/20`
- Active/pressed (dark): `dark:bg-ui-dark-blue/20 dark:text-ui-light-grey`

Reusing these tokens is what keeps dark mode compliant without inventing new
color math — `ui-light-grey` already has strong contrast against every dark
surface, which is why today's fix works there.

## The non-color cue

Replaces the trailing checkmark: a `bg-current` bar, ~10px wide × 2px tall,
`rounded-full`, absolutely positioned under the icon (`bottom-0.5`, centered
via `left-1/2 -translate-x-1/2`), `aria-hidden`. `opacity-0` when inactive →
`opacity-100` when active.

This is an overlay, not a flex sibling — unlike today's checkmark, it does
**not** reserve width when inactive. That's most of where the width
reduction actually comes from, more than the box shrink alone. Keeps a
`data-pressed-marker` attribute (mirroring today's pattern) for continuity,
though the toggling mechanism moves from `invisible`/visible to opacity.

Because `bg-current` inherits the same active-state text color already
proven compliant above, the marker itself never has a separate contrast
question to answer.

## Scope

**Changed:** `rich-text-toolbar.tsx` (every control swapped to the new
component; row/divider gaps tightened), new `rich-text-toolbar-button.tsx`,
its test file.

**Unchanged:** `toggle-button.tsx` and its ~25 other consumers. `button.tsx`
(the plain shared `Button`, previously used for the heading trigger/Link/
Unlink) — no longer used by this toolbar, but not modified itself.

**Out of scope:** `RichTextEditor`'s public props, the heading menu's
dropdown items (unaffected — they're not `ToolbarButton`s), task list /
alignment controls (already out per the existing header comment — separate
security-review slice).

## Testing

`rich-text-toolbar.test.tsx` needs real rewriting, not a class-string
tweak — the marker visibility mechanism changes (`invisible` class →
`opacity-0`), and the "does the group role work / caret-move refresh /
multi-editor accessible-name" assertions need to keep passing against the
new DOM shape. New `rich-text-toolbar-button.test.tsx` covers the component
itself in isolation: `stateKind` → correct aria attribute, `active` → visual
+ marker, `preventFocusSteal` opt-in/opt-out, accent variants.

axe gate is unaffected either way — the note already on file (AGENTS.md /
the original icons-design spec) is that axe cannot see accessible-name
collisions or 1.4.1 color-only violations at any seed size; the unit tests
above are the only coverage, same as before this slice.
