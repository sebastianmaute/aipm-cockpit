# Preview/apply parity — design

**Status:** design agreed 2026-09-05. Not yet planned, not yet implemented.

**Goal:** make the AI edit preview tell the truth about every field a chat write
tool can change, and make that property enforceable rather than maintained by hand.

**Architecture:** the preview (`inline-ai-edit/plan.ts` + `entity-descriptor.ts`)
gains the fields it is currently blind to, an id→title resolver so a relationship
diff is readable, and a rejection renderer. A new enumeration test fails when a
declared tool input has neither a descriptor field nor a documented exclusion.

**Tech stack:** unchanged — TypeScript, React, vitest.

---

## 1. The problem

The assistant previews a write, the user approves it, the write happens. Three
things break that contract today, and none of them is caught by any gate.

### 1.1 The preview cannot see ten model-writable fields

`diffFields` is a hand-maintained subset of what the tools accept. Nothing
compares the two sets. Measured 2026-09-05 by comparing the `*Fields` groups in
`chat-tool-defs.ts` against `diffFields` in `entity-descriptor.ts`:

```
raid:        declared=16  diffFields=13  INVISIBLE=3 -> linkedTaskIds, causedByRaidIds, stakeholderIds
change:      declared=16  diffFields=13  INVISIBLE=3 -> linkedTaskIds, linkedRaidIds, stakeholderIds
milestone:   declared=5   diffFields=4   INVISIBLE=1 -> linkedTaskIds
resource:    declared=13  diffFields=10  INVISIBLE=3 -> name, emails, roleId
task:        declared=11  diffFields=10  INVISIBLE=1 -> lastUpdateDate
stakeholder: declared=8   diffFields=8   INVISIBLE=0
```

★ `stakeholder: 0` is a real zero and the positive/negative controls fired, so
the method is not vacuously reporting absence. `resource.name` is discounted —
it is an alias the preview already models via `splitName`. That leaves **ten**
fields to disclose: seven relationship arrays, `resource.roleId`,
`resource.emails` and `task.lastUpdateDate`.

★★ **The seven relationship arrays REPLACE.** `updateRaid` / `updateChange` /
`updateMilestone` merge by object spread, so supplying `linkedTaskIds: [7]`
drops every other link. Omitting the key leaves the stored list untouched. An
undisclosed replace is the worst case in this document.

★★★ **AND THE DROPPED IDS ARE RECOVERABLE FROM EXACTLY ONE PLACE, WHICH DOES
NOT SURVIVE THE SESSION.** `Task` carries no reciprocal back-link array;
`linked-task-index.ts`'s `groupByLinkedTaskIds` is a read-time index derived
FROM this array, so it cannot reconstruct what the source already lost; and the
activity-log entry records the update without any field diff, so the dropped ids
are named nowhere. The only surviving copy is the undo stack's captured
before-image, which is session-scoped and single-shot. If undo is not used
before the session ends or another edit lands, the links are gone with no record
of what they were. That is what makes disclosure before approval the whole
mitigation — there is no after-the-fact repair path.

★★ **No id is checked for existence.** `sanitizeIdList` keeps any positive
finite integer and dedupes; `sanitizeMilestone` filters inline and does **not**
dedupe. A dangling id is stored verbatim on every one of these paths.

### 1.2 A preview can mark a field rejected that the writer stores (§384)

The preview's rule is per-field: `requiredNonEmpty.has(f) && after === ""`
rejects that field alone. The writer's rule is a joint predicate over the merged
row: `sanitizeResource`'s `if (!firstName && !lastName) return null`. So
`update_resource {name: "Cher"}` on a person with a stored surname previews
`lastName` as rejected while the write accepts the row and stores `lastName: ""`.

★★★ **The two replaying consumers perform the wipe.** `applyProposal`
(`chat-proposal-apply.ts`) and `confirmInsightRecommendation`
(`use-insight-recommendations.ts`) resend the original `ProposedCall.input` and
never read the plan, so the preview's rejection has no channel into what the
writer does. The rebuilding consumer (`use-inline-entity-edit.ts`) omits the
rejected field and the stored surname survives. **Which consumer loses data
depends on the direction of the divergence** — for §373's shape it was the
rebuilder, for §384's it is the replayers. Neither is "the" data-loss path.

### 1.3 Rejections are never rendered

★★ §384's register entry says the card "shows `lastName` REJECTED (bad-input)".
That describes the DATA, not the user. Verified 2026-09-05: the only occurrence
of `rejected` in `chat-proposal-block.tsx` is inside a comment, and
`inline-ai-edit-popover.tsx` has none. `recommendation-review-modal.tsx` renders
a bare COUNT (`insightRecommendationSkipped`), never which fields. So a user is
told nothing at all about the field that is about to be destroyed.

## 2. The invariant

> For every field a chat write tool can affect, the preview must show either the
> value the writer will store, or a rejection the writer will honour and the user
> can see. It may not mark a field rejected that the writer stores, and it may
> not omit a field the writer writes.

Nothing states this today. §383 names the guarantee only to decline claiming it;
`plan.sanitizer-parity.test.ts` machine-checks a scoped version with named
exclusions. This spec states the invariant and enforces it.

## 3. Decisions taken

| Question | Decision |
|---|---|
| A mononym rename that would empty a stored surname | **Clear it, and disclose it.** The write keeps its semantics; the preview stops calling it rejected and shows `lastName: Bono → —` as an accepted destructive change. |
| Scope | **Disclose all ten fields**, not just fix §384. |
| Field labels | **Readable labels, EN + DE**, for every previewable field — not just the new ones. |
| §383 (`resource.emails`) | **Fold in.** Its exclusion rationale predates `fieldSanitizers`; run the real `sanitizeEmailList` before diffing, as §373 did for the single `email`. |

## 4. Components

### 4.1 Descriptor: the ten fields

Each of the ten joins its entity's `diffFields`. Relationship arrays already
render through the generic `str()` comma-join (`plan.ts`), which is not
labels-specific, so no new array mechanism is needed for the preview — only for
readability (4.2).

`resource.emails` additionally gains a `fieldSanitizers` entry calling the real
`sanitizeEmailList`, mirroring §373's fix. `resource.roleId` and
`task.lastUpdateDate` are scalars and need no special treatment.
`task.lastUpdateDate` is written only when explicitly supplied — no writer
stamps it implicitly — so previewing it is signal, not noise.

### 4.2 An id→title resolver

A list of numeric ids is unreadable on an approval card. `liveRowTitle`
(`chat-proposal-stage.ts`) already resolves ONE id via the descriptor's `wsKey`
and `titleOf`; this slice generalises that shape to a list. A resolved diff
reads `Linked tasks: Draft brief, Sign off → Draft brief, Ship`.

★★ **The lookup material is asymmetric across the six referenced entities, so do
not assume a map exists.** `workspace-context.tsx` memoizes `tasksById`, already
consumed by `raid-panel-rows.tsx` — reuse it for the three `linkedTaskIds`
fields. There is NO `raidById`, `changesById` or `stakeholdersById`, and `roles`
is a plain array, so `causedByRaidIds`, `linkedRaidIds`, `stakeholderIds` and
`roleId` have nothing to reuse. `liveRowTitle`'s linear `.find` per id is
correct but is O(rows x ids) when applied to a list; whether that matters at
this slice's list sizes is a question for the plan, not an assumption for the
spec. Do NOT introduce new memoized maps into `WorkspaceProvider` without
measuring — its value is one `useMemo` over ~30 slices and every direct consumer
re-renders on any change to it, which is a documented landmine.

An id with no matching row renders as an explicit unknown marker rather than
being dropped. Hiding it would launder a real problem: these paths store
dangling ids and nothing prunes them.

### 4.3 The resource name pair

The descriptor gains a joint rule for `firstName`/`lastName` — at least one
non-empty — and per-field `requiredNonEmpty` stops applying to members of a
paired set. The mononym rename then previews as an accepted change that empties
the surname, which is what the writer does.

★ The existing inline `splitName` mirror in `plan.ts` stays behaviourally
identical through this change; §372's fix must remain pinned by its own test.

### 4.4 Rendering rejections

`chat-proposal-block.tsx` renders `plan.rejected` — the field and the reason —
beside the updates it already renders. `recommendation-review-modal.tsx` is
upgraded from a bare count to naming the fields. Without this, "the preview
tells the truth" is unenforceable, because the truthful verdict is invisible.

### 4.5 Field labels

`{d.field}` is interpolated raw on both surfaces today, so a user reads
`taskName`. With ten more fields that becomes `linkedTaskIds`.

A label map keyed `${entity}.${field}` resolves to an i18n key. **Reuse the
app's existing field strings wherever one exists** — the forms already name most
of these fields in EN and DE — and mint only the gaps. Measured: 58 previewable
fields exist today (raid 13, change 13, task 10, resource 10, stakeholder 8,
milestone 4) and this slice adds ten, so the map covers 68 fields. Minting 136
new strings would be the wrong way to reach that number.

★★ A missing entry must fall back to the raw field name, never to blank. A blank
label on an approval card is strictly worse than a property name.

## 5. Enforcement

### 5.1 The enumeration test (the new gate)

Compares the declared `*Fields` groups in `chat-tool-defs.ts` against
`diffFields` ∪ a documented exclusion set, and fails on any field in neither.
Every exclusion carries a written reason in the same place. This is what stops
the gap reopening when a tool gains a field.

★ It must carry its own positive and negative control — a scan that resolves
nothing passes everything, which is this repo's recurring gate failure.

### 5.2 Correcting the existing differential

`plan.sanitizer-parity.test.ts` swallows the §384 direction: when preview rejects
a field and the writer stores the row, it increments `previewOnlyRejects` and
`continue`s under the comment *"the safe direction — nothing is written."* That
is true for the rebuilding consumer and **false for both replaying consumers**.
The comment and the swallow both go.

★★ The existing sweep compares preview against the SANITIZER, one field at a
time, and never sets `input.name` — so it cannot reach an alias, a joint guard,
or a replay. It is structurally blind to the defect filed against the code it
tests.

### 5.3 A second, smaller differential

Against the REAL write path (`runTool` through the dispatcher, not the
sanitizer), covering the alias, paired-field and relationship-array cases.

★ Deliberately NOT routing all ~450 sweep pairs through the dispatcher: that
needs a workspace fixture per probe and would be slow and brittle, while the
class that must be caught here is enumerable — two aliases, five joint guards,
seven arrays.

### 5.4 Pins

- The mononym rename previews as an accepted clearing, on both consumer shapes.
- A relationship replace previews the removed links by their absence from `after`.
- A dangling id renders as unknown rather than vanishing.
- A rejected field is rendered on the card.

## 6. Register work

Close §384. Re-open §383 as folded in. File, at numbers re-checked against
`origin/main` at the time of filing (386-388 are taken by a concurrent branch):

1. `update_task` accepts an undeclared `notes` input that `buildPatch` resolves
   into `description`; the preview models no alias for it, so such a call
   previews an empty plan and overwrites the stored description. Not
   schema-advertised, so it is reachable by model drift or an imported proposal
   rather than routinely.
2. `update_resource`'s tool description tells the model `roleId` "assigns the
   resource's discipline + grade + rates". It sets one FK; discipline, grade and
   rates live on `Role` and are resolved at read time. `chat-tools.ts` says the
   opposite in its own doc comment. This is a false claim in the text the MODEL
   reads.
3. `sanitizeMilestone` filters `linkedTaskIds` inline and diverges from
   `sanitizeIdList` in TWO ways, not one. It does not dedupe — observable, not
   inert: a duplicated id inflates the `linkedTasks: N` count the insight digest
   renders (`use-insight-recommendations.ts`), though nothing renders a doubled
   row. And it accepts ONLY an array, where `sanitizeIdList` also parses a
   delimited string — so `linkedTaskIds: "1;2"` links two tasks on a raid or a
   change and silently yields `[]` on a milestone. The second divergence is the
   one that matters here: it is a preview/apply divergence in its own right,
   since a preview modelling `sanitizeIdList` would show links the milestone
   writer drops.
4. Rejections are computed and never rendered on the chat card (1.3).

Record the invariant (§2) in `docs/AGENTS/ai-assistant.md`, which owns inline edit.

## 7. Non-goals

- **The four other joint guards** — utilization clamp by mode, email dedupe
  against primary, absence date swap, RAID category/status gating. Each needs
  its own decision about what the preview should show. The enumeration test will
  list them as exclusions with reasons, so they are recorded, not dropped.
- **Pruning dangling ids.** This slice discloses them; deciding whether a write
  should reject an id with no row is a separate question.
- **`sanitizePlan`'s date swap** — no chat write tool reaches it.
- **Changing any write semantics.** Every fix here is to the preview, the
  rendering, or the tests. The one exception would be a bug found while writing
  the pins, which would be filed rather than folded in.

## 8. Risks

- **Refactoring shipped behaviour.** Moving the resource alias into a declared
  mechanism touches code that §372 fixed six commits ago. Its test must stay
  green throughout, and a green suite is not enough — the mutant must be re-run.
- **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it
  through an anchored utf8 write with `\r\n` anchors and real umlauts; the
  `i18n-encoding` test bans ASCII substitutions.
- **EN/DE key parity is tsc-enforced**, so a missing DE string fails typecheck
  rather than shipping — loud, which is the good direction.
- **A concurrent branch is editing `docs/open-followups.md`.** Union-merge per
  row; taking either side wholesale silently drops the other's entries and every
  gate stays green.
