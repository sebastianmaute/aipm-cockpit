# Board-Card Deep-Link Flash (#11) — Design

**Date:** 2026-06-22
**Status:** Approved
**Roadmap:** Closes the documented #10 (deep-link row flash) no-op for Kanban board mode.

## Goal

When the tasks pane is in **board** mode, a deep-link (`requestOpen("open-points", id)`)
scrolls the target card into view and briefly outlines it (`outline-AIPM-green`, 1800ms),
matching the table-row behaviour shipped in #10. The editor already opens in both modes;
this adds the card scroll + flash.

## Background

#10's shared hook `use-deeplink-row-flash.ts` (`useDeepLinkRowFlash(view)` →
`{ flashId, containerRef }`, `flashOutlineClass(isFlashed)`) is already called in
`tasks-section.tsx` with view `"open-points"`, but `containerRef`/`flashId` are wired
ONLY into the table branch. In board mode (`tasksViewMode === "board"`) the
`<TaskKanban>` branch gets neither, so a board deep-link opens the editor with no card
scroll/flash. Only one view branch mounts at a time, so the single `containerRef` from
the hook is free to attach to whichever branch renders.

Board structure (`task-kanban-board.tsx`): outer `overflow-x-auto` div (column scroller)
→ per-status `<section>` (w-64) → per-column `overflow-auto` vertical scroller → per-task
`<article data-testid="kanban-card-<id>">` (static className
`"rounded-lg border border-line bg-surface-muted p-2 text-sm"`, no per-card state class).
Not virtualized — every card is in the DOM. Board renders outside `RowContextProvider`;
cards are prop-driven.

## Changes

1. `src/app/task-kanban-board.tsx` — `TaskKanbanProps` gains
   `containerRef?: React.RefObject<HTMLDivElement | null>` and `flashId?: number | null`.
   Attach `ref={containerRef}` to the outer `overflow-x-auto` div. On each `<article>`:
   add `data-deeplink-row={task.id}` and append `flashOutlineClass(flashId === task.id)`
   to its className via `[...].filter(Boolean).join(" ")` (no trailing/interior gap, matching
   the #10 className tidy). Import `flashOutlineClass` from `./use-deeplink-row-flash`.
2. `src/app/tasks-section.tsx` — board branch passes `containerRef={containerRef}` and
   `flashId={flashId}` to `<TaskKanban>`. Table branch unchanged.

`scrollIntoView({block:"center"})` on a card scrolls its nearest scrollable
ancestors (per-column vertical + outer horizontal) into view on both axes.

## Error handling / edge cases

- Both new props optional → existing `<TaskKanban>` test render sites and any other
  caller stay valid; `containerRef` undefined → no ref attached (no crash);
  `flashId` undefined → `flashId === task.id` is always false → no outline.
- Card filtered out by search/people filter → not in DOM → `querySelector` no-op (graceful,
  same class as the remaining documented no-ops).
- Sentinel/aggregate ids handled upstream in the hook (`id < 0` early-return).

## Testing

`task-kanban-board.test.tsx`: every rendered card carries `data-deeplink-row` equal to its
task id; a card rendered with `flashId === <id>` has `outline-AIPM-green` in its className
while other cards do not; omitting `flashId` renders no outline on any card. Stub
`Element.prototype.scrollIntoView` if the test triggers the hook (board test renders
`TaskKanban` directly with explicit `flashId`, so no hook/scroll involved — just class +
attr assertions).

Gates: `npx tsc --noEmit`, `npm run lint` (--max-warnings=0), `npm run test:run`. Board is
NOT in axe `A11Y_VIEWS` (eye-verified); outline is decorative.

## Release

- `version.ts` → APP_VERSION `0.126.0` + new milestone codename; APP_BUILD_DATE.
  NO new `versionHighlight*` key (refinement of #10's shipped highlight; CHANGELOG covers it).
- `CHANGELOG.md` entry; README badge; `package.json` version.

## AGENTS.md

Update the v0.125.0 "Deep-link row flash" caveat: the Kanban **board** is now wired
(cards scroll + flash); the remaining graceful no-ops are tasks **modern full-page edit**
(list unmounted) and any row/card hidden by an active filter/search.

## Out of scope

Virtualized-board handling (board isn't virtualized); deep-link flash on surfaces outside
the five panels + board; smooth-scroll animation.
