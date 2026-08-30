# Recoverable destructive-save refusal — design

**Date:** 2026-08-30
**Branch:** `fix/recoverable-destructive-refusal`
**Closes:** `docs/open-followups.md` §293, §294, §295

---

## Goal

Make the destructive-save guard's refusal **recoverable**, then close the two paths that
currently turn a missed authorisation into lost work.

Today a mass deletion the user genuinely performed, reached through a route that forgot to arm
the one-shot bypass, is refused with no way forward and a toast that calls the user's own action
a glitch and advises the one gesture that discards it.

---

## Background

### The three register entries

- **§295** — the undo stack arms nothing, so `clear all → undo → redo` re-removes the rows
  through the undo runner with no bypass armed. The guard refuses; the redo appears to work on
  screen and is never persisted.
- **§294** — the one-shot bypass is spent by hand at each early return above the consume site in
  the save effect. Two returns decide it, three leave it by accident, and nothing checks either.
  A new early return leaks the arm by default.
- **§293** — the arming invariant is gated for the AI surface only (`destructive-save-arming.test.ts`
  enumerates `TOOL_DEFS`). The UI surface has no registry to enumerate from, so a new delete
  handler arms nothing and fails no gate.

### §293's own fix shape is rejected

§293 proposes a `DELETE_ROUTES` registry every UI delete handler must join, so a census can walk
it the way `destructive-save-arming.test.ts` walks `TOOL_DEFS`. This design **does not build it**,
for two reasons:

1. **It restates knowledge the arming call already carries.** Both the `allowDestructiveSave?.()`
   call and the registry line are written by the same author, in the same commit, from the same
   understanding. Whoever forgets one forgets the other. It catches the conscientious miss and
   nothing else.
2. **Nothing can force a new handler to join it.** §293 says so itself: any gate proposal here
   "has to either accept a registry of this shape or fall back to enumeration by hand". A list
   nothing forces you to join is a list that rots, and a rotted census reports success — the
   failure mode this repo treats as worse than no gate at all.

The evidence supports this reading. The cold review that found four missed routes on the branch
which filed §293 found them by **reading**, not by any list being short a row.

### What is worth attacking instead

Not the enumeration — the **consequence**. Measured against the tree at `96e21098`:

```
save-guard.ts            refuse = (fullWipe || massDelete) && !allowDestructive
use-storage-backend.ts   emitToast("info", t(lang, "storageRefusedWipe")); return;
i18n.ts                  storageRefusedWipe: "Storage blocked a sudden wipe of your whole
                         project to protect it (likely a glitch). Your saved data is intact —
                         reload the page to restore it."
```

There is no recourse. On a deletion the user did authorise but whose route forgot to arm, the app
tells them their own action was a glitch and advises reloading, which is exactly what throws the
work away.

Give the refusal an exit and a missed arming site degrades from lost work to one extra
confirmation — for every route, **including routes nobody has enumerated and routes that do not
exist yet**. That is a guarantee no census can offer, because it does not depend on knowing the
list.

### The save outage — new finding, owed a test

Reasoned from `use-storage-backend.ts`'s `return; // keep baselines so a later change re-evaluates`
together with `save-guard.ts`'s formula. **Not machine-verified; pinning it is a task in this
slice.**

The refusal keeps the baselines. `prevRecords` stays at the pre-deletion count and `curRecords`
stays low, so `isMassDeletion(prevRecords, curRecords)` keeps answering true and **every
subsequent save re-refuses**. It is not one lost save — it is a save outage that persists until
the user arms or reloads. Everything done afterwards is unpersisted, and the only signal is a
transient toast.

This is why the recourse needs a persistent surface and not only a toast.

---

## Architecture

Four parts. Part 0 is structural and must land first; Parts 1 and 2 are one behavioural change
split for reviewability; Part 3 is independent of the others.

```
Part 0   extract  use-destructive-save-guard.ts   (peer of use-load-truncation.ts)
Part 1   refusal becomes state, with a toast + banner exit      → closes §293
Part 2   the one-shot becomes structural                        → closes §294
Part 3   undo/redo arms itself                                  → closes §295
```

### Why Part 0 is not optional

`use-storage-backend.ts` measures **exactly 800 lines** by the gate's own counting method
(`readFileSync().split("\n").length`, which is `wc -l + 1`) and carries **no baseline entry**.
`scripts/check-file-sizes.mjs` skips a file at `n <= LIMIT`, so it passes today with zero
headroom: one added line makes it a *NEW file over 800* and fails `file-size-ratchet`. Parts 1
and 2 both edit that file.

Verify the count with the gate's method, never `wc -l`:

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
```

The ratchet forces an extraction, but it lands on the right seam independently: the truncation
lockout already lives in its own hook (`use-load-truncation.ts`), and the destructive lockout is
its peer. Making them symmetric is what the generalised banner in Part 1 assumes, and the
extracted hook is what makes Part 2 structural rather than two hand-placed lines.

There is precedent for this shape: `use-storage-file-ops.ts` and `use-storage-turso-ops.ts` are
both extractions from the same parent.

---

## Part 0 — extract `use-destructive-save-guard.ts`

A hook owning everything about the destructive lockout, mirroring `use-load-truncation.ts`.

**Moves out of `use-storage-backend.ts`:**

- `prevCollectionCountRef`, `prevRecordCountRef` — the guard's baselines
- `allowDestructiveRef`, `allowDestructiveSave`

**Adds (new code, in the new file):**

- `destructiveRefusal` state (Part 1)
- `allowDestructiveSaveAnyway` (Part 1)
- `consumeArm()` — reads the arm and clears it in one call (Part 2)

**Exposed API**

| Member | Purpose |
|---|---|
| `allowDestructiveSave()` | arm the one-shot — the existing call, unchanged for all ~20 call sites |
| `allowDestructiveSaveAnyway()` | the user's exit from a refusal: arm **and** clear the refusal state |
| `destructiveRefusal` | `{ prevRecords, curRecords, prevCollections, curCollections, fullWipe } \| null` |
| `consumeArm()` | read-and-clear the one-shot; the effect calls this once |
| `evaluate(curCollections, curRecords, armed)` | run `evaluateSaveGuard` against the baselines, record a refusal, return the verdict |
| `syncBaselines(curCollections, curRecords)` | for the suppress-after-load branch and the committed-save path |
| `clearRefusal()` | called on any successful save |

`allowDestructiveSave` keeps its `useCallback(…, [])` empty-deps identity stability —
`use-register-tools.ts` lists it in an exhaustive `useMemo` deps array that assumes every member
is identity-stable.

**Constraint:** after Part 0 the parent must measure ≤ 800 by the command above, with enough
headroom for Parts 1 and 2. Measure after the extraction; if headroom is under 20 lines, move the
four file-picker actions (`onPickStorageFile`, `onGrantWriteAccess`, `onOpenStorageFile`,
`onRequestStorageSwitch`) into `use-storage-file-ops.ts` as a second, separately-committed
extraction.

**Landmine.** An extraction commit invalidates every `path:LINE` citation below the moved code,
including citations written in the same commit. Cite symbols, and re-run
`npm run docs:claims:check` after Part 0.

---

## Part 1 — the refusal becomes state with an exit (§293)

### The verdict must name its cause

`save-guard.ts`'s `SaveGuardVerdict` gains the cause, because the confirm tier depends on it:

```ts
export interface SaveGuardVerdict {
  refuse: boolean;
  forensic: boolean;
  /** Which invariant refused. `null` when `refuse` is false. */
  refusedBy: "full-wipe" | "mass-delete" | null;
}
```

`fullWipe` wins when both hold — it is the larger loss and the one that takes the heavier
confirm tier.

### Refusal is state, not an event

On `verdict.refuse` the guard hook records
`{ prevRecords, curRecords, prevCollections, curCollections, fullWipe }` and the effect returns as
it does today. Any successful save clears it.

The counts **are** the state, for the same reason `use-load-truncation.ts` stores counts rather
than a boolean: the surface has to name a magnitude, and a separate boolean would be a second
source of truth that can drift.

### The exit re-triggers the existing save path

```ts
const allowDestructiveSaveAnyway = () => {
  allowDestructiveRef.current = true;
  setDestructiveRefusal(null);
};
```

Clearing the state is a dep change, so the save effect re-runs and the guard now passes. This
mirrors `allowIncompleteSave`, which also only sets a ref and clears state and lets the effect's
re-run do the write. **No direct `backend.save` call**, so the baseline resync stays on the single
path that owns it.

### Two surfaces

**Toast at the moment of refusal** — `showToastAction`, the primitive the undo stack already uses
(`use-undo-stack.ts` fires its "Undo" action toast through it). Carries the recourse label.

**Banner while the state stands** — because the refusal is an ongoing outage, not an event.

### The two lockouts cannot collide, by control flow

`use-storage-backend.ts`'s save effect calls `mayCommitAfterIncompleteLoad()` and returns early
**above** `evaluateSaveGuard`. A destructive verdict is therefore unreachable while a truncation
lockout stands. The two causes are mutually exclusive **by construction, not by convention** —
which is what makes a single cause-discriminated surface correct rather than merely tidy.

### Generalise the banner

`TruncatedLoadBanner` in `notifications.tsx` becomes cause-discriminated:

```
SavingPausedBanner({ cause: "truncation" | "destructive", … })
```

It keeps, unchanged and now shared by both causes:

- `role="alert"` — it arrives asynchronously, reports an ongoing blocking state and is the sole
  exit from a save lockout. All three are equally true of the destructive cause.
- the dismiss ✕ and the classic-layout re-open chip — `SidebarFooter` has one mount and it is
  inside `modernTree`, so a classic user who dismisses would otherwise lose the only exit.
- the `SidebarFooter` `savingPaused` / `onRestoreSavingNotice` indicator, whose strings
  (`storageSavingPaused`, `storageSavingPausedAction`) are already cause-neutral.

Per cause it varies: headline, magnitude line, action label, and confirm tier.

### Confirm tiers, and the objection they answer

`notifications.tsx` documents an explicit rejection of `TypeToConfirmDialog` for its own
Save-anyway:

> ★★★ THE PRIMARY ACTION IS DESTRUCTIVE AND GATED. […] It now routes through `ConfirmDialog` —
> the LIGHTER tier, not `TypeToConfirmDialog`: type-a-phrase friction on a user's only exit from
> a lockout is punitive, and unlike "clear all tasks" they did not choose to be here.

That objection is about **the only exit**, and the same docstring records the resolution:

> ★ NOT solved by refusing to dismiss in classic: a banner whose only exit is the irreversible
> button makes destroying data the fastest way to clear your screen. The chip keeps the escape
> reachable without the coercion.

Because the destructive banner is dismissible and carries the same re-open chip, "Save anyway" is
not the only exit — dismissal and reload both are — so the punitive objection lapses for the heavy
tier. Therefore:

| Cause | Tier | Rationale |
|---|---|---|
| `mass-delete` | `ConfirmDialog` | matches the truncation precedent; the user chose the deletion |
| `full-wipe` | `TypeToConfirmDialog` | the irrecoverable case and the one most likely to be a glitch |

**Landmine:** `TypeToConfirmDialog` holds `TITLE_ID` as a module constant, so only one may be open
at a time without duplicate ids. `Modal` stacks, so this is reachable.

### i18n keys

New, EN + DE. Placeholders are 0-based positional (`{0}`, `{1}`).

| Key | EN |
|---|---|
| `storageDestructiveBanner` | Saving is paused to protect your project. |
| `storageDestructiveBannerAria` | Saving paused — a large deletion was withheld |
| `storageDestructiveCount` | {0} of {1} records would be removed. |
| `storageDestructiveWipeCount` | Every record in this project would be removed. |
| `storageDestructiveSaveAnyway` | Save this deletion |
| `storageDestructiveConfirmTitle` | Save this deletion? |
| `storageDestructiveConfirmBody` | If you did not do this, reload the page instead — your saved data is intact. |
| `storageDestructiveWipeConfirmTitle` | Save this wipe? |
| `storageDestructiveWipeConfirmBody` | This removes every record in the project. If you did not do this, reload the page instead — your saved data is intact. |
| `storageDestructiveWipeConfirmValue` | yes, save this wipe |

`storageRefusedWipe` is **reworded in place** (EN + DE). It is the toast text and its only
non-test call site is the save effect; today it advises reloading with no alternative, which
contradicts the action the toast now carries. New text names both options.

**Landmines.** `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double quotes
there — patch it with a node UTF-8 write anchored on `\r\n`, then re-verify. DE must use real
umlauts; the `i18n-encoding` test bans ASCII substitutions and `\u00XX` escapes. EN/DE key parity
is enforced by tsc.

---

## Part 2 — the one-shot becomes structural (§294)

The save effect reads the arm **once, at the very top**, through the extracted hook:

```ts
const armed = destructive.consumeArm();
```

placed above `if (!args.hydrated) return;`. Every path below then spends by construction, and a
new early return added anywhere cannot leak. Both existing hand-written
`allowDestructiveRef.current = false` spends are deleted; `evaluate` takes `armed`.

**Why topmost is safe, and why it is the only placement worth having.** `allowDestructiveRef` is
read by nothing outside its own module — `use-load-truncation.ts`'s `guardedWrite` and
`flushCurrent` are separate save paths that never consult it — so an arm can only ever be consumed
by this effect. Nothing arms before hydration, and a popout never reaches the guard. Topmost is
the only placement where "every path spends" is total; anywhere lower leaves the returns above it
as exactly the hand-decided cases this entry is about.

**`verdict.refuse` now spends the arm.** Today it does not, and is safe only by a cross-module
coincidence in `save-guard.ts`'s formula that nothing states. Under this change it spends like
every other path, which is safe **only because Part 1 exists** — the user re-arms explicitly from
the banner. Parts 1 and 2 are one behavioural change; landing Part 2 alone would make a refusal
unrecoverable in a new way.

**Existing coverage that must stay green.** Four tests in `use-storage-backend.test.tsx` pin the
two known returns — a leak test and a control for each. The controls are load-bearing, not
decoration: a cold review mutated `save-guard.ts` to refuse every mass deletion regardless of the
arm and **both leak tests still passed** while all four controls failed. Any rework of these must
preserve that property.

**New obligation this creates, carried over from the existing comment.** Every arming site must
arm in the same synchronous block as its mutation. A site that arms, awaits, then mutates loses
its permission and its deletion is refused. Enumerate before adding one:

```bash
grep -rn "allowDestructiveSave" src/app --include=*.ts --include=*.tsx
```

---

## Part 3 — undo/redo arms itself (§295)

`useUndoStack`'s deps gain `allowDestructiveSave?: () => void`. Each runner already closes over
its images, so each arms itself in the direction that removes rows — inside
`fragmentUndoRunner`'s redo, `capturePart`'s forward closure, `fieldRowsRunner` and
`compositeUndoRunner`'s composed redo. A composite therefore arms if **any** fragment's applied
direction removes.

The call goes immediately before the setter, in the same synchronous block, satisfying Part 2's
atomicity invariant.

**The predicate.** A direction removes rows iff the images it applies contain any
`op === "delete"`. `buildForwardImages` tags exactly those. Pure, precomputable, no side effect
inside a setter — which matters, because a `setState` updater must stay pure and
`react-hooks/set-state-in-effect` plus the purity rules make the alternative unavailable.

**Over-approximation is the safe direction and is deliberate.** `applyUndoForward` carries an
identity guard — it removes a row only if the live row at that id still matches the recovered row
— so `some(op === "delete")` can arm when nothing is actually removed. That is harmless: the arm
is spent by the very save this mutation triggers, which is the property Part 2 makes total.
Under-arming reproduces the bug.

**The undo direction never arms.** `UndoOp` is `"delete" | "edit"`, and `use-budget-buckets.ts`
states the reason a create cannot be one: "created rows are excluded entirely — there is no
before-image for a row that did not exist, and no entity in the app captures a create." So undo
only restores rows or reverts edits, never removes. Arming on undo would hand a one-shot bypass
to an ordinary edit revert, which is the leak class §294 is about.

★ A `kind: "budget.created"` does exist and is **not** a counter-example — `ActivityKind` and
`UndoOp` are different vocabularies, and the bucket capture excludes created rows from the
before-images regardless of which activity kind it logs. Grepping capture sites for a
`*.created` kind finds it and proves nothing; read `UndoOp` and the exclusion comment instead.

★ `use-budget-buckets.ts` already applies this slice's predicate from the other side, and is the
precedent to copy: it arms on `deleted.length > 0` rather than `touched > 0`, because "an edit- or
create-only commit removes no record, so arming there would leak the one-shot bypass into whatever
save follows."

**Wiring constraint.** `task-manager.tsx` calls `useUndoStack` well before it calls
`useStorageBackend`, which is what produces `allowDestructiveSave` — so the value does not exist
yet at the `useUndoStack` call site. Confirm the ordering with
`grep -n "useUndoStack(\|useStorageBackend(" src/app/task-manager.tsx`. Forward it through a ref plus
an effect — the pattern `use-bulk-operations.ts`, `use-document-assets.ts` and
`use-reference-data.ts` already use — rather than moving the hook call, which would also move
`useUndoHotkey`'s listener registration relative to the other hotkey hooks.

---

## Testing

Unit tests are the only possible detector for most of this. The axe gate cannot see accessible-name
collisions at all, and nothing in axe evaluates focus or lockout recovery.

**Part 0 — extraction**
- The existing `use-storage-backend.test.tsx` suite passes unchanged; the extraction is behaviour-preserving.
- `npm run size:check` green, measured with the node one-liner, not `wc -l`.

**Part 1 — recoverable refusal**
- A refused save records the refusal state with the correct counts and `fullWipe` flag.
- **The outage.** A refused save followed by an unrelated edit refuses again — the finding above,
  currently unverified. Red against a tree where the baselines were resynced on refusal.
- `allowDestructiveSaveAnyway` arms, clears the state, and the ensuing save commits.
- A successful save clears a standing refusal.
- Banner renders the truncation branch and the destructive branch, each with its own headline,
  magnitude line and action label; the dismiss/re-open chip works in both.
- `mass-delete` routes through `ConfirmDialog`; `full-wipe` through `TypeToConfirmDialog`;
  cancelling either leaves the refusal standing and saving still paused.
- `SidebarFooter` shows the paused indicator for the destructive cause.
- The two causes are mutually exclusive: with a truncation lockout standing, a mass deletion
  produces no destructive refusal.

**Part 2 — structural spend**
- The four existing leak/control tests stay green.
- After every early-return path, the arm is false.
- A refusal spends the arm, and the banner's exit re-arms it.

**Part 3 — undo/redo**
- Redo of a captured deletion arms; undo of the same entry does not.
- Redo of a field edit arms nothing.
- A composite arms when any fragment's redo removes.
- End-to-end at the seam: clear-all → undo → redo commits rather than being refused. This is
  §295's own owed verification, which the entry says needs a test driving the sequence against
  `evaluateSaveGuard`.

**Mutation checks.** For each guard test, name the mutant it kills. A spec aborts at its first
hard `expect`, so a mutant that kills step 3 leaves steps 4-5 unproved — state which assertion
each mutant backs.

---

## Files

| File | Change |
|---|---|
| `src/app/use-destructive-save-guard.ts` | new — the lockout hook |
| `src/app/use-destructive-save-guard.test.ts` | new |
| `src/app/use-storage-backend.ts` | consume the hook; `consumeArm()` at the top of the save effect |
| `src/app/save-guard.ts` | `refusedBy` on the verdict |
| `src/app/save-guard.test.ts` | cover `refusedBy` |
| `src/app/notifications.tsx` | generalise the banner to a cause |
| `src/app/sidebar-footer.tsx` | cause-agnostic doc + prop naming |
| `src/app/task-manager.tsx` | wire the banner, the ref-forward to the undo stack |
| `src/app/undo/use-undo-stack.ts` | arm on a removing direction |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new keys; reword `storageRefusedWipe` |
| `docs/open-followups.md` | close §293, §294, §295 |
| `CHANGELOG.md`, `src/app/version.ts` | release entry |

---

## Register bookkeeping

§293 closes **with its proposed fix shape rejected**, not built. The closing note must say that
plainly and record the argument, so a future reader does not resurrect the registry from a
closed heading. The gap §293 names — no census over UI delete routes — **remains real**; what
changes is that missing a route is no longer a data-loss event.

An `open-followups.md` heading edit is a four-place edit: heading, table status, table anchor,
and the `isClosed` witness.

---

## Risks

- **`notifications.tsx` is dense.** Every branch carries a hard-won docstring recording a real
  defect. Generalising must preserve each one and attribute it to the cause it came from.
- **Part 0 headroom.** If the extraction leaves under 20 lines of headroom, a second extraction is
  needed and the branch grows. Measure immediately after Part 0.
- **Parts 1 and 2 cannot be split across releases.** Part 2 makes `verdict.refuse` spend the arm,
  which is only safe with Part 1's exit in place.
- **The outage claim is reasoned, not measured.** If the test written for it shows the refusal
  does *not* persist, the argument for a persistent banner weakens and the design should be
  revisited before building the surface.
