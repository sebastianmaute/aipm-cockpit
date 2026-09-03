# Document write concurrency — design

**Date:** 2026-09-03
**Status:** SHIPPED 2026-09-03 — `docs/open-followups.md` §349 is CLOSED. ★ This is a DATED DESIGN
RECORD: everything below states the tree as it stood on 2026-09-03 BEFORE the slice landed, in the
present tense, and is deliberately left that way. Read the §349 entry, not this file, for what the
code does now.
**Origin:** `docs/open-followups.md` §349, filed by the review of the AI write-safety slice
(0.279.0 "Sriduangkaew"). That slice gave the six entity `update_*` tools an `expectedToken` and
deliberately exempted `update_document`; this closes the hole the exemption left.

## Goal

An AI `replace`, `delete` or `move` on a document block must not silently overwrite an edit the user
made after the model read the block. Chat tool writes have no undo capture in this app, so a silent
overwrite is unrecoverable from the session that caused it.

## Background — measured, not assumed

**The mechanism already exists and is simply not advertised.** `DocOp` carries an optional
`expect: DocBlock` on its `replace`, `delete` and `move` arms, enforced in `document-ops.ts` against
live state via `blockChanged`. The hand block editor supplies its draft's baseline. The tool schema
in `chat-tool-defs-documents.ts` exposes `op`/`index`/`block`/`blocks` and no `expect` at all, and
its op enum omits `move` entirely. So the AI write path has no concurrency protection available to
it while the engine beneath it does.

Reproduce the absence:

```bash
grep -c expect src/app/chat-tool-defs-documents.ts               # 0
grep -n 'op: { type: "string"' src/app/chat-tool-defs-documents.ts   # ONE line: the op enum, no "move"
grep -c 'expect?: DocBlock' src/app/document-ops.ts              # 3
```

**`update_document` cannot use `expectedToken`, and this design does not ask it to.** A
`ProjectDocument` persists as a meta-blob with no CSV projection, so `PROJECTORS` has no entry and
`entityToken` has nothing to hash. The exemption is pinned by `NOT_TOKEN_GUARDED` in
`ai-entity-token.test.ts`, whose exhaustiveness case turns red if the field is ever spread onto
`update_document` or `update_settings`.

**Four facts that shaped the design, each probed 2026-09-03:**

- `blockChanged` is full structural `deepEqual`, so `expect` is not a marker — it is the entire block
  reproduced exactly. For a rich-HTML paragraph the model would have to echo the HTML byte-identical,
  and any normalisation it applies is a mismatch.
- `DocBlock` has no id — `heading`/`paragraph`/`bullets`/`table`/`dataSection`/`pageBreak`, not one of
  them carries one. Blocks are addressed by index and content only, so no id-based concurrency option
  exists.
- `get_document` returns the whole `ProjectDocument` verbatim. The response-cost slimming shipped in
  the same release was `list_*`-only, so the model does receive blocks at full fidelity. Checked
  because a slimmed read would have made any content-based precondition unusable.
- No persisted store can hold an `update_document` call, so making a new field REQUIRED cannot break
  stored work at upgrade (the §351 shape). `ALLOWED_REC_TOOLS` is the five entity `update_*` plus five
  `create_*`, enforced at generation, load and apply; `ScheduledJob` persists no tool calls at all;
  stored thread history is transcript, never re-executed.

## Decision 1 — a per-block HASH, not a full-block echo

The model sends a short token, not the block.

### Rejected: advertise `expect` as the engine already declares it

The cheapest change, and §349 itself describes closing the entry as "advertising, not building" —
which is true only of this option. It was rejected on two grounds:

- **It fails in the direction that kills the guard.** Reproducing rich HTML byte-for-byte under
  `deepEqual` will misfire on whitespace and entity encoding. An individual misfire is safe — it fails
  closed — but `expect` is optional, so the model's escape from a flaky precondition is to stop sending
  it, and a guard whose caller has learned to omit it is worse than no guard because it still reads as
  protection.
- **It pays the block's tokens twice on every guarded edit**, against the seven rich-HTML fields this
  app carries — the exact spend the response-cost half of 0.279.0 was cutting.

A hash also gives the AI write path ONE concurrency story: a read hands out a token, a write returns
it, a mismatch or absence refuses. That is `expectedToken`'s shape, and a second unrelated spelling of
the same rule is how the lockstep-guard landmines in this repo begin.

**Cost, stated plainly:** this is new code, not advertising. `entityToken` hashes a CSV projection and
a document has none, so `blockToken` needs its own canonical projection.

## Decision 2 — the check runs in the ENGINE

An earlier draft of this design put the enforcement in the tool layer and left `document-ops.ts`
untouched. **That is impossible, and the reason is worth recording.** `applyOps` applies ops
left-to-right against an evolving list — op 3's target is the list as already modified by ops 1 and 2.
A tool-layer check would have to simulate the engine to know which block sits at an index, duplicating
the logic the engine's own comment calls the one place the check cannot be fooled.

So `expectHash?: string` joins `expect?: DocBlock` on the `replace`, `delete` and `move` arms, and is
checked at the same three sites against the evolving array.

Both stay OPTIONAL at the engine level. `document-ops.ts` states its contract in terms — an absent
precondition "must never be read as expected nothing", because every AI/tool caller omits it today and
must keep applying — and the hand block editor shares that engine. Strictness therefore lives at the
TOOL layer, which refuses on absence while the engine stays permissive.

When both fields are present, BOTH are checked. That is cheaper to specify than a precedence rule and
there is no case where one should override the other: the editor has the block, the model has a token,
and neither caller sends both today.

## Decision 3 — the token must agree with `blockChanged`

`deepEqual` treats an omitted field and one explicitly set to `undefined` as the same block,
deliberately, so that a form control clearing `ordered` does not read as a change.

If the projection distinguishes them, the two guards hold different opinions about the same pair of
blocks, and the AI path refuses writes the hand editor accepts. The canonical projection must
therefore normalise `undefined` away, and a test must feed both spellings of one block and assert a
single token.

Injectivity is the other half. `ai-entity-token.ts` length-prefixes every field
(`column + ":" + value.length + ":" + value`) precisely to make its projection injective — commit
`6851e3ba`. A block union with free-text fields, string arrays and a nested `rows: string[][]` has the
same collision surface, so the projection is type-tagged, length-prefixed per field, count-prefixed
per array, and recursive for table rows.

## Decision 4 — `move` joins the op enum

Separate from concurrency and cheaper, but it belongs in the same slice because it is the same
omission. The engine's `move` is deliberately ONE op rather than a composed `delete` + `insert`,
because `applyOps` bails wholesale only when nothing applied — so the composed spelling can delete a
block and then have the re-insert refused, losing it. The model has no way to express the safe
spelling today.

## Decision 5 — partial application is kept, and reported

`applyOps` ends `applied === 0 ? null : next`, so a batch where op 2 is refused still commits op 1.
For a concurrency guard that is arguably backwards, and it is NOT changed here: the bail rule is
load-bearing elsewhere (it is why `move` is atomic) and touching it reaches the hand editor.

Instead the tool result reports per-op refusals explicitly, so the assistant can tell the user which
edits landed and which did not. Chat tool writes have no undo capture, so silence about a partial
apply is the expensive failure.

**This is already built — it is reuse, not new work, and an earlier draft of this spec said
otherwise.** `applyOps` takes a `rejected: string[]` out-parameter, `DocumentUpdateResult` carries
`rejected: readonly string[]`, and the array already reaches both the model and the chat card. The
existing `expect` mismatch even has the right wording: `op N: replace index X was changed by another
writer`. So the hash mismatch adds messages in that same shape and nothing else.

★★ **The trap is the op-index space, not the reporting.** `use-document-tools.ts` documents that TWO
index spaces meet in one `rejected` array — the caller's op indices and the engine's, which differ by
the number of ops rejected before the engine ran — and it remaps engine messages through
`remapOpIndex` against its own array, never `result.rejected`. A new refusal message added on the
engine side must go through that remap, or it names an op the model did not send.

## Tool surface

- `get_document` returns `{...doc, blockTokens: string[]}` — a PARALLEL array, so a model-facing token
  never leaks into the persisted `DocBlock` type. The executor builds a response object rather than
  returning the document reference.
- `update_document` ops gain `expectHash` on `replace`/`delete`/`move`, and `move` gains `from`/`to`.
- The tool layer requires `expectHash` on those three ops. Two DISTINCT errors, because they need
  different responses from the model: absence says to call `get_document` first; mismatch says the
  block changed underneath and to re-read it, never to retry the same call.

## Scope

**In:** `blockToken` and its canonical projection; `expectHash` on three `DocOp` arms and its three
enforcement sites; `blockTokens` on the `get_document` response; the `update_document` schema
(`expectHash` + `move`); tool-layer required-ness and its two error messages; hash-mismatch messages
added to the existing `rejected` channel, remapped through `remapOpIndex`; the tests below.

**Out:** `expectedToken` on `update_document` (structurally impossible, pinned as exempt); any change
to `applyOps`' bail rule; any change to `expect`'s existing semantics or to the hand block editor;
`create_document`/`delete_document`; §350 and §351, which are their own entries.

## Testing

- `blockToken` is injective across every arm of the union, including two tables differing only in
  where a row is split — the case a naive concatenation collides.
- `blockToken` agrees with `blockChanged`: a block with `ordered: undefined` and the same block with
  `ordered` omitted produce one token.
- A mismatched `expectHash` refuses THAT op and leaves the block UNCHANGED — asserted on the block,
  not merely on an error being raised. An assertion that only checks the throw passes against code
  that threw after writing.
- A matching `expectHash` applies, and the check reads the EVOLVING array: an op whose index is only
  correct after an earlier op in the same batch must pass.
- The tool refuses `replace`/`delete`/`move` with no `expectHash`, with the message naming
  `get_document`.
- `move` round-trips through the tool path, and the composed `delete`+`insert` contrast stays pinned
  where `document-ops.test.ts` already pins it.
- Every guard mutation-proved by reading WHICH cases fail rather than the exit code, recorded as
  `N failed / M passed` with the sum checked against the file's runtime test count. Mutants reverted by
  inverse anchored write with a uniqueness assertion in both directions, ending on an empty
  `git diff --stat` — `git checkout -- <file>` is deny-blocked in this repo.
- Gates: `npx tsc --noEmit` (exits 2 on diagnostics), `npx eslint --max-warnings=0` on touched files,
  the touched vitest files, `npm run size:check`.

## Note for whoever plans this

`TOOL_DEFS` ends by spreading `DOCUMENT_TOOL_DEFS` from a second file, so
`grep -c 'name: "update_' src/app/chat-tool-defs.ts` returns 7 and never sees `update_document`. That
is how this hole was missed when the write-safety slice was planned. Enumerate the tool surface
against the live `TOOL_DEFS` array, never against one defs file.
