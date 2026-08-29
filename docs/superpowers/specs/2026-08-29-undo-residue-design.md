# Undo residue — §177 · §178 · §179 · §180 · §181

**Date:** 2026-08-29
**Register entries:** `docs/open-followups.md` §177, §178, §179, §180, §181
**Branch:** `fix/undo-residue-preservation`

## Goal

Close the five undo-residue entries §50 deliberately deferred. Four are code fixes; one (§181) is a
measurement whose outcome may legitimately be "no code change".

## Why now, and what changed since the entries were written

Three of the five carry a deferral argued rather than measured. Reading the current tree, two of
those arguments no longer hold and one holds only in half:

- **§178** is framed as needing a new patch model (`{path, before, after}` instead of
  `{field, before, after}`) and a new restore runner. It does not. The patch already carries BOTH
  ends — `captureFieldPart`'s `restore` applies `e.before` and its `forward` applies `e.after` — so
  the keys the op actually touched are recoverable at restore time by diffing the two. No data-model
  change is required.
- **§179** says "the fix is not 'pass `preserve` to `rowsEqual`'" because the guard exists to stop a
  redo destroying an unrelated live row that reused a freed id. But equality-modulo-write-through-
  fields IS an identity notion strictly between whole-row equality and id-alone, which is what that
  entry asks for. A row that merely recycled a freed id differs on ordinary content fields, so it
  stays caught.
- **§180** says fixing it means "threading the per-entity `FieldGroup[]` through `captureFieldRows`
  to every one of the converted call sites — a change to the shared capture contract". The threading
  is real, but the contract change is not: `changedFieldGroups` already takes and honours groups on
  the single-row path (`captureFieldChanges`), and only the BULK builder is group-blind. The fix is
  to give `buildBulkFieldEdits` the parameter its sibling already has.

★★ These are re-readings, not measurements. Each is proved or refuted by a committed test in this
slice BEFORE the corresponding fix lands. If a probe refutes one, the entry keeps its deferral and
this spec is wrong about it — say so in the register rather than forcing the fix.

## The two capture paths (the fact the whole slice turns on)

| path | builder | groups honoured? |
|---|---|---|
| single-row modal save | `captureFieldChanges` → `changedFieldGroups(prev, next, groups)` | yes |
| bulk edit | `buildBulkFieldEdits(rows)` | **no** |

Reproduce:

```bash
grep -rn "buildBulkFieldEdits" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'
grep -n "export function buildBulkFieldEdits" -A 6 src/app/undo/field-groups.ts
grep -rn "UNDO_GROUPS" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'
```

## File structure

Two new pure leaf modules. Nothing new lands in `use-undo-stack.ts` beyond an import and a call —
it sits at 728 lines against the 800 ratchet, leaving roughly 15 lines of budget.

| file | status | responsibility |
|---|---|---|
| `src/app/undo/write-through-fields.ts` | new | §177a. Sole authoring site for the write-through list. Exports the tuple (carrying today's `satisfies` constraint) and the derived `Set`. Imports only `types.ts`, so `field-groups.ts` can consume it without reaching the hook. |
| `src/app/undo/merge-field-value.ts` | new | §178. Pure `mergeFieldValue(target, other, live)`. No React, no i18n, no DOM. |
| `src/app/undo/field-groups.ts` | edit | §180 group completion; drops its private `WRITE_THROUGH_KEYS` copy; exports `differs` |
| `src/app/undo/undo-stack.ts` | edit | §179 preserve-aware identity in the delete filter |
| `src/app/undo/use-undo-stack.ts` | edit | §178 wiring in `captureFieldPart`; drops its private `WRITE_THROUGH_FIELDS` copy |
| six bulk-edit call sites | edit | §180 pass the entity's groups |
| four register bulk sites | edit | §181 — **only if the probe confirms** |

Dependency direction is one-way and acyclic:
`use-undo-stack.ts` → `merge-field-value.ts` → `field-groups.ts` → `write-through-fields.ts` → `types.ts`.

`differs` is exported from `field-groups.ts` rather than copied into the merge module — `dup:check`
compares total duplicated LINE percentage across all formats, and a second copy of a structural-
equality helper is exactly the shape that moves it.

## §177a — one source for the write-through list

`WRITE_THROUGH_FIELDS` (`use-undo-stack.ts`, governs what a whole-row undo PRESERVES) and
`WRITE_THROUGH_KEYS` (`field-groups.ts`, governs what a bulk field patch CAPTURES) are both
hardcoded to `["noteLog", "outlookEventId"]`. They are deliberately separate constants because
`field-groups.ts` must not import the hook — but a third write-through field means editing both by
hand, and nothing enforces they agree.

A leaf module both can import removes the constraint that forced the split. The `satisfies` tuple
constraint moves with the declaration unchanged: it is load-bearing, because the list is applied to
entity types carrying NEITHER key (roles, grades), which a `keyof T` parameter could not accept.

★ This is §177a only. §177b — converting the remaining whole-row capture sites (reference-data
cascades, resource directory, task dedup, alloc plan, the buckets half of the tasks composite,
dependency stripping on delete) to field patches — stays OUT. That is a sweep across six subsystems,
not a fix, and §50's own reasoning for deferring it still applies.

## §178 — per-key and per-member preservation

`mergeFieldValue(target, other, live)` is called once per patch key. `target` is the end the
undo/redo is moving the row toward; `other` is the opposite end. A key where `target` and `other`
agree was never the op's, so `live` keeps it.

Undo is `merge(before, after, live)`. Redo is `merge(after, before, live)`. One function, both
directions.

| value shape | behaviour |
|---|---|
| both plain records | Start from `live`. For each key where `differs(target[k], other[k])`, write `target[k]` — or delete the key when `target` does not carry it. Keys the op never touched keep `live`'s value. |
| both arrays | order-preserving three-way merge, below |
| anything else — scalars, `null`, shape mismatch, `live` of a different shape | return `target`, i.e. today's behaviour unchanged |

**Array merge.** `opAdded` = members of `other` absent from `target`; `opRemoved` = members of
`target` absent from `other`; membership by structural equality. Remove each `opAdded` member from
`live`, then re-insert each `opRemoved` member anchored to its nearest surviving predecessor in
`target` (head when none), walking `target` in order so multiple re-insertions stack. Concurrent
additions keep their relative order.

**Duplicate fallback.** If `target` or `other` holds duplicate members, return `target` wholesale.
Anchoring is ambiguous with duplicates, and a silent wrong answer is worse than today's known-coarse
one. Recorded in the module docstring, not only here.

**Nesting.** Per-key at the TOP level of the field value only. A nested object is compared
structurally and replaced wholesale. Deeper recursion is not in scope and the docstring says so.

**The property that bounds the blast radius.** When `live` deep-equals `other` — nothing raced — the
result deep-equals `target`. Every non-racing undo in the app therefore behaves exactly as it does
today, and the change is observable only in the race this entry is about.

Reachable case being closed, from §178: RACI panel → Suggest RACI → apply across stakeholders (one
`bulk.edit` whose changed field is `raci`) → user assigns a cell for a DIFFERENT milestone on one of
those stakeholders → Ctrl+Z. Today the hand-assigned cell vanishes with the suggestion.

## §179 — preserve-aware delete identity

`applyUndoForward`'s delete filter confirms a row's identity by whole-row deep equality against the
capture-time image before removing it. A write-through field written onto a RESTORED row breaks that
equality, the redo declines to remove the row, and the next undo takes the id-reuse path and splices
a second copy in under a fresh id — a duplicate register row from three keystrokes and one note.

The filter moves to `rowsEqualExcept(r, recovered, preserve)`, ignoring the preserve keys at the top
level of the row. `applyUndoForward` already receives `preserve`.

Two residues, documented rather than fixed:

- A recycled-id row differing from the recovered image ONLY on write-through fields is still
  destroyed. Reaching that needs a new row whose every ordinary field coincidentally matches a
  deleted one.
- After a redo removes the row, a later undo restores the capture-time image, so a note added
  between undo and redo is lost. A delete-image has no live row to preserve from; this is inherent
  to the delete branch, not to the change.

The recycled-id guard is what the identity relaxation could break, so it gets its own test that must
go red if the new predicate ignores too much.

## §180 — group completion in the bulk builder

After `buildBulkFieldEdits` computes its `changed` key list, expand it: any group with at least one
member in `changed` contributes all of its members, still filtered by `NEVER_CAPTURE` and the
write-through keys.

`groups` becomes a **required** parameter. Only TWO of the six call sites pass a non-empty constant
(tasks and changes); the other four pass lists that are empty today — `RAID_UNDO_GROUPS`,
`MILESTONE_UNDO_GROUPS` and `STAKEHOLDER_UNDO_GROUPS`, the last of them twice. So an optional
parameter would be omitted at four of six sites and a future coupling silently missed by whoever
copied a neighbour. Required means a new entity must state its answer.

★★ The asymmetry is total and that is the argument for the fix. EVERY entity constant is already
passed on the single-row path — tasks, changes, milestones, stakeholders, RAID, resources and
calendar events all hand their groups to `captureFieldChanges`. NOT ONE is passed on the bulk path,
because the builder has nowhere to take it. So this is not "introduce group awareness"; it is
"stop the bulk path being the one place that drops it".

```bash
grep -rn "UNDO_GROUPS" src/app --include=*.ts --include=*.tsx | grep -v "undo/field-groups"
```

★ `RESOURCE_UNDO_GROUPS` reaches no `buildBulkFieldEdits` site, but it IS consumed — on the
single-row path in `use-resource-directory.ts`. The resource directory's BULK edit emits
`kind: "bulk.edit"` through the whole-row `capture()` with `edited: affected`, which is §177b
territory and stays out. Do not read the constant as a seventh bulk site, and do not read it as dead.

Call sites and the constant each passes:

| call site | groups |
|---|---|
| `use-bulk-operations.ts` (tasks) | `TASK_UNDO_GROUPS` |
| `change-panel.tsx` | `CHANGE_UNDO_GROUPS` |
| `raid-panel.tsx` | `RAID_UNDO_GROUPS` |
| `stakeholders-panel.tsx` | `STAKEHOLDER_UNDO_GROUPS` |
| `milestones-panel.tsx` | `MILESTONE_UNDO_GROUPS` |
| `use-raci-suggest.tsx` | `STAKEHOLDER_UNDO_GROUPS` |

The `KNOWN GAP` comment inside `buildBulkFieldEdits` is deleted, not amended — it currently forbids
the fix ("do not 'fix' it here without reading that entry first"), and a prohibition left standing
over changed behaviour instructs the next reader to revert.

★ Reachability is a DATA gap, not a code path: a lone-member difference requires the STORED row to
already carry a split pair. §227 and §228 both re-store one. The fix is worth taking anyway because
the precondition is not repairable at load.

## §181 — measure, then decide

The four registers omitting `stampField` (`use-resource-planner.ts`, `use-change-log.ts`,
`use-stakeholders.ts`, `milestones-panel.tsx`) against tasks, which passes it. Two texts written in
the same round disagree about which is right, and neither was verified.

**The probe:** enumerate every read of `localModifiedAt` and classify each as serialization,
explicitly ignored, or behavioural.

```bash
grep -rn "localModifiedAt" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.' \
  | grep -vE "localModifiedAt[[:space:]]*[:=]"
```

Evidence already in hand, to be confirmed and extended rather than trusted:

- `insights/detect.ts` derives RAID staleness from `localModifiedAt`, falling back to `raisedDate`.
  RAID is one of the four. An undo that does not stamp leaves the APPLY's stamp on a row whose
  content moved backwards, so the staleness detector reads a reverted item as freshly touched.
- `version-diff.ts` lists the field in `IGNORED_FIELDS` — deliberately not a version-diff input.
- `use-jira-sync.ts` clears it (`localModifiedAt: undefined`) as a sync marker.

**Outcomes, both acceptable:**

- Behavioural reads confirmed reachable from the four ⇒ add `stampField` to those four, replace the
  four source comments that point at §181, close the entry.
- Not confirmed ⇒ record the measurement in §181, keep it open, and change no behaviour.
  "Harmonising" four registers on an unverified argument is the failure mode the entry exists to
  prevent.

★ Whatever the outcome, the four source comments are re-read: three share one wording and
`milestones-panel.tsx` phrases it differently, and a comment describing an open question that has
since been answered is the prohibition shape above.

## Testing

| suite | pins |
|---|---|
| `merge-field-value.test.ts` (new) | the no-race property under fast-check (`live` deep-equals `other` ⇒ result deep-equals `target`); record per-key preservation and key deletion; array add, remove, and concurrent-insert ordering; the duplicate fallback; every shape-mismatch fallback |
| `undo-stack.test.ts` | the five-step duplicate reproduction; the recycled-id guard, which must go red if the identity predicate ignores too much |
| `field-groups.test.ts` | lone-member completion on `TASK_UNDO_GROUPS` and `CHANGE_UNDO_GROUPS`; empty-group entities unchanged; the write-through list agreeing across both consumers structurally rather than by hand |
| `use-undo-stack.test.tsx` | the RACI sequence end to end — bulk suggest, concurrent cell assign, Ctrl+Z, cell survives |

Every new guard is mutation-tested, and each assertion names the mutant that backs it. A surviving
mutant is a question, not a pass.

★★ Existing tests asserting wholesale replacement are read INDIVIDUALLY, never blanket-updated. A
test pinning today's whole-value merge is pinning the defect, and rewriting it to match new
behaviour without deciding which side is right is how a fix certifies itself.

★★ The fast-check property is anti-vacuity sensitive: state the floor as a FRACTION of runs that
reached a non-trivial merge, never an absolute count, or raising `numRuns` weakens the guard.

## Gates and risks

- `use-undo-stack.ts` is at 728 lines by the gate's own measure
  (`readFileSync().split("\n").length`, one more than `wc -l`). Budget ~15 lines; both new modules
  are extractions for this reason. Re-measure before committing, never from `wc -l`.
- Both new `.ts` files are coverage-gated (they are not UI glue, so they do not belong in
  `coverage.exclude`). Both are pure, so full coverage is cheap.
- `dup:check` compares the total duplicated-line percentage; `differs` is exported, not copied.
- No i18n keys, no new persisted `Workspace` field, no CSP host, no new Turso table — none of the
  six-write-path or allowlist constraints are engaged.
- No axe surface changes. The RACI and register panels are already scanned; this slice changes
  restore semantics, not markup.

## Out of scope

- §177b, the whole-row capture conversion sweep.
- Deep recursion in `mergeFieldValue` beyond the top level of a field value.
- Any change to the delete-image restore path beyond the identity predicate.
