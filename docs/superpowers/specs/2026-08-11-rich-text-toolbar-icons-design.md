# Rich-text toolbar: icon-only controls

Design for converting `RichTextToolbar` (`src/app/rich-text-toolbar.tsx`) from
text-labeled buttons to an icon-only toolbar, visually modeled on the tiptap
"Simple" template (https://template.tiptap.dev/preview/templates/simple).

## Motivation

Today every control in `RichTextToolbar` is a `ToggleButton`/`Button` whose
visible text IS its accessible name (WCAG 2.5.3 holds "by construction" per
`AGENTS.md`'s rich-text-toolbar bullet). That reads as a generic form toolbar
rather than a familiar rich-text editor toolbar. The user wants the icon-driven
look of tiptap's own reference template.

## Scope

This design covers **only** `RichTextToolbar` and its heading control. It
introduces `lucide-react` as a new dependency, used **only inside this
component** for now.

**Explicitly out of scope** (flagged during brainstorming and deferred by the
user): replacing `@heroicons/react` app-wide with `lucide-react`. Heroicons is
imported across 50+ files (`nav-icons.tsx`, `app-header.tsx`, action-center,
budget-panel, and more); a full swap is a separate project with its own
brainstorm/spec/plan, given the size-ratchet/dup-gate/doc-symbol-check
exposure and visual-regression surface across every view. Until that project
happens, the app has two icon packages: heroicons everywhere else, lucide-react
in this one component.

## Current structure (for reference)

- `CONTROLS = [...BLOCKS, ...MARKS]`: 12 toggleable marks/blocks, each a
  `ToggleButton` whose `children` is the translated label text.
- A native `<select>` for heading level (Paragraph/H1-H4), driven by
  `setLevel`/`setHeading`/`setParagraph` — deliberately NOT `toggleHeading`
  (picking the level already active must be a no-op), and deliberately without
  `.chain().focus()` (a closed `<select>` fires `change` on every arrow
  keypress in Chrome/Firefox; chaining `.focus()` there pulled DOM focus into
  the editor on the first ArrowDown and made Headings 2-4 unreachable by
  keyboard).
- Two plain `Button`s for Link/Unlink, each with text children.
- The `useEditorState` selector, the caret-move re-render fix, the
  `preventFocusSteal` mousedown guards, and the `group`-vs-`toolbar` role
  choice are all unaffected by this design and stay exactly as they are.

## Toolbar row: icon-only controls

Every mark/block button becomes icon-only:

- `ToggleButton`'s existing API already supports this with **no primitive
  changes**: pass the icon element as `children` (verified: lucide-react's base
  `Icon` component defaults `aria-hidden="true"` under the same condition
  heroicons does — no children, no other a11y prop passed — so an explicit
  `aria-hidden="true"` on each icon is belt-and-braces, same convention
  `toggle-button.tsx` already documents for heroicons), and pass `ariaLabel` +
  `title` as the same translated label text used today (e.g.
  `t(lang, "commTplBold")`). The existing `lang`-driven "· On/Off" tooltip
  suffix, `aria-pressed`, and the non-colour check-marker glyph are unaffected.
- Link/Unlink (plain `Button`s) get the same treatment: icon child +
  `aria-label`.
- Hit target, border-radius, and spacing language stay the same as today's
  chips (32px squares, `gap-1` row).

### Grouping

Six groups, separated by a thin vertical divider (`bg-line`, matching the
tiptap reference), replacing today's single flat row:

1. Heading trigger (see below)
2. Bold, Italic, Underline, Strikethrough, Code, Highlight
3. Superscript, Subscript
4. Bullet list, Ordered list
5. Blockquote, Code block
6. Link, Unlink

This reorders the existing `CONTROLS` array (today `[...BLOCKS, ...MARKS]` in
a different sequence) — a presentation-only change, since `CONTROLS` only
drives render order and the `pressed` array stays index-aligned to it.

### Active-state accent

Dark-blue accent (`ToggleButton`'s existing `"dark-blue"` accent, the app's
default) for every control except Highlight, which uses the `"pink"` accent —
mirroring the existing two-accent convention already used elsewhere in the
app for highlight-family controls. Both accents already exist on
`ToggleButton`; no new accent needed.

## Heading control: icon-triggered menu

Replaces the native `<select>` with a menu button, matching the tiptap
reference and the user's explicit choice over keeping the native select.

- **Trigger**: a `Button` showing the current level's icon (`Pilcrow` for
  paragraph, `Heading1`-`Heading4`) plus a chevron, `aria-label` +
  `aria-expanded`, `title` as a hint. This is the exact composition
  `GanttViewMenu` (`gantt-view-menu.tsx`) already uses for an icon-trigger +
  popover menu — same `Button` + `PopoverPanel` pattern, no new primitive.
- **Panel**: reuses `PopoverPanel` (`popover-panel.tsx`) as-is — it already
  owns portaling (escapes the toolbar's `flex-wrap` clipping), outside-click
  dismiss, Escape via the dismissal stack, and focus-on-open. Uses
  `role="dialog"`, **not** `role="menu"` — corrected after checking the
  precedent more carefully: `GanttViewMenu`, the app's one existing
  icon-trigger-opens-`PopoverPanel` composition, itself passes
  `role="dialog"`, for the same reason this file's own toolbar wrapper
  declares `role="group"` and never `role="toolbar"` (see the "★★★ `group`
  AND NOT `toolbar`" bullet) — an ARIA role that implies a keyboard contract
  (arrow-key roving between items) the component doesn't implement is worse
  than a role that implies none. A true `role="menu"` + `menuitemradio` would
  commit to that contract; this composition doesn't provide it, so it must
  not claim it.
- **Items**: icon + **visible text** ("Paragraph", "Heading 1"..."Heading 4")
  — a deliberate, scoped exception to "icons only". Five near-identical
  "H + small digit" glyphs in a list a user scans once is a real legibility
  risk that the persistent always-visible toolbar row doesn't have (the row's
  icons are memorized through repeated use; a dropdown is read cold each
  time). Flagged for confirmation at doc review — say if icon-only is wanted
  here too.
- **Semantics**: each item is a plain button; the currently active level
  carries `aria-current="true"` (screen-reader-visible state) plus a visual
  marker (bold weight or accent, mirroring the non-colour cue rule
  `ToggleButton` follows elsewhere), rather than `aria-checked`/
  `menuitemradio` — consistent with using `role="dialog"` over `role="menu"`
  above: no ARIA construct here implies a keyboard contract the component
  doesn't provide.
- **Behavior carries over unchanged**: `setLevel`/`setHeading`/`setParagraph`
  stay exactly as they are, including the "no `toggleHeading`, no `.focus()`"
  rules above — those rules were about avoiding a native-`<select>`-specific
  landmine (arrow-key `change` events) and a menu has no such landmine, but
  there is no reason to touch the command logic itself.

## Icon mapping (lucide-react)

Verified against lucide-react 1.31.0's real barrel exports (installed in a
scratch dir and grepped — not guessed). Using the `Icon`-suffixed export name
throughout, matching this codebase's existing heroicons import convention
(`BoldIcon`, `CheckIcon`, `AdjustmentsHorizontalIcon`, etc. — never the bare
name).

| Control | lucide-react export |
|---|---|
| Bold | `BoldIcon` |
| Italic | `ItalicIcon` |
| Underline | `UnderlineIcon` |
| Strikethrough | `StrikethroughIcon` |
| Code (inline) | `CodeIcon` |
| Highlight | `HighlighterIcon` |
| Superscript | `SuperscriptIcon` |
| Subscript | `SubscriptIcon` |
| Bullet list | `ListIcon` |
| Ordered list | `ListOrderedIcon` |
| Blockquote | `QuoteIcon` |
| Code block | `SquareCodeIcon` (visually distinct from inline `CodeIcon`) |
| Link | `LinkIcon` |
| Unlink | `UnlinkIcon` (pairs with `LinkIcon`'s glyph style; `Link2OffIcon` is the double-ring `Link2Icon` family instead) |
| Paragraph | `PilcrowIcon` |
| Heading 1-4 | `Heading1Icon` / `Heading2Icon` / `Heading3Icon` / `Heading4Icon` |
| Menu trigger chevron | `ChevronDownIcon` |

## Not touched

The sanitizer/allow-list, Tiptap commands, the `useEditorState` selector and
its caret-move re-render fix, the `preventFocusSteal` guards, and the
`group`-vs-`toolbar` role decision are all presentation-adjacent but
out of scope — this is a rendering change only.

## Test impact

- `rich-text-toolbar.test.tsx`'s multi-editor accessible-name-collision test
  currently likely queries by visible button text; it needs to assert against
  `aria-label`/accessible name instead. The name itself doesn't change (same
  translated string), only where it lives (visible text → `aria-label`).
- Tests exercising the native `<select>` (`setLevel` idempotency, the
  no-`.focus()` keyboard-arrow guard, the mousedown-picker guard) need
  rewriting against the new menu — a bigger test surface change than the
  button icon swap, since the interaction model itself changes (select →
  popover menu).
- New: `aria-current` correctness on the active heading item, menu open/close via
  `PopoverPanel`'s existing dismissal behavior (already covered by
  `popover-panel.test.tsx`; the toolbar's own test only needs to confirm it's
  wired, not re-prove `PopoverPanel`'s behavior).

## New dependency

`lucide-react` added to `package.json`, used only in `rich-text-toolbar.tsx`.
