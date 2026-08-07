# Documents — version model, mutation engine, persistence

Owns the **data half** of the documents feature: what a version is, how retention and
tombstones work, the single mutation path, and how `documentVersions` reaches all six
write paths and back into React state.

Does NOT own the renderers, the `DocBlock` union, the PDF-is-not-a-renderer rule, or the
pane file split — those stay in `AGENTS.md`'s "Documents (AI document authoring)" bullet.
One fact, one doc: this file links there rather than restating it.

★ The **surfaces** for version history and deleted-documents did not exist when this file
was written. Everything below describes the model and the storage, never a screen. If you
are looking for how a user reaches version history, it is not documented here because it
is not built here.

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
returns the newest version of every `documentId` absent from `documents`. A boolean flag was
rejected for the usual reason: it must be cleared on restore and can desync.

★★★ **Restoring a deleted document mints a NEW id** (ids are never reused) and writes a
`RESTORED_MARKER_OP` version against the **OLD** id. Without that marker the old id stays
absent from `documents` forever, so the derivation would keep reporting it as deleted after
the user had already restored it — a phantom row whose Restore button mints yet another copy
on every click.

★★ **The marker is checked on the NEWEST entry only**, in both `trimVersions` and
`deletedDocumentVersions`. So an id that was deleted → restored → deleted again correctly
reappears as deleted: the marker records a moment, it does not permanently exempt an id.

★★ **The marker also releases the group from tombstone protection**, which is what stops each
delete-restore cycle leaking one permanently unreclaimable row. Once it is newest, the group
re-enters ordinary retention and ages out.

★ The marker carries the recovered title/blocks rather than an empty snapshot, so the row
still reads as a meaningful history entry.

★ **`deletedDocumentVersions` has no production caller today** — only tests. It is a correct,
tested derivation waiting for a surface. Verify before assuming otherwise:
`grep -rn "deletedDocumentVersions(" src/app | grep -v "\.test\." | grep -v "document-versions.ts"`
→ **no output**. ★ The final `grep -v` is load-bearing: without it the command returns the
function's own definition line, which reads as a caller and inverts the answer.

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
`grep -rln "documentVersions" src/app --include="*.ts" | grep -v "\.test\."` returns **11**
files, not 6 — the CSV and Markdown *decode* halves are separate files, and `id-mint-session.ts`,
`use-storage-backend.ts` and `use-document-tools.ts` are consumers, not write paths. The table
below is the authority; the grep is only a starting set to read through.

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
