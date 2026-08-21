# Gantt Center-on-Today Scroll — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.17.1-gantt-center-on-today`
**Context:** Sub-project **G1** — small UX fix split off from the same conversation that also produced the upcoming RAID-report sub-project (R1). Ships first as a focused patch; R1 follows.

## Goal

When the Gantt opens, scroll its horizontal viewport so today's date sits in the middle. The user sees recent and near-future bars at a glance and scrolls left for past, right for future. Subsequent scrolls/edits do not re-center.

## Non-goals

- Re-centering on background data refresh, zoom change, or window resize — only the initial mount.
- A "scroll to today" button — out of scope for this patch.
- Changing the Gantt's own bar-layout or range computation.

## Architecture

Single-file change in `src/app/gantt.tsx`. Add one ref and one `useLayoutEffect`.

The Gantt already exposes everything we need:
- `wrapperRef` (declared ~L531) attached to the scrollable container at ~L1170 (`<div … overflow-auto …>`).
- `todayOffsetPx` (~L982) — the pixel x where today's marker is drawn, computed from `LEFT_GUTTER_PX + diffDays(range.min, today) * DAY_WIDTH_PX`.

### Behaviour

1. On mount, watch for the first render where `wrapperRef.current` exists AND `todayOffsetPx > 0` (the chart has laid out and today sits within the data range).
2. Set `scrollLeft` so today is centered: `target = todayOffsetPx − clientWidth / 2`, clamped to `[0, scrollWidth − clientWidth]`.
3. Latch the action with a `didInitialScroll` ref so it never fires again — user's manual scroll position is preserved across re-renders.

### Edge cases

- **Today outside data range:** `todayOffsetPx` can technically be ≤ `LEFT_GUTTER_PX` if today is before all tasks (the existing today-marker render at ~L1240 already guards with `>= LEFT_GUTTER_PX`). The clamp handles the case naturally — `scrollLeft = 0` (today is at/before the leftmost visible column).
- **Empty Gantt (no tasks):** the range falls back to `today − 7` … `today + 14` (~L967), so today sits at the chart's center already. Centering still works correctly.
- **Layout not yet stable:** `todayOffsetPx` is computed from React state derived from `tasks`. On first paint with tasks=[], `todayOffsetPx` may be small; on the next paint with tasks loaded, it shifts. The effect's dependency on `todayOffsetPx` plus the `> 0` guard plus the latch makes this self-correcting: we wait until layout is meaningful, then scroll once.
- **Popout window:** the Gantt may render inside a popout window (workspace-section uses `openPopoutWindow` for similar surfaces). `wrapperRef` works the same in either window — no special handling.
- **`useLayoutEffect` vs `useEffect`:** `useLayoutEffect` would scroll before paint, avoiding a single-frame flash of the unscrolled chart. Use `useLayoutEffect` (matches what large datagrids do for initial scroll positioning).

### Code

Add near the existing refs (after `wrapperRef` declaration, ~L531):

```tsx
const didInitialScroll = useRef(false);
```

Add a `useLayoutEffect` after the existing `todayOffsetPx` calculation (~L984+) — placed wherever it sits naturally alongside other effects:

```tsx
useLayoutEffect(() => {
  if (didInitialScroll.current) return;
  const el = wrapperRef.current;
  if (!el || todayOffsetPx <= 0) return;
  const target = todayOffsetPx - el.clientWidth / 2;
  el.scrollLeft = Math.max(
    0,
    Math.min(el.scrollWidth - el.clientWidth, target),
  );
  didInitialScroll.current = true;
}, [todayOffsetPx]);
```

Add `useLayoutEffect` to the existing React imports if not already present.

## Testing

Behavioural tests at this layer are awkward because JSDOM doesn't lay out — `clientWidth`, `scrollWidth`, `scrollLeft` are all 0 unless mocked. Two test-design choices:

- **Option A (preferred):** mock `wrapperRef.current` dimensions with `Object.defineProperty(el, 'clientWidth', ...)` and assert `scrollLeft` is set to the expected centered value. Reusable test pattern for any scroll-positioning logic.
- **Option B:** skip the unit test for this single useLayoutEffect, rely on the existing gantt.test.tsx behavioural tests still passing (no regression in bar layout / drag / click) plus a manual smoke check.

Use Option A — adds two focused tests in `gantt.test.tsx`:

1. **Centers today when layout is stable.** Mock `clientWidth = 800`, `scrollWidth = 4000`, render Gantt with a task spanning today ± 30 days. Assert `wrapperRef.current.scrollLeft === todayOffsetPx − 400` (clamped if necessary).
2. **Does not re-scroll after the initial mount.** After initial scroll, simulate a re-render (e.g. by adding a task). Assert `scrollLeft` was not reset.

Gates: `npx tsc --noEmit` 0, `npm run lint` 0, full suite green (896 + 2 new = 898).

## Release

Patch → **0.17.1** "Jemisin" (codename stays). No highlight key.

- `src/app/version.ts`: `APP_VERSION = "0.17.1"`. Top-of-file comment block recording the fix.
- `CHANGELOG.md` `[0.17.1] — 2026-05-28` entry: "Gantt now opens with today centered in the viewport — scroll left for past, right for future."
- No i18n change, no DESIGN-TOKENS change.

## Plan shape (preview — the writing-plans skill expands)

1. Add the latch ref + `useLayoutEffect` to `gantt.tsx`; import `useLayoutEffect`.
2. Add the two unit tests to `gantt.test.tsx`.
3. Release 0.17.1 (version.ts + CHANGELOG).

A 3-task plan — small enough to run inline if preferred over subagent-driven.

## What this closes

After 0.17.1 ships, the Gantt opens centered on today. Sub-project **R1 (RAID report)** is the remaining outstanding item from this conversation and gets its own brainstorm → spec → plan → build cycle.
