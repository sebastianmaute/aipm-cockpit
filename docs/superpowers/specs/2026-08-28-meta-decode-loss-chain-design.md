# Meta-blob decode loss: the three-link chain — design

**Date:** 2026-08-28
**Branch:** `fix/meta-decode-loss-chain`
**Register:** a NEW entry for the chain; `docs/open-followups.md` §98 corrected in place.

## Summary

A malformed `documents` meta blob in a Turso database is silently discarded at
load, persisted as an intentional empty by the next ordinary save, and seen by
neither save-time data-loss guard. The result is permanent, irreversible loss of
every project document, with no diagnostic at any layer.

This slice fixes all three links. Each is independently shippable and the value
drops off sharply after the second: **A** and **B** stop the destruction, **C**
is the net that should have caught it regardless.

## How this was found, and what is actually established

The slice began as `docs/open-followups.md` §98, which describes the two
SAVE-time counters (`nonEmptyCollectionCount`, `workspaceRecordCount`) ignoring
several live slices, and records **"no known live path"**. That claim is false,
but not in the way the entry implies: the path does not start at the counters.
They are the third link.

★★★ **THE CHAIN IS ESTABLISHED BY READING CODE AND UNIT-LEVEL FACTS, NOT BY
EXECUTION.** No step here was run end-to-end against a live Turso database, and
CI has none (§215), so nothing in this repo can execute it. Every claim below
carries the command that produced it; the end-to-end proof stays OWED and is
recorded as owed in the new register entry. Do not let a green suite imply it.

### Link 1 — the load silently discards eleven meta slices

`rowsToWorkspace` (`turso-schema.ts`) decodes its meta-blob slices inside
`try`/`catch` pairs whose `catch` bodies are a bare "malformed" comment and
nothing else. **ELEVEN such catches exist and not one calls `diag`**, although
`diag` is a parameter in scope and is passed to the sanitizer on the line above.

★★ COUNT THEM BY THE `catch`, NOT BY THE COMMENT WORDING. Nine say "malformed —
leave undefined"; two say "leave the emptyWorkspace() default" and "leave default
(undefined)". A first draft of this spec grepped the nine-way wording and scoped
fix A to nine sites, silently exempting two equally-silent catches. Both greps
below, or the narrow one lies by omission:

```bash
grep -c "// malformed" src/app/turso-schema.ts
grep -c "malformed — leave undefined" src/app/turso-schema.ts
grep -A3 "// malformed" src/app/turso-schema.ts | grep -c diag
```

Measured 2026-08-28: **11**, **9**, and **0**. Fix A covers all eleven.

A `JSON.parse` throw on the `documents` row therefore leaves `ws.documents`
undefined and says nothing. The load then proceeds, because `isWorkspaceEmpty`
refuses only a TOTALLY empty read and the entity tables came back populated.

**The JSON path is the contrast, and it is deliberate.** `jsonToWorkspace`
(`workspace.ts`) handles the same field's failure by emitting
`logDiag("error", "workspace.documentsDropped", …)`, under a comment that states
the posture outright: *"a user who opens a file and finds no documents has
something to find."* Same field, same failure class, opposite behaviour. The
precedent for A already exists in-repo and is followed, not invented.

### Link 2 — a read failure becomes a permanent write loss

`workspaceToStatements` (`turso-schema.ts`) emits a `DELETE FROM` for every DIRTY
table and then re-INSERTs only the rows it has. `meta` is in `TABLE_NAMES`, and an
empty or absent `documents` writes no row at all — pinned today by
`turso-schema.documents.test.ts`'s "writes no documents meta row when the array
is empty". So the malformed blob is deleted and nothing replaces it.

```bash
grep -n "DELETE FROM" src/app/turso-schema.ts
grep -n "TABLE_NAMES: readonly" src/app/turso-schema.ts
```

The first returns ONE line, guarded by `isDirty(name)`; the second shows `meta`
as a member.

★★★ **THE TRIGGER REQUIRES NO DOCUMENTS ACTION, AND THAT IS THE PART THAT MAKES
THIS SEVERE.** `meta` is dirty when ANY of its twelve slices changes reference,
and `activityLog` is one of them — auto-appended by ordinary use. So the next
thing the user does in the app destroys the row. A reader who assumes the user
must delete something to lose it will mis-rank this entry.

### Link 3 — the loss is invisible at the save choke point

The save effect (`use-storage-backend.ts`) computes `nonEmptyCollectionCount` and
`workspaceRecordCount` over the outgoing workspace and applies two invariants:
**L3** (`curCollections === 0` while the previous count was ≥2) and **Layer B**
(`isMassDeletion` — at least 5 records removed leaving at most 10%). `documents`
contributes ZERO to both, so a save that drops every document leaves the previous
and current totals equal and neither fires.

The `Workspace` type has **20** array-typed slices; the counters enumerate **13**.
The seven uncounted are `features`, `knowledgeItems`, `insights`, `activityLog`,
`documents`, `documentVersions`, `documentAssets`.

★★ §98 itself names "five" and lists `timelogLinks` and `settingsOverrides` among
them. Those two are object-typed, not arrays, so "count its records" does not mean
the same thing for them, and the entry omits `documentVersions`, `documentAssets`
and `features` entirely. Correct the entry rather than inheriting its list.
Reproduce the real set with a script over the `Workspace` type's array-typed
members — the plan carries the exact invocation.

## A — make the eleven swallows loud

Each of the ELEVEN catches emits `logDiag("error", …)` naming the slice that failed
to decode, mirroring `workspace.documentsDropped`. Purely additive: no behaviour
change, no threshold change, no new failure mode.

★ The catch must stay a catch. Rethrowing would make one corrupt slice discard the
whole workspace, which is the failure `jsonToWorkspace`'s own scoping comment
warns against — that a broader catch would make real file corruption survivable,
which is what its `strict` mode exists to prevent. Same reasoning, read from the
other side.

## B — a decode failure is an INCOMPLETE LOAD, not an empty slice

Route it into the EXISTING §103 guard (`use-load-truncation.ts`) rather than
inventing a second mechanism. That guard is the same defect one layer up — its own
header says so: *"an over-cap load truncates the documents array, and the next
AUTOMATIC save commits that loss permanently."* It already owns every part this
needs:

- a persistent banner carrying the MAGNITUDE (a count in a 7s single-slot toast is
  gone before the user reads the banner — the guard's own comment records that),
- a save lockout, `mayCommitAfterTruncation()`, consulted by the save effect,
- ★★★ a user-reachable escape, `allowTruncatedSave()`. **This is not optional.**
  The guard's own comment states the rule: without a visible way out, a sticky flag
  is a permanent save lockout — a worse defect than the one being fixed. A decode
  failure is MORE sticky than a truncation, because the user cannot repair a
  corrupt blob from inside the app at all.

`rowsToWorkspace` accumulates which slices failed to decode; the Turso backend
exposes that beside `lastLoadTruncation`; `reportFor` carries it as a third signal
so it cannot drift from the load it describes.

### The census this rides, and why it is widened here

`reportFor` deliberately bundles independent signals so they cannot drift apart,
and a source-scanning census in `use-load-truncation.test.ts` is what catches a
load path that forgets to call it. That census reads a HARDCODED `OPS_FILES`
holding two files, and `use-storage-backend.ts` — three of the six load sites — is
not among them.

```bash
grep -n "OPS_FILES *=" src/app/use-load-truncation.test.ts
for f in src/app/use-storage-backend.ts src/app/use-storage-file-ops.ts src/app/use-storage-turso-ops.ts; do
  echo "$f loads=$(grep -o '\.load()' $f | wc -l) reports=$(grep -o 'reportFor(' $f | wc -l)"
done
```

Measured 2026-08-28: `OPS_FILES` holds the file-ops and turso-ops files only, and
`use-storage-backend.ts` reports **loads=3 reports=2** while unseen by the census.

★★★ **THE 3/2 IS NOT A BUG, AND WIDENING `OPS_FILES` NAIVELY GOES RED ON CORRECT
CODE.** The unreported load is `onOpenStorageFile`, which carries a documented
reason: it applies tasks and RAID ONLY and never the loaded documents, so raising
the flag would warn about documents the user still has and lowering it would clear
a warning still true of the live ones. The census therefore needs a MARKED
EXEMPTION — the same shape as `ABSENCE_MARKERS` in `check-agents-symbols.mjs`,
where a deliberate absence is declared NEAR the site and the scanner honours it.
Widening without that mechanism produces a red gate on correct code, which is how
a gate gets weakened to make a pipeline pass.

★ B's own signal does not need that third load site: meta blobs are Turso-only, so
decode failures arise at the two load sites that ALREADY call `reportFor`. The
census is widened as the guard against a FUTURE path forgetting, not to cover this
one.

## C — classify the slices, then stop the list rotting

**The rule, stated once:** a slice counts toward the SAVE-time guards iff it holds
user-authored records that cannot be regenerated, AND its size is not driven by
automatic append.

| Slice | Counts | Why |
|---|---|---|
| `documents` | yes | user-authored, unrecoverable |
| `knowledgeItems` | yes | user-authored, unrecoverable |
| `documentAssets` | yes | user-uploaded bytes' metadata, unrecoverable |
| `activityLog` | **no** | auto-appended by ordinary use |
| `documentVersions` | **no** | auto-captured, pruned by retention |
| `insights` | **no** | derived by detection, regenerable |
| `features` | **no** | config, not records |

★★★ **THE EXCLUSIONS ARE LOAD-BEARING, NOT LAZINESS, AND ONE OF THEM WOULD
DISABLE A GUARD OUTRIGHT.** Adding `activityLog` to `nonEmptyCollectionCount`
means the current collection count can never reach 0 in a project that has ever
been used, so the L3 full-wipe invariant could NEVER FIRE AGAIN. Adding it to
`workspaceRecordCount` dilutes the mass-deletion fraction until Layer B stops
firing too. Both convert a data-loss guard into a data-loss vector — the identical
inversion `isWorkspaceEmpty` already documents for itself and warns against
"completing". `documentVersions` prunes by retention, so counting it would make an
ordinary prune read as a mass deletion and refuse a legitimate save.

### The false refusal C creates, and its fix

Adding `documents` to `workspaceRecordCount` means deleting five or more documents
from a documents-heavy project can trip Layer B. The documents delete path does
NOT arm the one-shot bypass:

```bash
grep -rn "allowDestructiveSave" src/app/documents-panel.tsx src/app/document-*.tsx
```

Measured 2026-08-28: no matches.

So C MUST arm `allowDestructiveSave()` on the documents and knowledge delete
paths, exactly as `use-bulk-operations.ts` already does for clear-all and bulk
delete. Widening the counters without this ships a bug — a user deleting their own
documents would be told the save was refused.

### The forcing function

A registry test asserting every `Workspace` array slice carries a recorded
decision (counted, or excluded WITH its reason). A new slice fails the suite until
someone decides.

★★ It is a TEST and not a comment because the comment already exists and did not
work: `workspace-metrics.ts` carries a "Deliberately NOT added … See §98" note
today, and the omission still went unexamined long enough to become this entry.

## Testing

Per-slice, in BOTH directions:

- each ADDED slice: a test proving the guard now fires on its loss, AND a test
  proving a legitimate user delete is still allowed (bypass armed),
- each EXCLUDED slice: a test pinning the exclusion and its reason, so a later
  "completion of the pattern" goes red instead of silently defeating a guard,
- link 1: `rowsToWorkspace` against a malformed blob emits the diag and leaves
  sibling slices intact,
- link 2: a workspace whose slice failed to decode does not emit the destructive
  delete-and-reinsert pair for `meta`,
- the guard's lockout AND its escape.

★ The excluded-slice tests are the ones that matter most and are the easiest to
write vacuously. Each must be mutation-checked: make the mutant (add the slice to
the counter) and confirm the test goes RED. A test that passes with the exclusion
removed pins nothing.

## Non-goals

- Not fixing §150, and not fixing §152 beyond the census widening B requires.
- Not touching `isWorkspaceEmpty`. Its `documents` inclusion and its `activityLog`
  exclusion are both already correct and both already reasoned in place.
- Not adding `insights` to any counter.
- Not attempting an end-to-end live-Turso proof. CI has no database (§215); the
  proof is recorded as OWED, not faked.

## Register changes

- NEW entry: the load-swallow to destructive-rewrite chain (links 1 and 2), with
  the owed end-to-end verification stated as owed.
- §98: dated correction replacing "no known live path", correcting the "five"
  slice list to the measured seven arrays, and pointing at the new entry. The
  entry stays SCOPED to the counters, which is what it is actually about.
- Both carry a conforming `**Status:**` line — the `followups-status-check` gate
  is blocking as of 0.263.0.

## Version

B changes user-visible behaviour (a banner, and a save that can now be withheld),
so this bumps. A and C alone would not.
