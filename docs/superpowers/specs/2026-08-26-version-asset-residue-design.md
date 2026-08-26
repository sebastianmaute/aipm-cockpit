# Version/asset residue — §254, §255, §256, §260

**Date:** 2026-08-26
**Register entries:** [§254](../../open-followups.md), §255, §256, §260 — all filed 2026-08-26 at the
close of the version-history-completeness slice (0.261.0 "Leckie", MR !413).

**Goal:** close the four follow-ups that slice deliberately left behind, and correct the one whose
filed premise measurement refutes.

**Shape:** four independent changes on one branch, ordered so each stands alone and can be reviewed
without the others. One is a transport fix with app-wide reach; one is a pure-function extraction;
one is a test fixture; one is a comment plus its pin.

**Behaviour changes**, so this is a version bump, not refactor-only.

---

## 1 · §260 — the pipeline timeout stops at the headers

### What was filed, and what is actually true

§260 states that a restore request which never settles leaves every restore control dead for the
life of the panel, and attributes it to the absence of any `AbortSignal` or timeout on the
version-history request path. **The attribution is wrong, and the mechanism it names is covered.**

Every version-store call routes through `runTursoPipeline` (`version-store.ts` — `listVersionMeta`,
`loadVersionPayload`, `appendVersion`, `pruneVersions`, `deleteVersion`), and `turso-pipeline.ts`
already wraps `fetch` in an `AbortController` armed at `DEFAULT_PIPELINE_TIMEOUT_MS` (15s), turning
an abort into `StorageNotReadyError("storage-unreachable")`. That rejection reaches
`runExclusiveRestore`'s `finally`, which releases the guard. A hung *connection* cannot dead-lock
the panel.

A narrower defect is real, and it is **app-wide rather than history-scoped**:

```js
const timer = setTimeout(() => controller.abort(), timeoutMs);
try { return await fetch(...); }        // resolves when HEADERS arrive
finally { clearTimeout(timer); }        // ← disarmed here
```

`runTursoPipeline` then calls `await res.json()` with the timer already cleared. A server that sends
headers and then stalls the body hangs forever, on every Turso caller in the app — workspace load
and save, snapshots, chat threads, document assets, version history.

### Measured, not reasoned

| probe | result |
|---|---|
| `json()` on a `Response` whose body never completes, no signal armed | never settles (still pending at 300ms) |
| abort raised *during* an in-progress body read | rejects `AbortError` |

The first establishes the defect; the second establishes that keeping the timer armed through the
body read is a working fix. Reproduce both with a `Response` built over a `ReadableStream` that
never enqueues and never closes.

### Fix

Make `postPipeline` own the entire network exchange — arm, fetch, read the body to text, disarm in
the one `finally` it already has:

```ts
async function postPipeline(
  config: TursoConfig,
  stmts: SqlStmt[],
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; text: string }>
```

`runTursoPipeline` parses the returned text instead of calling `res.json()`.

**Rejected alternative:** returning a `{ res, cancelTimer }` disposer pair and clearing the timer in
`runTursoPipeline`'s own `finally`. One owner beats a disposer that every future caller can forget.

Three consequences, stated here rather than discovered later:

- The 401 and non-ok branches now read a body they discard. Bounded by the same timer, and it drains
  the connection rather than leaving it undrained — `rollbackBestEffort` currently never reads its
  response body at all.
- A non-JSON 200 becomes the existing friendly `"Turso returned an unexpected response shape."`
  rather than a raw `SyntaxError` escaping to the caller. This is a small improvement, not the
  motivation.
- Every Turso call in the app now fails on a stalled body instead of hanging. That is the point, but
  it does change failure timing app-wide, which is why the no-leaked-timer assertion below covers
  every exit path rather than the happy one.

### Tests

In `turso-pipeline.test.ts`, alongside the three timeout tests that already exist and use fake
timers:

1. A stalled **body** aborts at `DEFAULT_PIPELINE_TIMEOUT_MS` and is classified as
   `storage-unreachable`.
2. `vi.getTimerCount() === 0` on all four exit paths: ok, non-ok, 401, and statement-error plus
   rollback.
3. A non-JSON body yields the shape error, not a `SyntaxError`.

**Mutation proof:** restore `clearTimeout` to its old position; test 1 must go red. The existing
`"clears the abort timer once the fetch resolves"` test stays green under both the old and new
positions — it asserts no *leaked* timer after the call completes, which is true either way. That is
exactly why it never caught this, and it is worth saying so in the new test's comment.

---

## 2 · §256 — the handler and select-all must enforce one rule from one place

`restoreRecord` in `history-panel.tsx` passes a caller-supplied key straight to `restore` as
`{ [key]: "all" }` without asking whether the change carries `restorable: false`. Unreachable today,
because `version-diff-view.tsx` renders no restore button on a non-restorable row (`const revertible
= c.restorable !== false`, twice — once per layout). The invariant is therefore held by the render
path alone, while the sibling whole-state path holds it in a pure function (`selectableSelection`).

§256 records why the previous slice did not fix it: an unreachable guard cannot be tested without
first building the unreachable state. **The extraction removes that objection**, which is the reason
for this shape rather than an inline `if`.

### Fix

A pure sibling to `selectableSelection`, exported from `history-panel.tsx`:

```ts
export function recordSelection(key: string, changes: readonly VersionChange[]): RestoreSelection | null
```

Returns a single-key selection when the key names a restorable change in `changes`; returns `null`
when the key is absent from the diff, or names a change with `restorable: false`. `restoreRecord`
bails on `null` without calling `restore`, so no control can report success over a row the restore
would skip — the symptom the previous slice existed to remove.

### Tests

Pure, no rendering: restorable key → a selection carrying exactly that key; non-restorable key →
`null`; unknown key → `null`.

★ Those three do **not** pin the call site — the extracted function would still pass every one of
them with `restoreRecord`'s use of it deleted. A second test therefore drives the handler: `vi.mock`
the `./version-diff-view` module with a stub rendering a button that invokes `onRestoreRecord` with
a non-restorable key, then assert the `restore` prop is never called. The stub is necessary rather
than convenient — the real view renders no restore control on a non-restorable row, which is the
same unreachability that kept §256 open, so nothing driving the real component can reach this
handler at all.

---

## 3 · §255 — derive the fixture from the registry

`version-restore.test.ts`'s "turns no array-typed slice of the workspace into an object" is the only
protection against a `kind: "singleton"` spec landing on an array slice — a corruption that spreads
the array into an object and makes every backend drop the slice on the next save, on all six write
paths, permanently. Its assertion is already generic; its **fixture** covers 5 of the 17
`kind: "list"` specs, so the other 12 are invisible to it.

§255 records the mutation that established this, with its control: flipping `milestones` to
`kind: "singleton"` left the suite green, while the identical edit to `calendarEvents` turned it
red. The difference is that the fixture populates `calendarEvents` and not `milestones`.

### Fix

`arrays(n)` becomes a fold over `COLLECTION_SPECS.filter((s) => s.kind === "list")`, seeding one
record per key. Each record carries `id` plus every `nameField` variant the registry uses (`name`,
`title`, `key`, `label`, `reason`), with the values differing between the Old and New workspaces via
`n` so each slice produces a real diff change.

★ Do not seed Old and New identically. An identical record produces no diff change, `applyRestore`'s
singleton branch bails when the diff carries no change for that spec, and the slice is then never
walked, never corrupted, and invisible to the assertion — reproducing the exact hole being closed.

**Why derived rather than twelve literals.** A literal fixture is a snapshot: list slice 18 lands
uncovered and nothing says so, which is the same shape as the hole. The derivation is not
tautological — the seeding keys off `key` while the mutation flips `kind`, so a spec flipped to
singleton is still seeded and therefore still detectable.

**Cost, stated:** the workspace slices have distinct record types, so the fold needs one cast. It is
confined to a single expression and commented. A cast spread across the fixture would hide real type
errors and must not be how this is written.

★ `roles`, `disciplines` and `grades` are reference data and are excluded from
`isEmptyWorkspacePayload` (§242), but they are ordinary `kind: "list"` registry rows here and are
corrupted by the same mutation. They belong in the fixture. The §242 exclusion does not carry across
— the two lists answer different questions.

### Mutation proof

All 17 list specs, not a sample: for each, an anchored `sed` flips that spec to `kind: "singleton"`,
the single test file runs and must exit non-zero, an anchored inverse write reverts it, and
`git diff --stat` must be empty before the next iteration. The report quotes the count the loop
actually produced. `calendarEvents` is the known-red control; a run in which it does not go red
means the harness, not the fixture, is what is being measured.

---

## 4 · §254 — record the decision at the site

`getVersionPayload` (`task-manager.tsx`) enumerates its slices literally and `documentAssets` is not
among them, while the save set in `use-storage-backend.ts` carries it. Document image bytes are
outside version history at every layer: not captured, not diffed, not restorable.

§254's judgement is that this is plausibly deliberate and that nothing records the decision — no
comment, no `restorable: false` row standing in for it, no test asserting the absence. This spec
**honours the register's own decision**: leave `documentAssets` out, and close the entry by writing
the reason down rather than by adding the slice. A capture carrying image bytes changes the cost of
every autosave-triggered version on a Turso project, and that is a measurement, not a docs task. If
it is ever added, the metadata slice and the byte side table must be decided separately — metadata
is small and diffable, bytes are neither.

### Fix

A comment at `getVersionPayload` giving both reasons (blob storage cost per capture is a different
question from JSON cost; the asset table is Turso-side with its own lifecycle) and naming the
user-visible asymmetry: deleting an image from a document **is** captured, because the referencing
block changes and `documents` is diff-visible, but restoring that version cannot bring the bytes
back — `documents` is `restorable: false` and `documentAssets` is absent from the payload entirely.
Two independent reasons for one outcome.

### Test

In `task-manager.restore-backfill.test.tsx`, one test over the parsed payload's key set: it
**excludes** `documentAssets`, and **includes** `documents` as the positive control. The control is
load-bearing — an absence assertion alone passes against a fixture that never built a payload at
all.

---

## 5 · Closing out

**Prose sweep.** The transport behaviour changes, so any prose stating or implying that the Turso
timeout covers a whole request is now false. Sweep for it and correct what is found, in the same
commit as the change.

**Register.** §254, §255 and §256 close in place with the `— CLOSED` heading marker. §260 is
rewritten first to record that its filed premise was **refuted by measurement** — the connection
half was already covered, the body half was not — and then closed against the transport fix. The
correction is the point of the entry, not an embarrassment to be quietly dropped: it was filed by a
cold review reasoning from source, and it says so.

**Release.** Behaviour changes on an app-wide code path, so `version.ts` bumps, `CHANGELOG.md` gains
an entry, and `npm run version:sync` propagates to the six satellites.

---

## Verification

Every local gate before the MR: `npx tsc --noEmit` · `npx eslint src scripts e2e` ·
`npm run test:run` · `npm run test:shuffle` (tests are added and reordered here) ·
`npm run version:check` · `npm run docs:claims:check` · `npm run docs:symbols:check` ·
`npm run size:check` · `npm run dup:check`. Exit codes read unpiped, never through a pipe.

Coverage: `turso-pipeline.ts`, `history-panel.tsx` and the version modules are all coverage-gated
`src/**` files, so `npm run test:coverage` must stay above the floors in `vitest.config.ts`.

No axe run is required — none of the four changes alters rendered markup. `recordSelection` changes
when a control acts, never what it announces.
