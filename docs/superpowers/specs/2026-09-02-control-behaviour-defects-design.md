# Control-behaviour defects — design

**Date:** 2026-09-02
**Register entries:** §326, §333, §334, §199
**Branch:** `fix/control-behaviour-defects`, off `origin/main` at `d65e5342` (0.277.1 "Ozeki")

## Goal

Close four small, independent control-behaviour entries — a duplicate-DOM-id collision, a
possibly-vacuous missing blur guard, an unclamped popover, and one deliberate UX fork. Each is
reachable by a user action sequence; none shares a file with another.

## The measure-then-fix rule

Three of the four entries are `never machine-verified`: their symptom is reasoned off the code and
has never been observed. **No fix lands before its symptom is measured in Chromium against seeded
data.** Where a probe fails to reproduce the predicted symptom, the entry closes as *not a defect*
with the measurement written into it — no code change, and no defensive guard added "while we are
here". A shorter slice is the honest outcome of a clean probe, not a failure of the slice.

This is the rule the last two slices earned. A guard whose symptom cannot be reproduced can only be
pinned by a vacuous test, and a vacuous test that claims coverage is worse than no test.

★★ Probes run against an isolated dev server on `PORT=3100`, never the long-running `:3000` the user
may have a live-data tab against.

---

## §326 — `TypeToConfirmDialog` collides on module-constant DOM ids

**What is wrong.** `TITLE_ID` and `MISMATCH_ID` are module-level constants in
`type-to-confirm-dialog.tsx`. Two mounted dialogs therefore put duplicate ids into the document, and
`aria-labelledby` / `aria-describedby` resolve to whichever element comes first in document order —
so the wrong dialog's title or mismatch text is announced, with no visible symptom and nothing
thrown.

**Why it is reachable.** `tasks-section.tsx` holds two independent booleans, `clearConfirmOpen` and
`deleteSelectedConfirmOpen`, each rendering its own `TypeToConfirmDialog`. The voice `clearAll` nonce
reconcile sets the first without checking that the second is closed.

**Probe.** Open the delete-selected dialog, drive the voice `clearAll` nonce path, count elements
carrying the title id in the document. Expected: 2.

**Fix.** `useId()` for both ids. Seven files render this dialog; none of them changes. This retires
an unwritten "only one of these may be mounted at a time" rule rather than documenting it.

**Test.** A unit test mounting two dialogs and asserting each one's `aria-labelledby` resolves to an
element *inside that dialog*. Mutation-proved by reverting either id to a module constant.

---

## §333 — chip clear buttons carry no `onMouseDown` guard

**The claim.** `AGENTS.md`'s `ResourcePicker` bullet states the rule: a commit-on-blur editor closes
on blur, so a clear button without `onMouseDown` + `preventDefault` can have its click land on an
already-closed editor and be swallowed. `labels-input.tsx` and `stakeholder-recipient-input.tsx`
both omit the guard.

**Prediction: the claim does not hold here, and the probe exists to establish that.** Read off source
on 2026-09-02, not yet observed:

- `stakeholder-recipient-input.tsx`'s only close path is a document-level `mousedown` listener gated
  on `rootRef.current.contains(e.target)`. The chip clear button renders *inside* `rootRef`, so a
  click on it closes nothing and there is no blur race to lose.
- `labels-input.tsx` reaches the same `rootRef` shape through `combobox-shared` and puts no `onBlur`
  on its own input at all.
- §265 records that `StakeholderRecipientInput` has **no production caller**, so `LabelsInput` — via
  `task-form-fields.tsx` and `bulk-edit-modal.tsx` — is the only half of this entry a user can reach.

**Probe.** In the task editor, type a label, commit it, click the chip's ✕, assert the label is
removed from the field. Repeat in the bulk-edit modal.

**Outcome.** If the label is removed, §333 closes as not-a-defect, carrying the probe and the
`rootRef`-containment reason. If a click *is* swallowed, add `onMouseDown` + `preventDefault` to both
controls and pin it with a test that fails without the guard.

★★ Recording the disproof is the deliverable in that branch. The entry's own status line says the
failure is reasoned from a pattern rather than observed; answering that is worth as much as a fix,
and leaves the next reader a measurement instead of a suspicion.

---

## §334 — `RaciChipPicker`'s popover has no right-edge clamp

**What is wrong.** The popover is `fixed z-[100] flex w-max`, positioned inline from a single
`getBoundingClientRect` at the trigger's own `left`, with no comparison against `window.innerWidth`,
no clamp and no flip. A trigger near the right edge of a wide RACI matrix renders a popover that runs
off-screen, and `w-max` means it never wraps to compensate.

**Probe.** Open a RACI trigger in the rightmost column of a wide matrix; read the popover's right
edge against `window.innerWidth`.

**Fix — adopt `PopoverPanel`.** The primitive already owns every part of this: a body portal, an
outside-`pointerdown` dismiss covering both the anchor and the portaled panel, Escape through the
dismissal stack, close-on-scroll/resize, a viewport clamp on both axes and a flip-above. The picker
hand-rolls all of it. The adoption deletes roughly forty lines of clone and takes the clamp for free,
and it honours the standing rule against hand-rolling a control a shared primitive covers.

Wiring: `placement="bottom-end"`, `autoFocus={false}` so opening cannot land focus on a role chip,
`role="menu"`, and an `id` for the trigger's `aria-controls`. The trigger keeps its `aria-haspopup`
and `aria-expanded`.

**Three behaviour changes to accept, and the third was missed by the first draft of this spec:**

1. `bottom-end` **right-aligns** the panel to the anchor, where the picker left-aligns today. Under a
   20px chip trigger the whole row shifts left. The primitive's clamp covers a leftmost-column
   trigger, so this is a change of appearance, not a new overflow.
2. `MIN_SPACE_BELOW` flips the panel above the anchor whenever fewer than 220px sit below it. That
   threshold was sized for the date and escalate panels; a ~34px chip row will flip far more eagerly
   than it needs to. **Decision deferred to the probe:** either accept the eager flip, or give
   `PopoverPanel` the minimum as an optional prop defaulting to today's value. Deciding it before
   seeing the flip in a browser would be guessing.
3. ★★★ **The panel starts TRAPPING TAB, and it changes the picker's dismissal kind.** The primitive
   registers `kind: "modal"`, not `layer`, and `docs/AGENTS/ui-shell.md` states why: `kind` means
   "traps Tab", and a surface gaining a real trap flips its kind in the same commit. The picker
   registers `layer` today and traps nothing, so a user who opens it and presses Tab currently walks
   out into the RACI matrix; afterwards Tab cycles the five chips. The primitive also restores focus
   to the anchor on Escape and on unmount-with-focus-inside, which the picker does not do at all
   today.

   This is the one change here that could be argued either way, and it is not a detail of the clamp:
   a five-chip row is menu-shaped, and cycling is defensible — but a matrix cell picker the user
   tabs *through* is a different interaction from a dialog they tab *within*. **The probe decides
   it**, on the same footing as `MIN_SPACE_BELOW`: drive the picker by keyboard alone before and
   after, and if the trap makes the matrix worse to traverse, the adoption is reverted to the
   minimal clamp and §334 closes that way with the measurement recorded. Adopting a primitive is
   only correct while the primitive's contract is the one this surface wants.

**Test.** jsdom has no layout, so no unit test can see the clamp. The unit test pins that the picker
renders *through* `PopoverPanel` and no longer emits its own `fixed`-positioned span; the clamp
arithmetic is already covered by the primitive's own tests, and the clamp *evidence* for this
consumer is the browser probe. The test is mutation-proved against a revert to the hand-rolled span.

---

## §199 — a block added at a narrow pane is not the one you can type in

**What is wrong.** At a narrow pane `document-editor.tsx` collapses every paragraph but the selected
one. `selectionAfterInsert` carries the resolved selection, which for move and delete is the whole
point — but for insert it means the newly-added block is never the selected one. "Add below →
Paragraph" yields a fresh seeded paragraph rendered read-only behind an "Edit this block" button.

**Decision — option (a).** Asking for a paragraph is asking to write one. `selectionAfterInsert`
branches on the inserted **kind**:

- `paragraph` — the selection moves to the new block;
- every other addable kind (heading, bullets, table, data section, page break) — the selection is
  unchanged.

★★★ **CORRECTED 2026-09-02, and the first draft of this section was wrong in a way that would have
shipped a no-op.** It said "text-editable kinds (paragraph, heading, bullets)", reasoning from what a
user can type into rather than from the selection model. `document-editor.tsx` admits ONLY paragraphs
to that model on two independent counts: `resolvedSelection` re-checks
`doc.blocks[chosen]?.type === "paragraph"` and falls back to `firstParagraph` otherwise, and the
collapse itself is `collapseParagraph={narrow && index !== selected}`, passed to a branch that only
a paragraph row reads. So selecting a newly-inserted heading would be resolved away on the very next
render — a change with no observable effect, pinned by a test that passes either way. Headings and
bullets are not collapsed at a narrow pane at all, so they have nothing to be rescued from.

The branch is on the KIND, never on the position: the pre-fix code's index-0-only special case is
what made this inconsistent in the first place, and reintroducing a positional rule would recreate
it.

**Scope.** Narrow-pane only. At a wide pane every paragraph is live and the selection is invisible,
so nothing observable changes there.

**Test.** One test per branch, both directions: inserting a paragraph selects the new block;
inserting a page break leaves the selection where it was. Mutation-proved by inverting the kind
predicate.

---

## Testing discipline

Every new test is mutation-proved in both directions, with the result recorded as `N failed /
M passed` and the sum checked against the file's runtime test count. A mutant is reverted with an
inverse anchored write asserting uniqueness in both directions, ending on an empty `git diff --stat`
— never with the deny-blocked checkout-a-path form.

No two vitest processes run at once. No gate's exit code is read through a pipe: redirect to a file
in the session scratchpad, echo the status unpiped, then read the file.

## Documentation

- `docs/open-followups.md`: §326, §334 and §199 close in the heading, four-place-edit style
  (heading · table status · table anchor · `isClosed` witness). §333 closes either way — as a fix or
  as a measured disproof.
- §102's hand-rolled-UI ratchet loses the `RaciChipPicker` row if the adoption lands.
- `AGENTS.md` and `docs/AGENTS/ui-shell.md`: the `PopoverPanel` consumer story gains this picker; the
  `MIN_SPACE_BELOW` decision is recorded wherever it lands.
- Any prose describing the pre-fix behaviour of the four surfaces is swept in the same commit.
- ★★ `popover-panel.tsx`'s own comments name `raci-chip-picker.tsx` twice — once in the
  `createPortal` census behind the nested-portal note, and once asserting that no `PopoverPanel`
  consumer renders `RaciChipPicker`. The adoption falsifies the second and changes the first. Both
  sit inside the file the change edits, which is the easiest place for a stale claim to survive a
  review that is looking at the diff rather than at the comments around it.

## Release

Patch — 0.277.2, codename stays "Ozeki" (uniqueness is per minor line). One open call: §199 is a
deliberate behaviour change rather than a defect fix. If it should ride a minor instead, this becomes
0.278.0 and needs a new codename.

## Out of scope

- §265 (`StakeholderRecipientInput` has no production caller) — named here only because it bounds
  §333's reachable surface. Deleting a component is its own decision.
- The wider §102 ratchet beyond the one row this slice touches.
- `PopoverPanel` refactors beyond the optional-minimum prop, should the §334 probe call for it.
