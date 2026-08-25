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

★★★ **TWO OF THE THREE STRUCTURAL WRITES OMIT `coalesce`, AND THE THIRD MUST NOT — it is a
SPLIT, not a blanket rule.** `use-document-editor.ts`'s `structural` bag builds `insert` and
`remove` without the field, and the engine reads `m.coalesce ? undefined : snapshot(...)` — so
omitting it snapshots unconditionally. That is right for those two: each changes what the document
CONTAINS, and merging one into a preceding typing run would leave the nearest restore point at
wherever that run started, when a version restore is the only recovery a document has.

`move` DOES carry the field, on the same `shouldCoalesce` rule the content-edit path uses. A
reorder loses nothing — no content changes and the inverse of a reorder is another reorder — while
minting per press was expensive in the only way that matters here: the keyboard path moves a block
ONE position at a time, so walking a block up from position 12 spent 12 of the document's
`MAX_VERSIONS_PER_DOC` slots and could evict the pre-session before-image and every AI-authored
version with it. `coalesce: false` would be equivalent to omission; omission is the spelling the
two non-coalescing paths keep, so the split is visible in the mutation itself.

★ **The separate append path was REMOVED.** `useDocumentEditor`'s `appendBlock` is GONE, and so is
the OPTIONAL `onAppendBlock` prop on `DocumentEditor` that was its only caller — do NOT reintroduce
either. It was reached from the zero-block empty state alone, i.e. the one path into an empty
document sat behind the one prop a wiring regression could drop with no type error, which is exactly
the shape `structural` is REQUIRED to prevent. The empty state routes through
`structural.insert(0, …)` now — equivalent on a list with no positions, and the `{op:"append"}`
engine op it used stays reachable from the AI document tools.

★ All three still ADVANCE the run's anchor (`lastMintedRef`) when they mint, so typing that follows
folds into the version they just wrote — a structural op is one of this hook's own commits and
advances the anchor for the same reason every other one does. For the empty state's `insert` that
is also what you want: its before-image already IS the pre-session state, so a second version would
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
Deleting the `endDrag()` call from the HOOK's own `onDrop` turns `document-editor.test.tsx`'s "does
not reorder on a drop when no drag is in flight" RED, and inside that file it is the only failure;
adding `reorder.endDrag()` as the first statement of the consumer's `onMove` on top of that turns
it GREEN again. So the consumer call is an equivalent mutant — a working substitute for a reset
this consumer already gets, carrying a false justification. That TEST is what guards the property;
if this editor ever grows a drop that REMOVES a block, add the call and the same test will still be
the thing watching it.

★★ RE-RUN IT RATHER THAN TRUSTING THE SENTENCE — it was written command-less, and the commit that
added six drag-feedback tests to that same file landed AFTER it, so the "only failure" half was
unverified until 2026-08-20. Re-measured then: hook mutation alone `Tests 1 failed | 46 passed
(47)`, naming that test; consumer call on top `Tests 47 passed (47)`. The scope is that ONE file —
`useListReorderDnd` is shared, so a whole-suite run would also charge its other consumers.

```bash
npx vitest run src/app/document-editor.test.tsx --maxWorkers=1 > /tmp/t.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |^\s+× " /tmp/t.log
```

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

★★ **THE THREE MARKDOWN DECODE STOP-RULES NEED THREE KILLING CASES, NOT ONE.**
`markdown-codecs-decode.ts` stops the generic table walk at `## Documents`, `## Document versions`
and `## Activity Log`, but only ONE adversarial test existed and it exercised the third — deleting
either of the other two left the whole suite green. `markdown-codecs.test.ts` now runs an
`it.each` over the three headings, each case proved to go red against the deletion of exactly its
own rule. Any future stop-rule added there needs its own case in that table; a shared "the walk
stops" test is not coverage.

★★ **`documentAssets` is EXCLUDED from `isWorkspaceEmpty`, and the reason is the `documents`
precedent — NOT the `activityLog` one.** The exclusion itself is right (an asset-only workspace is
near-unreachable, and leaving it out of the record count is the safe direction for a guard whose
whole job is refusing to overwrite a populated project). But the comment justifying it originally
cited `activityLog`, whose reasoning does not transfer at all: `activityLog` is excluded because
ORDINARY USE auto-appends to it, so counting it would let a transient empty read overwrite real
data. `documentAssets` rows come only from an explicit user upload, which is behaviourally
`documents` — and `documents` IS counted. The code did not change; the model it taught anyone
extending the slice did. ★ `documentAssets` is likewise absent from `nonEmptyCollectionCount` and
`workspaceRecordCount` (the SAVE-time mass-deletion thresholds), on the same reasoning; all three
live in `workspace-metrics.ts`.

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

## Asset images (S3c-1)

Shipped 0.254.0 "Yoshinaga", Turso-gated (`tursoConfig !== null`, same rule as version history).
Design lived in `docs/superpowers/specs/2026-08-08-documents-roadmap-s3-s4-design.md`'s S3c-1
section. ★★ Its open follow-ups start at `docs/open-followups.md` §202, and **no range is quoted
here on purpose** — the very commit that wrote "§202–§207" added §208 and §209 in the same diff, so
a range is stale before it is committed and nothing gates it. Derive today's set:
`awk '/^## [0-9]+\./{h=$0} /S3c-1|document_assets|documentAssets|asset librar|document image|data-asset/{print h}' docs/open-followups.md | sort -u`
(it also returns the older documents-roadmap entries §113/§115/§117/§140, which are genuinely
related). This section replaces "S3c" as a
bare label —
see `docs/open-followups.md` §113 for why that label collided with a different slice.

★★★ **EVERYTHING BELOW DESCRIBES THE POST-FIX-ROUND CODE.** The slice shipped its first cut with a
fully green gate suite — eslint, tsc, the whole unit suite, the coverage floors, axe and prod-smoke
— and was **non-functional** on the one backend it is gated to: no image could be uploaded without
killing every subsequent workspace save, and no image could be displayed at all. Four cold reviews
and seven fix commits closed that. The per-landmine paragraphs below say what each gate could not
see; read them as a list of what NOT to reintroduce, not as history.

★★★ **TWO STORES, NOT ONE.** Asset METADATA (`DocumentAsset` — id, name, mime, size, optional
width/height, content `hash`, `createdAt`; `document-asset.ts`) is an ordinary workspace slice on
all six write paths, exactly like `documents`/`documentVersions`. Asset BYTES live as base64 TEXT
in `document_asset_data`, a side table reached only through `document-assets-schema.ts` (pure
statement builders) and `document-assets-store.ts` (async CRUD) — mirroring the existing
out-of-`TABLE_NAMES` pattern (`comm-templates-store.ts`, `committee-report-versions-schema.ts`,
`chat-threads-schema.ts`). `DocumentAsset` is deliberately **MIME-generic at the model layer** —
format policy (PNG/JPEG/WebP only) lives entirely in the upload pipeline
(`document-asset-upload.ts`), not in the sanitizer, so the same table/store/dedup/delete can serve
a later non-image attachment slice with no migration.

★★★ **`DocumentAsset` IS THE FIRST STRING-ID ENTITY IN `ENTITY_SPECS`, AND A FUTURE ONE MUST
DECLARE `idKind: "text"`.** `colDdl` rendered ANY column named `id` as `id INTEGER PRIMARY KEY` — a
rowid alias, the one column type SQLite actually ENFORCES — and `insertStmt`/`tenantInsert` bound
`id` as `{type:"integer"}`. That was correct for every pre-existing spec, all of which mint a
number; `DocumentAsset` mints a `crypto.randomUUID()`, so a real engine answers `datatype mismatch`.
The asset INSERT rides the SAME `BEGIN…COMMIT` as tasks, RAID, milestones, budgets, plan and meta,
so **every workspace save reported failure from then on** — and the feature is Turso-gated, so it
reached exactly the users who could reach it.
★★★ IT DID NOT DIE MID-TRANSACTION, AND THIS PARAGRAPH SAID IT DID. A libSQL `/v2/pipeline` batch
does not abort at a failing statement: it errors that ONE statement, keeps executing, and COMMIT
still runs and succeeds. `runTursoPipeline` then calls `rollbackBestEffort` against an
already-committed transaction — which changes nothing — and throws. So the workspace WAS written,
minus the rejected row, behind a message saying the save failed. Measured against a live database;
`docs/open-followups.md` §211 and AGENTS.md's `idKind` bullet carry the same correction. `EntitySpec.idKind` (`turso-schema.ts`) now selects the pair:
`"text"` gives `id TEXT PRIMARY KEY` single-tenant, a plain `id TEXT` inside the composite tenant
PK, and a text-bound arg. ★ It DEFAULTS to `"integer"`, which is what keeps every other spec
byte-identical and is also what makes omitting it silent. Enumerate today's declarers with
`grep -n 'idKind: "' src/app/turso-schema.ts` — one line per spec that declares it.

★★ **NO STRING-MATCHING TEST COULD HAVE CAUGHT THAT, which is why `turso-schema.execute.test.ts`
exists.** `entity-persistence-registry.test.ts` proves the Turso paths by matching DDL TEXT and
never executes a statement — its own fixture id would have been rejected too, had anything run it.
The new suite executes the real statements against `node:sqlite`, generalised over `ENTITY_SPECS`
so every future entity is pinned without being named. It ALSO asserts every `{type:"integer"}` arg
is a decimal i64, because the tenant layout's `id INTEGER` is a plain column whose affinity SQLite
does NOT enforce — a UUID slips through the engine there, and only the Hrana wire contract rejects
it. ★★★ Its FIRST version was vacuous in the nastiest available way: the fixture READ `idKind`, so
deleting the field made the fixture switch to a numeric id and every assertion stayed green over
the restored bug. It now derives the id kind from OBSERVED builder behaviour. A fixture that
consults the field under test adapts to its own mutant.

★ **Related, and fixed in the same commit:** `existingColumnsFromPragma` (`turso-migrate.ts`)
treated a zero-row `PRAGMA table_info` — i.e. the table does not exist — as a table with no
columns, and emitted `ALTER TABLE` against it. Masked for the whole life of that module because
both load paths prepend the full DDL first; `document_assets` is the first new table to depend on
that ordering. `turso-migrate.ts` itself never has to know which `idKind` a table uses: `id` is
always created WITH the table, so the migrator only ever ADDs TEXT columns.

★★★ **`document_asset_data` is deliberately OUTSIDE `TABLE_NAMES`, and this is the same shape as
`chat_threads` above.** A workspace save emits a per-table `DELETE` + full re-`INSERT` for every
table `TABLE_NAMES` lists, so listing the byte table would wipe the entire image library on every
single workspace save. Consequence: nothing cleans it automatically on ordinary project use, so
`hardDeleteProject` (`turso-portfolio.ts`) calls `deleteAllAssetDataForProject` explicitly — and
**non-fatally**, via `logDiag`, because leaked bytes are recoverable disk space and a half-deleted
project is not. ★ It was NOT verified whether the two OLDER side tables of this shape —
`chat_threads`, `committee_report_versions` — get the same cleanup; probe before assuming either
way (§204).

★★★ **THE TWO HALVES SIT ON OPPOSITE SIDES OF `TABLE_NAMES`, AND BOTH SIDES ARE LOAD-BEARING.**
The METADATA table `document_assets` **IS** in `TABLE_NAMES` — not by a separate listing, but
because `TABLE_NAMES` is DERIVED from `ENTITY_SPECS` (`turso-schema.ts`), so an `ENTITY_SPECS` row
puts a table in it automatically. Only the BYTES are outside. Reading that as "assets are
out-of-`TABLE_NAMES`" flatly, and acting on it, breaks the slice in whichever direction you get
wrong: adding the byte table wipes the entire image library on the next workspace save; removing
the metadata row from the registry orphans every byte row and leaves the library empty. Verify with
`grep -n 'TABLE_NAMES: readonly' src/app/turso-schema.ts`, which shows the derivation on one line.

★★ **SINGLE-TENANT METADATA HAS NO `project_id` COLUMN AND THE BYTE TABLE ALWAYS DOES**, so the two
halves are partitioned by different things and cannot be guaranteed to agree. `colDdl` emits no
project column at all for the single-DB layout (the whole database IS the project), while
`DOCUMENT_ASSET_DATA_DDL` is one shape for both layouts — `PRIMARY KEY (id, project_id)` always —
and the key it is given comes from a UI-level read of the portfolio/registry state, not from the
workspace the metadata rode in on. Nothing reconciles them. The consequence is recorded as §207;
the mitigations that ARE in place are the Safe Mode refusal below and the `hardDeleteProject`
cleanup above.
★★ **The partition key is `ASSET_PARTITION_FALLBACK` when the caller has none, and it is NEVER
`""`.** `AssetDataRow.projectId`'s docstring claimed `""` was the single-tenant key for as long as
this feature existed and NO call site ever produced one — anything written by a caller who believed
it would have been invisible to every session that resolves the key the way the code does. The
docstring was corrected TO the code rather than the reverse (bytes already stored are keyed the
current way, and this table has no version marker to drive a migration), and
`documents-asset-section.tsx` normalises a blank id to the named constant with `||`, not `??`, so a
future caller following the old claim cannot open a second partition. ★ The fallback is a REAL key,
not a sentinel for "unpartitioned": every input to it is deterministic, so a later session in the
same state finds the same bytes — see §207 for why that makes it sound and Safe Mode unsound.

★★★ **THE ASSET LIBRARY REFUSES TO OPERATE IN SAFE MODE RATHER THAN RE-PARTITIONING BYTES.**
`DocumentsTabPanel` (`workspace-panels.tsx`) derives the byte store's key from `loadPortfolioMode()`
and `loadCurrentTursoProjectId()`, and BOTH force a degraded value under `?safe=1` (mode `"file"`,
id `null`) while `loadRegistry()` carries no such guard. Without a gate, a Turso-portfolio user
entering Safe Mode silently swapped the byte-lookup key to the file registry's id — metadata does
NOT move, since it rides the workspace — so every asset read as dangling, every embedded image
broke, and any upload wrote bytes under a key normal-mode boot never looks at.
`deleteAllAssetDataForProject` is keyed the same way, so those orphans then survived project
deletion too. ★★ It is reachable with NO user action on an env-configured deployment:
`getTursoConfig` falls back to `NEXT_PUBLIC_TURSO_*` BEFORE consulting settings, so default Safe
Mode settings still yield a live config — and a test leaning on the settings coupling passes
vacuously over exactly that path.
★★★ **REFUSING BEATS STABILISING THE KEY, and this is not fastidiousness — there is no coherent key
to stabilise TO.** Safe Mode also boots settings at `defaultStorageConfig` (`kind: "browser"`), so
the metadata half comes from a DIFFERENT workspace whatever the key says; pinning an id would pair
one project's bytes with another project's workspace, which is worse than showing nothing.
Reconstructing the real id would additionally mean reading the raw mode/project keys from inside a
view component, defeating the two guards `portfolio-mode.ts` exists to apply. So `isSafeMode()`
forces `tursoConfig` to null and the surface renders its existing empty state: no read, no write,
no byte moved — reusing the disable gate the feature already documents rather than inventing state.

★★ **The `assetPane` bag was ENTIRELY untested at the wiring seam, and the panel's own tests cannot
see it by construction** — they render the component and supply the props themselves, so an
unpassed prop is invisible to every one of them. Deleting the whole bag from this call site left
`workspace-panels.documents.test.tsx` green, and that file contained zero occurrences of "Asset".
Wiring-level cases now assert observable consequences, each proved to die against deletion of its
own line. Any new prop threaded through this call site needs a case THERE, not in the panel suite.

★★ **Metadata is written BEFORE bytes, and that ordering is the failure-mode design, not an
accident.** If the byte write then fails, the asset degrades to the already-designed DANGLING case
— visible in the library, self-describing, repaired by re-uploading over the same id — instead of
an invisible orphan that would need its own reclaim mechanism. Pinned by a mutation-checked test in
`use-document-assets.test.tsx`; do not reorder the two writes without re-checking that test's
premise.

★★★ **ALL THREE METADATA WRITERS GO THROUGH ONE FUNCTIONAL-UPDATE PATH, `commitAssets`, AND THAT
IS WHAT MAKES THE ORDERING ABOVE MEAN ANYTHING.** `setAssets` was originally typed to discard the
functional form — a value-only setter is ASSIGNABLE to `Dispatch<SetStateAction<…>>`, so narrowing
the deps type compiled and quietly removed the only way concurrent writers can compose — and
`upload` wrote `setAssets([...assets, asset])` off a render-scope closure. Three call sites fan out
N concurrent uploads sharing ONE closure, so dropping three files lost two metadata rows **whose
bytes had already been written**: precisely the orphan state the metadata-first ordering exists to
prevent. The stale read also made two identical files dropped together both mint an id, defeating
dedup. ★★ `rename` and `remove` carried the IDENTICAL clobber — a rename landing during an
in-flight upload dropped the uploaded row — so the fix is one writer, not three patched ones:
`commitAssets(fn)` updates a committed-list mirror (`assetsRef`, for reads inside the SAME tick,
before React has re-rendered) and calls `setAssets` with a functional update.
★★ **Every `fn` MUST be a pure array transform.** It runs once against the mirror and once in the
state updater, and React double-invokes the updater under StrictMode — ids and timestamps are
minted BEFORE `commitAssets` is called, never inside one. Never put a `setState`, a mint, or any
other effect in an `fn`.

★★★ **`upload` RETURNS THE ASSET, NOT ITS ID, AND THE CALLER INSERTS FROM THE AWAITED RESULT.**
An id-keyed lookup cannot find a just-minted row: by definition it is absent from the render
closure the insert callback closed over. The previous shape armed a boolean ref before the await
and reacted to a `lastId` state change, and was broken three ways at once — (a) re-inserting an
ALREADY-STORED image was a silent no-op, because the dedup branch set `lastId` to the value it
already held and React bailed out of the re-render so the effect never ran; (b) every rejection
path returns without touching `lastId`, so the arm was never cleared and the NEXT ordinary Upload
press appended that image to the open document unbidden; (c) one boolean cannot carry N files, so a
multi-file paste inserted exactly one. Awaiting the result deleted the arm ref, the last-inserted
ref and the effect outright. ★ `uploadAndInsert` runs the uploads CONCURRENTLY (`Promise.all`) but
inserts in the caller's file order.

★★★ **`insertAssets` IS A BATCH FUNCTION EVEN FOR THE SINGLE-ASSET PICKER PATH, AND COLLAPSING IT
BACK TO A PER-ASSET ONE REOPENS TWO DEFECTS.** Both come from the same root: `selected` is frozen
for the whole synchronous loop, so N per-asset calls all evaluate against the SAME pre-batch state.
(1) **The cap did not hold across a batch** — `assetIdsInDocument(selected)` returned the same id
set every time, so at 19 stored images a 5-file paste had all five pass the
`>= ASSET_MAX_PER_DOCUMENT` test and the document ended with 24. A running `present` set inside the
loop is what holds it WITHIN a batch; holding it ACROSS batches is free, since the next batch
re-reads the by-then-updated document. (2) **The insert index did not advance** —
`structural.insert` is a `splice(index, 0, block)` against LIVE state while `selected.blocks.length`
is frozen, so N inserts at one index put each new block BEFORE the previous one and a 3-image paste
landed in REVERSE order. ★★ The pre-existing "inserts in the pasted order" test compared the order
of the CALLS, which was right all along; nothing looked at the INDEX they carried. A test over an
ordered sequence of calls is not a test of where the results land.
★★ **The running state is deliberately OPTIMISTIC — it does not consult the `DocResult`
`structural.insert` returns.** Threading the returned document back in was the other candidate and
is worse here for a failure-mode reason, not a taste one: `structuralOp` returns `undefined` the
moment the open document changed underneath (`use-document-editor.ts`), so a result-driven counter
silently stops counting exactly when it is handed nothing — and every test stub returning a bare
`undefined` would DISABLE the cap while staying green. Counting locally cannot be switched off by a
caller, and it errs toward skipping rather than overshooting, which is the safe direction for a cap.
★ One cap decision is announced for the WHOLE batch, after it: a per-asset `setCapMessage` let a
later file that inserted fine CLEAR the message a skipped earlier one had just set.
★ `insertAssets` takes ASSETS, not ids; `insertAssetById` is the id-keyed wrapper the picker uses,
and the picker only ever names an already-rendered row.

★★ **The `alt` text is `htmlEscape`d at the seam and DOMPurify does not substitute for that.**
`asset.name` is `file.name` verbatim on upload, free text via rename, and fully attacker-controlled
in an imported workspace (`sanitizeDocumentAsset` keeps it as-is). Interpolated raw, a name of the
`x"><a href="…">Click here</a><img alt="` shape CLOSES the img and opens an anchor — and
`sanitizeDocumentHtml` then PASSES it, because `a` is allow-listed and an `https:` href satisfies
the URI regexp. The planted link persists into `block.html` and rides into standalone HTML, DOCX
and PPTX. Never hand a sanitizer a string that was already malformed when it was built. (The id is
escaped too, for the same reason at lower stakes.)

★★ **`encodeViaCanvas` returns `outBlob.type`, never the REQUESTED mime.** `canvas.toBlob` falls
back to `image/png` silently on an unsupported type, so trusting the request would store a mime
that misdescribes the bytes — and still pass the export allowlist, since the recorded mime is what
that allowlist reads.

★★ **The 32 MiB Turso ceiling is a MEASUREMENT, not a spec number, and it is SCOPED to one
statement.** Probed 2026-08-21 against a real database: a single-statement pipeline carried a 32
MiB text argument with no ceiling found; latency rose to ~6.6s at that size and ~1.8s at 6.7 MiB.
The 5 MB `ASSET_STORED_MAX_BYTES` cap therefore sits at ~4.8× headroom under the measured point,
so no chunking/streaming upload path was built. **The measurement does NOT cover batching several
assets into one pipeline** — that is why the store writes one asset per request rather than
coalescing a multi-image upload, and doing so later needs its own measurement first, not an
extrapolation from this one.

★ **Upload budget, all in `document-asset-upload.ts`** (verify current values with a grep — they
are `SCREAMING_CASE` and therefore ungated by `docs:symbols:check`, per this repo's own rule):
`ASSET_RAW_MAX_BYTES` 25 MB pre-decode ceiling · `ASSET_MAX_SOURCE_DIM` 8000 px header-only
dimension guard (rejects a decompression-bomb image before decoding its pixels) · downscale to
`ASSET_DOWNSCALE_W`×`ASSET_DOWNSCALE_H` (1920×1080) · `ASSET_STORED_MAX_BYTES` 5 MB applied AFTER
downscale · `ASSET_MAX_PER_DOCUMENT` 20 images, enforced at insert · SHA-256 content-hash dedup
(the `hash` field above), which also drives refcount-aware delete — deleting one document's
reference to a shared asset does not delete a byte row another document still points at.

★★★ **THE JPEG DIMENSION WALK RUNS ON FULLY UNTRUSTED BYTES AND ITS DOCSTRING ONCE LIED ABOUT
WHICH MARKERS IT TREATS AS STANDALONE.** `readJpegDimensions` feeds the decompression-bomb guard
(`ASSET_MAX_SOURCE_DIM`). Its comment claimed the walk treats SOI/RST0-7/TEM as standalone; the
code tested `0xD9` — that is EOI, not SOI. A second SOI was therefore read as length-carrying, the
walk desynchronised, and a 12000×12000 image prefixed with a duplicate SOI plus a decoy SOF0 at
the jump target reported 100×100 and sailed past the 8000 px cap. ★★ It was unreachable in
practice ONLY because Chromium refuses to decode a file with a duplicate SOI — i.e. the guard's
correctness rested on a decoder-side accident, which is not a property to rely on. Fixed by adding
`0xD8`; the docstring now matches the code.
★★ **Two guard branches in the same function survived deletion with the suite green**, and how they
survived is the transferable part: the SOS stop (`marker === 0xda`) had a test that passed for the
WRONG REASON — the fixture's scan data was shorter than its declared length, so the mutant ran off
the end and returned `null` too, same answer by a different mechanism (the fixture now carries a
plausible SOF0 INSIDE the scan data). And `len < 2` was reasoned to be an equivalent mutant and is
NOT: the `isSof` branch reads width/height BEFORE the pointer advance, so that guard is what stops
a malformed JPEG handing attacker-chosen dimensions to the bomb check. All three are now pinned by
tests watched to fail against their own mutants.

★★ **Formats: `ASSET_MIME_ALLOWED` is PNG + JPEG + WebP, and both exclusions are permanent, not
temporary gaps.** SVG is excluded on the same XSS-surface precedent as the branding image input
(`branding-image-input.tsx`) — an SVG can carry script. GIF is excluded because the downscale step
RE-ENCODES the image, which would silently destroy animation; there is no "downscale losslessly"
option for an animated format.

★★ **Rendering never inlines base64 into the live DOM string.** The preview resolves
`<img data-asset-id>` to **blob object URLs** imperatively, in `document-asset-images.ts` — ten
images at a few MB each would otherwise put tens of MB of base64 into the one
`dangerouslySetInnerHTML` string `document-preview.tsx` builds.
★★★ **THAT REQUIRES `blob:` IN THE CSP `img-src`, AND ITS ABSENCE BROKE EVERY DOCUMENT IMAGE IN
DEV AND PROD ALIKE.** The directive was `'self' data:`; `'self'` does NOT match a `blob:` URL, so
the browser refused every image load — and refused it INVISIBLY, because the `src` is set and only
the fetch is blocked, so there is no broken-image marker to notice. Measured in Chromium against
that exact directive. Nothing in the UNIT suite can see it — jsdom enforces no CSP — and at the
time no e2e spec touched document assets either, which left `src/proxy.test.ts` asserting the
directive STRING as the only guard. ★★ That gap is now closed by `e2e/documents-images.spec.ts`,
the only layer that can watch a document image actually fail: it drives a real Chromium page to a
seeded document and polls each `<img>`'s `naturalWidth`/`naturalHeight` against that asset's own
stored size. **Nothing weaker detects this bug** — a CSP-refused image keeps its `src`, stays in
the DOM and stays "visible", so presence, visibility, a `blob:`-src check and a screenshot all pass
against it; only a decoded bitmap has a non-zero `naturalWidth`. It separates the two failure modes
deliberately (no blob: src / `data-asset-missing` = the byte store never delivered, which says
nothing about CSP; blob: src with `naturalWidth` 0 = the browser refused the load, the CSP
signature), and additionally asserts that the page reported no `securitypolicyviolation` on ANY
directive, so a future `connect-src` or `style-src` narrowing trips it too. Deleting that spec
returns this whole class to undetectable. ★ Note
`IS_DEV` branches only `scriptExtras` and `styleElem` — never `img-src` — which is why this was NOT
a prod-only defect like the CSP class recorded elsewhere in this repo. ★ `object-src 'none'`
remains the guard against the usual `blob:` escalation; `img-src` can only ever decode an image.
Standalone HTML export (and
therefore PDF, which is that same standalone mode driven through the browser print dialog — there
is still no PDF writer and no PDF dependency in this repo) inlines a `data:` URI instead, because a
standalone file has no live JS to resolve a blob URL against.
★★★ **THAT `data:` URI IS A VALIDATED SINK, NOT AN INTERPOLATION.** `doc-render-html.ts` built
`src="data:${mime};base64,${data}"` with no escaping and no allowlist. The mime reaches it through
the LOAD path's `sanitizeText`, which only trims and clips — it strips no quotes and never consults
the upload allowlist — so a hostile project file carrying a mime of the
`image/png" onerror="…` shape yielded a live `onerror`, firing IMMEDIATELY because the resulting
src is undecodable. On the PDF branch that HTML is written into a `window.open("", "_blank")`, an
`about:blank` that inherits the opener's origin, so it would run in the app origin. `assetSrcAttr`
now validates the mime against `ASSET_MIME_ALLOWED` (imported, never restated, so upload policy and
render policy cannot drift) and the data by DECODING it through the shared `safeBase64ToBytes`,
falling through to the existing `data-asset-missing` branch on a miss. ★★ An alphabet regex sat in
that second slot first and was wrong in BOTH directions — it passed `"abcde"` and `"===="`, which
`atob` rejects, and rejected a line-wrapped row, which `atob` accepts; only `atob` knows what `atob`
takes. The regex is deleted — `grep -rn BASE64_RE src` exits 1 with no output.
★★ **Escaping alone would NOT have been enough** —
an escaped `image/svg+xml` is still an XSS surface, and the load path admits it while upload does
not; the allowlist is the part that matters. ★★ It was not reachable at the time only because no
production caller passes the optional `assets` argument — the sink is one wiring line from live, so
do not downgrade it on reachability grounds. ★ Its tests assert on PARSED attributes off a jsdom
element rather than substrings of the raw string: a raw-string assertion is the class of test that
let this ship.
★ The missing-image glyph
(`img[data-asset-missing]::before { content: "⚠" }`, for a dangling reference) relies on
pseudo-element rendering over a `src`-less replaced element — jsdom cannot render it, so only the
attribute and border/background classes are test-pinned, not the glyph itself; eye-verify in a real
browser before relying on it (§205). ★ `DocumentsHistoryModal`'s version-preview surface was NOT
wired to the same asset-resolution — a version containing an image block renders without its
picture there today (§206).

★★★ **SUPERSEDED BY S3c-2 (0.256.0 "Khaw") — DO NOT READ THE PARAGRAPH THIS REPLACES AS CURRENT.**
It said DOCX and PPTX emit a visible translated placeholder naming the asset, that this was S3c-1's
finished behaviour, and that real OOXML media parts (`word/media/`, relationship ids,
`<w:drawing>`/`<a:blip r:embed>`, EMU sizing from the stored `width`/`height`) were "the largest
unbuilt piece in the documents roadmap, with no existing scaffolding … in either renderer". All of
that shipped: `ooxml-media.ts` is the shared unit leaf and both package builders take media. ★★ The
placeholder did NOT go away, it NARROWED — it is now what the `omitted` and `missing` buckets emit,
and those two are not interchangeable. §202 is CLOSED. Read "Image bytes in every export format
(S3c-2)" below for the as-built contract; nothing about placeholders should be reasoned about from
here.

★★★ **Insertion does NOT go through the live rich-text editor, and this is load-bearing, not an
oversight.** `@tiptap/extension-image` is NOT installed, and this is deliberate — do NOT add it as
a shortcut for inline editing: `RICH_ALLOWED_TAGS` carries no `img` (only `DOCUMENT_ALLOWED_TAGS = [...RICH_ALLOWED_TAGS,
"img"]` does), and `RichTextEditor`'s `onUpdate` runs `sanitizeRichHtml` on every keystroke — so an
`<img>` pasted into a LIVE editor instance is destroyed on the very next update. That is exactly
why `document-block-editors.tsx` already renders an image-bearing paragraph READ-ONLY via
`paragraphHasImage`, rather than opening it in the live editor. Insertion instead appends a NEW
paragraph block directly through `structural.insert`, in `documents-asset-section.tsx` — it never
touches a live `RichTextEditor` instance at all.

★★★ **THE LOADER USED TO EAT EVERY IMAGE-ONLY PARAGRAPH, AND `ASSET_IMG_TEST_RE`
(`document-asset-patterns.ts`) IS WHAT STOPS IT.** An inserted image IS a paragraph whose entire html is the `<img>` tag —
`sanitizeBlock` dropped a paragraph at `htmlTextLength(html) === 0`, and `htmlTextLength` strips
every tag and does not project `alt`, so such a block measured zero and was discarded on ALL SIX
load paths at once. It rendered in the authoring session (in memory) and was simply gone after the
next reload, with no error and nothing in the truncation diagnostic. ★★ Fixed on the LOAD side
deliberately, not at the writer: that also repairs documents already stored broken, which no
write-side change could reach. ★★ The predicate is scoped to a NON-EMPTY `data-asset-id`, not to
`<img>` at large, because a bare `<img>` here can never become anything — the document allow-list
grants `img` only `alt` and `data-asset-id` and deliberately NO `src`, and the resolver plus all
three renderers key off a non-empty `data-asset-id` — so keeping one would reintroduce exactly the
accumulating invisible blank paragraph the empty-drop exists to prevent. ★★ It is case-INSENSITIVE
and admits every legal attribute spelling — unlike the renderers' regexes, which are
double-quoted-only because they only ever see DOMPurify-lowercased, normalised html. **They are no
longer "the same shape", and this line used to say they were:** `e5597c78` deliberately diverged
them, widening only this one to match its own threat model (it runs BEFORE any allow-list pass on
the load path, so it must survive hand-edited and imported html). §209 tracked the spellings of this
attribute contract and is **CLOSED 2026-08-25**: all three now live in `document-asset-patterns.ts`,
a module that imports nothing, so they are read side by side rather than three files apart — which
is why they can be kept divergent on purpose without drifting by accident. ★ It is deliberately NOT `/g` — a
global regex carries `lastIndex` across `.test` calls and would drop every OTHER image-only
paragraph in a document.
★★ Consequence for any e2e or fixture work: BEFORE this fix a seeded image-only paragraph did not
survive to render, so a spec written against one went vacuously green. `e2e/seed.ts` now seeds BOTH
shapes — a captioned figure AND an image-only paragraph — and **they are not interchangeable, so do
not "simplify" the seed down to one.** The captioned figure is valid whatever the block-drop rules
do, which makes it the stable carrier of the CSP/render assertion above. The image-only paragraph
is the shape `documents-asset-section.tsx` actually inserts, and it is what carries this guard's
only END-TO-END coverage: proved by mutation, reverting `ASSET_IMG_TEST_RE` deletes that block at load,
so `e2e/documents-images.spec.ts` finds no `<img>` for it and goes red rather than losing user
images silently again. ★★ That is an e2e-LAYER claim only — the guard itself is pinned directly,
and more thoroughly, by `document-model.test.ts` (image-only paragraph on the load path, on the
`normalizeBlockForStorage` commit path, twice in one document to catch a `/g` `lastIndex` carry, and
across every attribute spelling the widened pattern admits). ★★ **Do not quote a number for that
last set** — an earlier draft of this sentence said "all three quoting styles" and was already
stale: `e5597c78` widened `ASSET_IMG_TEST_RE` to a five-way alternation over `\s*=\s*`, so double-,
single- and UNQUOTED values, upper-cased tags and spaces around the `=` are each a separate branch,
and the test lists them one fixture per line precisely so a mutant keeping the wrong subset cannot
stay green. Read today's off the declaration:
`grep -n -A 1 "const ASSET_IMG_TEST_RE" src/app/document-asset-patterns.ts`. Do not read either layer as making
the other redundant. ★ The two assets are seeded at DIFFERENT dimensions on purpose — each
`<img>` is asserted against its own stored size, so a resolver pointing both at the same bytes
cannot pass.

★ **No sanitizer was edited by this slice.** `<img data-asset-id>` and `alt` were already in the
documents allow-list from S3a's `HTML_START` split (§114) — S3c-1 is a pure consumer of that
existing allowance, not a change to it.

★ **The asset library surface is outside axe coverage, structurally, not by omission.** Turso-gated
+ `e2e/seed.ts` seeds FILE mode → the a11y gate never renders it, the same blind spot as every
other Turso-gated view. And axe-core 4.12.1 has no rule that flags two controls sharing an
accessible name at any seed size (measured against the installed version — see `AGENTS.md`'s a11y
hard-constraint bullet), so even a hypothetical future scan could not catch a row-label collision
here. `asset-library.test.tsx`'s ≥2-row unique-name test is the only detector this surface will
ever have (§203).

★★★ **ROW LABELS CARRY AN OCCURRENCE INDEX ONLY WHEN A NAME IS AMBIGUOUS, AND THE ESCALATION LOOP
IS LOAD-BEARING.** Asset names are NOT unique and cannot be made so: upload takes `file.name`
verbatim and Chrome names EVERY pasted clipboard image `image.png`; `findDuplicate` is hash-only,
so two DIFFERENT images sharing a filename both get rows; and rename accepts a string already in
use. Every per-row control was labelled `${verb} – ${asset.name}`, so two rows could both read
"Delete – image.png" (WCAG 2.4.6). `buildRowTokens` returns id → display token: a name unique in
the RENDERED list is used bare — so the common case is now cleaner than before — and only rows
actually sharing a name are numbered, all of them including the first. ★★ The escalation loop is
not defensive padding: a user can rename a third row to literally `image.png (1)`, at which point
the GENERATED token for a colliding pair's first row collides with that row's BARE one — a
disambiguator re-creating the exact defect it closes. Bumping until the token set is free makes
uniqueness hold by construction. ★ The disambiguator is deliberately NOT the id (36 characters of
UUID read aloud on every control trades a 2.4.6 failure for a worse experience for the same users)
and NOT a whole-list positional ordinal (it shifts under sorting); the tokens derive from the
SORTED rows, so the index follows what is on screen. ★ `rowLabel` keeps the verb at the FRONT so
the accessible name still CONTAINS each control's visible text (WCAG 2.5.3).
★★★ **THE FIXTURE IS THE TEST HERE.** The pre-fix unit test used two DISTINCT names, so it passed
whether or not collisions were possible — the only possible detector, detecting nothing. It now
seeds two rows SHARING a name. ★★ And a uniqueness-ONLY assertion (`Set` size === row count) does
NOT prove the behaviour either: the escalation loop preserves uniqueness even with the occurrence
index removed, so the tests assert the specific expected tokens.

★ **Three smaller a11y/i18n defects on this surface, all worth not reintroducing:** both
`role="status"` regions were CONDITIONALLY MOUNTED, so no upload error and no cap message was ever
announced — a live region must exist BEFORE its text changes, so they are always mounted with the
text toggled. The disabled state told popout users "Images need a Turso project" even on a fully
configured Turso project, which sends the reader to check storage settings that are already
correct — read-only now has its own message, keyed off which condition actually failed. The
paste/drop zone was a role-less focusable `div` carrying an `aria-label` ARIA prohibits on a
generic role; it is a `role="group"`. ★ Separately, focus was dropped to `<body>` after every
rename commit or cancel (`setEditingId(null)` unmounts the focused control) and now returns to the
row's rename button; and the dangling state was announced to NOBODY — a `title` on a
non-focusable span with no text exposes no accessible name — so it carries `sr-only` text beside
the `aria-hidden` glyph. ★ `formatBytes` hard-coded a `.` decimal separator and rendered "3.0 KB"
in German; both branches route through `Intl.NumberFormat`, so the grouping separator is localised
too. Never reach for `toFixed` there again.

### The three asset-id patterns, and why they are deliberately NOT merged

★★★ **THREE patterns read `data-asset-id`, they disagree, and every disagreement is intentional.
Collapsing them is the "finish the job" mistake §218's closure exists to prevent.**

★★ All three live in **`document-asset-patterns.ts`** since 0.259.2 (§209, CLOSED 2026-08-25) — one
module that imports nothing and is DOM-free, both enforced by parser-backed source scans in its own
test. They were three files apart before; being adjacent is what makes the divergences below
readable as choices rather than drift.

| pattern | anchor | shape | what it is for |
|---|---|---|---|
| `ANY_TAG_ASSET_ID_RE` | any START tag | quote-aware, double-quoted value, `/g`, LAZY | tag-AGNOSTIC — deletion safety and the usage count |
| `IMG_TAG_ASSET_ID_RE` | `<img …>` | quote-aware, double-quoted value, `/g`, GREEDY | tag-ANCHORED — an export must only fetch bytes it can draw |
| `ASSET_IMG_TEST_RE` | `<img` | case-INSENSITIVE, all quoting styles, NOT `/g` | **yields no ids at all** — a `.test()`-only SURVIVAL PREDICATE deciding whether an image-only paragraph survives load |

★★ **THE THIRD IS NOT AN EXTRACTOR**, and prose in two files used to imply it was by listing it
beside the other two. It answers a different question at a different moment; folding it into either
extractor changes what survives load. ★ It is now EXPORTED (it was module-private in
`document-model.ts`) so its divergences can be asserted directly rather than probed through
`sanitizeBlock`; `document-asset-patterns.test.ts` is where that happens.

★★★ **THE FIRST TWO DIVERGE ON QUANTIFIER, NOT ONLY ON ANCHOR, AND IT IS CHARACTERIZED RATHER THAN
FIXED.** `ANY_TAG_ASSET_ID_RE` is LAZY and takes the FIRST `data-asset-id` in a tag;
`IMG_TAG_ASSET_ID_RE` is GREEDY and backtracks to the LAST. So
`<img data-asset-id="a" data-asset-id="b">` yields `all = ["a"]` and `drawable = ["b"]` — **`drawable`
is not a subset of `all`**, which the cap message's arithmetic otherwise leans on. It is reachable
only by scanning UN-loaded html: a full load collapses the duplicate attribute. There is a test
pinning it; do not "fix" it by making the first greedy, which would not make the two agree anyway
(the anchors still differ, which is the §218 design).

★★ **THREE REGEXES, NOT THREE READERS — the table above is about the PATTERNS, and a "finish the
job" reader who takes it as the whole population will miss two.** `attachAssetImages`
(`document-asset-images.ts`) reads the attribute through the DOM instead, with
`querySelectorAll("img[data-asset-id]")` on an already-rendered subtree — which gives a FOURTH
distinct answer again: `<img>`-only like `IMG_TAG_ASSET_ID_RE`, but tag-case-insensitive and
quoting-agnostic like `ASSET_IMG_TEST_RE`, because by then it is parsed markup and not text. And
`sanitize-html.ts` reads it as an allow-list VALUE predicate in `ATTR_VALUES`
(`/^[A-Za-z0-9_-]{1,64}$/`), which is what decides whether an id survives sanitising at all —
upstream of every one of the others. Enumerate the population with
`grep -rln "data-asset-id" src/app --include=*.ts --include=*.tsx`.

★★★ **THE DIVERGENCE IS SAFE ONLY BECAUSE OF AN ORDERING.** A single-quoted or uppercase
`<img data-asset-id>` survives load while being invisible to the cap and to every export — which
would be a live defect if stored HTML kept its original quoting. It does not: every load path runs
a structural pass and then `sanitizeDocumentRichFields`, and that second pass is DOMPurify, which
re-serialises attributes with double quotes and lower-cases tag names. Verified at TEN sites
(`workspace.ts`, `browser-backend.ts`, `csv-codecs-config.ts`, `markdown-codecs-core.ts`,
`turso-schema.ts`, each twice — documents and `documentVersions`). Reorder that pair on any load
path and rows the cap cannot see start reaching storage.

★★ **THE ORDERING HOLDS AT TEN; THE EXPRESSION DOES NOT, AND THIS SPOT USED TO QUOTE THE
EXPRESSION.** It said "every load path runs `sanitizeProjectDocuments(raw).map(
sanitizeDocumentRichFields)`" — that literal composition is the DOCUMENTS half only, at five sites,
and `csv-codecs-config.ts` wraps it across two lines so a single-line grep returns four. The
`documentVersions` half at each of the same five sites spells it differently:
`sanitizeDocumentVersions(...)`, which routes through `sanitizeProjectDocuments` internally, then a
per-version `sanitizeDocumentRichFields` over that version's blocks. Same order, different
spelling — so grep the ORDER, not the string.

★★ **WHAT IS PINNED IS ONE OF THE TEN.** `document-asset-usage.test.ts`'s "the load path
normalises quoting BEFORE anything counts references" carries two cases and they are not
interchangeable. The first composes the two passes BY HAND, so it pins the CONSEQUENCE of that
composition and not that any real load path uses it — it imports neither `turso-schema.ts` nor
`csv-codecs-config.ts`, so nothing either of them does can redden it. The second drives
`jsonToWorkspace` end to end and is mutation-proved: deleting `.map(sanitizeDocumentRichFields)`
from that decoder's `documents` branch reddens it (`[]` where `["c"]` was expected) while the
hand-composed case stays green. The other nine compositions are verified by inspection alone.

★ **ONE REVERSAL IS CORRECT AND MUST STAY**: `ai-document-blocks.ts` sanitises per block BEFORE the
structural pass, because it is an AI WRITE path, not a load path.

★ `assetRefsInDocument` (`document-asset-usage.ts`) computes `{ all, drawable, undrawable }` in one
pass; `undrawable` is measured over the WHOLE document, so an id on a span in one block and an
`<img>` in another is drawable and does not inflate the count. The cap message
(`assetLibraryMaxPerDocumentFreeable`) reports how many MORE images could be added once those
references are removed, rather than reporting a bare "full" — and rather than reporting
`undrawable.size` itself, which is what it did until 0.258.1 and which could exceed the cap and
could count references whose removal frees nothing. Both wrong directions, and the test that pins
each, are recorded in `docs/open-followups.md` §218's closing note.

★★ **`undrawable` USED TO OVER-COUNT FOR TWO REASONS `assetRefsInDocument` COULD NOT SEE. Both are
FIXED — `docs/open-followups.md` §231, CLOSED 2026-08-25 — and this paragraph stated them as current
until then.** The pattern behind `all` was a bare `/data-asset-id="([^"]*)"/g` with no tag anchor and
no quote awareness, so (a) it picked up a `data-asset-id="…"` a user simply TYPED into a paragraph
(the document sanitizer round-trips that byte-identical — HTML text nodes escape `&`, `<` and `>`,
never `"`), and (b) in a document whose `<img>` carried a crafted attribute BEFORE its id it picked
up a phantom while missing the real one. `ANY_TAG_ASSET_ID_RE` now requires a START tag and steps
over quoted attribute values, so neither shape reaches the cap or the room the message reports. ★ A
THIRD shape changed with them and is pinned rather than left latent: malformed `<imgdata-asset-id="x">`
(no space after the tag name) used to count and no longer does. The measured before/after table is in
`docs/superpowers/specs/2026-08-25-asset-id-extraction-design.md`, reproducible with
`node docs/superpowers/specs/_probes/asset-id-extraction.mjs`.
★★ **What still counts, correctly, is a `data-asset-id` on a REAL non-`img` start tag** — that is the
§218 design, not a defect. See `docs/open-followups.md` §249 for a measured open question about which
carrier tags can actually reach the loader.

## Image bytes in every export format (S3c-2)

Shipped 0.256.0 "Khaw". Design in
`docs/superpowers/specs/2026-08-22-documents-s3c2-ooxml-media-design.md`. It closed
`docs/open-followups.md` §202 (no OOXML media machinery) and §210 (standalone HTML/PDF carried an
`<img>` with no `src` and no placeholder); it opened §216—§223. Before S3c-2 every export
format substituted a translated placeholder naming the asset; now DOCX and PPTX carry real media
parts, and standalone HTML — which is also the PDF path, through the print dialog — inlines a
`data:` URI.

★★ **THE MODULE SPLIT IS DELIBERATE AND `ooxml-media.ts` IS A DOM-FREE LEAF.** It holds only
unit math and shapes — `EMU_PER_INCH`, `EMU_PER_TWIP`, `emuFromPx`, `emuFromTwips`,
`mediaExtension`, `contentTypeFor`, `fitExtent`, and the `Extent` / `MediaPart` types — so both
package builders and both renderers can share it without either importing the other. Keep it free
of DOM and of translation, exactly like `document-model.ts`.

### The three-bucket contract (`document-export-assets.ts`)

`loadExportAssets(doc, load, budgetBytes?, isRenderable?)` returns `{inlined, omitted, missing}`:
`inlined` is id — base64, `omitted` and `missing` are id sets.

★★★ **`omitted` AND `missing` ARE NOT TWO NAMES FOR THE SAME THING, AND COLLAPSING THEM
LOSES THE ONLY DISTINCTION A USER CAN ACT ON.** `omitted` is a POLICY decision — the bytes exist
and are usable, but the running budget was already spent, so a DIFFERENT export of the same
document (a format with no budget, or a smaller selection) will carry it. `missing` is a DATA
problem — there is no byte row, the load failed, or the renderer's own `isRenderable` declined
it — and no format anywhere will ever carry it until the asset is repaired. Every sink discloses
both, but a reader who is told "omitted" about a dangling asset goes looking for a setting that
does not exist.

★★ **ORDER IS LOAD-BEARING.** `documentAssetIds` returns ids in DOCUMENT order, de-duplicated,
and the budget is charged serially over that list — so which images survive a tight budget is the
order they appear in, not their size. Do not "optimise" this into a largest-first or smallest-first
pass without deciding what the user should see; document order is the only rule that is obvious
from the document.

★ `isRenderable` is asked BEFORE the budget is charged, so an asset the renderer cannot draw
never spends budget a later good image needs. It has **no default** — omitting it means no
renderability filtering at all. `NO_EXPORT_ASSETS` is the frozen empty triple, returned for a
document with no images so a caller never branches on `undefined`.

★★★ **THAT RATIONALE DOES NOT APPLY TO THE SINKS THAT ACTUALLY PASS IT, AND FOR ONE RELEASE
NOTHING PASSED IT AT ALL.** `canEmbedDocxAsset` and `canEmbedPptxAsset` were written for this
parameter and were then never handed to it — `document-download.ts` resolved ONE `ExportAssets`
per download and gave it to every format — so `canEmbedDocxAsset` shipped as a dead export while
three ★★★ docstrings asserted the protection was live. `document-download.ts` now resolves assets
PER FORMAT (`assetPolicy`), and the two OOXML sinks are exactly the UNBUDGETED ones, so no
budget headroom is at stake for them: what the predicate buys there is the three-bucket contract
— an undrawable id lands in `missing` instead of `inlined`-but-undrawable, the fourth state no
bucket describes — plus keeping its base64 out of memory. ★★ The emitted DOCX/PPTX bytes are
IDENTICAL either way (measured: `drawingFor` falls through to the same placeholder), so no output
test can see it; the wiring is pinned in `document-download.test.ts` by asserting — and
INVOKING — the argument `loadExportAssets` receives, and nowhere else.

★★ **THE HTML SINK IS THE ONE THAT HAS BUDGET TO LOSE, AND IT DELIBERATELY PASSES NO PREDICATE.**
That is right for the common case — it can inline any allowed mime, and `assetSrcAttr` declines an
unusable asset at render time — but it is not a closed hole: `assetSrcAttr` also declines a mime
outside `ASSET_MIME_ALLOWED` and a payload failing its base64 check, and `sanitizeDocumentAsset`
does NOT enforce the mime allowlist on load, so an imported workspace can carry a row whose bytes
are fetched, charged to the 25 MB budget, and then dropped to a placeholder. Not fixed, and cheap
to close the day it matters: give the inline sinks a predicate of their own rather than reusing an
OOXML one, whose geometry conditions HTML does not share.

★★ **`EXPORT_INLINE_BUDGET_BYTES` (25 MB) IS A JUDGEMENT CALL, NOT A LIMIT ANYTHING IMPOSES.**
Nothing in the HTML spec, the print pipeline or the browser breaks at 25 MB; base64 inflates bytes
by about a third, and a single HTML file much past that stops being something a mail client will
carry or a browser will open pleasantly. It applies ONLY to the inline-base64 sinks (HTML, and PDF
through it). **DOCX and PPTX are not budgeted** — they store bytes as real zip entries at native
size, so the same document exports complete as `.docx` and truncated as `.html`. That asymmetry is
intentional and is stated in the changelog in user terms; if the number is ever revisited, revisit
that sentence too.

### The additive `media` parameter, and why empty must stay byte-identical

`buildDocxPackage(bodyXml, extraStyles, page, media)` takes an OPTIONAL trailing
`readonly MediaPart[]` defaulting to `[]`. `buildPptxPackage(slides)` takes `readonly PptxSlide[]`
and each slide carries its OWN `media` — there is no deck-level media argument.

★★★ **AN EMPTY `media` MUST PRODUCE THE PACKAGE THE 3-ARGUMENT CALL PRODUCED, BYTE FOR
BYTE.** Every existing consumer — the workspace exporter, the committee report, every
image-free document — goes through these builders, and an accidental extra `<Default>` entry or
a shifted relationship id is a file Word or PowerPoint may refuse to open, with nothing in this
repo able to notice. Both builders therefore throw if a media part claims `rId1` (the styles part
in DOCX, the slide layout in PPTX) and both de-duplicate their `[Content_Types].xml` `Default`
entries, since two `png` defaults is itself a rejected file.

★★★ **EACH BUILDER'S OWN "BYTE" TEST IS WEAKER THAN ITS NAME, AND THAT IS STILL TRUE — what
changed on 2026-08-24 is that it is no longer the only thing watching.** The DOCX "byte-identical"
test lives in `ooxml-docx-primitives.test.ts`, NOT in `export-ooxml.test.ts`, and compares the
3-argument call against the 4-argument one — **the builder against itself** — so it proves the
parameter is ADDITIVE and nothing about what the package contains; measured, the mutant that opened
`docs/open-followups.md` §216 was caught by a trailing `not.toContain("image/")` assertion beside
that loop, not by the loop, and the PPTX equivalent survived it outright. `export-ooxml.test.ts`
asserts part presence and XML substrings, never package bytes, and there is still no `.docx` or
`.pptx` byte fixture in this repo (`src/app/__fixtures__/` holds `golden-workspace.csv` and `.md`
and nothing else). The design spec and the implementation plan for this slice BOTH claimed the
golden suite pinned these bytes, and both were corrected when it did not.

### The ordered part-manifest gate (§216, closed 2026-08-24)

`ooxml-package-manifest.test.ts` compares the MEDIA-FREE packages against
`docs/baselines/ooxml-parts.json`, using `packageManifest` / `formatManifestDiff`
(`src/test/ooxml-manifest.ts`). It rides the existing `unit-tests` job. Read the symbols for the
detail; what belongs here is the properties a reader gets wrong:

★★ **THREE SUBJECTS, DEFINED ONCE, AND ONE OF THEM IS THE SHAPE THE WORKSPACE EXPORTER EMITS.**
`MANIFEST_SUBJECTS` (`src/test/ooxml-manifest-subjects.ts`) holds docx portrait, docx LANDSCAPE and
pptx, and BOTH the gate and `scripts/update-ooxml-manifest.ts` import it. `buildDocxPackage`'s
`page` parameter defaults to landscape and `export-docx.ts` passes two arguments, so the landscape
subject is the docx the WORKSPACE exporter produces — and passing the default rather than the
literal puts that default under the gate too. ★★★ **IT IS NOT THE SHAPE THIS FILE'S OWN SUBJECT
EXPORTS, and "the docx an export produces" — what this said until 2026-08-24 — reads as though it
were, in a documents file above all.** There are TWO docx-producing paths and they disagree on
exactly this parameter: `export-docx.ts` (the WORKSPACE exporter) calls
`buildDocxPackage(body, DOC_STYLES)` and takes the landscape default, while `doc-render-docx.ts`
(the DOCUMENT export path, the one this whole section is about) calls
`buildDocxPackage(body, DOC_STYLES, PAGE, parts)` with `const PAGE: DocxPageLayout = "portrait"`.
The subject's own comment gets this right ("MIRRORING THE WORKSPACE EXPORTER"); the prose had
dropped the qualifier. Do NOT re-split this definition: `tsconfig.json` excludes `scripts/`,
so a divergence in the script's own copy is unreadable to tsc and stays green until the next
regeneration moves the baseline to a package the gate does not build.

★★★ **ORDERED, NOT SORTED.** A sorted manifest cannot see a reordering of the archive's entries,
and OPC readers can care which part leads a package. Measured while closing §216: a pure swap of
two adjacent zip entries — same part set, same digests, unchanged byte count — reddens this gate
and would be green under a sorted one. §216's closing note carries both mutants and their diff
bodies (excerpts — the thrown message wraps each in a header and three trailing lines).

★★ **AND A DUPLICATED PART PATH IS INVISIBLE, which is a FIFTH failure class beside the four the
ordering buys.** `unzipBytes` keys a `Map`, so a second entry at a path already seen OVERWRITES the
first — the manifest carries neither the extra entry nor the shadowed bytes, and the path list, the
order and every digest are unchanged. Out of reach by construction (the same `Map` is what makes
the ordering hold), not a covered case.

★★★ **MEDIA-FREE ONLY.** No BASELINE reaches a media-bearing package, so the duplicate
`<Default Extension="png">` the builders warn about is outside this gate's reach — and no baseline
can close it either, because a media-bearing package's part paths and count depend on the document.
A green run here says nothing about an image-bearing export.

★★ **BUT "NOTHING READS THOSE BYTES" IS FALSE, and this spot used to say it.** FIVE test files
unzip a media-BEARING package and assert over it. Three at the RENDERER level:
`doc-render-docx.test.ts` compares the media part against the source PNG byte for byte and pins the
media path list; `doc-render-pptx.test.ts` pins `ppt/media/image1.png` and `image2.png` and
resolves the rels targets onto them; `document-download.test.ts` asserts a media part's length on a
docx the download surface produced. Two at the BUILDER level: `ooxml-docx-primitives.test.ts`
byte-compares `word/media/image1.png` and, in sibling tests, pins the `<Default Extension="png"
ContentType="image/png"/>` entry, the `Target="media/image1.png"` relationship and the once-only
extension declaration; `ooxml-pptx-primitives.test.ts` byte-compares `ppt/media/image1.png` and
pins the per-slide rels target. What is missing is a BASELINE — every one of those assertions names
a string somebody chose, so a change nobody anticipated passes all five.

★★★ **THAT COUNT SAID THREE UNTIL 2026-08-24, AND HOW IT GOT THERE IS THE LESSON.** The wording
BEFORE it excluded the builder pair with a QUALIFIER — "nothing outside each builder's own unit
test" — and the fix round that corrected that dropped the qualifier and substituted a flat count,
trading a wrong-but-qualified claim for a wrong-and-unqualified one that under-reported existing
coverage by two. ★★ The grep it came attached to, `grep -rln unzipBytes src`, returns ELEVEN files
and so cannot answer the sentence it sat in: it also catches `src/test/unzip-bytes.ts`, that
helper's own test, `zip.test.ts`, this media-FREE gate and `document-export-assets.ts` itself. No
one-line grep selects "unzips a package that HAS media" — the five have to be read for, which is
why they are named above.

★★ **IT SAYS NOTHING ABOUT THE ZIP CONTAINER EITHER, and that is why `zip.test.ts` exists
separately.** A part manifest cannot see the archive's framing: part data carries no timestamp,
since the DOS date is written into the local file header and into the central directory and never
into a part's own bytes (`grep -n "writeU16(dosDate)" src/app/zip.ts` returns exactly those two
lines — earlier wordings here and in `src/test/ooxml-manifest.ts` named only the local header).
That is also why this gate needs no clock injection. `buildZip` takes a trailing `modified` date
for that other seam, its default deliberately unchanged so real exports stay byte-identical —
and `zip.test.ts` DECODES that default out of the local header and requires it to be today's date,
rather than merely showing it is not 1980. Neither gate covers the other.

★★ **REGENERATE WITH `npm run ooxml:manifest` AND NOTHING ELSE.** There is deliberately no
`vitest -u` path — "re-baseline to admit your own change" is the failure the whole gate exists to
prevent. Because a regeneration moves both sides of a digest comparison at once, the test carries
three assertions that hold still while it moves: per subject the ORDERED list of part paths as a
literal (a COUNT would miss an add-and-drop pair and name nothing when it failed — the earlier cut
asserted `toHaveLength(5)` / `toHaveLength(11)`); no `media/` path in any baseline, kept because a
filter naming `media/` says why it failed where a list mismatch does not; and per subject a read of
the LIVE package asserting `[Content_Types].xml` holds no `image/`. ★ Only that third one can see a
CONTENT-only change — the other two read the baseline, which a regeneration moved.

### DOCX: why the paragraph is SPLIT

★★★ **A `<w:drawing>` CANNOT GO THROUGH THE HTML PARSE, AND THAT IS WHAT FORCES THE SPLIT.**
The placeholder path substitutes TEXT into `block.html` BEFORE `docxRichParagraphs` parses it,
which is safe: text inherits whatever paragraph or list context surrounds it. A drawing is XML, and
an HTML parse mangles it. Leaving the `<img>` in place is not an option either — `htmlToRichLines`
has no `<img>` handling, so the tag reaches the DOMParser walk as an unrecognised void element and
vanishes SILENTLY. So `paragraphBlock` cuts the html around each image that will actually embed,
renders each fragment, and emits the drawing in its own `<w:p>` between them. Accepted consequence:
an image that sat inline with text gets its own paragraph. The block editor inserts images as
image-only paragraphs, so the shape the product actually produces is unaffected.

★ An image-free paragraph never enters the split — `paragraphBlock`'s `out.length === 0` arm
returns one call on the ORIGINAL string, so its bytes are what this file produced before S3c-2
existed.

★★★ **SPLITTING RICH HTML RE-ENTERS THE PER-SINK `isHtmlStart` LANDMINE FROM A NEW
DIRECTION, AND THE SYMPTOM IS MARKUP IN THE READER'S DOCUMENT.** `CONTAINS_TAG` (`html-start.ts`)
requires a `<` followed by a LETTER, so a CLOSING tag deliberately does not match. Slice
`<p>a<img>b</p>` around the image and the tail is `b</p>`, whose only `<` is that closing tag: it
classifies as legacy PLAIN TEXT, is escaped, and Word shows `b</p>` verbatim. Both renderers wrap
every fragment through `asMarkup` (a `<div>`) before the rich path.
★★★ **TWO SEPARATE PROPERTIES RIDE ON THAT ONE WRAPPER, AND THIS PARAGRAPH USED TO CONFLATE
THEM.** It read "IT IS NOT A TAIL-ONLY DEFECT — a fragment can be unbalanced in EITHER direction",
which answers a question the CLASSIFIER never asks. Keep the two apart:

- **Classification.** `CONTAINS_TAG` is UNANCHORED, so a fragment misclassifies only when it
  contains markup and NO OPENING TAG. A HEAD fragment is never one — it either opens a tag or holds
  no markup at all, and escaping pure text is a no-op. So this failure IS confined to the tail…
  ★★ …and, once a styled paragraph holds MORE THAN ONE image, to the MIDDLE fragments as well,
  which is the case this file and `doc-render-pptx.test.ts` both previously missed. Measured
  through the real `isHtmlStart(value, RENDER_SINK)` (value FIRST, sink second):
  `"<p>a"`, `"<p>a<em>b"` and `"<p>x</p><p>"` classify HTML; `"b</p>"`, `"</em>"` and
  `"</em></strong>"` classify PLAIN.
- **Parser reconciliation.** THIS is the "unbalanced in EITHER direction" property, and it is why
  the wrapper is a `<div>` rather than merely some opening tag: an unclosed `<p>` at the head and
  an orphan `</p>` at the tail both reconcile inside one well-formed container.

EVERY segment is wrapped because classification needs it for tails and middles while reconciliation
needs it for heads. The leading fragment usually happens to carry an opening tag, which is what
makes the whole thing easy to under-diagnose from one example.

★★★ **PAGE GEOMETRY IS IN TWIPS, DRAWING GEOMETRY IS IN EMU, AND THEY SIT A FEW LINES
APART.** `PAGE_GEOMETRY` and `docxContentWidth` are twips (A4 portrait content width = 10092);
`fitExtent` takes EMU. The factor is 635 (`EMU_PER_TWIP`). Passing the twips figure straight
through clamps every image to about a hundredth of an inch — valid XML, green tests, invisible in
Word. `emuFromTwips` exists so the conversion is SPELLED at the call site
(`CONTENT_WIDTH_EMU = emuFromTwips(CONTENT_WIDTH)`), and `doc-render-docx.test.ts`'s "sizes the
image against the page width in EMU, not twips" pins it: a 480px-wide asset must emit
`cx="4572000"` (480px at 96dpi = 5in). That test is the only thing between this and a silently
microscopic picture.

### PPTX: cost-based pagination, and the two scopes

Lines are costed in body-line-heights. `BODY_LINE_EMU` is one body line; `BODY_LINES_PER_SLIDE` is
`BODY_BOX` height divided by it; a text line costs 1 and an image line costs its height in whole
lines, at least 1. `paginateLines` is a single FORWARD pass that consumes exactly one line per
iteration and pushes an over-budget line onto a fresh chunk rather than re-testing it.

★★ **THAT SINGLE-PASS SHAPE IS WHAT MAKES IT TOTAL — there is no `MAX_SLIDES` constant and
adding one would hide a bug rather than fix it.** A pagination loop that can re-test the same line
is the shape that hangs; this one cannot. If you change it, preserve the property, do not cap it.

★★★ **MEDIA PART PATHS ARE UNIQUE DECK-WIDE WHILE RELATIONSHIP IDS ARE PER-SLIDE, RESTARTING
AT `rId2`.** `createDeckMedia` keeps the part counter in the OUTER closure and mints a fresh
relationship array INSIDE each slide (`rId1` is that slide's layout). Reversing the two scopes
produces VALID XML with the WRONG image on a slide — no schema error, no test that names the
cause. Read `PptxSlide`'s own docstring before touching either.

★ Pictures stack BELOW all of a slide's text, whatever order the `<img>` sat in
(`buildContentSlide` places every text line into one body text box, then each picture beneath it).
Bounded, not measured: the line budget counts LINES, not RENDERED lines, so a wrapped line
under-counts. Both facts are disclosed in the changelog.

### The visible-text gate: the same finding, the opposite remedy

★★★ **BOTH RENDERERS ONCE HAD A "does this fragment have visible text?" GATE. PPTX DELETED
ITS COPY AND DOCX KEPT ONE.** Neither renderer declares a `hasVisibleText` any more — that name
survives in `rich-text-runs.ts`, which is unrelated to any of this — so do not go looking for the
symbol, and do not port one file's answer to the other; both files carry a comment saying so.

- **PPTX:** the gate WAS the defect. `slideLines` already filters blank lines per block, so the
  extra check was redundant — and it dropped an `<hr>` and a declined image's placeholder, both
  of which are content carrying no text. It was removed. The warning lives in `doc-render-pptx.ts`.
- **DOCX:** the gate is REQUIRED. `docxRichParagraphs` is obliged to emit a paragraph for an empty
  value — a `<w:tc>` with no block-level child makes Word reject the whole file — so without a
  check every image-only paragraph, the shape the block editor actually inserts, is bracketed by
  two blank `<w:p>`. What changed is the QUESTION: it now asks "did this render to the
  empty-paragraph sentinel?" (`EMPTY_PARAGRAPH`, i.e. `<w:p/>`) rather than "does this markup have
  text?". The old form stripped tags and tested the remainder, which dropped a horizontal rule
  either side of an image.

★ Comparing against the sentinel rather than re-deriving the line list keeps ONE parse in play;
re-parsing here would duplicate `docxRichParagraphs`' own classification step and the two copies
would then have to agree forever.

### Standalone HTML and PDF

`renderDocumentHtml` now receives assets on both production paths. Three branches, not two: bytes
present — a `data:` URI via `assetSrcAttr`; `omitted` — the same translated placeholder text
the OOXML renderers use; `missing` — the `data-asset-missing` fallback. The rule that styles that
attribute lives in `DOCUMENT_PAGE_STYLES`, which a standalone export INLINES — it must never be
left to `globals.css`, which such a file never loads (that was half of §210).

★★★ **`downloadDocument` IS ASYNC AND THE PDF BRANCH OPENS THE TAB BEFORE IT AWAITS
ANYTHING.** `window.open` is only permitted inside the user gesture, and awaiting the bytes SPENDS
that gesture — so an await-then-open ordering puts EVERY user on the popup-blocker fallback path
that exists for the genuinely-blocked case, turning a missing image into a broken export button.
Open first, write into the already-open tab. §210 estimated this as a one-line wire-up and it is
not; the ordering IS the fix.

### What is NOT verified, and cannot be here

★★★ **NOTHING IN THIS REPO CAN OPEN A `.docx` OR A `.pptx`.** `unzipBytes`
(`src/test/unzip-bytes.ts`) is a bytes-preserving unzip — deliberately not the TextDecoder-based
sibling, which corrupts image bytes on invalid UTF-8 — and the tests compare part paths, part
bytes and document-XML substrings. That proves the package is the one the builders MEANT to write.
It says nothing about whether Word, LibreOffice Writer or PowerPoint accept it. The owed manual
pass is enumerated in `docs/open-followups.md` §219, and no green run substitutes for it.

★★ Two further known divergences are recorded rather than fixed: media parts are minted per
OCCURRENCE, so one image used twice ships twice (§217 — deduplicating needs a SECOND counter,
because a picture's `wp:docPr` / `p:cNvPr` id must stay unique even where the relationship is
shared, and today one running index serves as both); and `ANY_TAG_ASSET_ID_RE` counts a `data-asset-id`
on ANY element toward `ASSET_MAX_PER_DOCUMENT` while `IMG_TAG_ASSET_ID_RE` requires an `<img`, so a
`<span data-asset-id>` consumes a slot and reaches no export bucket at all. ★★ That second one is
**§218, CLOSED 2026-08-24** — the divergence is unchanged and deliberately so; what shipped is that
it is now VISIBLE (the cap message reports how much room removing those references would reclaim)
and pinned. It is described under "The three asset-id patterns" above, and only §217 remains open
here.

★★ A third is a maintainability gap rather than a divergence: `sanitizeDocumentAsset` deliberately
does NOT enforce `ASSET_MIME_ALLOWED` on load, so each consumer restates the allowlist check by
hand — seven copies of `(ASSET_MIME_ALLOWED as readonly string[]).includes(...)` today — and a
consumer that forgets gets no signal from any gate. ★★★ **ONE ALREADY HAS**: `document-preview.tsx`
hands the raw stored mime to `attachAssetImages`, which types its Blob with it and consults
nothing — and because it never names the constant, no grep for the constant can find it. §223
carries the four kinds of use, the mime-reader sweep that DOES find it, and the argument against
narrowing the storage layer; do NOT close it there.

★★★ **TWO MORE WERE FOUND IN REVIEW AND ARE DISCLOSED RATHER THAN FIXED, and BOTH are silent.**
(a) `image/webp` is on `ASSET_MIME_ALLOWED` and survives every downstream layer — `processUpload`
does not even re-encode a webp already inside the downscale cap, `mediaExtension` maps it and
`contentTypeFor` emits `<Default Extension="webp" ContentType="image/webp"/>` — so it ships as a
real media part. WebP is outside the blip formats ECMA-376 assumes and Microsoft documents its
insertion as current-Microsoft-365-only, so an older perpetual Word is expected to draw a blank
frame WITH NO PLACEHOLDER, because nothing here believes anything failed (§221; the decision was
to document rather than decline it, and the reasoning is in that entry).
(b) An image fitted to the full body box costs `ceil(3474720 / 213360)` = **17** slide lines
against a `BODY_LINES_PER_SLIDE` of **16**, so such an image can never share a slide. ★★ Reaching
17 takes BOTH a stored height of **359 px or more** AND an aspect ratio `w/h` below **≈2.41** — above that
the image is width-bound, never reaches the box height, and costs less (a 4000×1080 image costs
11). ★★★ **BUT 17 IS NOT THE LANDS-ALONE RULE AND THIS PARAGRAPH ONCE READ AS IF IT WERE**
("essentially every screenshot lands alone, while a panorama does not"). A line lands alone at cost
**16**, the whole budget: a 2500×1000 banner costs 16 and lands alone, while a 4000×1080 one costs
11 and shares. §222 carries the arithmetic, the fitted-height table and two reproduce scripts; do
not restate either rule as a height threshold alone, which is how this was written here first.
★★ Neither is measurable here: §221's format claim is sourced from the spec and Microsoft's docs,
not observed, and §219 items 6 and 7 carry both owed checks.

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

★ The two channel registrations are deliberately **paired on one source line**, because
`use-storage-backend.ts` is within a line or two of the 800-line cap and the gate counts
`split("\n").length`, i.e. `wc -l` **+ 1** (see `AGENTS.md`'s `size:check` entry).
★★ **CORRECTED: this said the file "sits exactly at" 800 and that splitting them "re-breaks the
gate". Measured, it is 799** — so a split reaches 800, which the gate PASSES (`if (n <= LIMIT)
continue`), and it takes TWO added lines to fail. Keep them paired anyway; the margin is one line
and the next edit to this file spends it. ★★ §220 used to carry the wider problem — that
`documents-panel.tsx` and `document-block-editors.tsx` were both AT 800 — and **§220 is now CLOSED**:
three modules were extracted and the two sit well under the cap (measure them with the command below;
they were 733 and 657 on 2026-08-24). This sentence outlived that fix by pointing at an entry whose
own close paragraph enumerates what it does not address and never mentions this back-reference — the
ordinary way a cross-file pointer rots. What remains true is the `use-storage-backend.ts` margin above,
which §229 now owns. Never quote a line count here — measure it:
`node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`.

## Test coverage — what is and is not pinned

★★ `entity-persistence-registry.test.ts`'s `documentVersions` block covers **CSV, Markdown and
JSON** round-trips — **three** backends, not six. Reproduce:
`grep -c "it(\"documentVersions survive" src/app/entity-persistence-registry.test.ts` → **3**.
★ Grepping the bare phrase instead returns 4 — the `describe` header matches it too.
The two Turso paths and IndexedDB are covered by their own suites, not by that registry block;
do not read a green registry run as proof all six carry the slice.
