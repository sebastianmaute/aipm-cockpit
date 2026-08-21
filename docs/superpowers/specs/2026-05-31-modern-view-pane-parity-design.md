# Modern view-pane parity — design

**Date:** 2026-05-31
**Branch:** `ui-polish-batch`
**Status:** approved (inline), implementing

## Problem

In the modern shell every primary view *except* Open Points (Tasks) renders its
content as a card that collapses to its content height, leaving a large empty
region below it (see `docs/patterns/incorrect.png` — Chat). The Tasks view
(`docs/patterns/correct.png`) fills the viewport with a single inset, rounded,
padded card. All other views must match Tasks: same inset, padding, rounded
corners, and full-height fill.

## Root cause

`ModernShell`'s `<main>` is a **block** element (`overflow-auto … p-6`), not a
flex container.

- Tasks is rendered directly as `content` and its root uses **`h-full`** → it
  fills main's padded box.
- Every other view is rendered via `WorkspaceSection fullBleed`, whose root uses
  **`flex-1`** — a no-op under a non-flex parent — so it collapses to content
  height. The child panels use `h-full`, but `h-full` of a collapsed parent is
  still collapsed.

Secondary divergences: panels use mixed padding (`p-4` vs `p-6`); a `pt-4`
offset pushes cards off main's inset edge; budget/reports cards are
content-height inside a scrolling wrapper (void when short); gantt had no card.

## Decisions

- **Inner padding:** normalize all views to `p-6` (match Tasks/Chat).
- **Gantt:** wrap in the same card as every other view (no longer full-bleed
  exempt).

## Design

1. **`view-styles.ts`** — add a shared full-height pane constant:
   `VIEW_PANE_FILL_CLASS = "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"`.
   This is the exact chrome the Tasks pane uses.

2. **Consumers of the fill card** (own internal scroll region): `tasks-section`
   (fillHeight branch), `chat-panel`, `raid-panel`, `resources-panel`,
   `activity-log-panel`, `gantt` — all use `VIEW_PANE_FILL_CLASS`.

3. **Content-flow cards** (scroll as a whole): `reports`, `budget-panel` keep
   `VIEW_PANE_CLASS` plus `min-h-full` so they fill when short and scroll when
   tall.

4. **`WorkspaceSection` fullBleed root** → sizing-only transparent container
   (`flex h-full min-h-0 w-full flex-col overflow-hidden`; drop `flex-1` and
   `bg-surface`), so the per-view card is the only surface and actually fills.

5. **Panel wrappers** drop `pt-4` in fullBleed mode only (classic keeps it for
   the tab strip), so cards align to main's inset edge.

## Tests (TDD)

- `view-pane-sweep.test.ts` — enforce the new contract: fill files use
  `VIEW_PANE_FILL_CLASS`; content files use `VIEW_PANE_CLASS` + `min-h-full`;
  `view-styles.ts` exports all three constants.
- `workspace-section.test.tsx` — fullBleed root uses `h-full`, not `flex-1`.
- `tasks-section.test.tsx` — fillHeight branch still `h-full`, no `resize`.

## Out of scope

- Classic layout behavior (already nests cards; unchanged beyond `p-4→p-6`).
- Popout windows (`isPopout` path) — unchanged.
