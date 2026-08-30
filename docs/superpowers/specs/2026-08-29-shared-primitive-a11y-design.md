# Shared-primitive a11y — design

**Date:** 2026-08-29
**Closes:** `docs/open-followups.md` §146, §246, §289
**Branch:** `fix/shared-primitive-a11y`

## Why these three together

§146 and §246 are the same shape: an accessibility defect that lives in a SHARED
primitive and therefore cannot be fixed at any one call site. Both were filed with an
explicit "wants its own slice, not a drive-by" note. §289 rides along because it is a
decision already taken and blocked on nothing.

★★★ **EVERY DEFECT IN THIS SLICE IS INVISIBLE TO THE AXE GATE.** AGENTS.md carries the
measurement: of axe 4.12.1's rules carrying one of the four tags `e2e/a11y.spec.ts`
requests, NOT ONE flags two controls sharing an accessible name, and none checks focus
restoration either. A green axe run says nothing about any of this, at any seed size,
in any view. Unit tests are the ONLY detector that will ever exist here. Write them as
the deliverable, not as evidence for the fix.

---

## Part 1 — §146: `PopoverPanel` never restores focus on dismiss

### The defect

`PopoverPanel` has never returned focus to its trigger. A keyboard user who opens a
menu and presses Escape lands on `document.body`; the toolbar they were in goes
arrow-dead, because its roving-tabindex guard correctly refuses to act from outside
the row. WCAG 2.4.3 at minimum. Pre-existing and app-wide.

### Deviation from the register's prescription — read this before implementing

§146 prescribes giving `onClose` a reason union (`"escape" | "outside" | "resize" |
"scroll"`) and having each consumer restore focus on `"escape"` only. **We are not
doing that**, and the reason is that its premise no longer holds: the entry reasons as
though only the CONSUMER can know the trigger, but `PopoverPanel` already takes
`anchorRef` — the trigger element — as a required prop, and holds `panelRef` for the
portaled panel.

So the fix lives entirely inside the primitive:

- no signature change;
- no sweep of the 19 consumer files;
- and, decisively, **no possibility of the inconsistency §146 itself warns about** —
  "one consumer restoring focus while its siblings do not is a worse inconsistency than
  the uniform gap". A consumer-threaded fix can drift; an internal one cannot.

The register's four-way enumeration of dismiss paths stays load-bearing. It is what
tells us which single path gets the new behaviour.

### Shape

`popover-panel.tsx` invokes `onClose` from exactly four places. Enumerate before
editing rather than trusting this list:

```bash
grep -n "onClose()\|onDismiss: onClose" src/app/popover-panel.tsx
```

- `useDismissable({ open, kind: "layer", onDismiss })` — carries **Escape**. This one
  gets a wrapper that restores focus, then calls `onClose()`.
- the outside-click `mousedown` listener — bare `onClose()`, unchanged.
- the `resize` listener — bare `onClose()`, unchanged.
- the capture-phase ancestor-`scroll` listener — bare `onClose()`, unchanged.

Scroll and resize must NOT restore: the user did not ask to leave the popover, the
layout moved out from under it. Outside-click must NOT restore: the user has
deliberately gone somewhere else, and yanking them back is a worse bug than the one
being fixed.

### Two details that decide correctness

1. **Guard the restore on focus still being inside the panel** —
   `panelRef.current?.contains(document.activeElement)`. Without it, any future path
   reaching the dismiss hook while focus sits elsewhere steals it back.
2. **Focus the anchor BEFORE calling `onClose()`.** The anchor lives outside the
   portal, so it survives the unmount either way and both orders are functional;
   restoring first avoids a frame where `document.activeElement` is `body`.

`onClose` is documented as needing to be stable (`useCallback`) so the listeners are
not re-subscribed. The wrapper must preserve that property. `useDismissable`'s own
deps are deliberately `[open, kind]` only, so an unstable wrapper would not
re-subscribe anything there — but the same care applies to the three effects that DO
list `onClose` in their deps.

### Tests (`popover-panel.test.tsx`)

Four cases, and the last three are the point:

- Escape returns focus to the trigger.
- Outside-click does **not**.
- Resize does **not**.
- Ancestor scroll does **not**.

A fix that restores unconditionally passes the first test alone. The three negatives
are the mutation detector, and the mutant to name is "call the restoring wrapper from
all four sites".

---

## Part 2 — §246: `InfoTooltip` in `roles-editor.tsx`

### What is actually wrong

§246 records this as an OPEN QUESTION — whether three columns sharing one hint are
same-purpose controls (which WCAG 2.4.6 permits) or a content gap. Reading the code
settles it, and against the entry's framing: the rate card is ASYMMETRIC.

- The `/h` columns (Internal /h, External /h) pass **specific** hints —
  `rolesInternalRateHint`, `rolesExternalRateHint` — through `SortResizeTh`'s `hint`.
- The two `/d` columns and the Basis column are plain `<th>`s carrying a bare
  `InfoTooltip` with the **generic** `rolesRateBasisHint`, which explains the
  Hours/Days switch rather than the column.

So a user asking "what is Internal /d?" is told about the basis switch — three times,
identically. That is a content gap whose symptom is the duplicate name.

Reproduce:

```bash
grep -n "rolesRateBasisHint\|InfoTooltip" src/app/roles-editor.tsx
```

### Fix

Add `rolesInternalRateDayHint` and `rolesExternalRateDayHint` (EN + DE) describing the
daily rate, mirroring the `/h` pattern. `rolesRateBasisHint` stays on the Basis column
alone, where it is exactly right.

★★★ `i18n.de.ts` is CRLF, and the Edit tool corrupts umlauts there and curls double
quotes. Patch it by a node UTF-8 write anchored on `\r\n`, then re-verify the bytes.
DE must use real umlauts — the `i18n-encoding` test bans ASCII substitutions.

---

## Part 3 — §246: `InfoTooltip` in the budget bucket table

### What is actually wrong

`InfoTooltip` renders `<span role="button" tabIndex={0} aria-label={label ?? text}>`,
so every instance is a **tab stop** whose accessible name is the whole hint paragraph.
`HoursCell` (`budget-panel-totals.tsx`) renders TWO of them per cell — one on the
"Plan" label, one on "Actual" — in every period column of every role row.

A six-period, eight-role bucket therefore puts roughly ninety-six extra tab stops in
one table, each announcing one of two identical sentences. §246 filed this as a
duplicate-name finding; the duplication is the symptom and the repetition is the
defect.

Reproduce:

```bash
grep -n "InfoTooltip" src/app/budget-panel-totals.tsx src/app/budget-panel.tsx
grep -n "tabIndex" src/app/info-tooltip.tsx
```

### Fix, in two halves that are NOT the same fix

**(a) Per-cell — delete, do not qualify.** Remove both `InfoTooltip`s from `HoursCell`
and state the Plan/Actual explanation ONCE. This closes the collision by removing the
repetition rather than by giving ninety-six controls ninety-six long distinct names.

The binding constraint is **exactly one instance of each hint in the rendered table**,
not a particular element. The Plan/Actual split is a per-CELL two-row layout, not a
column split, so there is no single column header that owns either hint — the exact
mount point is a plan-time decision taken by reading the bucket table's header markup,
and the two candidates are a header-row legend cell or a line above the table. Whichever
is chosen, a test asserts the hint text renders once across a multi-period, multi-role
fixture; that assertion is what pins the constraint, not the choice of element.

★ The cost is real and accepted: the explanation is no longer beside the cell.

★★ `HoursCell`'s two label spans are `w-14` for a measured reason recorded in that
file — "Actual" plus its tooltip overflowed a narrower box — and the two rows must
share one width or the inputs stop aligning. Removing the tooltip changes what has to
fit. Re-read that comment and update it in the same commit rather than leaving it
describing a constraint that no longer applies. jsdom has no layout, so nothing in the
unit suite can check the result.

**(b) Bucket-scoped — qualify with the bucket name.** The four CCI hints,
`budgetPlanHoursHint`, `budgetActualHoursHint`, `budgetWinLossHint`, and the
plain-text "Edit bucket" / "Close bucket" / "Remove bucket" buttons genuinely differ
per bucket: each reports a different bucket's number. These get the bucket name
threaded in — exactly the discriminator AGENTS.md prescribes, "can this value repeat
in one rendered list".

★ The three bucket buttons carry NO `aria-label` and take their accessible name from
their rendered CONTENT, so an attribute-matching grep cannot see them. AGENTS.md names
this as leg (2) of the three-leg enumeration rule.

---

## Part 4 — §246: `SortResizeTh` across embedded report tables

### What is actually wrong

`reports.tsx` embeds three tables — Assignee, Group and Labels — whose column headers
reuse generic labels. "Open", "Cancelled", "Overdue", "Total", "Inquiries" and
"Completed" each appear in two or three of them. These are **not** same-purpose
controls: "Open" in the Assignee table sorts a different table from "Open" in the
Group table, so 2.4.6 is genuinely failed.

Every sortable header in the app flows through `SortResizeTh`, so this shape reaches
any view embedding two tables of one kind.

### Fix

Add an optional `nameContext?: string` to `SortResizeTh`, **appended** to the header
button's accessible name. The visible label is unchanged.

★★★ Append, do not prefix, and do not replace. WCAG 2.5.3 requires the visible label
to be CONTAINED in the accessible name — containment, not prefix. AGENTS.md records
that reading a prefix rule into 2.5.3 flags conformant code, and this repo already has
a conformant control that fails a prefix test. Appending keeps the visible label whole
and inside the name.

★ Front-position IS a documented best practice, but it lives in a NOTE attached to the
SC, not in its normative text. Do not enforce it here as though it were the rule.

`reports.tsx` passes each embedded table's name. Other `SortResizeTh` call sites pass
nothing and are unchanged.

---

## Part 5 — §289: milestones should stamp `localModifiedAt`

### The decision

Taken during the undo-residue slice and filed as §289. `Milestone` carries an optional
`localModifiedAt`, but `milestones-panel.tsx`'s `save` never writes it, so the register
has no modification time at all.

### Order is load-bearing

**The apply goes first.** `save` stamps `localModifiedAt` on the item it writes; only
then does the bulk-edit capture gain `stampField: "localModifiedAt"`.

Reversing that order produces a stamp that appears ONLY when a user REVERSES
something, which is strictly worse than the current uniform absence — `stampField`
does not restore a prior stamp, it writes a fresh `new Date().toISOString()` on undo
AND redo.

### Verified, so it need not be re-derived

`localModifiedAt` is already a member of `DEFAULT_DIFF_SKIP` in `activity-log.ts`, so
stamping adds no field-change noise to activity entries.

```bash
grep -n "DEFAULT_DIFF_SKIP" -A 6 src/app/activity-log.ts
```

### Also replace the comment

`milestones-panel.tsx` carries a long comment explaining why milestones deliberately do
NOT stamp, ending with a paragraph saying the decision has since been reversed and
naming §289. Once this lands, that comment describes code that no longer exists.
Replace it with a short one stating what the code does now. Leaving a stale comment
that forbids the present is a defect class this repo has already paid for.

---

## Testing

- Collision assertions go through the shared `src/test/row-unique-names.ts` with
  `requireCollisionSeed: true`, never a hand-rolled enumeration. Its helpers throw on
  an ambiguous match; a hand-rolled `findIndex` silently takes the first and can pass
  against the wrong control.
- ★★ `minControls` proves only that the scope is non-empty — it counts CONTROLS over
  the whole document unless `scope` is passed, so a panel toolbar alone satisfies any
  plausible floor. It does NOT make a vacuous one-row fixture unreachable.
  `requireCollisionSeed: true` is the guard that does.
- ★ A collision test's `roles` list is load-bearing and nothing else checks it. Keep
  `minControls` at its exact MEASURED value for the scope; a loose floor lets a
  silently narrowed `roles` array back in unnoticed.
- Each guard gets a named mutant, and the mutant's token span is stated. A mutation
  "kill" whose mutant was never proved to land is not evidence.

## Out of scope

- **§279** — `controlNames` reads `aria-label || textContent` rather than the accessible
  name, so an `<input>` reports the empty string. That is a fix to the DETECTOR, which
  changes what every sweep in the repo reports. It wants its own slice so the change in
  reported surface is attributable.
- **§147, §245, §276, §282** — the row-unique-names sweep continuation.
- **§177b** — whole-row undo paths reverting unlisted concurrent writes.

## Risks

- `PopoverPanel` is consumed by 19 files. The change is internal and additive, but it
  changes behaviour for all of them at once. The three negative tests are what bound it.
- Part 3(a) is a **visible UI change**, and jsdom cannot see layout. It is owed an
  eye-verify against a real bucket table before release. Recorded here so it is a gate
  rather than a discovery.
- `i18n.de.ts` corruption hazard (Part 2, and Part 3 if new strings are needed).
