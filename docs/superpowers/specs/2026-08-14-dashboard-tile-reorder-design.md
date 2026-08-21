# Dashboard tile arrangement — design

**Date:** 2026-08-14
**Status:** design approved, plan not yet written
**Base:** `main` @ 0.238.0 "Attanasio"

---

## 1. What this builds

The Dashboard becomes an arrangeable board. A user can drag tiles into a new order,
set each tile's width and height independently within per-tile limits, and hide tiles onto
a shelf. The
arrangement persists per device, per project.

Two capabilities the request named explicitly, both delivered:

- **auto-scroll during drag** — drag toward the scroller's edge and the board scrolls, so
  a drop target below the fold is reachable
- **park tiles off the board** — a collapsed shelf holds hidden tiles and hands them back

## 2. Where the Dashboard is today

`dashboard-panel.tsx` renders three zones: a full-width headline, one CSS **multicolumn
masonry** flow, and a full-width footer. The masonry is `columns-1 lg:columns-2
xl:columns-3` with each card wrapped in `break-inside-avoid` — deliberately *not* a grid.
It replaced an earlier `lg:grid-cols-2` bento whose uneven card heights trapped large
whitespace voids on wide screens.

Card order is fixed in JSX, priority-first. Several cards are conditionally rendered
(`showRaid`, `showBudget`, `showChanges`, `showMilestones`, `tursoActive`,
`topActions?.length`, `activeInsightCount > 0`). Nothing about the layout is user-editable
beyond the Comfortable/Compact density toggle in Settings → Appearance.

This design replaces the masonry flow with a grid. It does **not** touch the headline or
footer zones.

## 3. Decisions

Each of these was an explicit choice during brainstorming, recorded with the reasoning that
settled it.

| # | Decision | Why |
|---|---|---|
| D1 | "Off-screen" means **both** edge auto-scroll and an off-board shelf | Both were wanted |
| D2 | **Grid model C** — 4 columns × a small row unit, tile size is `w×h` in units, `grid-auto-flow: row dense` | Gives height control and packs out the voids that killed the old bento. Rejected: fixed 4×4 with 16 slots (forces cards onto the shelf, inner scrollbars everywhere); 4 columns with content-height rows (voids return) |
| D3 | **Size via the ⋮ menu**, no resize gesture — **two independent radio groups, Width and Height** | A menu is keyboard-operable for free, and per-tile limits stop a user shrinking a card below what its content needs. Two axes rather than named presets: a single preset list conflates the axes, so "taller, same width" is only expressible where the table happens to hold that combination — `small` 1×2 had no 1×3, `wide` 4×2 had no 4×3, and a label like "Tall" silently changed width too |
| D4 | Narrow screens **clamp the column count** and derive from one saved layout | One arrangement, three renderings. Rejected: per-breakpoint layouts (triples the state, a new tile must be placed three times); always-4-columns with horizontal scroll (unusable at half-screen) |
| D5 | Persistence is **per device, per project** | Projects enable different modules, so their card sets genuinely differ. Zero backend write paths, nothing added to exports or Turso |
| D6 | Keyboard path is **⋮ menu commands**, not a grab mode | Complete, testable in jsdom, no new interaction model. Drag stays a mouse enhancement — the stakeholder-map precedent |
| D7 | Drag starts from an **always-on grip**, no edit mode | Several dashboard tiles are click-through (a KPI tile navigates). A grip means click-through and drag never fight |
| D8 | Headline and footer stay **fixed**, outside the grid | |
| D9 | The shelf is **collapsed to a button**, not always visible | |
| D10 | **Native HTML5 DnD**, extracted into a shared primitive. No dependency, no touch support | Matches all five existing drag surfaces and the "no lib" pattern recorded in AGENTS.md |
| D11 | `roles-editor.tsx` is migrated onto the primitive **in this slice** | It has a live defect the primitive fixes by construction — see §9 |

### Approaches rejected at D10, and why

- **dnd-kit.** Its one real advantage over native DnD is touch, which native HTML5 DnD
  cannot reach at all. But `@dnd-kit/core`'s latest is 6.3.1, published 2024-12-05, with a
  peer range of `react >=16.8.0` written before React 19 shipped — the range admits this
  repo's React 19.2.4 without anyone having tested it there. The package that names React
  19 explicitly, `@dnd-kit/react`, is version 0.5.0 and pre-1.0. Testing it also fights
  jsdom, which has no `PointerEvent`.
- **Pointer Events, hand-rolled.** Would reach touch with no dependency, and there is an
  in-repo precedent — `use-draggable.ts` already uses `onPointerDown/Move/Up` with
  `setPointerCapture` for window repositioning. Rejected only because touch was judged not
  to be a requirement for this surface. It stays the migration path if that changes: swap
  the mechanism inside the primitive, once, for every consumer.
- **Coordinate placement (`{x,y,w,h}` + collision/compaction engine).** Would allow
  deliberate holes and drop-exactly-where-you-point. Rejected as ~250–400 lines of net-new
  engine for a capability nobody asked for. Remains a clean upgrade: the stored shape
  changes, the drag layer and menu do not.

## 4. Data model

```ts
type TileSpan = 1 | 2 | 3 | 4;

interface DashboardLayout {
  v: 1;
  board: { id: DashboardTileId; w: TileSpan; h: TileSpan }[];  // order IS the placement
  hidden: DashboardTileId[];
}
```

`w` and `h` are set independently from two radio groups in the ⋮ menu, each constrained by
the tile's own `minW`/`maxW`/`minH`/`maxH` from the catalogue.

Order is the entire placement model; `grid-auto-flow: row dense` resolves it to cells. No
coordinates are stored, which is what keeps the engine a set of array operations.

**Store:** `aipm-cockpit:dashboard-layout` → `{ [projectId]: DashboardLayout }`, capped at
the 50 most-recent projects, validated on load. This is the `landing-state.ts` shape
exactly — per-browser, per-project, not a `Workspace` field, so it has zero backend write
paths, stays out of exports and Turso, and is already cleared by `clearAppConfig`'s
`aipm-cockpit:*` sweep.

**Popout is read-only.** No grips, no ⋮ menu, no shelf, no persistence — the same rule
`use-landing-delta` follows.

## 5. Module map

Pure, i18n-free, DOM-free engines:

| File | Owns |
|---|---|
| `dashboard-tiles.ts` | the **tile catalogue** — per tile: id, i18n label key, default `w`/`h`, the `minW`/`maxW`/`minH`/`maxH` limits, and the module gate deciding whether it exists for this project |
| `dashboard-layout.ts` | `reorder` · `hide` · `restore` · `resize` · `reconcile(stored, catalogue)` · `DEFAULT_LAYOUT` |

Store and hook:

| File | Owns |
|---|---|
| `dashboard-layout-store.ts` | the per-project localStorage map — load/validate/save/cap |
| `use-dashboard-layout.ts` | load → reconcile → apply, debounced persist, `reset()`, popout read-only |

React:

| File | Owns |
|---|---|
| `use-list-reorder-dnd.ts` | **the shared primitive** — `setData`, the splice, `dropEdgeFor`, `previewOrder`, `dragId`/`dragOverId`, autoscroll wiring, and an optional arrow-key fallback for consumers that have no other keyboard path. Commits through either `onReorder(ids)` or `onMove(dragId, targetId)` — the dashboard needs the pair form, because its board stores a size per tile and a bare id list cannot express that state |
| `dashboard-grid.tsx` | the grid container, span classes, dense flow, the scroller ref |
| `dashboard-tile.tsx` | tile chrome — `DragHandle` grip, title, ⋮ button; renders the card as children |
| `dashboard-tile-menu.tsx` | the ⋮ `PopoverPanel` — the Width and Height radio groups, move commands, Hide |
| `dashboard-shelf.tsx` | the "N hidden" disclosure button, its tray, and the tray's drop target |

`dashboard-panel.tsx` keeps its headline and footer and hands card elements to
`dashboard-grid`. Moving the card list into the catalogue should shrink it from its current
577 lines, which matters for the 800-line ratchet.

**Naming check before creating any of these:** a bare `./name` import resolves `.ts` ahead
of `.tsx`, so a new pure `foo.ts` silently hijacks an existing `foo.tsx` component import.
Verify no sibling of the other extension exists for each new filename.

## 6. Grid rendering and the clamp

Spans are **static class strings**. Tailwind v4 scans source for class candidates, so an
interpolated `col-span-${w}` emits no CSS at all. One literal per span value, per axis:

```ts
const W_CLASS: Record<TileSpan, string> = {
  1: "col-span-1",
  2: "col-span-1 lg:col-span-2",
  3: "col-span-1 lg:col-span-2 xl:col-span-3",
  4: "col-span-1 lg:col-span-2 xl:col-span-4",
};
const H_CLASS: Record<TileSpan, string> = {
  1: "row-span-1", 2: "row-span-2", 3: "row-span-3", 4: "row-span-4",
};
```

The width table carries the whole responsive clamp; height does not clamp. Eight literals
total — fewer than the six combined presets they replace, and they compose freely.

Consequence: **D4's clamp needs no JavaScript.** No width measurement, no `ResizeObserver`,
nothing jsdom cannot see. Row spans do not clamp — height does not need to.

Container: `grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 grid-flow-row-dense` plus a row
unit. The row unit is spacing, so per AGENTS it must be a density class rather than a
literal: `densityClasses()` gains a `tileRow` key.

**Row unit: 80px comfortable — SETTLED by eye-verify against prototype v4 on 2026-08-14.**
**Compact is 64px and is NOT settled** — it was never looked at in compact mode, and the
same check has to be repeated there before the tests hard-code it. jsdom cannot check
either number.

The arithmetic that matters, because it is what makes `h: 1` marginal:

```
body height = h × unit + (h − 1) × gap − header
```

Tile chrome (grip, title, ⋮, bottom border) costs a fixed ~26px off **every** tile,
regardless of height. So at a 64px unit a `h: 1` tile has ~38px of body and a `h: 2` has
~112px. At 48px, `h: 1` leaves ~22px — enough for a sparkline and nothing else.

Two consequences the catalogue must honour:

- **`minH: 1` is only correct for genuinely single-line content** (the completion
  sparkline). Anything with rows, tiles or a chart gets `minH: 2`.
- The row unit has to be chosen against real card content, not derived. Prototype v4 has a
  row-unit selector and prints each tile's computed body height in its header — that is the
  instrument for settling this.

Never write a `*` wildcard inside a Tailwind arbitrary-value bracket anywhere, including in
docs — Tailwind scans `.md` too and emits it as invalid CSS, which 500s the app.

## 7. Drag interaction

The grip is the shared `DragHandle` with an `ariaLabel`, which turns it into a real
`role="button"` rather than the decorative `aria-hidden` variant.

The primitive returns:

- `dragId`, `dragOverId`
- `dropEdgeFor(id)` — **derived from the splice, never chosen for looks.** Because the
  dragged id is removed before being inserted at the target's original index, dropping on a
  later tile lands *after* it and on an earlier tile *before* it. A fixed edge marker is
  correct in one direction and a lie in the other; `reports.tsx` already documents this.
- `previewOrder` — the order as it would be if released now

**The Dashboard renders `previewOrder`, not an edge marker.** With `dense` backfill, an
edge marker on the target tile would routinely point at a slot the tile does not end up in;
live reflow shows the true result before release. Reports keeps its edge indicator. Both
come out of one splice function, so the two renderings cannot disagree.

Auto-scroll: `use-drag-autoscroll.ts` unchanged, `active = dragId !== null`, ref on the
dashboard scroller. Its `autoscrollDelta` is already pure and already clamps the hot zone to
a third of the container height so the two edge zones cannot overlap on a short board.

## 8. The shelf

A disclosure button labelled "N hidden" with `aria-expanded`, sitting after the grid.

- Drag a tile onto the button **or** the open tray to hide it. Dragging over the *collapsed*
  button opens the tray on `dragenter`, so the user never has to open it first.
- The tray lists hidden tiles as chips: each draggable back, each with a **Restore** button.
  That button is the keyboard path — without it, a keyboard user who hid a tile could never
  retrieve it.
- All tiles hidden → the grid renders an empty state pointing at the shelf.

## 9. The shared primitive and its adoption

The drag surfaces in `src/app` group into three different problems. Enumerate them rather
than trusting this list, which will rot:
`grep -rln "onDragStart" src/app --include=*.tsx | grep -v "\.test\."`

1. **Reorder a list** — `reports.tsx` (report cards), `roles-editor.tsx` ×2 (roles table and
   a sub-list), `budget-panel.tsx` (buckets). All four perform the identical splice.
2. **Move into a container** — `task-kanban-board.tsx`, `task-kanban-swimlanes.tsx`,
   `stakeholder-map-panel.tsx`.
3. **Drag to reschedule** — `gantt-rows.tsx`, `resource-calendar-rows.tsx`,
   `resource-calendar-band.tsx`.

`drag-handle.tsx` is the shared grip atom and belongs to no class — every class uses it.

The Dashboard is class 1. `use-list-reorder-dnd.ts` covers class 1 only.

**Adopted in this slice:** dashboard, `reports.tsx`, `roles-editor.tsx` (both sites),
`budget-panel.tsx`. Reports is the donor of the pattern — extracting from it and then
leaving its copy in place would mean two implementations of one thing, which is the outcome
the extraction exists to prevent. Reports is also the most developed of the four, so it is
both the riskiest to migrate and the one with the most existing tests holding it.

### The defect this fixes

`reports.tsx` carries this comment on its `dragstart`:

> The payload is unused — the reorder reads `dragId` from state — but Firefox will not
> START a drag at all unless `dragstart` sets some transfer data, so reorder was dead
> there. jsdom dispatches the sequence regardless, which is why no test caught it.

Grepping `setData` across every `.tsx`: eight drag surfaces call it. **Two do not** —
`roles-editor.tsx` at both of its sites (sets `effectAllowed`, stops there) and
`budget-panel.tsx`, whose `onDragStart={() => setDragId(br.bucketId)}` does not even take
the event argument. roles-editor's test supplies a `dataTransfer` stub that *includes* a
`setData`, so it passes regardless — exactly as the comment predicts.

### The four sites are NOT identical — capability matrix

Read before migrating. Compiled by reading each site, not assumed:

| | reports | budget-panel | roles-editor ×2 |
|---|---|---|---|
| `setData` (Firefox) | ✅ | ❌ | ❌ |
| arrow-key reorder | ✅ `moveReport` | ✅ `moveBucket` | ❌ **none** |
| drop-edge indicator | ✅ `dropEdgeFor` | ❌ | ❌ |
| edge auto-scroll | ✅ | ❌ | ❌ |
| splice semantics | **target's original index** | **target's original index** | **target's post-removal index** |

**The splice difference is a real behaviour difference, not a style one.** Reports and
budget-panel remove the dragged id and then insert at the index the target held *before*
removal, so the dragged item takes the target's slot — dropping on a later item lands
*after* it. roles-editor filters the dragged id out first and inserts at the target's index
in the *filtered* array, which always lands *before* the target. On `[A,B,C,D]`, dragging A
onto C gives `[B,C,A,D]` in reports and budget-panel, and `[B,A,C,D]` in roles-editor.

**The primitive standardises on the reports/budget-panel semantics** — three of the four
sites already have it, it is the semantics `dropEdgeFor` is derived from, and taking the
target's slot is what a user dragging downward expects. **Migrating roles-editor therefore
changes its behaviour for downward drags.** That is intended, and its tests must be updated
to the new expectation rather than the primitive bent to preserve the old one.

An earlier revision of this section claimed neither roles-editor nor budget-panel had a
keyboard path. That was wrong: `budget-panel.tsx` wires `moveBucket` to ArrowUp/ArrowDown on
its handle. Only roles-editor's two lists have no keyboard alternative — which is what makes
its missing `setData` severe, since in Firefox there would be no way to reorder at all.

Not reproduced in a real Firefox — the evidence is the repo's own documented rule plus the
absence of the call. Verify in Firefox during implementation; if the rule turns out to be
wrong, that comment needs correcting too. Reproduce the audit with:
`grep -rn "onDragStart" src/app --include=*.tsx | grep -v "\.test\."` then check each hit
for a `setData` call.

Adopting the primitive fixes `setData` at all three sites by construction and gives
roles-editor the arrow-key fallback it lacks.

## 10. Reconciliation

A stored layout is always older than the catalogue, and the catalogue also varies per
project. On every read:

- an id in storage no longer in the catalogue is **dropped**
- a catalogue id missing from storage is **inserted after the nearest preceding catalogue
  neighbour that is present**, or at index 0 if there is none — deterministic, so a newly
  shipped tile lands where its author intended rather than being dumped at the end
- a stored `w` or `h` outside the tile's current limits is **clamped to the nearest legal
  value**, per axis and independently — not reset to the default, which would discard a
  choice the user made on the axis that is still legal
- **a tile gated off by a module toggle stays in the stored layout and is simply not
  rendered.** Turning Budget off and on again must return the burn tile to where the user
  put it

## 11. Accessibility

The Dashboard is in `A11Y_VIEWS`, so this re-scans it. Two of the three requirements below
are invisible to that gate.

- **Per-tile control names must be tile-unique** — `Move – Top actions`, `Tile options – Top
  actions`. N identically-named controls is a WCAG 2.4.6 failure that **axe cannot detect at
  any seed size**: of its 105 rules, none flags two controls sharing an accessible name, and
  the one adjacent rule is links-only and `wcag2aaa`. A unit test rendering ≥2 tiles is the
  only possible detector.
- **Visible label contained in the accessible name** (WCAG 2.5.3). Also ungated: axe ships
  `label-content-name-mismatch`, but it is tagged `experimental` and excluded by axe's
  default `tagExclude`, so a tag-only `runOnly` never runs it. Containment, not prefix —
  the check is position-independent.
- The menu holds **two `role="group"` radio groups**, Width and Height, each item a
  `role="menuitemradio"` with `aria-checked`, each group carrying its own `aria-label` so
  the two are distinguishable. Values outside the tile's limits are rendered `disabled`
  rather than omitted, so the scale stays readable and the limit is visible. Move commands
  are plain menu items.
- **★ An axis where `min === max` renders NO chooser** — a static "fixed at N" line instead.
  Four radio items with three disabled and one checked is indistinguishable from a broken
  control, and it was read as exactly that in prototype v3: the KPI tile had both axes
  pinned and the menu looked defective. Only render a group the user can actually change. **The Dashboard's keyboard path is the menu, not the primitive's
  arrow keys** — it does not enable that option. Reports, roles-editor and budget-panel do,
  because they have no menu.
- The ⋮ menu uses `PopoverPanel` and the shared dismissal protocol. Read
  `docs/AGENTS/ui-shell.md` before wiring it — that file owns the Escape/Tab protocol.
- A `role="status"` live region announces menu-driven moves: *"Top actions moved to position
  3 of 9"*. Keyboard users have no drag feedback otherwise.
- Grips and menu buttons are `print:hidden` (`DragHandle` already is).

## 12. Testing

| Layer | What it pins |
|---|---|
| `dashboard-layout.ts` | full branch coverage on every operation; a fast-check property that `reconcile` is idempotent and never loses a live catalogue tile |
| `dashboard-layout-store.ts` | 50-project cap, corrupt JSON → defaults, validated load |
| `use-list-reorder-dnd.ts` | `setData` is called (spied, mutation-proved — the existing reports test is the template); splice semantics; `dropEdgeFor` in **both** directions; arrow-key fallback |
| components | ≥2 tiles so unique-name assertions can fail; menu commands; shelf restore; popout renders no grips |
| Playwright | the geometry — 4 tracks render, `dense` backfills, the clamp collapses to 2 columns |

**What jsdom structurally cannot test:** it has no layout engine. No unit test can verify
column count, dense packing, or the clamp. Those tests can only assert *which class strings
are applied*, and the spec should not pretend otherwise — the seeded Playwright check is the
only real measurement.

Run `npm run test:shuffle` before pushing, since this adds and reorders tests.

## 13. Gates

| Gate | Effect |
|---|---|
| coverage floors | new `.ts` engines are gated; they are logic, so they get tested rather than excluded (`use-view-digest.ts` precedent). Only `use-dashboard-layout.ts` is an exclusion candidate, and testing it is preferred |
| `size:check` | `dashboard-panel.tsx` is 577 lines today. Budget from `readFileSync().split("\n").length`, **not** `wc -l` — the gate counts one higher |
| `dup:check` | moves the right way: three copies of the reorder become one |
| axe | re-scans the Dashboard. Green proves nothing about duplicate names |
| i18n | every new string EN + DE with real umlauts; `i18n.de.ts` is CRLF and the Edit tool corrupts it — patch via a node utf8 write with `\r\n` anchors |
| `docs:symbols:check`, `docs:claims:check` | both run over the `docs/AGENTS/dashboard.md` update. Cite symbols, not line numbers |
| release | if this ships as a version bump: `version.ts` + `CHANGELOG.md` + the five unchecked places (`package.json`, `package-lock.json` ×2, README badge, the five codemap headers) |

## 14. Accepted limitations

- **Dense backfill can place a tile away from where it was released.** Mitigated by live
  preview: the board reflows under the cursor, so the outcome is visible before release.
- **A card whose content outgrows its declared height scrolls inside itself.** Inherent to
  model C. The RAID register at `h: 2` will clip to roughly four rows. Curated defaults and
  per-tile `minH` keep it sane, and the user can raise the height on its own axis.
- **No touch support.** Native HTML5 DnD does not fire on touch. The ⋮ menu remains fully
  usable there, so the board is arrangeable on a tablet — just not by dragging.
- **Deliberate holes are impossible.** Order-only placement plus `dense` fills every gap.

## 15. Out of scope

Free resize by dragging; per-breakpoint layouts; team-shared layouts; making the headline or
footer zones arrangeable.

## 16. Roadmap — follow-on work, not this slice

1. Migrate class-2 surfaces (kanban board, kanban swimlanes, stakeholder map) onto a
   "drop into a container" primitive.
2. Migrate class-3 surfaces (gantt bars, resource-calendar rows and band) — drag against a
   coordinate axis; may never share a primitive.
3. Touch support — swap the primitive's HTML5 DnD for Pointer Events in one file, for all
   consumers at once.
4. Coordinate placement `{x,y,w,h}` if deliberate holes ever become a requirement.

## 17. Sequencing

The work splits cleanly in two, and the split is worth keeping even inside one branch
because the first half is independently shippable and independently reviewable:

**Phase A — the primitive and its adoptions.** Extract `use-list-reorder-dnd.ts` from
`reports.tsx`, adopt it in reports, `roles-editor.tsx` ×2 and `budget-panel.tsx`. Pure
refactor plus a defect fix; no user-visible change beyond reorder starting to work in
Firefox and gaining arrow keys. Verifiable on its own: the existing tests for all three
surfaces must stay green, plus the new `setData` test.

**Phase B — the Dashboard board.** Catalogue, layout engine, store, grid, tile chrome, ⋮
menu, shelf. Consumes the Phase A primitive.

If this needs to be two branches rather than two phases, A is the one that can ship first.

## 18. Reference

Interactive prototype with every decision applied, plus the row-unit instrument:
`.superpowers/brainstorm/9016-1786736320/content/layout-prototype-v4.html`
(gitignored; open it through the brainstorm server, or directly in a browser).
