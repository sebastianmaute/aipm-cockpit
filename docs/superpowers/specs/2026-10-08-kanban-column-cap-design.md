# Kanban board: cap each column, with "Show more" (§5, board phase)

**Status:** design, approved in chat 2026-10-08 (option B over per-column virtualization); this
written spec is for owner review. Register entry §5 (#87). Batch 18.

## Goal

Keep the Open Points **board** view responsive on large projects by rendering at most a fixed
number of cards per status column, with a button that shows more, without breaking drag and drop,
the keyboard status path, the deep-link card flash or printing.

## Why (measured, 2026-10-08)

`e2e/perf-task-board.spec.ts` (PERF=1 only) timed the board against the virtualized table on the
same machine, same scaled workspaces, medians of 3. Opening the board costs **+546, +996 and +2213
ms** more than opening the table at 504, 1008 and 2002 tasks, and the main thread stays busy longer
afterwards (54/97/173 ms against 16/11/9). The fullest column held 321, 645 and 1284 cards. At 1008
tasks the board's own share is about five times the 200 ms rule the table's spec set. Numbers and
commands are in §5.

## Why a cap and not virtualization

Per-column virtualization (`@tanstack/react-virtual`, as the table) was considered and set aside:
the table needed three review rounds of fixes that rest on undocumented virtual-core behaviour
(scroll offset, measured heights, `initialRect`), the board would carry six virtualizers at once,
and native drag and drop adds a collision the table never had (Chromium cancels a drag whose source
element unmounts). A cap renders only real cards, so nothing the user is touching can unmount.

## Shape

- `task-kanban-board.tsx`. Each column renders `cards.slice(0, limit)`, where
  `limit` starts at **`KANBAN_COLUMN_PAGE = 100`**. The per-column limits are `TaskKanban`'s own
  state, `Partial<Record<TaskStatus, number>>`; a missing entry means the page size.
- **At or under the cap the column renders exactly as today**: no button, no change in markup. The
  14-task seed never reaches it, so every existing unit test, e2e spec and visual baseline is
  unchanged.
- **Over the cap**, a button follows the last rendered card: "Show 100 more (545 hidden)", where the
  first number is `min(KANBAN_COLUMN_PAGE, hidden)`. Each click raises that column's limit by
  `KANBAN_COLUMN_PAGE`. It is a plain `Button` from the design-system primitives, not a hand-rolled
  one.
- The column header's count stays the column's **true total**, as today.
- The limits live as long as the board does: leaving Open Points, switching to the table or
  swimlane view, or the §548 load hold remounts the board and resets them. A search or filter change
  keeps them (the board stays mounted).

## Accessibility and i18n

- The button's accessible name carries the column, so the six are distinct: EN "Show {0} more in
  {1} ({2} hidden)", with a DE equivalent. New keys in `i18n.ts` and `i18n.de.ts` (DE edited by node
  utf8 write, per AGENTS.md).
- A unit test renders two over-cap columns and asserts the button names differ (the axe gate is
  silent on duplicate names).

## Collisions

1. **Drag and drop.** Every rendered card is a real card, so a drag source can never unmount under
   the pointer. The drop target is the column `<section>`, which is always rendered, so a column
   with hidden cards still accepts drops. A card dropped into a column lands wherever that column's
   order puts it, which may be past its cap; the header count still rises. Accepted.
2. **Keyboard status path.** The card's status `<select>` is unchanged; a status change moves the
   card exactly as a drop does.
3. **Deep-link card flash.** `useDeepLinkRowFlash` sets `flashId` during render (its render-time
   reconcile) and only on the next animation frame queries `[data-deeplink-row]`. The board already
   receives `flashId` as a prop, so it does **not** use the hook's `scrollToId` callback: a
   render-time reconcile in `TaskKanban` (a last-seen `flashId`, per the AGENTS.md pattern; no
   effect, since `set-state-in-effect` is banned) raises the target column's limit past the card's
   index in the same render pass. The card is in the DOM before the frame that queries it. Seeded
   with a sentinel, so a fresh mount honours a pending flash (the remount-swallow rule).
4. **Print.** While printing, every card renders, so a printed board is complete. The print
   subscription in `use-task-row-window.ts` (`subscribePrint`, `getPrintSnapshot`) moves to a small
   `use-printing.ts` exporting `usePrinting()`, used by both the table window and the board. The
   table's behaviour is unchanged; its existing print tests stay green.
5. **Swimlane view.** Out of scope: one outer scroll box over a lanes × status grid, a different
   shape. It gets its own measurement later.

## Testing

- **Unit, new `task-kanban-board.test.tsx`:**
  - 100 cards in a column: all render, no button;
  - 101 cards: 100 render, button reads "Show 1 more in … (1 hidden)";
  - a click raises the limit by 100;
  - the header count is the true total while capped;
  - two capped columns give distinct button names;
  - a `flashId` for card 250 of a column renders it on that render, and a fresh mount with a
    pending `flashId` honours it;
  - printing (the `usePrinting` store reporting true) renders every card;
  - DE label under `loadI18n("de")`.
- **`use-printing.ts`:** the existing `use-task-row-window` print tests keep passing after the move.
- **Mutation:** one mutant per behaviour above (cap off-by-one, header count from rendered cards,
  click not raising the limit, column dropped from the name, flash reconcile removed, sentinel seeded
  from the live prop, print flag ignored), each must turn a test red.
- **Probe:** re-run `e2e/perf-task-board.spec.ts` for the after-numbers. The probe's "holds N cards"
  check changes to read each column's header count, since cards past the cap are no longer in the
  DOM; and it adds one axe check on the board at 1008 tasks with the buttons showing.
- **Gates:** `npx eslint --max-warnings=0` on changed files, `npx tsc --noEmit`, the vitest files
  above under the shared lock.

## Register

§5 records the after-numbers and narrows to the swimlane view, Gantt and the activity log. The
accepted trade-off (a long column ends in a button, and find-in-page cannot see hidden cards) goes
in the entry.
