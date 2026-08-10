# Documents — version model, mutation engine, persistence

Owns the **data half** of the documents feature: what a version is, how retention and
tombstones work, the single mutation path, and how `documentVersions` reaches all six
write paths and back into React state.

Does NOT own the renderers, the `DocBlock` union, the PDF-is-not-a-renderer rule, or the
pane file split — those stay in `AGENTS.md`'s "Documents (AI document authoring)" bullet.
One fact, one doc: this file links there rather than restating it.

★ The **surfaces** for version history and deleted-documents ARE built and live in this slice:
a per-row "History" button (`documents-list.tsx`) opens `DocumentsHistoryModal`, and the
deleted-documents section with its Restore button sits behind the toolbar's show-deleted toggle
(`documents-panel.tsx`). Everything below still describes only the model and the storage — the
panes are `AGENTS.md`'s Documents bullet. An earlier revision of this paragraph said those
surfaces did not exist; they landed later in the same branch and the paragraph was not updated.

## The version model (`document-versions.ts`)

★★★ **A `DocVersion` is a BEFORE-IMAGE — the state a mutation REPLACED — not a diff.**
Restoring writes it back verbatim, so there is deliberately **no inversion logic anywhere**
in this module or downstream of it. Do not add any; a "revert" is a write of a stored
snapshot, nothing more. This is the entire safety net behind direct AI document writes,
because chat tool writes take no undo capture.

`DocVersionSource` is `"ai" | "user"`. `DocVersionOp` is
`"update" | "rename" | "delete" | "duplicate" | "restored"`.

★★ `sanitizeDocumentVersions` **delegates block and title validation to
`sanitizeProjectDocuments`** (via a synthetic `ProjectDocument` wrapper) so a shape can
never be legal in a version and illegal in a document. But `savedAt` is validated **HERE**,
not borrowed from that delegation — the function keeps the caller's raw `savedAt` and
discards the wrapper's `createdAt`/`updatedAt`, so the delegated check would have been
thrown away. A garbage timestamp is not cosmetic: `byNewest` does a raw string compare and
`trimVersions` picks `sorted[0]` as the tombstone, so a corrupt `savedAt` can crown the
wrong version as the one that survives a delete.

★★ **Its two fallbacks are `"user"` and `"update"`** — an unrecognised `source` or `op` is
silently normalised to those. TEST TRAP: a fixture seeded with those two values round-trips
to itself even on a backend that stored *neither* field, so such a test passes against a
backend that drops them entirely. Seed `source: "ai"` and `op: "restored"` instead; only a
genuinely preserved value can satisfy that. `entity-persistence-registry.test.ts` seeds
exactly those two for this reason.

## Retention (`trimVersions`)

Newest-first within a document, then newest-first globally, for **live documents only**.
Caps are `MAX_VERSIONS_PER_DOC` and `MAX_TOTAL_VERSIONS`.

★★★ **A deleted document is trimmed immediately and hard, not "not yet trimmed".** The first
`trimVersions` pass after a delete keeps only its single newest version — the tombstone —
and drops every older one, regardless of either cap. That entry *is* the tombstone, and the
deleted-documents derivation reads its existence. Drop it and the document becomes
unrecoverable **while every other test still passes**.

★ Tombstones are excluded from `keepable` entirely, so they never count against
`MAX_TOTAL_VERSIONS`. That exemption is bounded by the restored marker (below). An id that
is deleted and never restored keeps one row forever — accepted, and the only remaining
unbounded case.

★ **The global cap has no per-document floor.** A rarely-touched live document can in
principle be starved to zero history by other documents filling the global pool first.
Accepted trade-off — it takes 25+ actively-edited documents to bite.

★★ **It returns the SAME array reference when nothing was dropped.** The Turso and IndexedDB
dirty checks are reference equality, so rebuilding an equal-but-new array would force a
write on every mutation.

★★ **Its only production caller is the mutation engine** (`withVersions` in
`document-mutations.ts`). Retention therefore runs on mutation, **never at load** — an
imported or hand-edited workspace can exceed both caps and nothing trims it until the next
document mutation. Reproduce the caller set (the third `grep -v` drops the definition itself,
without which the command returns the definition line and reads as if there were two callers):
`grep -rn "trimVersions(" src/app --include="*.ts" | grep -v "\.test\." | grep -v "document-versions.ts"`
→ one line, `document-mutations.ts`.

## Tombstones and the `"restored"` marker

★★★ **"Deleted documents" is DERIVED, never a stored flag** — `deletedDocumentVersions`
returns the newest version of every `documentId` absent from `documents` **whose `op` is
`"delete"`**. A boolean flag was rejected for the usual reason: it must be cleared on restore
and can desync.

★★★ **THE `op === "delete"` REQUIREMENT IS THE WHOLE CORRECTNESS ARGUMENT — do not
"simplify" it away.** The function used to ask "is this `documentId` absent from
`documents`?", which is a different question from "was this deleted", so ANY load-side
asymmetry between the two arrays surfaced as a phantom deletion. The reachable one is a cap
asymmetry: `sanitizeProjectDocuments` `break`s at `MAX_DOCUMENTS` while
`sanitizeDocumentVersions` has no count cap and structurally cannot acquire one. Measured on
all six write paths — a 205-document file loads as 200 documents and 205 versions, and five
documents that still existed in the file were listed as deleted, each with a Restore button
that would mint a duplicate.

★★ It is sound **by construction, not by luck**: the delete case writes
`snapshot(target, "delete", ctx)` with `savedAt = ctx.now` and a version id minted last, so it
wins both the timestamp comparison and `byNewest`'s descending-id tie-break, and `trimVersions`
keeps exactly that entry as the tombstone.

★★ **RESIDUAL LIMIT, state it rather than implying the case is closed:** a hand-edited or
foreign file carrying `op:"delete"` on a version whose document is absent is **byte-identical**
to a genuine deletion. No filter can separate them, because the two are the same data. The
filter narrows the failure from "any load asymmetry" to "a file that lies"; it does not
eliminate it.

★★★ **THE MARKER NO LONGER GATES ANYTHING IN `document-versions.ts` — but it is still live in
two OTHER files, so do not delete it.** `deletedDocumentVersions` once carried a second filter
excluding `RESTORED_MARKER_OP`; that was **removed** because `op === "delete"` subsumes it (a
marker's op is `"restored"`, which the new filter already rejects). `trimVersions` does not read
the constant either — it delegates to `isTombstone`, which compares the string literal
`"delete"`. Reproduce: `grep -n "RESTORED_MARKER_OP" src/app/document-versions.ts` → **6** lines,
of which exactly **1 is code**, the `export const` declaration; the other five are prose in
doc-comments. Its live readers are in files this paragraph used to omit — `document-mutations.ts`
(the restore-refuses-a-marker guard and the marker write) and `documents-history-modal.tsx`
(filters markers out of the restorable list). Sweep for them with
`grep -rn "RESTORED_MARKER_OP" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."`.
★ An earlier revision here claimed 5 lines / 2 code lines and named a `trimVersions` comparison
that does not exist — refuted by its own attached command, which nobody ran.

★★★ **A MARKER IS NOT A SNAPSHOT, and `restore` now refuses one.** It records that an id was
recovered — it is the one op that is explicitly not a before-image — so restoring one measured as
minting a second copy of the document *and* a second marker. `applyDocMutation`'s `restore` case
rejects it up front (`"is a restore marker, not a snapshot"`). ★ The derivation already filters
markers out, so no surface offers one today; the guard exists because the version-history and
deleted-documents surfaces are built directly against these version rows and either could hand
one back.

★★ **The marker is checked on the NEWEST entry only** in `trimVersions`. So an id that was
deleted → restored → deleted again correctly reappears as deleted: the marker records a moment,
it does not permanently exempt an id.

★★★ **Restoring a deleted document mints a NEW id** (ids are never reused) and writes a
`RESTORED_MARKER_OP` version against the **OLD** id — which is what stops the tombstone becoming
permanent in retention.

★★ **The marker also releases the group from tombstone protection**, which is what stops each
delete-restore cycle leaking one permanently unreclaimable row. Once it is newest, the group
re-enters ordinary retention and ages out.

★ The marker carries the recovered title/blocks rather than an empty snapshot, so the row
still reads as a meaningful history entry.

★★ **`deletedDocumentVersions` has exactly TWO production callers, and both are deliberate.**
Reproduce:
`grep -rn "deletedDocumentVersions(" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "document-versions.ts"`
→ **2** lines. ★ The final `grep -v` is load-bearing: without it the command also returns the
function's own definition, which reads as an extra caller.

- **`document-mutations.ts`** — the restore-idempotence guard **reuses** the derivation rather
  than re-deriving "the newest version for this id" itself. ★★ That is a design decision, not an
  incidental import: it makes it impossible for the guard and the list the user is looking at to
  disagree. "Simplifying" it into its own walk re-opens exactly that gap.
- **`documents-panel.tsx`** — the deleted-documents section calls it directly and adds **no
  narrowing of its own**, so it inherits the derivation's rules instead of duplicating them.
  ★★ That is why the pane needed no change when the `op === "delete"` filter landed, and why a
  future change to the rules must be made in the derivation, never in the pane.

## The mutation engine (`document-mutations.ts`)

★★★ **`applyDocMutation` is the SINGLE path both the pane and the AI tools mutate through.**
If either mutated `documents`/`documentVersions` independently, "every mutation snapshots its
before-image" would be only half-implemented. Its one production caller is `mutateDocuments`
in `workspace-context.tsx`; nothing else may call it, and nothing may bypass it by reaching
for `setDocuments`/`setDocumentVersions`. Reproduce:
`grep -rn "applyDocMutation(" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."`
returns **two** lines — the definition and that single caller.

★★ **No clock and no mint.** `now`, `mintDocId` and `mintVersionId` are injected via
`DocContext`, making `applyDocMutation` a pure deterministic function of its inputs — which is
what lets the property test drive it.

★★★ **A WHOLLY-REFUSED WRITE MUST NOT MUTATE.** When every op in a `kind: "ops"` mutation is
rejected (and no title changed), `applyOps` returns `null` and the engine returns the caller's
own state untouched. Writing the empty/unchanged result would destroy the document while the
caller reported only "I couldn't do that" — and chat tool writes have no undo capture, so this
branch is the only thing between a bad model index and real data loss.

★ **`changed: false` paths return the caller's OWN array references**, never rebuilt-but-equal
ones — `workspace-context.tsx` uses that identity to decide whether a write is needed.

★ Ops apply **left to right against the evolving array**, so an index means "as the array
stands at that step" — `[delete 0, delete 0]` means "the first two". That is the only reading a
model can act on deterministically.

★★ **Which mutations write a version, and against which id:**

| mutation | version written | `documentId` it is written against |
|---|---|---|
| `create` | none — nothing was replaced | — |
| `rename` | before-image, op `rename` | the renamed document |
| `ops` | before-image, op `update` | the edited document |
| `delete` | before-image, op `delete` | the deleted document (becomes the tombstone) |
| `duplicate` | source's title/blocks, op `duplicate` | ★ **the COPY's new id**, not the source |
| `restore` (live) | before-image, op `update` | the document restored in place |
| `restore` (deleted) | marker, op `restored` | ★ **the OLD id**; the new document gets none |

★ `duplicate` writing against the copy is deliberate: reverting straight after a duplicate
returns the copy to its copied-from state, and because the copy's id stays live the entry is
ordinary capped retention rather than a tombstone.

★ A restore of a deleted document **does not consume** the version row it restored from.

★ `capTitle` slices to `MAX_TITLE_CHARS` then trims, matching the document sanitizer exactly —
a title accepted here can never disagree with what the next load produces. Empty (including
whitespace-only) is rejected rather than stored, because the sanitizer would drop the document
on the very next load while this module reported success.

## Persistence — six write paths

`documentVersions` is a top-level optional `Workspace` field carried by all six write paths.

★ **Do not try to enumerate them with a bare grep.**
`grep -rln "documentVersions" src/app --include="*.ts" | grep -v "\.test\."` returns **12**
files, not 6 — the CSV and Markdown *decode* halves are separate files; `id-mint-session.ts`,
`use-storage-backend.ts` and `use-document-tools.ts` are consumers, not write paths; and
`scale-workspace.ts` only *mentions* the field in comments, so it is neither. The table below is
the authority; the grep is only a starting set to read through.
★★ That number is VOLATILE and has already rotted once: it was a true **11** when written, and
became 12 when a comment mentioning `documentVersions` was added to `scale-workspace.ts` — a
file whose author never touched this doc. **Re-run the command before quoting the number**; do
not assume the count still matches just because the write-path table does.

| path | file |
|---|---|
| JSON | `workspace.ts` |
| IndexedDB | `browser-backend.ts` |
| CSV | `csv-codecs-config.ts` (+ `csv-codecs-decode.ts`) |
| Markdown | `markdown-codecs-core.ts` (+ `markdown-codecs-decode.ts`) |
| Turso single-DB | `turso-schema.ts` |
| Turso multi-tenant | `turso-tenant-schema.ts` |

★★★ **THE TENANT SAVE LIVES IN A SEPARATE FILE FROM THE SINGLE-DB SAVE, AND THE OBVIOUS GREP
MISSES IT.** `turso-tenant-schema.ts` has its own `tenantWorkspaceToStatements`; the **load**
side is shared (`rowsToWorkspace`), so a slice added to only one of them reads back correctly
in both modes while silently dropping data in tenant mode — with every test green. This slice's
own plan missed it, and the plan's own grep instruction would not have found it. **Any future
"six write paths" task must open `turso-tenant-schema.ts` explicitly**, not trust a grep of the
schema file it expects.

★★ **Because the read side is shared, there are FIVE sanitize call sites, not six.** Reproduce:
`grep -rln "sanitizeDocumentVersions(" src/app --include="*.ts" | grep -v "\.test\." | grep -v "document-versions.ts"`
→ `browser-backend.ts` · `csv-codecs-config.ts` · `markdown-codecs-core.ts` · `turso-schema.ts` ·
`workspace.ts`. Six write paths, five read paths — do not "fix" the asymmetry.

★★ **Load is a TWO-PASS sanitize on every path:** `sanitizeDocumentVersions` (DOM-free,
structure only) then `sanitizeDocumentRichFields` for the block HTML allow-list. They are split
because the first is DOM-free by contract and cannot call DOMPurify. All five read paths use
the identical shape — including feeding `savedAt` in as both `createdAt` and `updatedAt` of a
synthetic `ProjectDocument` wrapper, since a version has neither of its own.

★ **On all five the pass sits inside a `catch`**, so one malformed version can never discard the
whole workspace — but they differ in scope and in what they do next, and only the JSON path is
loud about it:

| path | catch scope | on failure |
|---|---|---|
| JSON (`workspace.ts`) | the version block alone | **re-throws when `strict`**; otherwise logs the `workspace.documentVersionsDropped` diagnostic |
| CSV · Markdown | the version block alone | returns `undefined` — silent |
| Turso (`turso-schema.ts`) | the version block alone | leaves the slice `undefined` — silent |
| IndexedDB (`browser-backend.ts`) | ★ the **whole IDB read**, not just this pass | falls through to the legacy/blank path — silent |

★★ So corrupt history is recoverable-but-invisible on four of the five: nothing surfaces to the
user and only JSON emits a diagnostic. Do not read a clean load as proof the stored versions
parsed.

★ **Emission is gated on a non-empty array on every path**, so a workspace without history stays
byte-free of a `documentVersions` key and existing goldens are unaffected. An empty array is
therefore indistinguishable from absent at rest — which is fine, because both load to `[]`.

★★ **Meta-blob, not `ENTITY_SPECS`.** Neither `documents` nor `documentVersions` is an
`ENTITY_SPECS` row; both ride the `meta` table as one JSON row each, exactly like `insights`.
See `AGENTS.md`'s Documents bullet for why the absence from `TABLE_NAMES` means "has no table of
its own", NOT "is not workspace data" — that reading is how a future change talks itself into
adding it to the per-table DELETE set.
★ Note the consequence the bullet does not spell out: the `meta` table **IS** in `TABLE_NAMES`
and IS `DELETE`d and rewritten whenever it is dirty. That is safe only because the dirty block
re-emits **every** meta key in the same pass — adding a new meta key without adding it to that
block would silently drop it on the next save of any other meta slice.
★ `dirtyWorkspaceTables` maps a `documentVersions` reference change to `meta`, so an in-place
mutation of the array skips the save entirely.

## Entity links (`document-ref.ts`)

A document names the tasks, milestones, RAID items and changes it is about, via
`ProjectDocument.linkedEntities` — a sparse `DocEntityRef[]` of `{kind, id, label?}`.

★★ **It costs nothing on the six write paths, and that is a property of WHERE it lives, not of
anything the slice did.** `documents` is a meta-blob — one JSON row in `meta` — so a field INSIDE a
document rides every backend for free. Contrast `documentVersions` above, which is a top-level
`Workspace` field and therefore needed all six. Do not generalise either case: the question is
always whether the new field sits inside an existing blob or beside it.

★★★ **`sanitizeDocument` BUILDS FROM AN EXPLICIT FIELD LIST.** A persisted field it does not name
is dropped on every load, on every backend, silently — the shape that erased RAID note logs
(§49). Adding a field to `ProjectDocument` means adding it to that function, not only to the type.

★ **Sparse on BOTH sides.** An empty list is an ABSENT key, never `[]` — `sanitizeDocEntityRefs`
applies that on load and the `unlink` case applies it on write, so the two cannot disagree and an
unlinked document serializes byte-identically. The goldens pin those bytes.

★★ **`refKey(kind, id)`, never a bare id.** Ids collide ACROSS kinds: task #7 and risk #7 are
different entities. Every lookup, dedupe, React key and unlink comparison goes through it. This is
also why `LinkPickerEntry` gained an optional `key` and why `EntityLinkPicker`'s `onAdd`/`onRemove`/
`onOpen` take the ENTRY rather than an id — a multi-kind picker cannot disambiguate otherwise.

★★★ **`label` IS A TOMBSTONE AND `resolveDocRef` IS ITS ONLY READER.** It is the display source
only when `id` no longer resolves; while the target LIVES the live title wins. Read it directly and
a rename silently desyncs every chip and badge — the stale-name-cache class `effectivePersonEmail`
exists to prevent. The rule is mutation-pinned in `document-ref.test.ts`: a label-first resolver
fails that test.

★★ **A REFERENCE IS NOT CONTENT.** `link` and `unlink` write NO version (content gets versions;
references and metadata do not — consistent with `create`, which also writes none) and both LEAVE
`updatedAt` alone. `updatedAt` is a displayed column AND the list's default sort key, so bumping it
on an attach would report a content edit that never happened.

★ **Dangling references are left in place, deliberately.** Deleting an entity does NOT prune the
documents pointing at it, and nothing prunes at load. Both alternatives make a delete→undo round
trip lossy — the undo restores the entity but not the links, which is the §50 shape. Leaving the
reference is lossless, and the chip degrades to its tombstone label plus a non-colour marker
(`data-dangling-marker`; a `title` alone is hover-only and closes nothing for WCAG 1.4.1).

★★ **The badge's accessible name is row-qualified and only a unit test can prove it.** Measured
against axe-core 4.12.1: no rule carrying the four tags `e2e/a11y.spec.ts` requests flags two
controls sharing an accessible name, at ANY seed size, in ANY view. `DocumentBadge` therefore
appends the entity's own title, and each surface's test renders ≥2 rows. `DocumentBadge` takes
everything as PROPS and calls no context hook — it renders inside a Kanban card, which sits outside
`RowContextProvider`, and `useWorkspaceTab` throws without a provider.

★ **Two known behaviours of the filtered state**, both accepted rather than overlooked:
a read-only popout renders no link field AND no chips (the field is withheld rather than drawn
inert, per the no-false-affordance rule), and the preview can show a document outside the filtered
list, because selection still resolves against the full `documents` set.

## Load/save wiring (app state)

★★ `documentVersions` was implemented in the model and all six write paths **before** it was
loaded or saved — it initialised to `[]` and stayed there, so every reload silently dropped
every document's history. The wiring closes that at nine lines in `use-storage-backend.ts`:
the `useWorkspace()` destructure, the load-apply, the autosave **deps array**, five
workspace-assemble literals (autosave save, explicit save, migrate-to-target save, the
dirty-check `outgoing`, and the workspace getter), and the broadcast registration. Reproduce:
`grep -n "documentVersions" src/app/use-storage-backend.ts` → **9** lines (one of them carries
two `useBroadcastSync` calls).

★★★ **THERE ARE TWO LOAD FUNNELS AND THE SECOND IS EASY TO MISS.** `applyRestoredWorkspace` in
`task-manager.tsx` fans a restored workspace into every setter **by hand** — a slice absent from
that list is dropped on a Turso version restore even when the ordinary load path is perfect.
Reproduce: `grep -n "setDocumentVersions" src/app/task-manager.tsx` → **3** lines (destructure,
the restore call, the dep array).

★ Both funnels use `?? []` because the context state is non-optional: the mutation engine
spreads the previous array, which would throw on `undefined`.

★★ **`documents` and `documentVersions` each register their own cross-tab `useBroadcastSync`
channel and must stay in step.** The autosave writes the WHOLE workspace on any slice change, so
a tab holding a stale copy writes it back over another tab's work — that is why each slice needs
a channel at all. The two are additionally coupled: `deletedDocumentVersions` derives tombstones
from **both**, so a tab that received a document delete without the matching version (or the
reverse) would compute a wrong deleted-documents list.
★ `useBroadcastSync` takes a **free string** `kind` over one shared `BroadcastChannel` — there is
no key union, registry or allowlist, so a new channel needs no registration anywhere.

★ The two channel registrations are deliberately **paired on one source line**:
`use-storage-backend.ts` sits exactly at the 800-line ratchet, and the gate counts
`split("\n").length`, i.e. `wc -l` **+ 1** (see `AGENTS.md`'s `size:check` entry). Splitting them
re-breaks the gate.

## Test coverage — what is and is not pinned

★★ `entity-persistence-registry.test.ts`'s `documentVersions` block covers **CSV, Markdown and
JSON** round-trips — **three** backends, not six. Reproduce:
`grep -c "it(\"documentVersions survive" src/app/entity-persistence-registry.test.ts` → **3**.
★ Grepping the bare phrase instead returns 4 — the `describe` header matches it too.
The two Turso paths and IndexedDB are covered by their own suites, not by that registry block;
do not read a green registry run as proof all six carry the slice.
