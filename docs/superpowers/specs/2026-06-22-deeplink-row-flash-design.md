# Deep-Link Row Scroll + Highlight (#10) — Design

**Date:** 2026-06-22
**Status:** Approved (design)
**Roadmap:** Follow-on to slice #9 (click-through parity). The slice-#9 spec listed
"Deep-linking that scrolls/highlights a specific row WITHIN a destination view
(beyond opening its editor)" as explicit out-of-scope; this slice delivers it.

## Goal

When a Dashboard (or Action Center) deep-link fires `requestOpen(view, id)`, the
destination panel already opens the matching item's editor. This slice ALSO scrolls
that item's row into view and briefly outlines it, so the user sees *where* the item
sits in its list — fired immediately alongside the editor open, across all five
deep-linkable panels (RAID, milestones, changes, stakeholders, tasks).

## Background / current state

`WorkspaceTabContext` (`workspace-tab-context.tsx`):
- `pendingOpen: { view: AppView; id: number } | null`
- `requestOpen(view, id)` sets `activeTab = view` + `pendingOpen = {view,id}` + (non-popout) writes `window.location.hash`.
- `clearPendingOpen()` resets `pendingOpen = null`.

Each destination panel consumes `pendingOpen` in a `useEffect` that opens the editor
then calls `clearPendingOpen()` (one-way, fire-once; guarded against re-opening the
already-open item):
- RAID — `raid-panel.tsx:256-266` → `openEdit(item)`
- Milestones — `milestones-panel.tsx:134-143` → `setEditing(m)`
- Changes — `change-panel.tsx:241-249` → `openEdit(item)` (skips aggregate `id===0`)
- Stakeholders — `stakeholders-panel.tsx:147-157` → `openEdit(item)`
- Tasks — `task-manager.tsx:1229-1236` → `openEditModal(task)`

All five row lists render `<tr key={item.id}>` inside an `overflow-auto` scroll
container, with **no virtualization** and **no per-row refs or data-attributes**.
Sanctioned palette token for the highlight: `outline-AIPM-green` (the focus-ring color;
`globals.css` brand tokens only).

Editor surface differs per panel, which bounds where the highlight is visible:
- Inline-draft panels (milestones, changes, stakeholders): the list stays mounted
  beside/above the draft form → row present at fire time → highlight visible.
- RAID: modal overlay → list stays mounted behind it → row present → highlight visible
  behind the modal (and on close, within the flash window).
- Tasks: modern default uses the **full-page `TaskEditView`** which replaces the list →
  the row is NOT in the DOM at fire time → graceful no-op (see Edge cases). Classic/popout
  use a modal → list mounted → highlight visible.

## Architecture

One shared React hook + a data-attribute + an outline class on each row. No new
deep-link channel; no change to the existing editor-open effects.

### New module: `src/app/use-deeplink-row-flash.ts`

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import type { AppView } from "./nav-config";

export const DEEPLINK_FLASH_MS = 1800;
const FLASH_CLASS = "outline outline-2 -outline-offset-2 outline-AIPM-green";

/** Outline classes for the transiently-flashed row; "" otherwise. */
export function flashOutlineClass(isFlashed: boolean): string {
  return isFlashed ? FLASH_CLASS : "";
}

/**
 * When a `requestOpen(view, id)` deep-link lands on this panel, scroll the row
 * carrying `data-deeplink-row="<id>"` into view (centered) and flash `flashId`
 * for DEEPLINK_FLASH_MS. Does NOT clear pendingOpen — the panel's own
 * editor-open effect still does (both fire in the same commit before the
 * clear-triggered re-render). Graceful no-op when the row isn't in the DOM.
 */
export function useDeepLinkRowFlash(view: AppView): {
  flashId: number | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const { pendingOpen } = useWorkspaceTab();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);

  useEffect(() => {
    if (pendingOpen?.view !== view) return;
    const id = pendingOpen.id;
    if (id < 0) return; // sentinel / aggregate → no specific row
    setFlashId(id);
    const raf = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-deeplink-row="${id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    });
    const timer = setTimeout(() => setFlashId(null), DEEPLINK_FLASH_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [pendingOpen, view]);

  return { flashId, containerRef };
}
```

Notes:
- The effect mirrors the established lint-passing `pendingOpen`-consumption shape used
  by all five panels (conditional + early-return + minimal deps). `set-state-in-effect`
  is the same pattern those panels already ship — the deps are `[pendingOpen, view]`,
  not the render-mirroring anti-pattern the ban targets.
- `id < 0` early-return covers the sentinel `-1` (aggregate delta-strip / "+N more")
  so we never query a bogus selector.
- `behavior: "auto"` (instant) — no smooth-scroll, so no `prefers-reduced-motion`
  concern. Static outline (no keyframes) for the same reason.

### Per-panel wiring (×5)

For each of `raid-panel.tsx`, `milestones-panel.tsx`, `change-panel.tsx`,
`stakeholders-panel.tsx`, and the tasks list (`tasks-section.tsx` + `task-row.tsx`):

1. Call `const { flashId, containerRef } = useDeepLinkRowFlash("<view>");`
   (`"raid" | "milestones" | "changes" | "stakeholders" | "open-points"`).
2. Attach `ref={containerRef}` to the existing `overflow-auto` scroll container.
3. On each row `<tr>`: add `data-deeplink-row={id}` and append
   `flashOutlineClass(flashId === id)` to its className.

Tasks specifics: `tasks-section.tsx` owns the scroll container + the `visibleRows.map`,
so it calls the hook and passes `isFlashed={flashId === task.id}` down to the memoized
`TaskRow` (new prop); `TaskRow` appends `flashOutlineClass(isFlashed)` and sets
`data-deeplink-row={task.id}` on its `<tr>`. (Keeps `TaskRow` prop-driven; preserves
`React.memo`.)

## Error handling / edge cases

- **Row not in DOM** (filtered out, on another search/sort page, or list unmounted —
  tasks full-page edit): `querySelector` returns `null` → no scroll; `flashId` is set
  but no row matches `flashId === id` → no visible outline; `flashId` self-clears after
  `DEEPLINK_FLASH_MS`. No crash, no stale state. The tasks-modern-full-page case is
  therefore effectively a no-op; accepted (KISS) and documented in AGENTS.md.
- **Sentinel / aggregate id** (`-1`, or changes' `id===0`): `id < 0` returns early;
  `id===0` matches no row (`nextEntityId` is 1-based) → no-op.
- **Unmount mid-flash**: cleanup cancels the rAF and timeout.
- **Two effects, one `pendingOpen`**: the hook does not clear `pendingOpen`; the panel's
  existing editor-open effect does. Both run in the same commit with the same value
  (the `clearPendingOpen` state-set schedules a *later* re-render). The re-render with
  `pendingOpen = null` hits the hook's early-return → no re-fire.

## Testing

`use-deeplink-row-flash.test.tsx`:
- Renders a probe component wrapping the hook in a `WorkspaceTabProvider`, with a row
  carrying `data-deeplink-row`. Stub `Element.prototype.scrollIntoView` (jsdom has no
  layout). Assert: `requestOpen("changes", 5)` → `flashId === 5` and `scrollIntoView`
  called with `{ block: "center", behavior: "auto" }`.
- Non-matching view → `flashId` stays `null`, `scrollIntoView` not called.
- Sentinel `id = -1` → `flashId` stays `null`.
- With fake timers: after `DEEPLINK_FLASH_MS` → `flashId` back to `null`.
- `flashOutlineClass(true)` returns the outline classes; `(false)` returns `""`.

One panel integration test (`change-panel.test.tsx` addition): a deep-linked change row
renders with `data-deeplink-row="<id>"` and the outline class while flashed.

Gates: `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run test:run`.
Dashboard axe gate unaffected (no new interactive control; outline is decorative);
run it anyway before push per the standing rule.

## Release

- `version.ts`: APP_VERSION `0.125.0` + new milestone codename (next sci-fi author),
  APP_BUILD_DATE, append `versionHighlightDeepLinkFlash` to `APP_HIGHLIGHT_KEYS`.
- i18n EN + DE: `versionHighlightDeepLinkFlash` (DE via node utf8 write, real umlauts,
  CRLF `\r\n` anchors).
- `CHANGELOG.md` entry; README badge; `package.json` version.

## AGENTS.md

Add a "Deep-link row flash (v0.125.0)" pointer: shared `use-deeplink-row-flash.ts`
(`useDeepLinkRowFlash(view)` + `flashOutlineClass`); each deep-linkable panel attaches
`containerRef` to its scroll container + `data-deeplink-row={id}` + the outline class on
rows; static `outline-AIPM-green` (no bg, palette-safe; never fights row `bg-*` state
classes); fires alongside the editor-open effect, does not clear `pendingOpen`. ★ Caveat:
tasks **modern full-page edit** unmounts the list → the flash is a graceful no-op there
(row not in DOM at fire time); visible on inline-draft panels + RAID/tasks-classic modals.

## Out of scope

Persisting the highlight until the editor closes (needs per-panel close hooks — rejected
in brainstorming for "fire immediately"); auto-clearing search/sort filters to force the
target row into view; smooth-scroll animation; click-through on surfaces outside the
existing five panels.
