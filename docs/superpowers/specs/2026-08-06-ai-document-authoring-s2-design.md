# AI document authoring S2 — AI tools and version history — design

Date: 2026-08-06
Status: design approved, unimplemented
Baseline: 0.219.0 "Elgin", `main` @ `4e2a18e5`
Parent spec: [`2026-08-06-ai-document-authoring-design.md`](2026-08-06-ai-document-authoring-design.md) (S1 shipped as 0.219.0, MR !354)

## Problem

S1 shipped the document model, storage across six write paths, three renderers and the
Documents view. The assistant still cannot touch any of it: `view-ai-scope.ts:177` tells the
model, truthfully, *"There is no tool for reading or writing documents yet."*

S2 closes that — and closes it safely. Chat tool writes have **no undo capture**, so an AI
that can rewrite a document can also destroy one with no recovery path. Version history is
not a nice-to-have bolted on beside the tools; it is the precondition that makes direct AI
writes acceptable.

## What already exists

Measured against `4e2a18e5`, not assumed:

| Thing | Where | Shape |
|---|---|---|
| Document model | `document-model.ts` (210 lines) | `DocBlock` union · `ProjectDocument` · `sanitizeProjectDocuments`. **DOM-free by contract**, enforced by a comment-stripped source scan |
| Documents state | `workspace-context.tsx:128,163,384` | `documents` + `setDocuments` already in context — the dispatcher can read them without a task-manager change |
| Documents pane | `documents-panel.tsx` (408 lines) | Holds the pure helpers `appendDocument` / `renameDocument` / `duplicateDocument` / `removeDocument`, each a functional-setter no-op-preserves-identity shape |
| Tool schemas | `chat-tool-defs.ts` (593 lines) | `TOOL_DEFS` at `:207`, closes `:593`. Pure data |
| Tool routing | `chat-tools.ts` (748 lines) | `ToolDispatcher` type `:265`, `runTool` switch `:498`, `requireId` `:388`, `patchWithoutId` `:395` |
| Tool impl | `use-chat-dispatcher.ts` (796 lines) | `ChatDispatcherArgs` `:70`, one `useMemo` `:277`–~790, refs absorbing every reactive read |
| Chat surface | `chat-panel.tsx` (**977 lines, baselined**) | `ToolBlock` defined inline at `:936`, rendered at `:718` |
| AI rich text | `ai-rich-text.ts` | `sanitizeAiRichText` = `sanitizeRichText` then `sanitizeTemplateHtml`; `withAiRichFields` + `AI_RICH_FIELDS` (flat entity fields only: raid / change / milestone) |
| Activity | `activity-log.ts:12` | `ActivityKind` union; `ACTIVITY_KIND_TO_KEY` `:168` is total; `ai.inlineEdit` is the existing AI precedent |
| Chips | `ask-claude-prompts.ts:54` | `ASK_CLAUDE_PROMPTS`; the test pins the exact view list (`:45`) and requires hints-or-digest behind every chipped view (`:62`) |

### The size ratchet is a first-class constraint here

`scripts/check-file-sizes.mjs`: `LIMIT = 800`; a file over the limit that is **not** in
`docs/baselines/file-sizes.json` is a NEW-file violation, and a baselined file that **grows**
is a violation. The baseline holds exactly five entries — `chat-panel.tsx` 977,
`task-manager.tsx` 2972, `task-row.tsx` 827, `tasks-section.tsx` 1067,
`workspace-section.tsx` 965.

Consequences that shape the whole slice:

- `use-chat-dispatcher.ts` at **796** has four lines of headroom and needs about five.
- `chat-tools.ts` **748** and `chat-tool-defs.ts` **593** have room only for delegation, not
  for five inline tool bodies.
- `chat-panel.tsx` is baselined at its exact current size, so it **cannot grow by one line** —
  which makes extracting `ToolBlock` a prerequisite of the chat file card, not tidiness.
- `task-manager.tsx` likewise cannot grow, so nothing in S2 may add a dispatcher arg or a
  getter there. Everything the document tools need comes from `useWorkspace()`.

## Decisions

Each was an explicit fork, resolved before design:

1. **Versions live in their own `Workspace.documentVersions` blob**, not nested inside each
   `ProjectDocument`. Documents stay lean on every read and write, history is capped and
   sanitized independently, and the two travel separately.
2. **Delete is recoverable.** `delete_document` snapshots first; the Documents view surfaces
   deleted documents and restores them. This departs from `delete_task` / `delete_resource`,
   deliberately — those delete a row the user can retype, this deletes a document that took a
   session to author.
3. **Every mutation snapshots — AI and user alike.** One code path, no "AI delete is
   recoverable but mine isn't" asymmetry, and S3's block editor inherits it for free.
4. **`update_document` takes block ops, not a full array.** Surgical edits are the reason the
   model is a typed block array at all (parent spec decision 3). `replaceAll` covers wholesale
   rewrites without a second tool.
5. **Document tool code lives in its own modules**; the three existing chat files each grow by
   a handful of delegating lines.
6. **History surfaces as a per-row modal**, with deleted documents behind a toolbar toggle.

---

# 1. Data model

New pure, i18n-free, **DOM-free** module `src/app/document-versions.ts` — same contract as
`document-model.ts`, and for the same reason: it is reachable from
`scripts/generate-sample-workspace.ts`, where a DOMPurify call throws under bare node and
`jsonToWorkspace`'s catch-all swallows the throw into an empty workspace that then
"successfully" writes near-empty sample files (§36(a)).

```ts
export type DocVersionSource = "ai" | "user";
export type DocVersionOp = "update" | "rename" | "delete" | "duplicate";

export type DocVersion = {
  id: number;            // own max+1 mint, independent of document ids
  documentId: number;
  title: string;         // the title AS IT WAS
  blocks: readonly DocBlock[];
  savedAt: string;       // ISO
  source: DocVersionSource;
  op: DocVersionOp;
};
```

## Before-image, not after-image

A version holds the state the mutation **replaced**. Restore therefore means writing the
version back verbatim, with no inversion logic. `create` writes no version — nothing was
replaced. `duplicate` writes one against the **new** document, so its first revert returns it
to the copied-from state rather than to nothing.

## Sanitizer and caps

`sanitizeDocumentVersions(raw: unknown): DocVersion[]` — one entry point, reusing
`sanitizeProjectDocuments`' per-block validation so a version can never carry a block shape
the live model would reject. Unknown shapes are dropped, not passed through.

| Cap | Value |
|---|---|
| `MAX_VERSIONS_PER_DOC` | 20 |
| `MAX_TOTAL_VERSIONS` | 500 |

Text is capped with `capHtmlText`, never `clipText` — `capHtmlText` backs a truncation off one
code unit rather than splitting a surrogate pair, and a lone surrogate becomes `U+FFFD` on
CSV/MD while surviving on JSON/IDB (a backend-dependent corruption; open-followups §22).

## The retention exception that carries delete-restore

Trimming is oldest-first within a document, then oldest-first globally — **except that the
newest version of a `documentId` absent from `documents` is never trimmed.** That entry *is*
the tombstone.

"Deleted documents" is therefore **derived**, not stored:

```ts
versions.filter(v => !documents.some(d => d.id === v.documentId))
```

A stored `deleted: true` flag would have to be cleared on restore and can desync from the
documents array; a derivation cannot. Restore of a deleted document recreates it under a
**new id**.

### ★★★ The derivation is only sound if document ids are never reused — and today they are

Measured 2026-08-06, not assumed. `id-mint-session.ts` `mintId(kind, list)` is the
session-scoped monotonic minter every entity uses, and its `MintKind` union has **no
`"document"` member**; `seedMintFromWorkspace` does not seed documents either. S1 mints with
`document-model.ts` `nextDocumentId(docs)` — plain max+1 with no high-water mark. So deleting
the highest-id document frees its id, and the very next create takes it.

Under this slice that is no longer a cosmetic difference: the new document would silently
inherit the deleted one's version history, and its first "Restore" would write a stranger's
content over it. **S2 must add `"document"` and `"documentVersion"` to `MintKind`, seed both
in `seedMintFromWorkspace`, and move the panel's two `nextDocumentId` call sites
(`documents-panel.tsx:107,133`) onto `mintId`.** That is task 1 of the plan, before anything
depends on it.

(The parent spec and `docs/AGENTS/ai-assistant.md` both name `nextEntityId` for this. No such
function exists anywhere in `src` — the real name is `mintId`. Fix the AGENTS line in the same
commit as the code.)

★ TEST TRAP: retention looks correct while eating the restore point. Pin it with a fixture
holding a tombstone plus 20+ newer versions on *other* documents, and watch the naive
oldest-first implementation fail first.

# 2. Storage — six write paths

```ts
// workspace.ts
/** Before-image snapshots of document mutations (AI and user), the safety net
 *  that makes direct AI document writes acceptable. Optional & additive:
 *  undefined/empty serializes to nothing (byte-stable). Sanitized by
 *  sanitizeDocumentVersions. */
documentVersions?: readonly DocVersion[];
```

Pattern B (meta JSON blob), mirroring `documents` and `insights` — no `ENTITY_SPECS` row, no
Turso table, and therefore **not** in `TABLE_NAMES` (because it has no table of its own, not
because it is non-workspace data — the parent spec records why reading that the other way is
how a future slice talks itself into adding it to the per-table DELETE set).

| Path | Work |
|---|---|
| JSON file / SharePoint / local-file | Native array; `jsonToWorkspace` routes through `sanitizeDocumentVersions` **and** `sanitizeDocumentRichFields` |
| IndexedDB | KV entry beside the other blob fields — no new object store, no DB version bump. Load path routes through both sanitizers |
| Turso single | `meta` row `key = "documentVersions"`; load at the `rowObjects(byTable.get("meta")).find(…)` site, save beside `documents`, `dirty.add("meta")` on reference inequality |
| Turso tenant | `tenantInsert("meta", ["key","value"], ["documentVersions", JSON.stringify(...)], projectId)` |
| CSV | `CSV_SECTION_DOCUMENT_VERSIONS`, gated `config === undefined` exactly as `documents` is at `csv-codecs-config.ts:613` — storage-only, never in a user-facing export |
| Markdown | `documentVersionsToMarkdown` / `markdownToDocumentVersions`, fenced ```` ```json ````, gated the same way (`markdown-codecs-core.ts:574`) |

Dirty detection is reference equality, so an in-place mutation silently skips the save. Every
writer returns a new array.

## The rich-text boundary, restated because it now applies twice

`paragraph.html` inside a version inherits open-followups §28 and §97 exactly as a live block
does: the CSV/MD/JSON decoders hand-build entities and never call the entity sanitizer, and
the sanitizer is DOM-free so it could not run DOMPurify even if they did.

- **Sink re-sanitize** already holds in `doc-render-html.ts`; the history modal's Preview
  renders through that same path, so it inherits the guard rather than adding one.
- **`sanitizeDocumentRichFields`** runs on versions too at the two whole-object load
  boundaries that cast verbatim (`jsonToWorkspace`, the IDB load in `browser-backend.ts`).
- ★★ Adding DOMPurify to the CSV/MD decoders **inverted** the DOM rule for those files in S1 —
  from "you cannot call it here" to "you must ensure a DOM exists". Without one the call
  throws, the catch swallows it, and documents come back `undefined`; on the JSON path, which
  has no local catch, the whole workspace returns EMPTY. The version decoders join that same
  regime (§97).

## Sample data

Add **one version** against the existing sample document in `sample-workspace-small.json`
(the hand-curated master), then regenerate `-big`/`-huge` via
`npx vite-node scripts/generate-sample-workspace.ts` and regenerate `__fixtures__/golden-*`.

Without it the new CSV and Markdown sections are empty in the goldens and pin nothing. Not a
tombstone — a deleted row in demo data is noise the user did not ask for.

★★ `golden-workspace.test` pins CSV and Markdown bytes **only**. There is no golden JSON and
nothing pins IDB or Turso (proved by mutation in S1: an unconditional emit left it green). On
those three paths the task's own tests are the entire net.

# 3. One mutation path

New pure module `src/app/document-mutations.ts`:

```ts
export type DocOp =
  | { op: "append";     block: DocBlock }
  | { op: "insert";     index: number; block: DocBlock }
  | { op: "replace";    index: number; block: DocBlock }
  | { op: "delete";     index: number }
  | { op: "replaceAll"; blocks: readonly DocBlock[] };

export type DocMutation =
  | { kind: "create";    title: string; blocks?: readonly DocBlock[] }
  | { kind: "rename";    id: number; title: string }
  | { kind: "duplicate"; id: number; title: string }
  | { kind: "delete";    id: number }
  | { kind: "ops";       id: number; ops: readonly DocOp[]; title?: string }
  | { kind: "restore";   versionId: number };

export type DocState  = { documents: readonly ProjectDocument[]; versions: readonly DocVersion[] };
export type DocResult = DocState & { changed: boolean; rejected: readonly string[]; documentId: number | null };

export function applyDocMutation(
  state: DocState,
  m: DocMutation,
  ctx: { now: string; source: DocVersionSource; mintDocId: () => number; mintVersionId: () => number },
): DocResult;
```

`documents-panel.tsx` drops its four local helpers and routes through this; the AI tools call
the same function. One code path, so "every mutation snapshots" cannot be half-implemented.

A no-op returns the **same array references** and `changed: false` — the S1 identity rule,
which is what keeps the Turso/IDB dirty check honest.

`restore` has two cases and they differ: when the version's `documentId` still exists, the
document is restored **in place** (title + blocks written back, a before-image version
appended as usual); when it does not, the document is **recreated under a new id** from
`mintDocId`, because the old id may have been re-minted since. Both cases leave the version
row itself untouched — restoring is not consuming.

Op indices resolve against the **evolving** array: ops apply sequentially, so `[delete 0,
delete 0]` removes the first two blocks. This is stated in the tool schema description because
it is the only reading a model can act on deterministically.

## Why this cannot live inside a functional setter

★★★ `setDocuments(prev => …)` and `setDocumentVersions(prev => …)` are **separate setters**,
and the before-image is available in the documents updater while it must land in the versions
one. Computing it inside an updater makes that updater impure, and React StrictMode
double-invokes updaters — appending the version **twice**.

So the composition lives in **`workspace-context.tsx`**, where both slices already are:

```ts
mutateDocuments(m: DocMutation, source: DocVersionSource): DocResult
```

It reads the before-image from provider-held refs (the same ref discipline
`use-chat-dispatcher.ts` already uses to keep its identity stable), computes one `DocResult`,
and calls both setters in the same tick. Callers get the result back synchronously, which is
what lets a tool report `rejected` without re-reading state.

★ The refs must be refreshed in an effect exactly as the dispatcher's are, or a second
mutation in the same tick snapshots a stale before-image.

# 4. The five tools

| Module | Holds | Size impact |
|---|---|---|
| `chat-tool-defs-documents.ts` | `DOCUMENT_TOOL_DEFS` + a `DocBlock` JSON-schema helper shared by all five | `chat-tool-defs.ts` +2 (a spread) |
| `chat-tools-documents.ts` | `runDocumentTool(d, name, input)`, arg coercion, boundary guards, `DocumentToolDispatcher` type | `chat-tools.ts` +~8 (one delegating case group, plus the type in `ToolDispatcher`) |
| `use-document-tools.ts` | The impl hook, spread into the dispatcher's returned object | `use-chat-dispatcher.ts` +~5 |
| `ai-document-blocks.ts` | `sanitizeAiDocBlocks` — DOM-bound, so deliberately not in `document-model.ts` | new |

To buy the headroom the dispatcher needs, move the `ChatDispatcherArgs` interface
(`use-chat-dispatcher.ts:70`–~99, ~30 lines including its comments) into
`chat-dispatcher-types.ts` and re-export it from its current home so no import in the tree
changes. Do this **before** adding the spread, and re-run `size:check` between the two.

| Tool | Args | Returns |
|---|---|---|
| `list_documents` | — | `{id, title, blockCount, updatedAt}[]` |
| `get_document` | `id` | full document including `blocks` — the model must read before it can edit surgically |
| `create_document` | `title`, `blocks?` | `{id, title, blockCount}` |
| `update_document` | `id`, `title?`, `ops?` | `{id, blockCount, applied, rejected[], removed}` |
| `delete_document` | `id` | `{deleted: true, restorableVersionId}` |

Reads (`list_documents`, `get_document`) take no `isReadOnly` guard, matching
`list_allocations` and `get_dashboard_snapshot`.

## Guards — all four are mandatory

1. **A non-array `ops` throws at the tool boundary** (`chat-tools-documents.ts`), never in the
   pure module. This is the `set_task_dependencies` class: malformed model output must never
   be byte-identical to a legitimate "clear everything".
2. **A wholly-refused write throws and writes nothing** — stored blocks untouched, no version
   appended. Writing the empty result would destroy the document while the model reports only
   "I couldn't do that."
3. **`isReadOnly → readOnlyError()` first** on `create` / `update` / `delete` — popouts neither
   persist nor broadcast, so a chat edit there is silently lost.
4. **`replaceAll` reports `removed`** (prior block count minus kept) so a model that sends only
   the new block instead of the whole document cannot delete the rest invisibly.

★ TEST TRAP (inherited, and it has already bitten this codebase once): asserting the result
`blocks` equals `[]` against a fixture that never had blocks passes whether the code preserves
or erases. Seed a real prior value and watch the assertion fail first.

★★ Test at the **write**, not at the tool call. Spying on `runTool` is one hop short of the
defect — S1's review found the model-write gap exactly there, and only on a cold read.

## Model-authored HTML

New DOM-bound `ai-document-blocks.ts`:

```ts
export function sanitizeAiDocBlocks(blocks: unknown): DocBlock[]
```

`paragraph.html` goes through `sanitizeAiRichText` (`ai-rich-text.ts`) = `sanitizeRichText`
then **`sanitizeTemplateHtml`**. Not `sanitizeNoteHtml`, and the difference is not reach:
`ALLOWED_TAGS` is `["p","br","strong","em","u","h1","h2","ul","ol","li","a"]`, so neither list
allows `<h3>`/`<div>`/`<table>` — both delete the TAG. What differs is the text inside it.
`sanitizeNoteHtml` sets `KEEP_CONTENT:false` and deletes it too; `sanitizeTemplateHtml` keeps
DOMPurify's default and unwraps, so a model emitting `<h3>Section</h3>` keeps the word.

Every other block's text goes through the DOM-free document sanitizer.

Applied to the model's **input**, never to the merged document — re-running the allow-list
over storage rewrites bytes the call never asked to touch, and would unwrap a tag an older
path legitimately stored. A field the model did not supply is **skipped**, not blanked.

Deliberately **not** an `AI_RICH_FIELDS` entry: that map is flat entity fields, and blocks are
nested. A test pins each list there, so the omission is a decision, not a gap.

# 5. Surfaces

## History modal — `documents-history-modal.tsx`

Opened from a per-row button whose accessible name is row-**unique**: `History – <title>`, not
N identical "History". The axe gate can pass N identical labels when only one row is seeded,
so this is a hand check, not a gate result.

Rows: `savedAt · source (AI / you) · op · block count`, with **Preview** (read-only render
through `doc-render-html` preview mode, which is where the sink sanitize lives) and
**Restore**.

Restore takes no confirm dialog: restoring itself writes a before-image version, so it is
itself revertible. A toast reports what happened.

## Deleted documents

A `ToggleButton` in the toolbar — never a hand-rolled `aria-pressed` button, which gets
neither the non-colour `data-pressed-marker` nor the primitive's test. Its label is pinned to
what it **enables** ("Deleted documents") so `aria-pressed` tracks that state and
"Deleted documents, pressed" cannot imply the wrong mode.

With it on, the list renders tombstones (derived, §1) with a Restore action; restore recreates
under a fresh id.

## Toolbar order

**New document** keeps the lead as the pane's primary action, then the download menu, then the
contiguous trailing group **Print · reset-columns · reset-size**. The deleted toggle goes
before the trailing group, never between two of its members.

Assert with the shared `src/test/toolbar-order.ts` and `contiguous: true`. Never a hand-rolled
`compareDocumentPosition` walk — `buttonIndex` throws when a key matches zero or several
buttons, while a `findIndex` silently takes the first and can pass against the wrong control.

## Chat file card

★★ `ToolBlock` is defined **inside** `chat-panel.tsx` at `:936`, and that file is baselined at
exactly 977 lines — it cannot grow at all. Extracting `ToolBlock` into `chat-tool-block.tsx`
is therefore a **prerequisite** of this feature, and it shrinks chat-panel, which the ratchet
allows.

In its new home the block renders a document card when the tool name is one of the five and
the result carries an id: title · block count · **Download** (format menu reusing
`DOC_FORMATS` from `documents-toolbar.tsx`) · **Open** (navigate to the documents view with
that row selected). Download needs the workspace for `dataSection` resolution, read via
`useWorkspace()` in the card — chat-panel is not memoized, so a context read there costs
nothing (unlike `ResourcesPanel`).

## Registrations

| Registration | Consequence if missed |
|---|---|
| `view-ai-scope.ts` `documents`: delete the now-false `reading` line, add `toolHints` | The model keeps telling users it has no document tools |
| `ASK_CLAUDE_PROMPTS.documents` + the pinned view list at `ask-claude-prompts.test.ts:45` | Test red — and the chips are only *legal* once `toolHints` exist (`:62`) |
| `ActivityKind "ai.documentWrite"` + `ACTIVITY_KIND_TO_KEY` + EN/DE | tsc (the record is total by construction) |
| `activityViewOf` → `"documents"` | Activity row does not deep-link |
| `dashboard-delta.ts` `classify` | Explicit decision: **`null`** — a document write is not a delta-strip verb |
| EN + DE i18n for every new string | tsc key parity. DE written via node utf8 write — the Edit tool corrupts umlauts and curls quotes, and the file is CRLF so an LF-anchored replace silently no-ops |
| `HELP_ENTRIES` prose for the new controls | The gate is per-**view** and `documents` is already covered, so nothing goes red — which is exactly why this is easy to skip and must be done deliberately |

# 6. Testing and gates

- **`npm run size:check` is the gate most likely to fire.** Run it after each extraction and
  again after each of the three chat-file edits. Both extractions
  (`ChatDispatcherArgs` → `chat-dispatcher-types.ts`, `ToolBlock` → `chat-tool-block.tsx`)
  exist *because* of it.
- **`npm run dup:check`** — five tool defs shaped like the existing 38 is a live clone risk;
  the shared `DocBlock` schema helper and the existing field-helper pattern are the
  mitigation. Verify by running the gate, not by assuming.
- **Property test** on `applyDocMutation`: for every mutation kind, `mutate` then `restore` the
  newest version returns the prior document state. `fc.date({noInvalidDate: true})` or an
  integer-ms range for timestamps — a bare `fc.date()` can emit an Invalid Date whose
  `.toISOString()` throws.
- **Codec round-trip** extended to `documentVersions` across all six block types:
  `sanitize(decode(encode(v)))` equals `sanitize(v)`.
- `entity-persistence-registry.test.ts` extended to `documentVersions`.
- `golden-workspace.test` regenerated once, from the real sample change.
- Coverage floors are blocking (global lines 92 / funcs 91 / branch 80 / stmts 89).
  `document-versions.ts`, `document-mutations.ts`, `ai-document-blocks.ts` and
  `chat-tools-documents.ts` are real logic → tested, never excluded. `use-document-tools.ts`
  is dispatcher glue → `coverage.exclude`, the same class as the existing dispatcher hooks.
- **axe**: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents"` on a fresh
  isolated server (`PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`) — never the
  reused `:3000`, whose stale Tailwind produces phantom failures. The history modal is closed
  at scan time, so its labels and contrast are a hand check.
- `npm run test:shuffle` before pushing — the only local reproduction of the blocking
  `unit-tests-shuffled` job.
- `npx tsc --noEmit` after editing any test — `next build` does not typecheck `*.test.tsx` and
  vitest never typechecks.
- **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the
  file. For a backgrounded run, write the real code *into* the log:
  `{ cmd > log 2>&1; echo "REAL_EXIT=$?" >> log; }`.
- E2E on this machine needs `--workers=4`; the default 10 against a Next dev server produces
  60s timeouts that read like a broken app.

# 7. Out of scope for S2

- Any block **editing UI** — S3. S2's only block writer is the model.
- Entity attachment — S4.
- Bold/italic fidelity in `.docx` / `.pptx` — the OOXML renderers still receive
  `descriptionTextWithBreaks` flat text.
- Diffing two versions. The modal previews a version whole; a block-level diff is a later
  slice if it earns itself.
- Undo-stack integration. Chat writes have no undo capture and this slice does not add any;
  version history is the recovery path, deliberately.
