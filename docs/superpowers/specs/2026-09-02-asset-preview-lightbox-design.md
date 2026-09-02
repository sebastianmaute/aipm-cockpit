# Asset preview lightbox — see the picture, from both surfaces

**Date:** 2026-09-02
**Status:** approved, not yet planned
**Scope:** one new modal component plus two entry points. Turso-gated by
inheritance. No engine change, no storage change.

## Goal

Let the user actually look at an uploaded image. Today they cannot, on either
surface, and the gap is worst exactly where it matters most.

## The defect

`asset-library.tsx` contains **no `<img>` element at all**. The library is a
text table — name, size, usage, with rename / delete / insert controls. So a
user renames, deletes and inserts images having never seen them, identifying
each by filename alone. Deleting the wrong image this way is unrecoverable from
that surface.

Images only become visible once inserted into a document, where
`document-preview.tsx` resolves `<img data-asset-id>` through
`attachAssetImages` and `loadAssetData`. Even then, the image renders at
document width with no way to enlarge it.

## Decisions

### 1. A modal lightbox, not a detached window

The app has both mechanisms. A real popout (`isPopout`) needs its own render
tree, and popout surfaces are read-only mirrors by design — heavy machinery for
looking at a picture. The lightbox is an in-page modal over the current view.

### 2. Draggable and resizable, on the existing hooks

`useResizable(storageKey, { axis })` is a generic hook used at **44 sites**, four
of them modals following an established key convention
(`aipm-cockpit:modal-size:task-form`, `:budget-bucket`, `:sharepoint`,
`:shift-edit`). It restores the persisted size on mount and returns a `reset`.
This one takes `aipm-cockpit:modal-size:asset-preview`. Size then persists per
viewer for free.

★ **Built on `Modal` + `ModalHeader` + `useDraggable` + `useResizable`, with
`notes-window.tsx` as the precedent** — the app's other non-form floating
window. **NOT `EditModalShell`** (`edit-modal-chrome.tsx`): that is chrome for
*entity edit modals*, carrying `onSubmit`, `ModalFieldControls`, `useConfirm`
and a save/delete footer. A lightbox is not a form, and adopting form chrome to
get its resize wiring would drag in five unrelated concerns.

★★★ Read [`docs/AGENTS/ui-shell.md`](../../AGENTS/ui-shell.md) before building —
it owns the Escape/Tab dismissal protocol for every modal, popover and panel in
this app, and this component must follow it rather than hand-roll dismissal.

### 3. Both entry points, one component, caller-supplied order

Opened from a library row AND from an inserted image in the document preview.
Prev/next navigate **within the list the caller passed**:

```
assets: readonly AssetRef[]   // the caller's own order
startIndex: number
```

★★ **The component is list-agnostic on purpose.** The library's natural order is
its current sort; a document's is the order the images appear in the document.
These genuinely differ, and that is correct rather than a bug to reconcile:
"next" always means next in the list you opened it from. A single global
ordering would make "next" jump to an image that is not visible where the user
clicked — worse than the asymmetry it removes.

### 4. Object URLs must be revoked on navigate AND on close

Bytes arrive through `loadAssetData` as blob URLs. Every arrow-press mints a new
one, so revoking only on close leaks one URL per navigation for the life of the
session. Both paths revoke.

### 5. A missing asset renders a stated message, never a broken image

`document-asset-repairs.ts` and the `data-asset-missing` marker already model an
asset whose bytes cannot be resolved. The lightbox renders an explicit
"unavailable" state for that case. A broken `<img>` in a full-screen overlay is
the worst possible presentation of it, and navigation must still work past it.

### 6. Preview stays available in read-only popouts

Unlike upload, rename and delete, previewing mutates nothing. The read-only
gating that suppresses the write affordances does not apply. Turso gating is
inherited rather than re-implemented: both entry points only exist on surfaces
that already require `tursoConfig !== null`, so the lightbox never needs to
check it.

### 7. Accessible name and keyboard contract

- The modal is labelled by the asset's name.
- Escape closes; Left/Right navigate. Arrow handling must not fight the modal's
  focus trap — verify against the dismissal protocol rather than by feel.
- Prev/next/close need row-unique, non-colliding accessible names. Note the axe
  gate cannot see duplicate accessible names in any view, so unit tests are the
  only detector.
- The image carries the asset name as `alt`.
- Trigger affordance: the library row's image must be reachable by keyboard, not
  a click-only region.

## Testing

- Opens from a library row at the right index; opens from an inserted image.
- Prev/next move within the supplied list and **stop at both ends — they do not
  wrap**. Decided here rather than deferred: with two images, wrapping makes
  "next" and "previous" land on the same picture, which reads as a broken
  control. The end control is disabled, so its state is visible before it is
  pressed.
- A single-asset list renders no navigation, or inert navigation — pinned either
  way.
- Escape closes; focus returns to the element that opened it (the same
  focus-moves-with-the-element rule `asset-library.tsx` already applies on
  leaving rename mode).
- Missing-bytes asset renders the unavailable state, and navigation still works.
- Object URLs revoked on navigate and on close — assert `revokeObjectURL` calls,
  since a leak is invisible to every other assertion.
- Size persistence: `useResizable` is keyed correctly and does not collide with
  another modal's key.

## Gates

`npx tsc --noEmit` (exits **2**, not 1) · `npx eslint src` · touched vitest
files · `npm run size:check`. `asset-library.tsx` is 402 lines and
`documents-asset-section.tsx` 474, both against the 800 cap with no baseline
entry; the new component is its own file, so headroom is not at risk.

★ Any new DE strings go into `i18n.de.ts` by node utf8 write with `\r\n`
anchors, never the Edit tool.

## Out of scope

- **No metadata panel and no download button.** Dimensions, mime and file size
  are only useful when something is wrong; the app's existing download path is
  for documents, and a second one for assets is separate work.
- **No editing, cropping or rotation.**
- **No change to `AssetLibrary`'s rename/delete/insert behaviour**, to the asset
  store, or to any export path.
- **No thumbnails in the library table.** A worthwhile follow-up and a different
  change: it touches row layout, sort and the size ratchet, and the lightbox
  solves the reported problem on its own.

## Files

| File | Change |
|---|---|
| `src/app/asset-preview-modal.tsx` | NEW — the lightbox |
| `src/app/asset-library.tsx` | open it from a row |
| `src/app/document-preview.tsx` | open it from an inserted image |
| `src/app/i18n.ts` / `i18n.de.ts` | new keys, EN/DE parity tsc-enforced |
| tests | as listed above |
