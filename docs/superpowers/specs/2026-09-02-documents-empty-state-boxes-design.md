# Documents pane — a clickable empty-state box per section

**Date:** 2026-09-02
**Status:** approved, not yet planned
**Scope:** two empty states in the Documents pane. No engine change, no new capability.

## Goal

Give the Documents pane the same clickable dashed empty-state box the Knowledge
tab already has — **one per section, independently**. An empty document list
offers "create a document"; an empty image library offers "upload an image". If
one section has content while the other is empty, only the empty one shows a box.

## What already exists

- `AddFirstItemButton` (`add-first-item-button.tsx`) is the shared primitive:
  a full-width `<button>` with `border border-dashed border-line`, a hover
  transition to `ui-dark-blue`, an optional description line above a bold CTA,
  and an optional `ariaLabel`. Its docstring lists the panels using it —
  budget, gantt, milestones, changes, stakeholders, raid, open-points,
  knowledge. **Documents is not among them.** This slice adds it.
- Knowledge's call (`knowledge-panel.tsx`) is the reference shape:
  `text` = a description key, `addLabel` = `` `+ ${t(lang, key)}…` ``,
  `rounded="xl"`.
- `handleCreate` (`documents-panel.tsx`) already creates a document with a
  unique title and is wired to the toolbar's `onNew`.
- `AssetLibrary` already takes `onUpload: (file: File) => void`.

## What is being replaced

Two passive `EmptyState` messages, neither clickable:

| Site | Today |
|---|---|
| `documents-list.tsx` | `<EmptyState title={t(lang, "documentsNoneYet")} />` when `documents.length === 0` |
| `asset-library.tsx` | `<EmptyState title={t(lang, "assetLibraryEmpty")} />` when `assets.length === 0` |

## Decisions

### 1. Two independent boxes, not one combined empty state

Knowledge gates its single box on **both** its lists being empty. Documents does
NOT copy that: each section decides for itself. An empty document list beside a
populated image library still shows the document box, because the two are
separate things to create and the pane renders them as separate sections.

### 2. The image box inherits its gating rather than re-implementing it

`documents-asset-section.tsx` returns early with a `compact` `EmptyState` when
`!enabled` (`tursoConfig !== null && !isReadOnly`), choosing between two
deliberately distinct messages — `assetLibraryTursoOnly` and
`assetLibraryReadOnly` — under a ★★ comment warning never to conflate them.

`AssetLibrary` therefore only ever renders when assets are **enabled**. Putting
the box at `asset-library.tsx`'s existing empty branch means the Turso and
read-only gating is inherited for free, and those two messages are untouched.

★★ **Do not add the box to the `!enabled` branch.** A clickable upload box on a
read-only popout, or on a non-Turso backend, is a false affordance — the exact
class this pane avoids elsewhere, and `AddFirstItemButton`'s own docstring
restricts it to a truly-empty register.

### 3. The documents box is suppressed when read-only

`DocumentsList` already receives `isReadOnly`. When set, keep today's passive
`EmptyState`. A popout is a read-only mirror whose create affordance is
deliberately inert; offering a dashed "create" box there would promise an action
that cannot happen. Only `onCreate` needs threading in from the orchestrator.

### 4. ★★★ Neither box may reuse the label of the control beside it

This is the load-bearing a11y decision, and it has already bitten this exact
pane. `documents-panel.tsx`'s `handleCreate` carries a ★★ comment recording that
using the toolbar button's label (`documentsNew`) as a new document's default
title made the pane hold **two buttons called "New document"**; the fix was to
split the strings.

The same collision is available here twice over, because in both sections the
existing control stays mounted beside the empty box:

- the toolbar's New button (`documentsNew`) sits above the empty document list;
- the `FilePickerButton` labelled `upload` ("Upload") sits directly above the
  empty image library.

So each box needs its **own** string, distinct from its neighbour's:

| Key | EN | DE |
|---|---|---|
| `documentsCreateFirst` | `Create your first document` | `Erstes Dokument erstellen` |
| `assetLibraryUploadFirst` | `Upload your first image` | `Erstes Bild hochladen` |

Each box passes its key as BOTH `addLabel` (as `` `+ …` ``) and `ariaLabel`, so
the accessible name is the CTA alone — the behaviour `AddFirstItemButton`'s
2026-08-26 decision block already specifies for the `text` variant. The
description lines reuse the existing `documentsNoneYet` and `assetLibraryEmpty`,
which are being replaced as *titles* but keep their wording as *descriptions*.

★★★ **On an empty Turso project BOTH boxes render at once, in one pane.** Two
dashed buttons with colliding accessible names is a WCAG 2.4.6 failure, and the
axe gate is measurably blind to duplicate accessible names in every view at
every seed size — Documents is an axe-scanned view, so a green run proves
nothing here. A unit test rendering both boxes together is the only possible
detector.

### 5. The file-dialog seam — extract, do not hand-roll a second one

`AddFirstItemButton` is a plain `<button onClick>`; opening a file dialog needs
an `<input type="file">` to click. `FilePickerButton` owns that today but
hardcodes a `Button` as its trigger, so the dashed box cannot be its trigger
as-is.

**Extract the mechanism into a small hook** (working name `useFilePicker`)
returning the imperative `open()` and the props for the hidden input, and have
BOTH `FilePickerButton` and the new box use it.

★★ The alternative — a second hidden input hand-rolled beside the dashed box —
recreates precisely the divergence `FilePickerButton` was created to end
(`open-followups.md` §15: "Replaces two hand-rolled shapes that had diverged
onto the same settings surface"). Its docstring names three load-bearing
properties that a second copy would have to re-derive and could silently lose:
`sr-only` rather than `display:none` (a `display:none` input cannot be clicked
in every browser), `tabIndex={-1}` + `aria-hidden` (or the input becomes a
second tab stop announcing the same name — and axe reports missing names, never
duplicated ones), and a real `<button>` rather than a styled `<label>` (a
`<label>` is not focusable, so its focus ring can never render, WCAG 2.4.7, and
axe has no focus-visibility rule either). The hook must preserve all three, and
`file-picker-button.test.tsx`'s existing coverage of them must still pass
unchanged — that is the evidence the extraction was behaviour-preserving.

## Testing

- **Both boxes rendered together, names distinct.** The only detector for §4.
  Assert with the shared `src/test/row-unique-names.ts` helper rather than a
  hand-rolled enumeration.
- **Documents box:** renders when the list is empty; clicking it creates a
  document; **absent when `isReadOnly`**, with the passive message in its place.
- **Image box:** renders when the library is empty and enabled; clicking it
  opens the file dialog (assert the hidden input is clicked, not that a file
  arrives); **absent** in both `!enabled` branches, with `assetLibraryTursoOnly`
  and `assetLibraryReadOnly` each still rendering their own message.
- **`FilePickerButton` unchanged:** its existing tests pass without edits.
- Mutation-prove the read-only guard on each box: drop it and confirm the
  corresponding absence test goes red, recorded as `N failed / M passed` where
  N+M equals the file's runtime test count.

## Gates

`npx tsc --noEmit` (exits **2** on diagnostics, not 1) · `npx eslint src` ·
the touched vitest files · `npm run size:check`. Headroom is comfortable:
`documents-panel.tsx` 758, `asset-library.tsx` 402, `documents-list.tsx` 238,
none with a `file-sizes.json` baseline, all against the 800 cap.

★ `i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts — both DE strings
above carry them. Patch it with a node utf8 write whose anchor contains `\r\n`,
then read the bytes back. The `i18n-encoding` test bans ASCII substitutions and
`\u00XX` escapes.

## Out of scope

- **No change to the two `!enabled` asset messages.** They are correct and
  deliberately distinct.
- **No change to `handleCreate`, `onUpload`, or any engine.**
- **No drag-and-drop onto the dashed box.** `AssetLibrary` already has its own
  `onDrop`; adding a second drop target is a separate decision.
- **No image preview.** That is the companion spec,
  `2026-09-02-asset-preview-lightbox-design.md`, and ships independently.

## Files

| File | Change |
|---|---|
| `src/app/use-file-picker.ts` | NEW — the extracted hidden-input mechanism |
| `src/app/file-picker-button.tsx` | consume the hook; behaviour unchanged |
| `src/app/documents-list.tsx` | dashed box when empty and not read-only; new `onCreate` prop |
| `src/app/documents-panel.tsx` | thread `onCreate={handleCreate}` |
| `src/app/asset-library.tsx` | dashed box at the existing empty branch |
| `src/app/i18n.ts` / `i18n.de.ts` | two new keys (EN/DE parity is tsc-enforced) |
| tests | as listed above |
