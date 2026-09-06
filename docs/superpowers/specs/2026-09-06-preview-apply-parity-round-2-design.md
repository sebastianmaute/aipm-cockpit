# Preview/apply parity, round 2 — design

**Date:** 2026-09-06
**Branch:** `feat/preview-apply-parity-round-2`, off `origin/main` at `9699f0a5`
**Closes:** `docs/open-followups.md` §390-406 (seventeen entries)
**Target release:** 0.287.0

## Goal

The 0.286.0 slice made the staged plan card disclose what the assistant writes. It closed §383 and
§384 and filed seventeen entries it deliberately did not patch. This slice closes that block: the
preview and the writer stop holding two spellings of one rule, the divergences that needed both
sides moved get moved, and every refusal the code already computes reaches the person approving it.

## Why the seventeen were deferred, and what changed

Five of them (§395, §396, §398, §399, §397) were filed as **coordinated** changes: tightening the
writer alone was measured to invent a new disagreement pointing the other way. That measurement was
correct against the code as it stood, because each merge-site guard table hand-copies its
sanitizer's acceptance rule from elsewhere in the same file. Layer 1 removes the second spelling, so
each of those five becomes a single edit that moves both sides at once. The layer order is the
design: Layer 1 is what makes Layer 2 safe.

## Decisions taken

Four were the user's, made during brainstorming:

| § | Decision | Alternative rejected |
|---|---|---|
| §392 | A seventh `InlinePhase`, `"rejected"` | Reusing `clarify` with the rejection rows rendered above the message |
| §396 | A blank `lastUpdateDate` CLEARS the field | Blank is a no-op and the preview stops promising a clear |
| §403 | Milestone links align to `sanitizeIdList` | Keep the asymmetry, leave it pinned |
| §397 | Thread the merged row into `fieldSanitizers` | Keep the narrowing, leave it pinned |

Two were taken without asking, and both follow the field's own UI: a boolean is refused as a risk
score, and a change amount must be an integer. In each case the alternative admits a value the form
that owns the field cannot produce.

## Layer 1 — one spelling per rule

**§405.** Each `dropUnaccepted*Fields` table restates its sanitizer's acceptance rule. The docstrings
say "hoist the sanitizer's OWN acceptance predicate"; no code is shared, so a divergence would be
silent, and the tests cannot catch it either because the `it.each` rows are hand-picked values
rather than a property over the sanitizer.

Invert the dependency in `sanitize-records.ts`: the sanitizer calls the predicate.
`sanitizeRaidItem` reads `if (acceptsRiskScale(o.probability))`, `sanitizeChangeItem` reads
`if (acceptsChangeAmount(o.costImpact))`, and so on for the patch dates and the stakeholder enums.
The guard table and the sanitizer then share one function rather than one intention.

The four load-path sanitizers are pinned by tests the last slice deliberately left untouched. Those
tests are the safety net for this inversion: they must stay green with no edits, and a change that
needs one is a change in behaviour, not a refactor.

**§400.** `str` exists twice — `plan.ts` declares `function str`, `entity-descriptor.ts` declares
`const str`. `plan.ts` imports `entity-descriptor.ts`, so importing the helper back would close a
cycle. Extract it to a leaf module both import.

The entry's own reproduce (`grep -n "^function str" src/app/inline-ai-edit/*.ts`) returns ONE hit
today, not both, because the descriptor's copy is a `const` arrow. Correct the entry when closing
it — the claim is true and the command beside it is not.

## Layer 2 — the coordinated divergences

Each of these is one edit once Layer 1 has landed, because the predicate the preview consults and
the predicate the writer consults are the same function.

**§395 — a boolean stores a fabricated risk score.** `toNumber(true)` is `1`, inside the [1,5]
range, so `update_raid_item({probability: true})` stores a plausible-looking score that feeds
`riskSeverityFromMatrix`. It never appeared as a preview/apply divergence because the preview
coerces identically and shows it as accepted. `acceptsRiskScale` refuses a boolean.
`toNumber(false)` is `0`, already out of range.

**§399 — a fraction the preview rejects applies anyway.** `sanitizeChangeItem` asks
`Number.isFinite(days) && days >= 0`; the descriptor's `intRangeFields` guard demands
`Number.isInteger`. So `scheduleImpactDays: 1.5` previews as REJECTED and applies. The shared
predicate demands an integer, matching the stepper the field renders.

**§398 — a non-string clears a milestone's rich text.** `sanitizeRichText` returns `""` for a
non-string, `if (description)` omits the key, and the rebuilt record loses the stored value. It was
left out of the milestone guard deliberately, because the preview PROJECTS a non-string rather than
refusing it, and guarding the writer alone would make the write keep a value the card says is
changing. Both sides move: the preview refuses a non-string `description`, and the field joins
`MILESTONE_FIELD_GUARDS` on the same predicate.

**§396 — a blank `lastUpdateDate` previews a clear the writer does not make.** `buildTaskCleanPatch`
drops the key when `sanitizeIsoDate` returns `""`, and a dropped key on a patch merged over the
stored row leaves the field unchanged — where the full-record sanitizers behind raid, change and
milestone clear theirs. Per the decision above, the task path aligns with the registers: a blank
writes `""`. The preview already shows a clear, so this is a writer-side change that makes the card
true.

Note the asymmetry this deliberately does NOT touch: `dueDate` throws on a blank, because
`requiredNonEmpty` catches it first. That is a different rule and stays.

## Layer 3 — every refusal is shown

**§392 — a rejection-only inline plan is reported as "no changes".** `isEmptyPlan` counts
`updates`, `creates`, `deletes` and `links`, and not `rejected`, so a plan whose only content is a
refusal is empty by that predicate. `use-inline-entity-edit.ts` routes it to `clarify` and shows the
`inlineAiEditNoChanges` copy instead of naming the field it refused.

Add `"rejected"` to `InlinePhase`. A plan that is empty but for `rejected` entries routes there and
renders the rejection rows the previous slice built. `clarify` keeps its meaning — the model needs
more from the user — and the new phase means the model understood and the writer will not take it.

Routing to `preview` was considered and is wrong on its own: `apply()` also rejects an empty plan,
so the user would get a live Apply button that no-ops. The new phase has no Apply button, so that
trap cannot recur.

**§404 — a wholly-refused dependency proposal shows no change and no reason.** The describer
previews what the write would STORE by calling `resolveDependencyWrite`, so self-links, unknown
ids, duplicates, over-cap entries and cycles are correctly not shown as landing. When every
proposed link is refused, the card correctly shows no change, and says nothing about why. Populate
the `Rejected` bucket from the resolver's own outcome, one entry per refused link with its reason.

One line of the dispatcher's wholly-destructive refusal is mirrored in the describer rather than
shared, because that branch lives in the hook and not in the pure resolver. That duplication is the
Layer 1 defect class on another surface; this slice records it and does not widen it.

**§390 — the inline CREATE path writes link fields with no preview.** `plan.creates` carries the
model's tool input verbatim to `runTool`, so an inline `create_raid_item({title, linkedTaskIds})`
writes those links while the card shows only the new row's title. Run the create's input through the
same link projection the update path uses.

Severity is lower than the update case and the design says so: a create has no prior row, so it
cannot DROP existing links. The exposure is an undisclosed write, not an undisclosed destruction.

**§406 — the dependency card label is hardcoded English.** The describer builds
`` `${title} dependencies` `` and it reaches the card through `fieldLabel` verbatim, so a German
user reads "Kickoff vorbereiten dependencies". Every other label on that surface is translated and
`i18n.ts` already carries a `dependencies` key.

The label becomes structured data the renderer translates. `chat-proposal-describe.ts` is i18n-free
by construction and takes no `lang`; passing one in would put `t()` into a module whose purity is
deliberate.

## Layer 4 — the gates stop lying

**§394 — the parity sweep cannot exercise the silent-RESET half.** Every required enum's fixture
value coincides with its own sanitizer's hardcoded fallback, so a refused value reads back as the
value already held and the sweep records agreement. A row whose enum is not the default is silently
reset with the card showing nothing — which was a live production defect on stakeholders, found by
moving `STK_BASE` off its defaults and measuring 27 mismatch pairs.

Two parts. First, move the enum fixtures off their fallbacks in the PER-ENTITY patch tests and
triage the resulting reds. Not in the shared sweep's fixtures — that manufactures reds outside the
direction under test, and the file's own header says so. Second, `resource` is the last bare
`sanitizerReader`, faithful today only because `updateResource` has no merge-site guard; compose it
with the real write path before it needs one, since a merge-site guard is structurally invisible to
a raw-sanitizer reader.

**§397 — the emails preview cannot see the row's own primary address.** A `fieldSanitizers` entry
receives only the field's value, so the preview calls `sanitizeEmailList(v, undefined)` where
`sanitizeResource` calls it with the merged row's primary. An incoming extra equal to the primary is
kept by the preview and dropped by the write, and at the 10-address cap the asymmetry shifts which
address lands tenth.

Thread the merged row into every `fieldSanitizers` entry. The signature changes from
`(v: unknown) => string` to one that also receives the row. The test named `KNOWN DIVERGENCE` in
`plan.test.ts` flips to the agreeing expectation it already names.

**§401 — an accepted input the schema never declares is invisible to the coverage gate.**
`tool-input-coverage.test.ts` enumerates DECLARED schema properties, so `update_task`'s `notes`
alias — resolved as `input.description ?? input.notes` — cannot be seen by it. The alias itself is
harmless: it lands in `description`, which is previewed.

Close the gate's reach rather than documenting it. Add a source scan over the dispatcher for
`input.<name>` reads with no declared property on that tool's schema, allowlisted with written
reasons. A green run then means "every accepted input is covered", which is what a reader already
believes it means.

**§402 — `roleId`'s description tells the model it assigns rates.** The schema says `roleId`
"assigns the resource's discipline + grade + rates". It sets one foreign key; those values live on
`Role` and resolve at read time. Correct the description. The risk is a model choosing `roleId` to
achieve something it cannot achieve.

## Layer 5 — the data-model calls

**§403 — the milestone link rule disagrees with every other register's.**
`sanitizeMilestoneTaskIds` is array-only (a delimited string yields `[]`, where raid and change
parse one) and does not dedupe, which inflates the digest's `linkedTasks` count. So
`linkedTaskIds: "1;2"` links two tasks on a raid item and nothing on a milestone.

Per the decision above, align it: parse delimited strings and dedupe. This moves stored data —
duplicate ids currently persisted collapse on the next write — which is why it was filed rather
than done. The test pinning the divergence ("yields [] for a delimited string, unlike
sanitizeIdList") is rewritten to pin the alignment.

**§393 — a merged recommendation plan cannot always resolve a field's label.**
`describeRecommendationPlan` pushes diffs from a different descriptor per proposed call, so one
`EditPlan` can hold two entities' field names in one array, and the label map is entity-qualified
because it must be — `impact` is a 1-5 scale on a RAID item and free text on a change.
`recommendationPlanEntity` answers only when exactly one register is updated and otherwise falls
back to raw property names: worse to read, never wrong.

Add a per-diff entity to `FieldDiff` and `LinkDiff`. About twelve exact `toEqual` assertions in
`plan.test.ts` redden on the extra property and get it.

**This is the item to cut if the slice runs long.** It is a design improvement, not a defect: the
current behaviour is degraded readability, never a wrong label.

**§391 — `emptyPlan()` is safe at two of its three call sites, and the reason is per-site.** A
record, not a defect. Two call sites are correct forever (the `pendingOn` create-to-update remap,
and the id-less delete); the third was not, and this slice's predecessor fixed it. Close as a
documented decision with no code, so the next reader does not conclude from two correct examples
that a hardcoded empty plan is always right there.

## Testing

Each fix is pinned at the layer that can actually see it, which is the lesson the previous slice
paid for:

- A merge-site guard is pinned by `plan.write-path.test.ts`, which replays through the real
  dispatcher. A helper test cannot pin its own wiring — deleting the call site leaves it green.
- A sanitizer predicate is pinned by its per-entity `sanitize-*-patch.test.ts`, on a fixture that
  is OFF the sanitizer's own fallback.
- A preview projection is pinned by `plan.test.ts`.
- The Layer 1 inversion is pinned by the existing load-path sanitizer tests staying green with no
  edits. A test that needs editing means the inversion changed behaviour.

Every guard added or moved is mutation-tested: remove the call site, confirm the write-path
differential reds while the helper test stays green. Report each mutant as `N failed / M passed`,
with the sum equal to the file's runtime test count.

## Out of scope

- §219's OOXML manual byte-verify and §375's eye-verify. Both are owed, neither is this slice.
- The `resource` merge-site guard itself. §394 composes the reader so one can be added safely; adding
  one is a separate decision about `updateResource`'s behaviour.
- Any change to `dueDate`'s throw-on-blank rule (§396 covers `lastUpdateDate` alone).

## Risks

**Layer 1 touches the load-path sanitizers.** Their behaviour is pinned by tests the previous slice
deliberately left untouched, and those tests are the control: they must pass unedited.

**Layer 5's §403 moves stored data.** Duplicate milestone task ids collapse on the next write. That
is the intent, and it is the reason the entry asked to be argued before being changed.

**The slice is large.** Seventeen entries across five layers, three of which change user-visible
behaviour. §393 is the declared cut line.
