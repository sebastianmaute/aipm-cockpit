# Version-history completeness — design

**Date:** 2026-08-26
**Branch:** `feat/version-history-completeness`
**Closes:** §241 (partially, by design), §242 (partially, by design)
**Register numbers to mint:** §254 (see "Filed, not fixed")

## Goal

Six slices reach `getVersionPayload` that the version-history registry cannot see. Make
the diff see all of them, make the three user-authored ones restorable, and stop the
emptiness guard reading a documents-only project as an empty transient.

## The defect, in one paragraph

`writeVersion` (`use-version-history.ts`) runs two guards before capturing. The FIRST,
`isEmptyWorkspacePayload`, counts nine legacy content lists; the SECOND skips a capture
when `diffWorkspaces(prev, payload).length === 0`. `COLLECTION_SPECS` (`version-diff.ts`)
— the registry BOTH `diffWorkspaces` and `applyRestore` walk — omits `knowledgeItems`,
`insights`, `documents`, `documentVersions` and `calendarEvents`. A project holding only
documents therefore fails guard one; and even past it, a session that edits only those
five produces an empty diff and fails guard two. Both guards must change or a
documents-only project still never versions — closing either alone accomplishes nothing
for that project shape.

## Decisions taken

| Question | Decision |
|---|---|
| Which slices become restorable | `knowledgeItems`, `insights`, `calendarEvents` |
| `documents` / `documentVersions` | diff-visible, **not** restorable |
| Which slices count toward non-emptiness | `knowledgeItems`, `documents`, `calendarEvents` |
| `KnowledgeItem`'s string id | widen `recordId`, and harden `changeKey` |
| Verification | unit + a self-skipping live-Turso spec |

### Why documents are diff-only

`documents` and `documentVersions` already own a version model — `applyDocMutation`,
before-images, tombstones (`docs/AGENTS/documents.md`). A workspace-level restore would
bypass that path entirely: no before-image minted, and `documentVersions` itself being
rewritten underneath. One document would have two independent histories with two writers.
They still need a diff row, because the diff is what arms the capture — without it a
documents-only session produces no version at all, which is §241's sharpest half.

### Why insights and documentVersions are not counted for emptiness

The guard exists to drop a capture taken mid-project-switch, when content arrays are `[]`
and only defaults are seeded. A slice may only be counted if a switch transient cannot
carry it non-empty while the nine are empty.

- `insights` is written by a DEBOUNCED detect effect (`task-manager.tsx`, the
  detect→reconcile runner keyed on `buildInsightInput`). A timer armed by the OLD
  project's inputs can fire after the reset, so counting it lets a stale write mark the
  transient non-empty — re-opening the hole the guard closes.
- `documentVersions` is derived from `documents` (`workspace-context.tsx` sets both from
  one loader result). A project with versions has documents, so it adds no information a
  `documents` count does not already give, and inherits the same derived-slice objection.

The rule, which the guard's comment was missing: **count user-authored content, never
derived slices.** Same reasoning that already excludes `activityLog` and seeded reference
data.

## Changes

### 1. `src/app/version-diff.ts`

Add an exported id type and widen the change record:

```ts
export type RecordId = number | string;
```

`VersionChange.recordId` becomes `RecordId | null`. `VersionChange` also gains
`restorable?: false`, copied from the spec in `diffList`, so a consumer can tell an
informational row from a revertible one without importing the registry.

`CollectionSpec` gains:

```ts
/** Omitted = restorable. `false` = diff-visible but `applyRestore` skips it, because
 *  the slice owns its own history elsewhere and must keep a single writer. */
restorable?: false;
```

`diffList`'s `byId` map keys on `RecordId`; `recordLabel` takes a `RecordId` (its
`#${id}` fallback already works for both).

Five rows appended:

| key | label | nameField | restorable |
|---|---|---|---|
| `knowledgeItems` | Knowledge | `name` | omitted |
| `insights` | Insights | `key` | omitted |
| `calendarEvents` | Calendar events | `title` | omitted |
| `documents` | Documents | `title` | `false` |
| `documentVersions` | Document versions | — (falls back to `#id`) | `false` |

The existing ★★★ block declaring `knowledgeItems` and `insights` "DELIBERATELY ABSENT"
becomes false and is rewritten. It must NOT simply be deleted: the corruption it
describes — a `kind: "singleton"` row on an array slice, which `mergeFields`'
`{ ...target }` turns into an object with numeric keys, which `workspaceToJson` then gates
on `.length` and drops from all six write paths — is still live for any future array
slice. The replacement states that rule plus the `restorable` rule.

### 2. `src/app/version-restore.ts`

`applyRestore` skips non-restorable specs — one guard at the top of the
`COLLECTION_SPECS` loop:

```ts
if (spec.restorable === false) continue;
```

The slice is then carried through from `current` untouched, exactly as today.

`byId` types as `Map<RecordId, Rec>`; the `as number` cast on `change.recordId` goes.

`changeKey` stops being a raw colon join. Two collisions, both **silent wrong-record
restores** rather than crashes:

- a string id containing the separator makes `collection:id` ambiguous
- a string id of literally `"_"` collides with the `null` singleton sentinel

Encode unambiguously (`JSON.stringify([collection, recordId])` is sufficient and stays
readable in a devtools inspection). `changeKey` is used to BUILD and to LOOK UP the
selection within one session, and `RestoreSelection` is never persisted, so no
compatibility shim is needed.

### 3. `src/app/version-diff-view.tsx` and `src/app/history-panel.tsx`

`history-panel`'s Restore path auto-selects EVERY change. With documents now in the diff,
a user could select a documents row and get a silent no-op. Rows whose change carries
`restorable: false` render as informational: not selectable, with a hint saying document
history is managed per document. `history-panel`'s two auto-select loops skip them, so
the selection can never contain a key `applyRestore` will ignore.

### 4. `src/app/use-version-history.ts`

`isEmptyWorkspacePayload`'s `lists` grows by `knowledgeItems`, `documents`,
`calendarEvents`. The comment records the user-authored-only rule and names both
exclusions with their reasons, so the next contributor does not "complete the pattern".

## Tests

### Flipped characterization tests

`src/app/version-restore.test.ts` holds four tests pinning today's behaviour:

- "keeps knowledgeItems and insights as ARRAYS through a full restore"
- "reverts settingsOverrides but carries the five array slices from live state"
- "carries five slices through a short pre-0.259.0 capture and reverts the sixth"
- "turns no array-typed slice of the workspace into an object"

Each is re-pointed at the new behaviour. **Each must be proven RED against the new code
before being rewritten** — a characterization test edited to match whatever the code now
does is blind to what it stopped covering. The array-never-becomes-an-object test keeps
its assertion: that property must survive, and is now the guard on the new rows having
`kind: "list"` rather than `"singleton"`.

### New unit coverage

- `version-diff.test.ts` — each new row produces changes; a string-id `knowledgeItems`
  diff round-trips; a `restorable: false` collection still appears in the diff and carries
  the flag on its changes.
- `version-restore.test.ts` — the three restorable slices genuinely revert (added /
  removed / modified each); `documents` and `documentVersions` are carried from live even
  when their key is present in the selection; both `changeKey` collisions.
- `use-version-history.test.tsx` — a documents-only payload is NOT empty; likewise
  knowledge-only and calendar-only; an insights-only payload IS empty; a
  documentVersions-only payload IS empty.
- `version-diff-view.test.tsx` — a non-restorable row is not selectable and carries its
  hint.

### Live-Turso e2e

`e2e/version-history-documents.spec.ts`, following the
`documents-images-interactive.spec.ts` pattern. `readEnvLocal()` parses `.env.local`
itself, because Playwright does not load it — only Next does, so the obvious
`test.skip(!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL, …)` is ALWAYS true in the test
process and skips everything even against a live database.

**The gate is two-part, and the second half is an ASSERTION, not a skip.** A suite gated
only on a skip condition SKIPS every test and prints as a PASS — the false-green shape
that sibling spec was built to survive, because `reuseExistingServer: !CI` will happily
attach to a server started before `.env.local` existed, where the config never reached the
browser. So the spec asserts the history panel is live before testing anything through it;
absent, it fails loudly. **A skip is never evidence.**

The test itself seeds a documents-only project, edits a document, and asserts a version row
appears and that a `version.skipEmptyTransientCapture` diagnostic does NOT fire.

**Credentials are never printed.** No value from `.env.local` may be echoed, logged, put in
an assertion message, or embedded in a failure diff — every check is on a boolean or on
observable app behaviour, so a failing assertion cannot leak a token into CI output.

Run it against a fresh server on an isolated port, never the reused one:

```
PORT=3100 npm run dev
PORT=3100 npx playwright test e2e/version-history-documents.spec.ts --project=chromium --workers=1
PORT=3100 npm run stop
```

CI is permanently silent on this spec (§215). That is accepted and stated at the top of
the file: it exists so the claim can be re-measured by whoever has a database, rather than
looked at once.

## Docs

- `docs/open-followups.md` — §241 and §242 both close PARTIALLY. The documents pair stays
  non-restorable by design and `insights`/`documentVersions` stay uncounted by design, so
  neither heading may carry the bare word `CLOSED` (it breaks the `isClosed()` witness in
  `scripts/followup-claims-lib.mjs`). Each is a FOUR-place edit: heading, summary-table
  status cell, summary-table anchor, and the closure witnesses agreeing afterwards.
- Prose sweep. Any claim that the five array slices are "carried through from live" is now
  false for three of them — including the rewritten block in `version-diff.ts` itself and
  the §241/§242 entries. Sweep for it rather than fixing only the files this branch opens.
- `CHANGELOG.md` + the nine version sites. User-visible behaviour change → minor bump,
  `0.261.0`.

## Filed, not fixed

**§254 — `documentAssets` is absent from the version capture set entirely.**
`getVersionPayload` omits it (the save set in `use-storage-backend.ts` carries it, the
capture set does not), so image bytes are outside version history at every layer.
Plausibly deliberate — versioning blobs is a different cost question — but nothing records
the decision. File it with a reproduce command; do not fold it into this slice.

## Non-goals

- `applyDocMutation` and the document version model are untouched.
- No new UI for restoring a document version; that path already exists per document.
- The retention/pruning model is unchanged.

## Risks

- **The four flipped tests are the highest-risk edit in the slice.** They currently pass
  and describe correct-for-today behaviour; the danger is rewriting one to match the new
  code without first watching it fail for the right reason.
- `insights` gaining a diff row means the debounced detect effect's writes now register as
  meaningful change. A recompute that materially changes an insight will arm a capture
  where it previously did not. That is correct — a lifecycle change is user-visible state —
  but it will increase capture frequency on insight-heavy projects, and retention is what
  bounds that.
- `restorable: false` is a new concept with two members. If a third arrives, the rule for
  when it applies must stay "the slice has its own history and its own single writer", not
  "restoring this is awkward".
