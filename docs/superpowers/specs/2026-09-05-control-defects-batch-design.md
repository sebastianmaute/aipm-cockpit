# Control-defects batch — design

**Date:** 2026-09-05
**Base:** `origin/main` @ `2eeb68f8` (0.285.0 "Barnhill")
**Status:** approved, not yet planned

Six independent, user-visible control defects, batched into one slice. No new persisted
`Workspace` field, no backend write paths, no version bump in this spec — the slice ships
separately on explicit say.

Every fact below was measured against the tree at `2eeb68f8`. Line numbers rot on the first
insertion: re-grep the symbol before relying on one.

## Scope

| # | Item | Surface |
|---|---|---|
| 1 | Turso buttons visible-but-disabled | `projects-panel.tsx` |
| 2 | Ask Claude icon clipping | `task-row.tsx` |
| 3 | RAID badge shows a count; no badge may wrap | `task-raid-badge.tsx`, `task-row.tsx`, `document-badge.tsx`, `task-jira-badge.tsx` |
| 4 | Asset name opens the preview | `asset-library.tsx` |
| 5 | Knowledge "Attach to" becomes a searchable single-select | `knowledge-panel.tsx`, NEW `single-entity-picker.tsx` |
| 6 | Re-clicking an open document's name collapses the body | `documents-panel.tsx`, `documents-list.tsx` |

Explicitly OUT of scope, filed instead as register entries (see "Follow-ups"):
the `"1 changes"` pluralization defect, and the missing Turso connection test.

---

## 1. Projects tab — Turso buttons visible but disabled

**Today.** `projects-panel.tsx` renders "Load from Turso" and "Move to Turso" inside
`{!isTurso && tursoConfigured && (` and `{!isTurso && tursoConfigured && currentProject && (`.
When Turso is unconfigured the buttons are **absent**, not disabled — so the capability is
undiscoverable from this screen.

**Change.** Drop `tursoConfigured` from both render gates; pass `disabled={!tursoConfigured}`
to each `Button`. `Button` already forwards `disabled` and styles it (its base class carries
`disabled:cursor-not-allowed disabled:opacity-50`) — no primitive change.

`currentProject` stays a **render** gate on Move-to-Turso. With no project there is nothing to
move, and a permanently disabled control is noise rather than discovery.

**★★ LOAD-BEARING TRAP — the hint is unreachable on the control it explains.** A `disabled`
button dispatches no mouse events, so a `title` on it never surfaces. The explanation of *why*
the button is disabled would therefore be invisible exactly when it is needed. Both buttons get
a wrapping `<span title={...}>` that carries the hint, and a test pins that the hint lives on
the wrapper rather than the button. Do NOT reach for `aria-disabled` instead: an
`aria-disabled` lookalike still fires `onClick`, which here would start a migration the user
was told was unavailable.

**i18n.** One new key pair for the disabled hint. `storageNotReady` exists but is about
file-backed storage and must not be reused.

**Tests.** Unconfigured renders both buttons, both `disabled`, hint present on the wrapper;
configured renders both enabled. Mutation: remove `disabled=` and the first assertion must go
red.

---

## 2. Ask Claude icon clipping

**Today.** The leading cell is `<Td className="w-7">` with the default `padding="normal"`.
`Td` is private to `task-row.tsx` and resolves `normal` to `px-4`, `tight` to `px-1`. So a
28px-wide cell carries 32px of horizontal padding — the sparkles glyph clips and is pushed
left, visibly colliding with the checkbox cell beside it.

**Change.** Add `padding="tight"` to that cell. One line; 32px of padding becomes 8px.

**Tests.** Assert the leading cell's class contains `px-1` and not `px-4`. jsdom has no
layout, so the class is the only observable — the visual result belongs to the eye-verify.

---

## 3. RAID badge → count, and the wrapping root cause

**Today.** All four badges — Jira, RAID, Document, Changes — render inside the narrow,
user-resizable ID column of `task-row.tsx`. None carries `whitespace-nowrap`. The RAID badge's
visible text is the glyph string `raidReferencedByMix` (`"{0}R · {1}A · {2}I · {3}D"`), which
wraps to four lines, and the Changes badge wraps to two. Row height inflates accordingly.

**Change, part A — the badge text.** Visible text becomes a new short count key, `"{0} RAID"`.
The existing `raidReferencedByMix` breakdown moves into `title`. The two trade places; no
information is lost from the row.

**Change, part B — the accessible name.** `task-raid-badge.tsx` builds its `aria-label` so the
visible text is contained in it by construction. The chain is rebuilt to lead with the NEW
visible text, then the breakdown, then the row token:

    aria-label={rowLabel(rowLabel(countText, mix), rowToken)}

Leading with the visible text satisfies WCAG 2.5.3 by construction rather than by coincidence.
2.5.3 is CONTAINMENT — case-insensitive and position-independent — so front position is the
Understanding note's best practice, not the criterion; it is chosen here because it cannot be
broken by a translation that reorders the sentence. The trailing `rowToken` is what closes
2.4.6, and it is a REQUIRED prop precisely so a missed caller is a tsc error.

**Change, part C — the wrap.** `whitespace-nowrap` on the RAID, Document and Jira badges and
on the inline Changes span in `task-row.tsx`.

**★★★ NO GATE CAN SEE A REGRESSION IN PART B.** The component's own comment records why:
axe ships `label-content-name-mismatch` and it carries `wcag21a`, but it is ALSO tagged
`experimental`, which axe's default `tagExclude` drops — so the tag-only `runOnly` in
`e2e/a11y.spec.ts` never runs it. Separately, axe has no rule at all that flags two controls
sharing an accessible name, at any seed size in any view. `task-raid-badge.test.tsx` is the
only detector for either property and must be mutation-proved, not merely re-run green.

**Prose sweep.** The file's existing comments describe the old arrangement (visible glyph
string, bare-count tooltip) in four places, including an "ACCEPTED COST" paragraph reasoning
about a tooltip that is about to change meaning. They are rewritten in the same commit. A
comment left describing the previous behaviour reads as current to the next contributor.

**i18n.** One new key pair (`"{0} RAID"`). `raidReferencedByMix` and `raidReferencedBy` both
survive and are both still used.

---

## 4. Asset name opens the preview

**Today.** `asset-library.tsx` renders the asset name as a bare span when not editing. The
row has no `onClick`. Preview is a separate `Button` whose `onClick` is
`setPreviewIndex(index)`, rendered only when `loadImage` is available.

**Change.** The name becomes a button calling the same `setPreviewIndex(index)` — but ONLY
when `loadImage` is available. Without it there is no preview to open, and a control that
does nothing is worse than plain text. The editing branch (`Input`) is untouched.

**Styling.** Follow the existing clickable-name pattern used for document titles
(`text-left underline-offset-2 hover:underline` plus the shared `INTERACTIVE` ring), NOT a
`Button` variant. In a data table a name should read as a name.

**Naming.** Two assets can carry the same name, so the control takes the row `token` already
built for this row's other controls. The sibling controls are all `Label – token` composites,
so a name-derived accessible name cannot collide with them.

**Tests.** Clicking the name opens the preview. A two-row fixture where BOTH assets share a
name, asserted with the shared `src/test/row-unique-names.ts` and `requireCollisionSeed: true`
— a bare `minControls` floor is satisfied by a SINGLE row's own controls (this row renders
Preview, Insert, Rename and Delete, plus Confirm/Cancel while editing) and would therefore pass
over a one-row fixture. Count them in the fixture rather than trusting that list.
Also: with `loadImage` absent, the name renders as non-interactive text.

---

## 5. Knowledge "Attach to" — searchable single-select

**Today.** A native `Select` whose options are `targets`: every task, RAID item, change,
milestone and stakeholder, plus the project. The list scales with workspace size, so a
searchable control is warranted rather than cosmetic. There are also two fixed entries: an
empty dash option and a Standalone option.

**Why not the existing picker.** `EntityLinkPicker` is multi-select only — `selected` is a
readonly array with `onAdd`/`onRemove` chips, there is no single-value concept and no
empty/none option. Its own docstring scopes it to multi-linked entities, and it is consumed by
`TaskLinkPicker` and `RaidCausedByField`. Adding a single-select mode would put two working
surfaces at risk for a third caller's benefit.

**Change.** A new `src/app/single-entity-picker.tsx`. A `.tsx` keeps it out of the coverage
gate; a pure `.ts` would be coverage-gated and would raise the floors.

It reuses the PURE engine rather than the component: `filterPickerOptions` from
`picker-filter.ts`, which already layers `wildcardMatcher` (the `*` wildcard) over an
`#id` exact match and a 20-item limit. It owns what the multi-select cannot: a single value,
the empty option, and Standalone.

Its ARIA mirrors `entity-link-picker.tsx`'s existing combobox rather than inventing one — the
repo has a working pattern and a hand-rolled second one is the failure this rule exists for.

`knowledge-panel.tsx` swaps the `Select` for it, keeping the `kind:id` value format so nothing
downstream changes.

**Checked and clear.** The peer's derived-label hazard — an id-to-name accessor returning a
blank for an entity whose label is DERIVED rather than stored — does not reach here: every
`targets` name comes from a stored field (`taskName`, `title`, `name`). No `roleLabel`-style
derivation is in this path. Roles are not an attach target.

**i18n.** One new key pair for the search placeholder. Model it on `depSearchPlaceholder`
("Type to find a task, or * for all"), which already teaches the wildcard in the placeholder.

**Tests.** Typing filters; `*` matches all; an `#id` query matches by id; selecting sets the
same `kind:id` value the `Select` produced; the empty and Standalone options remain selectable;
keyboard navigation reaches and commits an option.

---

## 6. Documents — re-click the name collapses the body

**Today.** `handleSelect` unconditionally sets `selectedId`. The content is three
always-mounted siblings — `DocumentLinksSection`, `DocumentsAssetSection`,
`DocumentEditModeBody` — each null-guarding internally. There is no wrapping container and no
disclosure primitive on this panel.

**Change.** New transient `bodyCollapsed` state in `documents-panel.tsx`. `handleSelect`
toggles it when the clicked document is already the open one, and otherwise selects the new
document and expands. Only `DocumentEditModeBody` — the tall rendered document — becomes
conditional. Links and assets stay visible, so the metadata controls remain usable while the
height is reclaimed.

**★★★ COMPARE AGAINST `selected?.id`, NEVER `selectedId`.** `selected` is
`selectionPool.find(d => d.id === selectedId) ?? selectionPool[0] ?? null`. On first load
`selectedId` is `null` while the first document is rendered as open. A toggle written against
`selectedId` therefore makes that first document's name silently un-collapsible — the single
most likely click in the panel does nothing. This is the specific defect the design exists to
prevent, and it is invisible to any test whose fixture clicks a document AFTER an explicit
selection.

**State is transient.** Plain component state, reset on reload. Collapsing is a momentary
"give me room" gesture, not a preference — no localStorage key, no settings field, nothing to
go stale.

**a11y.** The title button gains `aria-expanded` reflecting the collapse state for the open
document only, and keeps `aria-current`. `aria-expanded` needs no label, so this costs no i18n
key. The existing comment in `documents-list.tsx` states the design intent is "current item in
a set, not a toggle" — that intent is deliberately reversed here, so the comment is rewritten
rather than left contradicting the code beneath it.

**Unaffected.** `useDocumentEditMode` keeps its `documentId` and is not remounted, so a
collapse does not discard edit state. A user may collapse while `editing` is true and the
editor returns on expand; accepted, and noted in the eye-verify.

**Tests.** Clicking the open document's name collapses the body and leaves links/assets
mounted; clicking again expands. **A test that collapses the FIRST document with `selectedId`
still null** — the trap above; it must be red against a `selectedId` comparison. Clicking a
DIFFERENT document selects it and expands. `aria-expanded` tracks the state.

---

## Files

Modified: `projects-panel.tsx` · `task-row.tsx` · `task-raid-badge.tsx` · `document-badge.tsx` ·
`task-jira-badge.tsx` · `asset-library.tsx` · `knowledge-panel.tsx` · `documents-panel.tsx` ·
`documents-list.tsx` · `i18n.ts` · `i18n.de.ts`

Created: `single-entity-picker.tsx` + its test. Tests updated alongside each item.

No file approaches the 1600-line ratchet; `documents-panel.tsx` is the largest touched at 767.

## i18n

Three new EN/DE key pairs: the RAID count (`"{0} RAID"`), the Turso disabled hint, and the
attach-to search placeholder. `aria-expanded` and the asset-name control need none.

`i18n.ts` and `i18n.de.ts` are being written concurrently by a peer session for an unrelated
label map, so **all six items are built i18n-last** and the string commit lands once that
branch is clear. EN/DE key parity is tsc-enforced. `i18n.de.ts` is CRLF and must be patched by
an anchored utf8 write matching CRLF with real umlauts — the `i18n-encoding` test bans ASCII
substitutions, and the Edit tool corrupts umlauts and curls quotes in that file.

## Gates

`npx tsc --noEmit` (exits 2 on diagnostics) · `npx eslint --max-warnings=0` on touched files ·
the touched vitest files, then `npm run test:run` · `npm run test:shuffle`, since new tests are
added · `npm run size:check`.

Never two vitest processes at once. Never read a gate's exit code through a pipe.

**Every guard is mutation-proved by reading WHICH cases fail**, recorded as `N failed / M
passed` whose sum equals the file's runtime test count — an exit code alone cannot distinguish
a landed mutant from a mutant that never applied. `git checkout -- <file>` is deny-blocked
here, so each mutant is reverted by an inverse anchored write with uniqueness asserted in both
directions, ending on an empty `git diff --stat`.

Never stage `sample-workspace-huge.json` (a foreign concurrent writer modifies it) or
`not-in-use.env.local.bak` (untracked, not gitignored, holds live Turso credentials). Never
`git add -A` or `git add .`; commit with `git commit --only <paths>`.

## Owed: eye-verify

jsdom has no layout, so nothing in the unit suite can see the defects this slice is mostly
about. A real-browser pass is a gate for this slice, not a nicety:

- the leading icon cell no longer clips and no longer collides with the checkbox
- no badge wraps in the ID column at its narrowest resize, and row height is back to one line
- the disabled Turso buttons show their hint on hover
- the asset name is discoverable as clickable and opens the preview
- the attach-to combobox opens, filters, and commits by keyboard alone
- collapsing the document body reclaims height and the panel reflows to its row content

## Follow-ups

Two defects found while scoping, deliberately not folded in. Numbers are minted at filing time
against `origin/main` — a number is reserved only once it is there, and a peer session holds an
unlanded block from 390, so these take numbers above it.

1. `taskRowChangesBadge` is `"{0} changes"`, so one change renders "1 changes". DE plural
   handling makes this more than a string edit.
2. There is no Turso connection test anywhere in the repo — Jira and Timelog both have one.
   Until it exists, "Move to Turso" can only be gated on configuration being PRESENT, never on
   it being CONFIRMED WORKING, which is what was originally asked for.
