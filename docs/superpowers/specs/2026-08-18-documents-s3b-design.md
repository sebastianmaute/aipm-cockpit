# Documents S3b — the block editor — Design

**Status:** Approved for planning
**Date:** 2026-08-18
**Base:** `main` at 0.246.0 "Bodard" (merge `90cff77b`)

Fourth slice of the documents arc. S1 (0.219.0 "Elgin") shipped the model, storage across
the six write paths, the Documents view and three renderers. S2 (0.222.0 "Charnas") shipped
the AI tools. S3a shipped `sanitizeDocumentHtml`, mark-aware OOXML and the three policies.
S4 shipped `linkedEntities`. **This slice makes a document editable by hand.**

Source roadmap: `docs/superpowers/specs/2026-08-08-documents-roadmap-s3-s4-design.md`,
section "S3b — the editor". **Three of its instructions are retired by work that shipped
after it was written** — see "What the roadmap got wrong" below. Read that section before
planning; taking the roadmap literally would rebuild things that already exist.

## Problem

A `ProjectDocument` can be created, renamed, duplicated, deleted, linked, restored and
rewritten **by the assistant**. A human can do none of that to its *content*. The Documents
pane renders a read-only preview; the only way to change a paragraph is to ask the model.

The write path for hand editing already exists and is tested: `applyDocMutation` accepts
`{kind: "ops", id, ops}` where a `DocOp` is `append` / `insert` / `replace` / `delete` /
`replaceAll`, and `workspace-context` already calls it. **This slice adds no storage, no
mutation kind, no write path, and no new persisted field.** It is a UI slice over a
mutation layer that is already versioned, retention-bounded and property-tested.

## Scope

Full S3b: per-kind editors for all five editable block kinds, plus paragraph alignment.

| Block kind | Editing surface |
|---|---|
| `paragraph` | the shared `RichTextEditor`, unchanged |
| `heading` | level select (1-3) + plain-text input — `heading.text` is `string`, no marks |
| `bullets` | per-item text fields, add / remove / reorder item, ordered toggle |
| `table` | per-cell text fields, add / remove row, add / remove column, caption field |
| `dataSection` | a `select` over the 15 `ExportSectionKey`s, never free text |
| `pageBreak` | no editor — nothing to edit |

**In scope is block *content*. Out of scope is the *set* of blocks.** Adding, removing or
reordering blocks is the structural slice. The gutter therefore carries the kind chip and a
overflow menu but **no drag handle** — a handle that does nothing is worse than no handle.

Also out of scope, unchanged from the roadmap: a figure block with a caption; search and
replace (its extension's licence is unverified and it is orthogonal); and marks inside
`heading.text`, `bullets.items` or table cells, which are plain `string` by type.

## What the roadmap got wrong

Each of these was true when written and was falsified by a later release. Verify with the
commands given rather than trusting this list.

**1. "A third `RichTextEditor` variant using `sanitizeDocumentHtml`."** There are no
variants. The unify-rich-text slice (0.232.0) removed the `variant` and `labels` props —
one editor, one toolbar, one schema at every call site. Reintroducing a per-surface variant
is explicitly forbidden by `AGENTS.md`: a surface needing different markup should render
differently, not sanitize differently.

Verify: `grep -n "variant" src/app/rich-text-editor.tsx` — the only hits are a `Button`
`variant` and a comment forbidding a size variant.

**2. "`ToolbarButton` (`rich-text-editor.tsx`) is one of those sites."** It moved to
`rich-text-toolbar-button.tsx` and already carries the opt-in `preventFocusSteal` prop the
roadmap asks a new toolbar to hand-roll. The toolbar itself (`rich-text-toolbar.tsx`)
already declares `role="toolbar"` with a roving `tabindex` contract (`toolbar-roving.ts`,
0.236.0) and an `aria-label` fed from the editor's own `label`, which is what disambiguates
sibling editors in one form.

Verify: `grep -rln "ToolbarButton" src/app --include="*.tsx" | grep -v test`

**3. Decision 3, "alignment cannot be expressed as markup here."** It can, for paragraphs.
`data-align` is on `GUARDED_DATA_ATTR` with a value predicate in `ATTR_VALUES` admitting
exactly `left`, `center`, `right` and `justify`, and `TextAlign` is configured with
`types: ["heading", "paragraph"]`. That value predicate is why this does not re-open
`ALLOWED_URI_REGEXP` — the attribute is guarded by an allow-list of four literals, not by
the URI regexp that strips `class` and `style`.

Alignment survives end to end, verified on this tree: the editor emits it, the sanitizer
keeps it, `globals.css` and `doc-render-html`'s standalone stylesheet both style
`[data-align]`, and `rich-text-runs` carries `align` on its line base so `doc-render-docx`
(`w:jc`) and `doc-render-pptx` honour it. **So paragraph alignment costs this slice
nothing.**

**4. "Blocks are edited in place."** There is no per-block React tree to edit in place.
`DocumentPreview` renders the whole document as ONE HTML string built by
`renderDocumentHtml` and injected with `dangerouslySetInnerHTML`. This is the finding that
shapes the architecture below.

## Architecture

**An explicit edit mode, not an always-on inline editor.**

`DocumentPreview` is left exactly as it is. It is the canonical on-screen renderer and it
shares `renderDocumentHtml` with the export and PDF paths, so putting editing concerns
inside it would couple hand editing to export fidelity. Edit mode replaces the preview with
a block-list React view; leaving edit mode returns to the canonical preview, which is also
the honest way to confirm what was saved.

Consequence, stated plainly because it is a real cost: **two renderers of the same content
exist while edit mode is open** — the React block view and `renderDocumentHtml`. The drift
risk is bounded by the block view never being a fidelity claim; export, PDF and print
continue through the canonical renderer alone, and the preview is one toggle away.

### Modules

`documents-panel.tsx` measures 796 lines against the 800-line ratchet. The gate counts
`split("\n").length`, which is `wc -l` plus one, so it has **four** lines of headroom. It
cannot absorb any of this. New files:

| File | Responsibility | Purity |
|---|---|---|
| `document-editor.tsx` | edit-mode orchestrator: block list, selection state, the gutter | React |
| `document-block-editors.tsx` | the five per-kind editors | React, presentational |
| `document-editor-commit.ts` | block to `DocOp`, the dirty check, the image predicate, the coalescing decision | **pure, DOM-free, i18n-free** |
| `use-document-editor.ts` | selection + commit wiring to the workspace mutation | React |

The pure module is where the logic that can be wrong lives, and it is coverage-gated by
default. `use-document-editor.ts` is render-scope glue; if it ends up holding only wiring it
belongs in `vitest.config.ts` `coverage.exclude`, and if it ends up holding logic, that
logic belongs in the pure module instead.

Split `document-block-editors.tsx` per kind if it approaches ~400 lines. The table editor is
the largest and is the natural first extraction.

### Narrow-pane layout

Roadmap decision 2 stands: at a wide pane each block gets its own toolbar; at a narrow pane
the toolbar docks once above the document and acts on the selected block. The trigger is
**pane width, not device width** — the pane is user-resizable and has a popout path.

The swap hinges on the existing `use-media-query.ts` hook, never on a measured width:
**jsdom has no layout**, so a width-driven branch is untestable unless the match is
injectable.

## Commit semantics

**Commit on blur, per block, only when the content changed.**

There is no unsaved buffer and no Save button. Most panels in `workspace-section` render
only the active tabpanel, so the Documents pane remounts on tab switch — a buffer would be
silently discarded, which is this repo's worst failure class. Committing on blur means the
worst case is a saved edit the user did not finish, which is recoverable from version
history; the alternative's worst case is unrecoverable.

The dirty check is required, not an optimisation: without it, focusing and leaving a block
writes a version whose before-image is identical to its after-image.

### Version coalescing

`MAX_VERSIONS_PER_DOC` is 20 and every `ops` mutation writes a before-image. Editing twenty
blocks would therefore evict the document's entire prior history — including every
AI-authored version — behind ordinary use.

`document-editor-commit.ts` therefore decides *whether a before-image is warranted*: if the
newest version for that document is already `source: "user"`, `op: "update"` and within a
short coalescing window, the mutation carries no new before-image.

**The property this preserves is the one a user wants:** the first before-image of an
editing session is the state *before the session started*, which is the thing worth
reverting to. Twenty keystroke-shaped snapshots are not.

The window is a named constant, not a literal. Coalescing applies **only** to consecutive
`user` + `update` versions on the same document — an AI write, a rename, a delete or a
restore between two user edits ends the run, because those before-images record a different
actor's change and are never the current session's start state.

This is the one place the slice touches a versioned path. It is a decision *about* whether
to write a version, expressed as a pure function over the existing version list — not a
change to `applyDocMutation`'s own retention or tombstone logic, which stay untouched.

## Image safety

**A paragraph whose stored HTML contains an image element renders read-only, with a stated
reason, instead of an editor.**

This is reachable today. `ai-document-blocks` sanitizes model-authored paragraph HTML with
`sanitizeAiDocumentRichText`, which calls `sanitizeDocumentHtml`, and
`DOCUMENT_ALLOWED_TAGS` is `RICH_ALLOWED_TAGS` spread plus `img`. The shared
`RichTextEditor` commits through `sanitizeRichHtml`, which does not admit `img` — and
because `img` is a **void** element it does not unwrap to text, it vanishes outright. So
opening such a paragraph and typing one character would destroy the image with no error and
no toast.

Rejected alternative: a `sink` prop on `RichTextEditor` selecting the document sanitizer.
It would preserve the image, but it puts a second sanitize policy on the shared editor for
a block kind that has no way to *create* an image until S3c — widening a shared security
boundary to protect content the app cannot yet produce by hand.

The predicate is a pure function in `document-editor-commit.ts` over already-sanitized
stored HTML. The reason string is translated in both dictionaries — a disabled control with
no stated reason reads as a broken control. This condition disappears in S3c; the predicate
and its string are expected to be deleted then, not extended.

## Accessibility

**The axe gate cannot see the failure this slice is most likely to introduce.** Two controls
sharing an accessible name is flagged by no rule under the four tags `e2e/a11y.spec.ts`
requests, at any seed size. A table editor renders "Add row" once per table and "Remove
column" once per column; a bullets editor renders "Remove item" once per item. Every
per-block control therefore takes a **block-unique** accessible name, and the detector is a
**unit test rendering at least two blocks of the same kind** — written alongside the
control, because nothing else in the repo can catch it.

Toolbar toggles use `ToggleButton`, never a hand-rolled `aria-pressed` button —
`ToggleButton` carries the non-colour pressed marker that closes WCAG 1.4.1 on the three
dark schemes. For paragraphs this is free: the shared toolbar already does it.

The Documents view is in `A11Y_VIEWS`, so edit mode is scanned — but only in whatever state
the e2e seed produces. A control reachable only after entering edit mode on a seeded
document is scanned only if the seed gets there.

`pageBreak` blocks and read-only image paragraphs must remain reachable and announced in the
block list even though they carry no editor.

## Testing

- **Per-kind editor unit tests**, each rendering at least two blocks of that kind, asserting
  block-unique accessible names. This is the WCAG 2.4.6 detector; it is not optional.
- **`document-editor-commit.ts`**: unit tests for the block-to-`DocOp` mapping, the dirty
  check, the image predicate, and each coalescing arm — including the three run-breaking
  cases (an `ai` source, a non-`update` op, and a version outside the window).
- **A property test for the version budget:** N successive edits within one session must
  leave the pre-session before-image reachable and must not exceed `MAX_VERSIONS_PER_DOC`.
- **Mutation-prove the coalescing guard.** The obvious fixture — a document with no prior
  versions — cannot observe a coalescing bug at all, because every arm agrees there. Seed a
  prior `user` + `update` version explicitly, then confirm the assertion fails when the
  guard is reverted.
- **Narrow-pane layout** is tested by injecting the media-query match, never by resizing.
- Existing `documents-panel` and `document-preview` suites must stay green **unedited** —
  the preview is not being changed, and editing its tests would hide it if it were.

## Risks

| Risk | Mitigation |
|---|---|
| The block view and `renderDocumentHtml` drift | The block view is an editing affordance, never a fidelity claim; export, PDF and print stay on the canonical renderer; preview is one toggle away |
| `documents-panel.tsx` at 796 of 800 | All new code lands in new modules; the panel gains only the mode toggle and the mount. If that exceeds four lines, extract from the panel in the same commit |
| Commit-on-blur surprises a user mid-edit | Version history is the recovery path, and coalescing keeps the pre-session state as its first entry |
| Coalescing hides a real intermediate state | The window is short and named; the run breaks on any non-user or non-update version |
| Per-control accessible-name collisions | Unit tests with at least two same-kind blocks; the axe gate provably cannot cover this |
