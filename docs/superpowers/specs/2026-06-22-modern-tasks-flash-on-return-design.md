# Modern Tasks Deep-Link Flash-on-Return (#12) — Design

**Date:** 2026-06-22
**Status:** Approved
**Roadmap:** Resolves the MED-2 value limit surfaced reviewing #11: in the DEFAULT
modern layout a task deep-link opens the full-page `TaskEditView`, which unmounts the
tasks list/board, so the #10/#11 scroll+flash is never seen there.

## Goal

When a task deep-link opens the full-page editor in modern layout, flash (scroll + outline)
the task's row/card AFTER the editor closes and the list re-mounts — so the user returns to
the list with the just-viewed item highlighted. No editor-open delay; tasks-only (only tasks
use the full-page editor). Non-task panels and classic/popout already show the flash and are
left unchanged.

## Background (mechanism, from code map)

- Deep-link effect `task-manager.tsx:1231-1236`: `pendingOpen.view==="open-points"` →
  `openEditModal(task)` → `clearPendingOpen()`.
- `openEditModal` (`use-task-submit.ts:246`): sets `editingId`, `taskModalOpen=true`, form.
- `useEditView = settings.layout==="modern" && !isPopout` (`task-manager.tsx:297`).
- View-switch effect `task-manager.tsx:299-307`: on `taskModalOpen` true → stash
  `editorReturnRef.current = activeTab`, `setActiveTab("edit")`; on false → `setActiveTab(editorReturnRef.current)`.
- `modern-shell.tsx:63-70`: `activeView==="edit"` renders ONLY `editView`; returning to
  `"open-points"` re-mounts `TasksSection` FRESH.
- `TasksSection` already calls `useDeepLinkRowFlash("open-points")` (`tasks-section.tsx:172`).
- Close handlers (`use-task-submit.ts`): `handleCancelEdit` (:238) and `handleSubmit` success
  (:214) both set `taskModalOpen=false` AND clear `editingId` — so the edited id is NOT
  available at close; it must be captured separately at open time.
- `workspace-tab-context.tsx`: value = `{ activeTab, setActiveTab, isPopout, pendingOpen,
  requestOpen, clearPendingOpen, pendingChatSeed, requestChat, clearChatSeed }`.

The existing `pendingOpen` is cleared by each panel's editor-open effect; a flash-only signal
needs its OWN clear because no editor effect consumes it.

## Architecture (Approach B — flash on close)

### 1. `workspace-tab-context.tsx` — flash-only channel

Add to `WorkspaceTabContextValue` + the provider:
- `pendingFlash: { view: AppView; id: number } | null` (state, init `null`)
- `requestFlash: (view: AppView, id: number) => void` — `setPendingFlash({view,id})` ONLY.
  Does NOT call `setActiveTab` and does NOT write `window.location.hash` (pure flash request;
  the caller is already on/returning to the target view).
- `clearPendingFlash: () => void` — `setPendingFlash(null)`.

Both new functions `useCallback`-wrapped (stable). Extend the provider value object.

### 2. `use-deeplink-row-flash.ts` — consume `pendingFlash` too

The hook currently render-reconciles `pendingOpen` (via `handled`/`targetIdFor`) into
`flashId`+`flashSeq`. Add a PARALLEL reconcile for `pendingFlash`:
- New `handledFlash` last-seen state, seeded `undefined` (sentinel — so a fresh mount that
  already has `pendingFlash` set fires, not the remount-swallow trap).
- When `pendingFlash !== handledFlash`: `setHandledFlash(pendingFlash)`; if
  `targetIdFor(pendingFlash, view)` is non-null → `setFlashId(target)` + bump `flashSeq`; and
  call `clearPendingFlash()` (the hook OWNS clearing this signal — no editor effect does).
  Clearing during render: call it conditionally inside the same `if`, mirroring how the
  existing reconcile sets state during render (already the lint-passing shape here). Pull
  `clearPendingFlash` from `useWorkspaceTab()`.
- The existing `[flashId, flashSeq]` side-effect (rAF scroll + 1800ms auto-clear) is unchanged
  — it fires for flashes from EITHER source.

`targetIdFor` is reused (same view-match + `id < 0` sentinel guard).

### 3. `task-manager.tsx` — capture origin, request flash on return

- Add `const flashOnEditReturnRef = useRef<number | null>(null);`
- In the deep-link effect (:1231): when a task is found AND `useEditView` is true (modern
  full-page), set `flashOnEditReturnRef.current = task.id` before/after `openEditModal(task)`.
  (Classic/popout: leave null — the modal path already shows the flash behind it.)
- In the view-switch effect (:299-307) CLOSE branch (`!taskModalOpen && activeTab==="edit"`):
  capture `const back = editorReturnRef.current;` then `setActiveTab(back);` and, if
  `flashOnEditReturnRef.current !== null && back === "open-points"`, call
  `requestFlash("open-points", flashOnEditReturnRef.current)` and reset the ref to null.
  Both setState calls batch → `TasksSection` mounts with `pendingFlash` already set → its hook
  reconciles on mount → scroll+flash. Add `requestFlash` to this effect's deps.

Gating recap: ref set only on modern-full-page task deep-links; consumed once on return to
open-points; never fires for normal edits, classic/popout, or non-task views. Both cancel and
save route through the same close branch → flash on either (returning to the list shows the
just-edited row).

## Error handling / edge cases

- Task deleted or filtered out on save → the row/card isn't in the DOM → `querySelector` no-op
  (graceful; same class as the documented filtered no-ops).
- `requestFlash` never touches `activeTab`/hash → no spurious nav, no hash pollution, popout-safe.
- `pendingFlash` sentinel (`handledFlash=undefined`) → fresh `TasksSection` mount with the signal
  pending fires once; subsequent re-renders with the same object are skipped; after consume it's
  cleared so it can't re-fire on a later unrelated mount.
- If the user navigates somewhere OTHER than open-points after closing (not possible via the
  deep-link path since `editorReturnRef` restores the open-points origin) → `back !== "open-points"`
  guard skips the flash; ref still reset to avoid a stale later fire (reset unconditionally in the
  close branch when the ref is set).
- Board mode: returning to open-points re-mounts `TasksSection` which owns both table + board
  branches → board card flashes on close too (no extra wiring).

## Testing

- `use-deeplink-row-flash.test.tsx`: `requestFlash("changes", 5)` (no `requestOpen`) → `flashId`
  becomes 5 + `scrollIntoView` called; `pendingFlash` is cleared (assert a second render doesn't
  re-fire / a `clearPendingFlash` spy ran); wrong-view `pendingFlash` ignored; sentinel `-1` ignored.
- `workspace-tab-context` (or via the hook harness): `requestFlash` does NOT change `activeTab`
  and does NOT write `window.location.hash` (assert hash unchanged), distinguishing it from
  `requestOpen`.
- `task-manager` wiring: if a focused test can drive open→close in modern layout, assert
  `requestFlash` is invoked with the task id on return; if the full cycle is impractical in jsdom,
  cover the ref→requestFlash branch logic indirectly and note manual verification.
- Gates: `npx tsc --noEmit`, `npm run lint` (--max-warnings=0), `npm run test:run`, `npm run build`.
  Board not in axe; outline decorative.

## Release

- `version.ts` → APP_VERSION `0.127.0`, APP_MILESTONE `"Sawyer"` (Robert J. Sawyer), APP_BUILD_DATE.
  No new `versionHighlight*` key (still part of the deep-link-flash story).
- `CHANGELOG.md` entry; README badge; `package.json` version.

## AGENTS.md

Flip the MED-2 limitation note in the deep-link-flash bullet: modern full-page task deep-links
now flash the row/card ON EDITOR RETURN via the `pendingFlash` channel (`requestFlash`/
`clearPendingFlash`; hook consumes + self-clears it; `task-manager` `flashOnEditReturnRef` set on
modern-full-page task deep-links, fired in the view-switch close branch). Keep the view-toggle-
within-window best-effort note. Document `pendingFlash` as a flash-only sibling of `pendingOpen`
(no `activeTab`/hash side-effects; hook owns clearing).

## Out of scope

Reveal-then-edit (Approach A, rejected); flash-on-close for non-task editors (they're modals/
inline — list stays visible, already flashes); smooth-scroll animation; deep-link highlight that
persists until interaction.
