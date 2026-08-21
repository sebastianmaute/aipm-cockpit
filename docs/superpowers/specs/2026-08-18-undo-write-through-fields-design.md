# Undo must not clobber write-through fields — Design

**Date:** 2026-08-18
**Closes:** `docs/open-followups.md` §50 (open, pre-existing, DATA LOSS)
**Base:** 0.245.0 "Buckell" (`49ed5b56`)

---

## Problem

Undoing a bulk edit restores a whole-row before-image, so it silently discards
anything a *different* writer changed on those rows between the op and the undo.

`undo-stack.ts` `applyUndoRestoreWithRemap`, edit branch:

```ts
out[out.findIndex((r) => r.id === item.id)] = item;   // whole-row replace
```

`applyUndoForward` (redo) carries the same shape:

```ts
const idx = out.findIndex((r) => r.id === item.id);
if (idx !== -1) out[idx] = item;
```

Two field families are written outside the op that captured them, and both are lost.

### 1. Note logs — user-typed text

`Task`, `RaidItem` and `ChangeItem` each carry `noteLog?: NoteLogEntry[]`
(`grep -cF 'noteLog?: NoteLogEntry[]' src/app/types.ts` → **3**). The notes window is
owned above every panel and commits write-through, so:

> select 3 RAID rows → bulk-set severity → open notes on one → add a note → Ctrl+Z → **the note is gone.**

Redo brings it back, but only an immediate one, which also re-applies the bulk edit
the user was undoing. §50 states this; it is restated here because an earlier revision
of that entry claimed redo did *not* recover the note, and a test written to that
claim fails against correct code.

**Verified this session, where §50 left it open:** the task half is real, not merely
"very likely". `use-bulk-operations.ts:257` captures `beforeRows = tasks.filter(...)` —
whole rows, the same shape as RAID and changes.

### 2. `outlookEventId` — a duplicate meeting in a real calendar

Background calendar push/pull stamps `outlookEventId` onto live rows through functional
setters: `use-entity-calendar-push.ts:89`, `use-outlook-calendar-push.ts:60`,
`use-milestone-calendar-pull.ts:87`, `use-committee-outlook-push.ts:106`.

So: bulk-edit some tasks → the auto-sync timer pushes them → Ctrl+Z → the before-image
restores `outlookEventId: undefined`. The Outlook event still exists; the row has
forgotten it; **the next push creates a duplicate event in the user's calendar.**

This one needs no user race at all — the background timer supplies the concurrent write —
and it reaches entities with no note log (milestones, absences, committee meetings).

### Why the per-field path is immune

`captureFieldEdit` (`use-undo-stack.ts:595`) never builds a `BeforeImage`. It merges:

```ts
const merge = (patch: Partial<T>) =>
  setter((prev) => prev.map((r) => (r.id === id ? stamp({ ...r, ...patch }) : r)));
```

Merge semantics already work in this engine. That is the whole basis of Part B below.

---

## Scope

**In:** both fields, both directions (undo and redo), every whole-row edit-image path;
plus converting the `bulk.edit` capture sites that are field patches to field-patch captures.

**Out:**

- §168 (template import drops note logs) — same symptom, different cause (a DOM-free
  sanitizer that cannot carry rich HTML). Coupled to §36(a); its own slice.
- §148 (`retryLoad` clobbers a concurrently-minted chat thread) — unrelated machinery.
- Widening undo semantics beyond the two mechanisms below.
- The `stampField` / `localModifiedAt` question. `NEVER_CAPTURE` already excludes it
  from field capture; whole-row restore still reverts it, and that is correct — the
  stamp describes the row's own last edit.

---

## Part A — engine-level preserve list (the backstop)

`applyUndoRestoreWithRemap` and `applyUndoForward` each take a **required**
`preserve: readonly string[]`. The edit branch in both stops replacing and instead lets
the live row win on those keys.

**Required, not optional-with-empty-default.** A future call site that forgets the
argument is then a typecheck error rather than a silent reopening of this bug. The pure
engine stays generic, i18n-free and clock-free: it receives key *names* as data and
never names them itself.

`applyUndoRestore` (the non-remap wrapper) has **zero production callers** —
`grep -rn "applyUndoRestore\b" src/app | grep -v "\.test\."` returns only the engine's
own declaration and docstrings — so widening its signature costs nothing but its tests.

### The list

```ts
// use-undo-stack.ts — the layer that already imports app types.
/** Fields written to a live row by something OTHER than the op that captured it.
 *  A whole-row undo must let the live value win, or it reverts a write the user's
 *  undo was never about. */
const WRITE_THROUGH_FIELDS = ["noteLog", "outlookEventId"] as const;
```

Passed at the four runner call sites: two in `fragmentUndoRunner`
(`use-undo-stack.ts:199` restore, `:206` forward) and two in `capturePart`'s `restore`
(`:299` restore, `:306` forward).

### Two edge cases a naive spread gets wrong

**Preservation must not INVENT a key.** `{ ...item, noteLog: live.noteLog }` sets an
*explicit* `undefined` key when neither row has one, which changes `Object.keys` — and
`rowsEqual` in this same file compares `Object.keys(a).length` to confirm a row's identity
before redo removes it (the guard protecting an unrelated live row that reused a freed id).

★ **Honest scope: I have not demonstrated a reachable defect through that guard.** The
obvious sequences are closed because `pushEntry` clears the redo stack on every fresh
capture, and an id claimed by a delete-image is never touched by the edit branch. So this
is avoiding a needless hazard in a shared engine, not fixing a known break — do not write a
test claiming to reproduce one. The rule is simply that the result carries exactly the keys
one of the two rows had: copy when the live row has it, **delete** when only the image has
it, and leave it absent when neither does.

**Live wins even when live is emptier.** Notes deleted after the bulk edit stay deleted; an
`outlookEventId` cleared by a 404 (`use-entity-calendar-push.ts:90` sets `undefined` so the
next push re-creates) stays cleared. Undoing a severity change must resurrect neither.

---

## Part B — field-patch captures for the bulk-edit sites (the right shape)

The merge fragment already exists. `captureFieldPart` (`use-undo-stack.ts:377`) builds a
composite fragment that reverts N rows by merging a patch onto each live row, in one
setter pass. It is tested and already used in production by `use-task-submit.ts`.

Its docblock names this conversion as *"the obvious §50 fix"* and names the trap it
creates. Part B does exactly that, for the `bulk.edit` capture sites that are field
patches. Enumerate with:

```bash
grep -rn 'kind: "bulk.edit"' src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

| Site | Who owns the patch |
|---|---|
| `use-bulk-operations.ts:260` (tasks) | the hook itself — `updates` + status, already built |
| `use-bulk-operations.ts:285` (tasks + bucket move) | same, via `commitBuckets`' `tasksPart` |
| `milestones-panel.tsx:216` | the panel's `applyBulk(changes)` |
| `use-resource-planner.ts:264` (RAID) | **the panel** — `raid-panel.tsx:308` `applyBulk` |
| `use-change-log.ts:137` (changes) | **the panel** — `change-panel.tsx:272` `applyBulk` |
| `use-stakeholders.ts:84` | **the panel** — `stakeholders-panel.tsx:197` `applyBulk` |

`use-alloc-plan.tsx:247` and `use-resource-directory.ts:280` also carry the kind but are
whole-row replacements, not field patches, and stay on `capturePart` — Part A covers them.

### The call-site change

Three of the six capture through `onCaptureBulk?.(ids)`, which receives **ids only**:

```ts
const captureRaidBulkUndo = useCallback((ids: readonly number[]) => {
  const edited = raid.filter((r) => ids.includes(r.id));
  if (edited.length) captureRef.current?.({ setter: setRaid, kind: "bulk.edit", edited, fromArray: raid, entityKey: "raid" });
}, [raid, setRaid]);
```

The panel knows the patch and the hook does not, so the contract widens: the panel computes
one `{ id, before, after }` per selected row from the fields it is about to write, and the
hook builds a field part from that. The panel already derives the patch row-by-row
(`raid-panel.tsx` `applyBulk` builds `patched` per row), so `before` is `pick(item, keys)`
and `after` is `pick(patched, keys)` over the same key set.

### Two hazards, both already documented in the code

**1. The `isPrimary` trap.** `compositeUndoRunner` falls back to fragment 0 when nothing is
flagged, and `captureFieldPart` hardcodes `isPrimary: false` and publishes no id-remap. So a
field part sitting first in a composite that also holds a `capturePart` cascade becomes the
nominal primary, leaves `primaryRemap` empty, and points every `fkRemapField` cascade at
stale ids **with no error**. `use-bulk-operations.ts`'s bucket composite has the whole-row
`tasksPart` at `parts[0]` — converting it reproduces this shape exactly. The remaining
`capturePart` is flagged `isPrimary: true` in the same edit.

**1b. A single-array field capture needs its own entry point.** `captureFieldPart` returns a
`CompositeFragment`, and the only way to push one today is `captureComposite` — which drags
in both the `isPrimary` fallback above and the missing `entityKey` below for five sites that
have no second array at all. So `UndoStackApi` gains `captureFieldRows` (one array, N rows,
one entry, carries `entityKey`), built on `captureFieldPart` so there is still one merge
implementation. Only the tasks-plus-bucket-move branch stays a real composite.

**2. `CaptureCompositeOpts` has no `entityKey`** (`use-undo-stack.ts:411`). `buildUndoLabel`
resolves the entity from the kind's prefix, `"bulk"` is not in `ENTITY_KEY_SET`, and the
bulk branch needs an explicit key — so routing a bulk edit through a composite downgrades
its label from `Edit 3 RAID items` to `Edited 3 item(s)`. `use-task-submit.ts:314` records
this as a known cost and a follow-up. Part B closes it: add `entityKey?: UndoEntityKey` to
`CaptureCompositeOpts` and forward it — `pushEntry` already accepts `{ name, entityKey }`.

### Why both parts, and not either alone

They cover different sets and neither is a superset.

- **A alone** fixes both fields on all whole-row edit paths, including the reference-data
  cascades, dedup and alloc plan that B cannot express as patches — but only for fields on
  a hand-maintained list a future write-through field can silently escape.
- **B alone** makes the bulk sites immune by construction, with nothing to maintain, and
  preserves *every* concurrent edit rather than two named fields — but leaves
  `outlookEventId` clobbered on the cascade, dedup and alloc-plan paths, so §50 does not close.

A is the backstop; B is the correct shape where the op is a field patch. After both, the
list protects only the paths that genuinely replace whole rows.

---

## Testing

**Pure engine** (`undo/undo-stack.test.ts`): preserve in both directions; live key present;
live key absent while the image has it (assert `"noteLog" in result === false`, not merely
`undefined` — the weaker assertion passes against the spread bug); key absent from both
rows (same assertion, and this is the one that pins "never invent a key"); live emptier than
the image; and one test proving `applyUndoForward`'s `rowsEqual` identity guard still fires
after preservation — a non-regression check, not a reproduction of a known break.

**Per register** — one integration test each for tasks (`use-bulk-operations.test.tsx`),
RAID (`use-resource-planner.undo.test.tsx`) and changes (`use-change-log.test.tsx`):

> bulk apply → **then** add the note → undo → assert the note survives and the bulk field reverted.

★ Seed the note **after** the apply. A fixture that seeds it before passes against unfixed
code — the §48 trap, which §50 restates and which this repo has now paid for twice.

**Redo leg:** bulk edit → note A → undo → note B → redo → assert B survives *and* the bulk
field re-applied. Without the `applyUndoForward` half this test fails.

**`outlookEventId`:** drive the push setter between apply and undo, then assert the id
survives the undo. This is the case with no note log involved and the one that reaches
milestones.

**Label non-regression** (Part B): assert the undo meta label still names the entity after
the composite conversion — the `entityKey` forward is what keeps it, and nothing else in the
suite would notice it going generic.

---

## Release

Behaviour fix → version bump across the eight sites AGENTS.md lists: `src/app/version.ts`
(`APP_VERSION` + `APP_BUILD_DATE` + milestone), `CHANGELOG.md`, `package.json`,
`package-lock.json` (**two** occurrences), the README shields badge (version **and**
codename), and the generated header on all five `docs/CODEMAPS/*.md`. Codename re-checked
against `CHANGELOG.md` immediately before use, never reserved in advance.

### Docs this slice owes

- **Close §50**, recording that the task half is now verified rather than suspected.
- **Correct `captureFieldPart`'s docblock** — it says §50's task half is "UNVERIFIED … do
  not cite this as a known task defect". Measured false this session.
- **Correct `use-task-submit.ts:314`'s** "`CaptureCompositeOpts` has no such field" once
  Part B adds it, and retire the follow-up note beside it.
- **Correct §87** ("AI cannot read the activity log — deliberate, no tool exposes it").
  B2a shipped `search_history` (`chat-tool-defs.ts:397`) and `getActivityLog()` on
  `ToolDispatcher`. Unrelated to this slice, found while surveying the register; corrected
  here because the rule is to fix what you disprove in the same commit.
- **Record B's residue as a new entry:** the whole-row paths that remain (reference-data
  cascades, resource directory, dedup, alloc plan, task-dependency stripping) still revert
  every concurrent edit outside the preserve list. Not a defect this slice introduces — the
  scope it deliberately leaves.
