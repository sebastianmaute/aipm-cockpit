# §100 — raise the document cap and make load-time truncation non-silent

**Date:** 2026-08-07
**Closes:** `docs/open-followups.md` §100 (both halves — the document-count loss and the
related per-version block truncation)
**Explicitly NOT in scope:** §98 (`documents` invisible to the L3/B save-time guards), §101
(`ai.documentWrite` deep-link). Both adjacent, neither folded in.

---

## Problem

`sanitizeProjectDocuments` (`document-model.ts:193`) stops at `MAX_DOCUMENTS` (200) with a bare
`break`. Nothing records the truncation. Load an over-cap workspace, let autosave fire, and the
excess documents are gone from storage — permanently, on all six write paths:

```
original file: 205 docs / 205 versions
after load:    200 docs / 205 versions
after re-save: 200 docs / 205 versions
documents PERMANENTLY LOST by load->save: 5
```

This shipped in 0.219.0 "Elgin" (`90199c26`) and is live today. It is **not** an S2 regression;
S2 introduced only the phantom-deleted-documents consequence, which was closed separately.

The engine-side cap added in S2 (`document-mutations.ts` refuses creates past the cap) stops the
app *building* an over-cap state. It does nothing about *loading* one. The exposure is any
workspace not produced by the current engine: a hand-edited JSON, a third-party or imported file,
or data written before that guard existed.

### The related silent truncation (in scope)

A version carrying more than `MAX_BLOCKS_PER_DOC` (500) blocks loads truncated, because
`sanitizeDocumentVersions` delegates per item to `sanitizeProjectDocuments`, which slices:

```
blocks per version: in 525, out 500
version COUNT cap probe: in 1200 versions -> out 1200   (no count cap on versions — clean)
```

Restoring such a version hands back a truncated document body with no indication. History
corruption rather than loss, lower severity, same mechanism.

---

## Decisions taken

Four forks were settled before design. Recording them with their reasoning, because each had a
defensible alternative:

**1. Raise the cap to 1000 rather than refusing the load or leaving it at 200.**
Refusing locks a user out of their own legitimate project with no in-app route to get under the
cap. Leaving it at 200 and only warning means the data still dies — the fix would be a
disclosure, not a save. Raising eliminates the loss for every realistic project while keeping a
real bound against hostile input.

**2. One constant, not a load-vs-create split.**
`MAX_DOCUMENTS` continues to serve both doors — load truncation *and* the engine's
create/duplicate/restore refusals (`document-mutations.ts:385,487,555`). A separate
`MAX_DOCUMENTS_LOAD` would create exactly the "one door of two" shape that produced six defects
in S2.

**3. The disclosure is uniform and user-visible on every backend.**
Not ring-only (a user who loses documents is still not told), and not "reuse the existing
channel" — the existing `lastImportDroppedRows` toast reaches only `LocalFileBackend` and
`SharePointBackend`, because its consumer sits in `use-storage-file-ops`. IndexedDB and Turso
would have stayed silent. Partial coverage on a data-loss path is the failure mode this design is
shaped against.

**4. Automatic saves are blocked after a truncating load.**
A warning alone still ends in destruction on the user's next edit.

### One correction carried forward

An earlier costing of decision 4 claimed it could reuse `suppressNextSaveRef`. **It cannot.**
That ref is one-shot *and* is already set by every load (`use-storage-backend.ts:341`), then
cleared on the first debounce cycle (`:387-392`). The truncating load already sets it today; the
loss happens on the *next* save. Reusing it buys nothing. This needs a new **sticky** flag.

Nor would the existing invariants catch it: dropping 205 of 1205 leaves 83%, nowhere near
guard B's ≤10% threshold, and documents are not counted by those guards at all (§98).

---

## Architecture

Extend the codebase's existing `ImportDiag` idiom to the document sanitizers, thread it through
all five load paths, accumulate on the backend, surface it at the one load site every backend
passes through, and gate automatic saves on a sticky flag.

```
raw blob
  -> sanitizeProjectDocuments(raw, diag?)      counts what the cap dropped
  -> load site hands counts to its backend
  -> backend.lastLoadTruncation                optional field on StorageBackend
  -> use-storage-backend load effect           toast + logDiag + set sticky flag
  -> save choke point                          automatic save refused while sticky
```

### Why an optional `diag` out-param

The alternative — a sibling `sanitizeProjectDocumentsWithReport` returning
`{documents, truncated}` with the existing name as a thin wrapper — is purer, but it duplicates
the entry point: ~95 existing call sites would sit on the wrapper while five sit on the real one.
Two doors onto one question.

A third alternative — computing it at the load sites by comparing lengths — is **provably
imprecise** and was rejected on that basis. With 205 raw entries of which 5 are invalid and a cap
of 200, `out.length === cap && raw.length > cap` is true while nothing was actually lost. It
over-reports a data-loss warning, which is worse than under-reporting one.

`ImportDiag` is already threaded as `diag?:` through ~20 CSV/Markdown decoders and mutated with
`diag.droppedRows++` (`csv-codecs-decode.ts:106`). Accumulator mutation is the accepted local
exception to the immutability rule; the precedent is established and tested.

### Counting: bounded, and deliberately an upper bound

The exact count — keep sanitizing past the cap to see how many *valid* documents were lost —
reintroduces the denial-of-service the cap exists to prevent: a hostile 10⁶-entry file would be
fully sanitized before being discarded.

So the sanitizer counts **remaining raw array entries** after the break. `O(1)` per entry, no
sanitization of the tail. The number never understates the loss and may overstate it when the
tail is junk. **The user-facing wording therefore says "entries", not "documents"** — the count is
honest about being an upper bound.

---

## Components

| File | Change |
|---|---|
| `document-model.ts` | `MAX_DOCUMENTS` 200 → 1000. `sanitizeProjectDocuments(raw, diag?)` counts remaining entries after the cap break. Stays DOM-free — the diag type is a type-only import, no runtime dependency added |
| `document-versions.ts` | Threads the same diag through its per-item delegation so block truncation is counted |
| `browser-backend.ts:270` | Passes a diag; stores counts on the backend |
| `csv-codecs-config.ts:276` | Same |
| `markdown-codecs-core.ts:226` | Same |
| `turso-schema.ts:211` | Same (serves Turso single **and** tenant — they share `rowsToWorkspace`) |
| `workspace.ts:664` | Same (JSON) |
| `workspace.ts:459` | New optional `lastLoadTruncation?: { entries: number; blocks: number }` on the `StorageBackend` interface, beside `lastImportDroppedRows`. Named `entries`, not `documents`, to match what is actually counted |
| `use-storage-backend.ts:~339` | **The single consumer.** The generic load effect every backend passes through. Reads the field after `applyWorkspace`, fires the toast, writes the ring entry, sets the sticky flag |
| `use-storage-backend.ts:~387` | Save choke point. Automatic save refused while the sticky flag is set; `allowTruncatedSave()` arms a one-shot bypass, mirroring `allowDestructiveSave()` exactly |
| `notifications.tsx` | New `TruncatedLoadBanner` — a thin wrapper over the shared `AlertBanner` primitive, same shape as the existing `StorageBanner` (`:90`). Carries the "Save anyway" action and a dismiss |
| `task-manager.tsx:~2618` | Mount it beside `StorageBanner` |
| `i18n.ts` / `i18n.de.ts` | New keys, EN/DE parity. DE needs real umlauts |

Placing the consumer at the generic load effect rather than in `use-storage-file-ops` is what
makes the disclosure uniform. That single choice is the difference between this design and the
existing `droppedRows` toast that reaches two backends out of six.

---

## Data flow

1. A load path decodes a blob and calls `sanitizeProjectDocuments(raw, diag)`.
2. The sanitizer fills `diag.droppedEntries` / `diag.droppedBlocks`.
3. The load path assigns `backend.lastLoadTruncation = {...}`.
4. `use-storage-backend`'s load effect reads it immediately after `applyWorkspace(workspace)`.
5. If either count is non-zero: `logDiag("error", "workspace.documentsTruncated", …)`, a toast
   naming what was not opened and stating that saving is paused, and the sticky flag is set.
6. The save effect refuses while the flag is set.
7. The banner's "Save anyway" calls `allowTruncatedSave()`, which arms the one-shot bypass and
   clears the sticky flag; the next save proceeds and commits the truncation.

---

## Error handling

`diag` is optional at every level. A backend that never sets `lastLoadTruncation` yields
`undefined`, which produces no toast and no flag — fails safe, and matches the convention
`lastImportDroppedRows` already established as an optional field.

Counting cannot throw: it reads `raw.length` and an index, both already in hand.

The sticky flag pauses **automatic** saves only. The user is never locked out of saving
deliberately; the surfaces must say so plainly, because a user who does not realise saving is
paused would otherwise lose subsequent edits — the risk this option trades for protecting the file.

## The recovery affordance is mandatory, not a nicety

Self-review caught this and it nearly shipped as a hole. **The user cannot resolve a truncating
load by editing.** The excess documents were never loaded into memory, so there is no in-app way
to delete documents until the workspace is under the cap — the very rows that would have to go are
the ones that are not there. Without an explicit escape the sticky flag is a permanent block on
saving, which is a worse defect than the one being fixed.

So a truncating load raises a **persistent banner**, not only a transient toast: the state is
sticky, and a toast that disappears leaves the user with a silently unsaveable app. The banner
offers exactly two routes out, and they are the only two that exist:

- **Save anyway** — accept the loss deliberately. Arms the one-shot bypass.
- **Leave it** — the source file keeps all its documents; repair it outside the app and reopen.

`TruncatedLoadBanner` wraps the shared `AlertBanner` primitive rather than hand-rolling a surface,
matching `StorageBanner` (`notifications.tsx:90`) — a hand-rolled banner would miss the a11y
wiring the primitive already carries.

---

## Testing

- **Sanitizer:** counts on truncation, zero when under cap, new cap value, block-truncation count.
- **DOM-free contract:** the existing comment-stripped source scan must still pass.
- **One test per load path** — five of them — that a truncating load propagates a non-zero count.
- **A registry-style test that every backend sets the field.** This is the "one door of N" guard
  and is the single most important test in the slice: it is what stops a future backend from
  silently opting out of the disclosure.
- **Save guard:** automatic save refused while sticky.
- **The escape works.** "Save anyway" arms the bypass and the next save actually proceeds. This
  pins the difference between a guard and a lockout, and is the test that would have caught the
  hole self-review found.
- **Mutation-test the guard** — remove the refusal and confirm a test goes red. A guard whose
  removal leaves the suite green is not pinned.
- **i18n:** EN/DE key parity (tsc enforces); DE umlauts real, not ASCII substitutes.

---

## Known consequences

Flagged rather than buried:

- The engine's refusal message becomes `document limit reached (1000)`. Existing tests
  interpolate `MAX_DOCUMENTS`, so they adapt; any hardcoded `200` will not.
- A 1000-document workspace serialises into a single meta JSON blob. That is a real increase in
  worst-case row size on every backend. Not a blocker, but it is a change to the shape of the
  data at rest, not merely to a limit.
- Tests that build `MAX_DOCUMENTS`-sized fixtures now build 1000-element arrays. Slower; watch
  the property suites, which already run ~100 cases each.

---

## Success criteria

1. A 1205-document workspace loads through all five load sites (covering all six write paths —
   Turso single and tenant share `rowsToWorkspace`), keeps 1000, and the user is told on every
   backend.
2. Nothing is destroyed without a deliberate user save.
3. A 205-document workspace — the original reproduction — now loads and saves with **no loss at
   all**, because it is under the raised cap.
4. Restoring an over-500-block version warns instead of silently returning a cut-off body.
5. `docs/open-followups.md` §100 closes in full.
