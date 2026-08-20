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

★★★ **`move` IS ONE OP AND MUST STAY ONE.** `applyOps` validates and applies per-op, pushing a
reason for each refusal, and bails wholesale only when NOTHING applied — the wholly-refused-write
rule above. So a reorder spelled as `delete` + `insert` can apply the delete and have the
re-insert refused, losing the block; a single op cannot express that failure. `document-ops.test.ts`
pins the contrast directly ("is atomic where a composed delete+insert is not"). Do not "simplify"
the op away.

★ Its arithmetic: remove at `from`, then insert at `to` **in the resulting array**, so `to`
addresses `0..len-1` and `to === len - 1` appends. That is the same splice `reorderIds`
(`list-reorder.ts`) performs, so the drag hook's dragged/target pair needs no translation.

★★ **`from === to` is REJECTED, not applied.** `changed` derives from the applied COUNT, never
from comparing the result, so a self-move would mint a before-image recording nothing. No user
reaches that arm — `useListReorderDnd`'s `commit` returns early when `reorderIds` hands back the
SAME array reference, which it does for equal ids — but model JSON and stored ops both arrive as
`unknown` at runtime, so the arm has to exist.

★ **The op interpreter lives in `document-ops.ts`**, split out when `document-mutations.ts`
reached 795 of the 800-line ratchet. Nothing about the split is semantic: `applyDocMutation` is the
dispatcher, `applyOps` the interpreter its `"ops"` arm calls. `DocOp` is declared there and
re-exported from `document-mutations.ts`, so no importer moved — they all still name the engine.
Count them rather than trust this line (it was **four** non-test modules on 2026-08-20, and
`use-document-editor.ts` was the one this slice added):
`grep -rln "import type {[^}]*DocOp" src/app --include="*.ts" | grep -v ".test."`

## Coalescing before-images for hand edits (`document-editor-commit.ts`)

★★★ **THE RUN IS ANCHORED BY IDENTITY, NOT CONTENT.** `shouldCoalesce(versions, documentId, now, anchor)`
decides whether a hand block edit reuses the session's most recent before-image or the mutation engine
mints a new one (`applyOps` → `"ops"` mutation → the `update` row in the table above). `anchor` is the
exact `{id, savedAt}` pair the CALLER's own last commit minted — `DocResult.minted` — never a "newest"
re-derived from the version list; coalescing happens only while that exact row is still the newest one.

★★ **Why identity, and not the `source === "user" && op === "update"` check it replaced:** the "restore
(live)" row two sections up ALSO writes a `user`/`update` before-image (`snapshot(liveDoc, "update", ctx)`,
`ctx.source` hardcoded to `"user"` by the panel funnel), byte-indistinguishable from one of the hand
editor's own. A content-only test coalesced onto it and silently overwrote the just-restored state with
no history entry that it had ever existed. Giving the restore its own `DocVersionOp` was rejected —
`sanitizeDocumentVersions` coerces an unknown op back to `"update"`, so an older client reading the same
project would silently re-open the hole on shared data.

★ Both halves of the pair are compared, and the id alone is not enough — `seedMintFromWorkspace(ws,
"reset")` restarts the `documentVersion` high-water mark per project, so ids alone can resume a run onto an
identically-numbered row in a DIFFERENT project; `savedAt` separates them. Both comparisons are equality,
never ordering — this identity check does not depend on a clock. `source`/`op` are kept as secondary
guards (unreachable in practice for the one caller today, whose anchor is always a `user`/`update` mint,
but this is an exported pure function that cannot assume a future caller's discipline).

★ `COALESCE_WINDOW_MS` (5 minutes) is measured from the anchor's own `savedAt`, never from the previous
edit — a coalesced edit mints no version, so it never advances the anchor, and a continuous burst of
sub-window edits can still cross the window measured from wherever the session's last real version landed.

★ The property this whole mechanism preserves: the FIRST before-image of a session holds the state before
the session started — the thing a user actually reverts to. The commit-side half of the contract
(unmount flush, the concurrent-write abandon guard, undirty adoption of an external write) lives in
`useBlockDraft` (`document-block-editors.tsx`) and is summarized in `AGENTS.md`'s "Documents (AI document
authoring)" bullet, which also owns the narrow-pane docked-toolbar and zero-block-empty-state surfaces —
this file stops at the version-model decision, per the header note above.

★★★ **STRUCTURAL WRITES OMIT `coalesce` ENTIRELY, so each records its own before-image.**
`use-document-editor.ts`'s `appendBlock` and its `structural` bag (`insert` / `remove` /
`move`) build their mutation without the field, and the engine reads
`m.coalesce ? undefined : snapshot(...)` — so omitting it snapshots unconditionally. Merging a run
is right for typing and wrong for a delete: it would leave the nearest restore point at wherever the
typing run started, and a version restore is the only recovery a document has. `coalesce: false`
would be equivalent; omission is the spelling both structural paths use, so the two match.

★ They still ADVANCE the run's anchor (`lastMintedRef`) when they mint, so typing that follows
folds into the version they just wrote — an append or structural op is one of this hook's own
commits and advances the anchor for the same reason every other one does. For `appendBlock` that is
also what you want: its before-image already IS the pre-session state, so a second version would
capture a half-typed placeholder and spend one of only `MAX_VERSIONS_PER_DOC` slots.

## What the commit path stores, and the second guard

Two properties of the hand block editor's commit path, expanded from the code comments in
`document-block-editors.tsx`.

### The commit NORMALISES; it does not merely validate

`tryCommit` runs the draft through **`normalizeBlockForStorage`** — the loader's own per-block rule,
exported from `document-model.ts` — and commits the RESULT, so a stored block survives the STRUCTURAL
half of a load unchanged.

★★★ **NOT "identical by construction", and the overclaim is the dangerous direction.** A load is TWO
passes: `sanitizeProjectDocuments` (structural, DOM-free) and THEN `sanitizeDocumentRichFields` →
`sanitizeDocumentHtml` (the DOMPurify allow-list) — see `browser-backend.ts`'s documents branch, which
composes them in that order. `normalizeBlockForStorage` is the first pass only. Paragraph HTML round-trips
today because everything the editor can PRODUCE already sits inside `DOCUMENT_ALLOWED_TAGS`, which is a
fact about the editor's toolbar, not a guarantee from this function. A slice that lets a block carry markup
the allow-list strips — the images slice is the live candidate — breaks the round-trip while this call goes
on returning a non-null block. Reading it as covering both passes is how that would ship unnoticed.

★★★ **Validating instead let the two disagree, silently, in three measured ways.** A paragraph over
`MAX_HTML_TEXT_CHARS` came back with every mark flattened to plain text (`capHtmlText`'s truncation
branch returns `plainToHtml(slice)`); a heading kept the trailing whitespace the loader trims; and
"Add item" appended an empty bullet item that counted as a change, minting a document version for
content the next load drops — one of `MAX_VERSIONS_PER_DOC` (20) slots spent, and the row the user
just added gone on reload.

★★ **Per-editor `maxLength` caps are the WRONG fix** and were rejected for the reason the defect
existed in the first place: one copy of each loader rule per editor, free to drift from the loader's.

★ `null` means the loader would DISCARD the block. That refusal is shown (`BlockRefusalNotice`), and
so is the concurrent-write ABANDON — one nullable `"empty" | "conflict"` state, because the abandon
used to be silent and a user watched their typing be replaced on screen with no explanation. ★ The
UNMOUNT flush abandons silently and must: the component is going away, so there is nothing to render
into.

★ `blockSurvivesLoad` still exists and has NO production caller. It is kept as the tested statement of
the DROP rule — `document-editor-commit.test.ts` pins all five droppable shapes, one per block
kind that has one (`pageBreak` cannot be dropped), including the two no editor control can reach — and is defined in terms
of `normalizeBlockForStorage`, so the two cannot disagree.

### The engine carries the second concurrent-write guard

`replace`, `delete` and `move` each take an optional **`expect`** — the baseline the caller derived
its edit from, built by `replaceBlockOp` / `deleteBlockOp` / `moveBlockOp`
(`document-editor-commit.ts`) — and `applyOps` refuses the op when live state at that index no
longer matches it.

★★★ **THE IN-COMPONENT GUARD IS STRUCTURALLY BLIND ON ONE PATH, which is why this exists.**
`useBlockDraft`'s `externallyWritten` reads refs that advance only when that row RENDERS. `BlockEditor`
returns a DIFFERENT component per `block.type`, so a concurrent write changing the TYPE at an index
unmounts the row with no final render — every ref the guard reads frozen at its pre-write value. The
guard then returns false and the unmount flush overwrites whichever block shifted into that index. The
engine compares `expect` against live state at CALL time, which no ref-based check can do.

★ `expect` is OPTIONAL because the AI tools build their own ops and are resolving no draft of their
own. A future op-builder that IS resolving a draft must pass it. An ABSENT `expect` must never be
read as "expected nothing" — every AI and tool caller omits it and must keep applying.

★★ **`insert` deliberately has none.** A concurrent write that shifts indices makes an index-only
`delete` or `move` act on a block the user never pointed at, recoverable only by restoring the whole
document; the same shift on an `insert` merely puts a new empty block one position from where it was
asked for, which the user drags. `insert` also has no target block to name.

★ A refused op reports its own reason in `DocResult.rejected` — `op {i}: replace index {n} was
changed by another writer`, and the `delete` and `move` arms word theirs for their own op (`move`
names its `from` index).

## Reorder wiring (`document-editor.tsx`)

The block editor drives `move` through the shared `useListReorderDnd`, with the row INDEX as the
reorder id — `DocBlock` is a positional array and every op addresses a block by index, so nothing
was added to the model. `onMove` forwards its dragged/target pair straight to `structural.move`,
passing `doc.blocks[from]` as the `expect` baseline.

★★★ **NO consumer-side `reorder.endDrag()` — and the plan that specified one was wrong in BOTH
halves.** (a) The hook's own `itemProps`' drop handler already calls `endDrag()` immediately after
`commit`, in the same event, so the drop path self-resets; the arrow-key path never sets `dragId`
at all, so there is nothing to reset there either. (b) The premise that "index keys make a move
remount every row from the lower index down, detaching the node that owns dragend" is backwards —
an index-keyed list is precisely the case React reconciles IN PLACE, because a reorder leaves the
key SET unchanged.

★★ **MEASURED, not reasoned**, because `use-list-reorder-dnd.ts`'s own docstring argues the
opposite case forcefully — and is right about consumers whose drop UNMOUNTS the dragged item.
Deleting `endDrag()` from the HOOK turns `document-editor.test.tsx`'s "does not reorder on a drop
when no drag is in flight" RED (re-run 2026-08-20: 1 failed / 30 passed, and that one test is the
failure); adding `reorder.endDrag()` in the consumer on top of that turns it GREEN again (31
passed). So the consumer call is an equivalent mutant — a working substitute for a reset this
consumer already gets, carrying a false justification. That TEST is what guards the property; if
this editor ever grows a drop that REMOVES a block, add the call and the same test will still be
the thing watching it.

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

★★ **A `duplicate` CARRIES the references** — a copy is about the same entities as its source. That
literal is an explicit field list and dropped them until it named them, which is the same shape as
`sanitizeDocument` two rules above; the sparse rule applies to the copy too.

★★ **While a filter is armed, selection falls back within the VISIBLE rows**, not to `documents[0]`.
The link field is bound to `selected`, so the full-set fallback let an attach made from a filtered
view land on a document the list was not showing — silently, and document writes have no undo. A
test whose fixture happens to put the linked document first cannot see this; the pinning test puts
the UNLINKED one first, deliberately.

★ **One accepted behaviour:** a read-only popout renders no link field AND no chips — the field is
withheld rather than drawn inert, per the no-false-affordance rule.

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
