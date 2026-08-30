# Seed allow-listing and handle-commit ordering — design

**Date:** 2026-08-30
**Closes:** open-followups §286, §287, §288
**Status:** approved, not yet planned

## Goal

Three open defects, all in "a new project or a new file is being adopted" paths.
Each is a place where a write commits before the decision that authorises it, or a
policy runs at one caller instead of at the shared choke point.

| | Defect | User-visible? |
|---|---|---|
| §287 | Declining the overwrite confirm still re-points storage at the picked file | Yes — the next autosave writes the live project over a file the user declined |
| §286 | The template seed's note-log validator diverges from the canonical one in six ways | Partly — captured note entries are dropped, or stored uncapped |
| §288 | The AI-seed branch reaches a workspace without the rich-field allow-list | No live XSS; unsanitised at rest, and export sinks that do not re-sanitise |

## Architecture

One shape recurs in all three, and it is why they are one slice: **a decision and
its commit are separated, and the commit runs first.** §287 commits a file handle
before the user answers. §288 runs its allow-list in one caller instead of the tail
both callers share. §286 has two validators where the only forced difference is a
DOM dependency.

The fix in each case moves the commit behind the decision, or moves the policy into
the single point of ingress.

---

## Unit 1 — §287: the caller commits the handle

### Today

`LocalFileBackend.openFile()` ends with an `idbSet` of the picked handle under the
active backend's own key. The confirm that asks whether to overwrite the live tasks
runs afterwards, in `use-storage-backend.ts` `onOpenStorageFile`. Declining
therefore keeps the current workspace while storage points at the picked file, and
the next debounced save writes the live project over it. `refreshBackendStatus()`
runs only in the accept branch, so the UI keeps naming the previous file — there is
no on-screen signal that anything moved.

The IndexedDB key is derived from the backend *kind*, not from the instance, so
this is the active backend's own slot.

### Change

- `openFile()` returns the picked `FsHandle` and does **not** persist it.
  `tryGrantPermission(handle, "readwrite")` stays inside it — it must run in the
  user-gesture context.
- A new `loadFrom(handle: FsHandle | null): Promise<Workspace>` carries the whole
  body of today's `load()`. `load()` becomes `loadFrom(await this.getHandle())`.
  The null case throws `StorageNotReadyError("local-file-not-picked")`, exactly as
  today. Both diagnostic mechanisms in `load()` — the `finally` that publishes
  `lastLoadTruncation`, and the import-flag reset placed above the first possible
  exit — move with the body unchanged. The file's own comment warns that a new
  early return is the shape that broke the SharePoint sibling; this refactor adds
  no exit.
- `openFileForBackend` returns `Promise<FsHandle> | null` instead of
  `Promise<void> | null`.
- `onOpenStorageFile` reads via `loadFrom(handle)` and calls the existing public
  `setHandle(handle)` only inside the accept branch.
- `use-storage-file-ops.ts` — the add-existing-project flow — wants adoption, so it
  calls `setHandle` immediately after opening. Its `preopenedBackend` branch
  already calls `setBackendFileHandle` and is untouched.

### Rejected alternatives

**Confirm before picking.** `showOpenFilePicker` requires transient user
activation, which expires after roughly five seconds. A modal confirm does not
consume the activation, but a user who reads slowly gets a picker that throws — a
failure that appears only for slow readers and is close to untestable.

**Capture and restore.** Read the prior handle, write it back on decline. Smaller,
but the wrong handle is genuinely committed for the duration of the dialog; a crash
or tab close mid-confirm leaves it in place.

**Stage the handle in memory.** Have `getHandle()` prefer an uncommitted handle.
This reintroduces §287 by another route: a save firing during the confirm would
target the staged file. It is safe only because `window.confirm` blocks timers, and
the codebase is moving toward non-blocking dialogs.

### Why this one

It removes the bad state rather than repairing it. There is no window in which
storage points somewhere the user has not agreed to, so no crash, no second tab and
no future non-blocking dialog can widen it.

---

## Unit 2 — §286: one note-log policy, canonical semantics

### Today

`sanitizeNoteLog` in `note-log.ts` and `sanitizeSeedNoteLog` in `templates.ts`
disagree on six behaviours. Only the DOM dependency is forced: the canonical one
calls `sanitizeRichHtml` and `htmlToText`, and `templates.ts` is DOM-free by
contract because it sits in the sample generator's import graph.

| | canonical | seed |
|---|---|---|
| entry count | caps at `MAX_NOTE_ENTRIES` | unbounded |
| html cap | byte slice at `MAX_NOTE_HTML` | visible-text cap `TEXTAREA_MAX` |
| `text` | control chars stripped, capped | raw projection, uncapped |
| `authorName` | control chars stripped, capped | `nonEmptyStr`, uncapped |
| missing or duplicate `id` | mints one, de-dupes | drops the entry; duplicates pass |
| `timestamp` | must parse as a date | any non-empty string |

### Change

Extract a DOM-free core parameterised by the two DOM-dependent steps:

```ts
export interface NoteLogHtmlOps {
  sanitizeHtml: (raw: string) => string;
  toText: (html: string) => string;
}
export function sanitizeNoteLogWith(raw: unknown, ops: NoteLogHtmlOps): NoteLogEntry[];
```

`note-log.ts` passes `sanitizeRichHtml` and `htmlToText`. `templates.ts` passes its
own `sanitizeRichText` against `RICH_SINK`, paired with `htmlPlainProjection`,
keeping its DOM-free contract intact. Every other behaviour — entry cap, byte html
cap, control-char stripping, timestamp validation, mint-and-dedupe — lives once in
the core, with the canonical semantics.

**Decision, taken deliberately:** canonical wins on all six rows, including `id`.
§168's heading is "template import drops every register's note log"; today it is
fixed except for exactly the legacy entries whose absent ids the canonical repair
was written for. Duplicate ids matter for the same reason: the notes window edits
and deletes by id, so two entries sharing one id leave the other unaddressable.

`template-note-carry.test.ts`'s "drops an entry with no usable id or timestamp,
keeping its siblings" currently certifies the drop as intended behaviour. It flips.
The commit message says so explicitly rather than the assertion being quietly
weakened — that test encoded the behaviour being corrected, which is the one case
where changing a test is the fix and not a retreat.

The core must stay DOM-free: it may hold no import that reaches `sanitize-html`,
and its test asserts that on a comment-stripped source scan, matching the
`document-model.ts` precedent.

---

## Unit 3 — §288: the allow-list moves into the shared tail

### Today

`buildNewProjectWorkspace` has two adjacent branches — one calling `applyTemplate`,
the other calling `appendSeed` over `remapSeed`. `applyTemplate` ends by calling
that same pair, preceded by four allow-list passes: `allowListRich` over tasks and
milestones, `allowListRaid`, and `allowListChange`. `appendSeed` itself is a pure
spread. So the AI branch reaches a workspace with no allow-list pass at all.

`proposalToSeed` builds RAID, changes and milestones through `sanitizeRaidItem`,
`sanitizeChangeItem` and `sanitizeMilestone`, which run `sanitizeRichText` only — a
classify-and-upgrade with no allow-list. Only the task path reaches
`sanitizeAiRichText`, through `buildSeedTask`.

Scope, stated honestly: this is **not** a live XSS. `RichTextView` sanitises at
render. The exposure is unsanitised-at-rest, plus whatever export sinks do not
re-sanitise on the way out. It is worth fixing because AGENTS.md states that
`sanitizeAiRichText` and `AI_RICH_FIELDS` apply on every model-write path, and this
is a model-write path where they do not — so either the code or that sentence is
wrong, and a reader trusting the sentence will not go looking.

### Change

Move the four passes out of `applyTemplate` and into `appendSeed`, so no seed can
reach a workspace un-allow-listed and a third seed source added later cannot miss
it. `sanitizeSeedTask` stays in `applyTemplate` — it is per-row validation of a
template's captured tasks, not allow-listing.

### Rejected alternative

Clean at production, in `proposalToSeed`. `template-apply.ts` already argues
against this for §228, in a comment a dozen lines above the code being changed:
fixing it at save would leave templates written by older builds unrepaired, and
apply is the only ingress into a workspace. Cleaning at the producer also leaves
any future seed source unprotected, which is the defect being closed.

### Two consequences that must be verified, not assumed

1. **Order changes.** Today the passes run before the id remap; inside `appendSeed`
   they run after it. The remap rewrites ids and foreign keys and should not touch
   rich fields — the plan verifies this rather than assuming it.
2. **Double application.** AI tasks already pass through `sanitizeAiRichText` and
   would now also meet `allowListRich`, so the passes must be idempotent.
   `allowListNoteLog` re-derives `text` from html at every boundary and so is
   idempotent by construction; `sanitizeRichHtml` is idempotent under its default
   configuration. Both get an explicit test rather than an assumption.

---

## Testing

Every route gets a positive and a negative assertion in **separate** `it()` blocks.
Vitest aborts at the first failing hard assertion, so two such assertions in one
block leave the second unproved.

- **Unit 1.** Drive the decline path, then observe a subsequent save's target — the
  probe §287 records as never having existed. Positive control: the accept path
  must still adopt the file, or a backend that refused every open would satisfy the
  negative just as well. A second test asserts the UI label and the persisted handle
  agree after a decline.
- **Unit 2.** A table-driven suite over both ops sets, one row per divergence, so
  the two validators cannot drift apart again without a red run. Plus the DOM-free
  source scan on the new core.
- **Unit 3.** A hostile payload — a paragraph followed by a script element — as a
  RAID description through the AI branch, asserted at rest. An idempotency test
  applying each pass twice. A test asserting the template branch is unchanged.

Mutation testing: each new guard gets a named mutant recorded beside the assertion
it backs. An assertion with no mutant is stated as unproved rather than described
as mutation-proved. Where one mutant is killed by several assertions, that is
recorded too — such a mutant does not prove any one of them in isolation.

## Non-goals

- The four write paths that skip load-time rich-field sanitising: CSV, Markdown and
  both Turso layouts. §288 explicitly warns against leaning on load-time
  normalisation as reassurance; widening to fix it is a separate, larger entry.
- §152's decline-path import reporting. The deliberately inverted guard clause
  there stays as it is.
- `onPickStorageFile`, which has the same ordering shape on the write side. §287
  calls itself the read half of that pair; the write half is out of scope.
- Any change to `evaluateSaveGuard`, to the note-log caps themselves, or to the id
  remap.

## Release

Unit 1 is a user-visible data-loss fix, so this slice bumps. The CHANGELOG covers
Unit 1 in user language. Units 2 and 3 are correctness and hardening with no
user-visible symptom to describe; they are named in the register and in commit
messages, and are not sold as fixed user-facing bugs.

Closing §286, §287 and §288 is a four-place edit each: heading, summary-table
status cell, table anchor, and the Status witness. No body line may contain the
word CLOSED.

## Gates

The full local chain before release: `tsc --noEmit`, `eslint --max-warnings=0`,
`version:check`, `docs:symbols:check`, `docs:claims:check`,
`followups:status:check`, `size:check`, `dup:check`, and vitest over the touched
surface plus a shuffled run at the pinned seed. CI owns the full suite, the
coverage floors, axe and prod-smoke.
