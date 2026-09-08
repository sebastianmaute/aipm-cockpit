# Preview ⟺ write-path parity, enumerated against the real dispatcher — design

**Date:** 2026-09-07
**Branch:** `feat/write-path-parity-sweep`, based at `origin/main` = `960b639e` (0.293.0 "Vandermeer").
**Originally drafted** 2026-09-07 against `08bab65b` (0.291.1 "Hoban") on the now-merged
`feat/preview-write-path-parity-sweep`, which ended up carrying the AI-calendar-writes slice
instead. Re-grounded 2026-09-08 — read the next section before trusting any number below it.
**Closes:** open-followups §394, §418. **Tail:** §405 (narrowed residue only).
**The sweep itself ships no user-visible behaviour change.** It is detector work: every user-facing
defect in the preview/apply cluster (§383 · §384 · §390 · §392 · §393 · §395–§404 · §406) was closed
on 2026-09-06 by two slices. What is left is the class of defect neither of the two existing
detectors can see.

★ **Two unrelated user-reported fixes were folded into this branch** at the user's instruction, ahead
of the sweep, each in its own commit — they share no code with the design below and are recorded here
only so the branch's contents match this document:
- `721580ad` — the chat attachment hint disclosed three fewer families than the picker accepts
  (HTML, Office, mail) and quoted only the flat-file cap, not `MAX_MAIL_BYTES`. Guarded by a test
  deriving the families from the classifier's own extension sets.
- `1bb16135` — the sidebar's "New chat" label wrapped to two lines, because `Button`'s `BASE_CLASS`
  declares no display and the call site's `justify-center gap-1.5` were therefore inert.

---

## Re-grounding, 2026-09-08

0.293.0 "Vandermeer" landed **under** this document between drafting and execution. It added two
`INLINE_DESCRIPTORS` entities (`absence`, `calendarEvent`), seven tools, two merge-site guards and a
new descriptor member. Every count below was re-measured on `960b639e`; each correction carries the
command that produced it, because a correction is a new claim and inherits none of the verification
of the thing it corrects.

| claim as drafted | measured on `960b639e` | command |
|---|---|---|
| 6 descriptors | **8** | `grep -cE "^  [a-zA-Z]+: \{" src/app/inline-ai-edit/entity-descriptor.ts` |
| 6 `update_*` tools | **8** | `grep 'case "update_' src/app/chat-tools.ts \| grep -cv update_settings` |
| 4 `dropUnaccepted*` guards | **6** | `grep -cE "^export function dropUnaccepted" src/app/sanitize-records.ts` |
| 4 `_FIELD_GUARDS` tables, none exported | **6, two of them exported** | `grep -nE "^(export )?const [A-Z_]+_FIELD_GUARDS" src/app/sanitize-records.ts` |
| 15 hand-written `CASES` | **17**, already covering all 8 entities | `grep -c 'entity: "' src/app/inline-ai-edit/plan.write-path.test.ts` |
| `plan.write-path.test.ts` 660 lines | **782** (LIMIT 1600) | `node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)"` |

### Three things that are not just counts

**(a) The two new guards are ALLOWLISTS.** `dropUnacceptedAbsenceFields` and
`dropUnacceptedCalendarEventFields` iterate the PATCH and keep only what their table accepts; the four
older guards iterate their own TABLE and `delete` what fails. The consequence is opposite in the
direction this sweep measures: with a denylist, a refused value **overwrites the stored one** (§394's
recorded shape); with an allowlist, a refused value **preserves** it and a field with no table entry
passes straight through. `sanitize-records.ts` carries a ★★★ block saying so at the split.

**(b) `rawTypeGuards` makes the guard layer shared for those two entities.**
`entity-descriptor.ts:215` declares an optional `rawTypeGuards`, fed `ABSENCE_FIELD_GUARDS` and
`CALENDAR_EVENT_FIELD_GUARDS` — **the same objects the merge site reads**. `plan.ts` consults it at two
sites (one gated on `target === "row"`, one not). So for `absence` and `calendarEvent` the preview and
the writer agree at the guard layer *by construction*. That is recorded as a limit below, not as
coverage, and it changes the acceptance mutation — see "Acceptance".

**(c) The timing table's environment attribution was wrong when written**, and the argument it
supports survives anyway. It recorded `plan.sanitizer-parity.test.ts` as `1.19s (node)`. That file has
**never** carried a `@vitest-environment` directive (`git log -S "@vitest-environment" --` on it is
empty), `vitest.config.ts` has been globally `environment: "jsdom"` since before this spec's own base
(`git show 08bab65b:vitest.config.ts`), and `environmentMatchGlobs` has never existed in it. Both
files were always jsdom. Measured today: **11 tests, 50ms of test work, 24.90s environment, 37.31s
total**. How the original 2.82s was obtained cannot be reconstructed and is not defended here. The
conclusion — do not open a third file — is *strengthened*: a third jsdom file buys another ~25-30s of
environment, and that, not a node-vs-jsdom contrast, is the reason.

### Scope decisions taken by the user, 2026-09-08

- **All 8 entities.** The entity table is asserted exact against `Object.keys(INLINE_DESCRIPTORS)`,
  so a ninth entity reds it rather than being silently uncovered.
- **Findings are FIXED in this slice, not filed.** This supersedes the drafted policy below. The two
  exception sets should therefore end **empty**, and a surviving entry is a decision to be argued in
  review, not a default. ★ This makes the slice's size unbounded by construction; the count from the
  first red run is reported to the user before any fixing starts, so it can be cut back deliberately.
- **§405 tail is IN**, as its own commit.

### Peer coordination, 2026-09-08

The peer session `aipm-wt-a-ea` now holds **§415** (plural agreement), not the insights-guardrail
cluster. Agreed protocol:

- `src/app/i18n.ts` and `src/app/i18n.de.ts` are **the peer's exclusively** for the duration. A fix
  here that needs a key hands them the key plus EN and DE values; this slice edits neither file.
- Follow-up numbering: **435-449 this slice, 450+ the peer.** A number is reserved only once it is on
  `origin/main`. Unused numbers in the range cost nothing — `followups:index:check` compares sets and
  never checks successorship.
- `docs/open-followups.md` conflicts are resolved by identifying an entry by **title, never number**.

---

## The problem

`describeEntityCalls` renders the card the user approves. Two of its three consumers
(`chat-proposal-apply.ts`, `use-insight-recommendations.ts`) then **replay the original
`ProposedCall.input`** through the dispatcher and never read the plan. So any divergence between what
the card showed and what the writer stored is a silent, user-visible data defect — the shape §384
shipped.

Two detectors exist. Neither can see a divergence introduced *below* the sanitizer.

**`plan.sanitizer-parity.test.ts`** — exhaustive and shallow. 8 descriptors × 74 `diffFields` × 10
probes, comparing the preview against each field's **sanitizer**. Its own limits block records the
gap as (6): *it cannot see a merge-site guard it does not compose*. Each reader hand-composes the
guard it knows about, so the sweep proves the sanitizer's rule, never the writer's wiring.

**`plan.write-path.test.ts`** — narrow and deep. Replays whole tool inputs through the real
dispatcher (`runTool` over `useChatDispatcher`, live workspace read-back), but only over 15
hand-written `CASES`, each encoding one known defect.

The gap between them is the whole defect class: **a divergence at a layer the sanitizer cannot show,
in a field nobody wrote a case for.**

### Measured, not argued

§394 records the probe. With all four BASE fixtures moved off their sanitizers' fallbacks,
`dropUnacceptedStakeholderFields` was deleted at its call site in `use-register-tools.ts` — the exact
silent-reset the sweep exists to catch, on a row stored as `"Sponsor"` — and
`npx vitest run src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` was **still green,
`Tests 8 passed (8)`, EXIT=0**. That mutation is this slice's acceptance test.

### The second half: §418

`update_task` alone routes through `buildPatch`, a whitelist — so a source scan can enumerate its
accepted inputs, which is how `tool-input-coverage.test.ts` caught the undeclared `notes` alias. The
other **seven** (`update_raid_item`, `update_change`, `update_milestone`, `update_resource`,
`update_stakeholder`, `update_absence`, `update_calendar_event`) route through
`patchWithoutId(input, kind)`, whose whole body is `{ ...input }`
minus `id`, `expectedToken` and `TOKEN_EXCLUDED[kind]`. **There is no set of reads for a regex to
find, because the code never names the fields.** Reproduce the split:
`grep -c patchWithoutId src/app/chat-tools.ts` → 8 (one import line + seven call sites), against
`update_task` alone reaching `buildPatch`. §418's own text names the remedy: not a wider source
scan, but a replay.

Reproduce the tool count: `grep 'case "update_' src/app/chat-tools.ts | grep -cv update_settings` → **8**
(6 when this was drafted; `update_absence` and `update_calendar_event` joined the pass-through set,
so the §418 gap is now seven tools wide, not five).

---

## Approach

Enumerate the replay. Add a mechanical sweep to `plan.write-path.test.ts` that drives every field of
every entity through the real dispatcher and reads the stored row back.

### Why in that file rather than a new one

Measured 2026-09-07 with `npx vitest run --maxWorkers=1 <file>`:

| file | tests | test work | environment | total |
|---|---|---|---|---|
| `plan.write-path.test.ts` | 31 | **134ms** | 29.17s (jsdom) | 38.49s |
| `plan.sanitizer-parity.test.ts` | 8 | 29ms | 1.19s (node) | 2.82s |

★★ **THE SECOND ROW'S ENVIRONMENT IS WRONG AND THE FILE WAS NEVER A NODE-ENVIRONMENT FILE** — see
Re-grounding (c). Re-measured 2026-09-08: 11 tests, 50ms test work, 24.90s environment, 37.31s
total. Both files are jsdom and always have been. The conclusion below survives on the
*third-file* argument alone, which is the only part of it that was ever load-bearing.

30 dispatcher mounts cost 134ms of test work; the 38s is the jsdom environment, paid **once per
file**. Projecting ~120 replays gives ~0.5s of test work — and a new jsdom file would buy that for
another ~25-30s of environment. The file was 660 lines when this was drafted and is **782** on
`960b639e`, against a `size:check` LIMIT of 1600 — comfortable, but the sweep is additive to it, so
re-read the real number before assuming headroom.

★ Those are this machine's numbers under contention. The *relative* conclusion (reuse the jsdom file)
is what the decision rests on, not the absolute seconds.

### Two layers, deliberately not merged

- the existing hand-written `CASES` stay exactly as they are — each names a specific defect (§384's
  mononym, the raid `category`→`status` drag) and that name is what a red run tells you;
- the new sweep enumerates mechanically and knows nothing about any particular defect.

Merging them would trade a legible failure for a uniform one.

### The enumeration axis

Per entity, the union of three sets, every one derived at runtime:

1. `INLINE_DESCRIPTORS[entity].diffFields` — what the preview declares;
2. `Object.keys(storedRow)` — every field the writer could actually move. This is the §418 half:
   `patchWithoutId` forwards whatever the model sent, so the accepted surface is the **row**, not the
   descriptor;
3. one junk key no schema declares — the non-vacuity control, which must be dropped.

★★ **THE STATED REASON FOR (2) WAS HALF-FALSE AND IS REWRITTEN HERE; THE CHOICE IS UNCHANGED.** As
drafted it read: the guard tables are module-private, so the stored row is the only available
source. There are **six** tables on `960b639e`, and `ABSENCE_FIELD_GUARDS` and
`CALENDAR_EVENT_FIELD_GUARDS` are both `export`ed — so availability no longer discriminates.
Verify with `grep -nE "^(export )?const [A-Z_]+_FIELD_GUARDS" src/app/sanitize-records.ts`
(six hits, the last two exported).

The real reason to read `Object.keys(storedRow)` is that **the row is the writer's actual contract
and the guard table is not**. A guard table is one layer of the merge; the sweep exists precisely to
see divergence at layers the tables cannot show, so sourcing the axis from a table would narrow the
sweep to the thing it is trying to get underneath. That reason holds whether or not the table is
exported, which is why it is the one written down.

### The one maintained thing, and its guard

A per-**entity** table carrying a seed row and a `TokenEntity` kind. `updateTool` and `wsKey` are NOT
in it — `INLINE_DESCRIPTORS[entity]` already declares both.

A new **field** is covered the moment it exists. A new **entity** is not, so the table is asserted
complete against `Object.keys(INLINE_DESCRIPTORS)` and reds when a descriptor is added. The
sanitizer sweep already uses this trick; copying it is deliberate.

---

## The contract

Per entity × per field, three relations:

1. **preview accepts** ⇒ the stored value equals what the card showed;
2. **preview rejects** ⇒ that field did not move. Compared against the field's own before-value,
   never against "was anything written" — a replay always writes, so the latter would flag every
   preview-only rejection;
3. **moved but never previewed** ⇒ an undisclosed write. §418 as a property. This is the relation no
   source scan can reach for the seven pass-through tools.

Gaps go in exception sets asserted **exact** against the set that actually fires — the pattern
already proven in `plan.sanitizer-parity.test.ts`, where a fixed defect turns its own stale exception
red instead of quietly covering the next one.

★ Both existing exception lists (`PREVIEW_REJECTS_APPLY_WRITES`, `APPLY_ONLY_REJECTS`) are **empty
today**, and that is a measurement rather than a deletion. So any entry this sweep needs is a NEW
open defect rather than archaeology.

★★ **SUPERSEDED BY THE USER'S 2026-09-08 DECISION: findings are FIXED in this slice, not filed.**
The measurement above still stands and is the reason the decision is affordable to state — nothing
here is pre-existing debt. Both sets should end empty; an entry that survives to review is a
position someone has to argue, not a default.

★★ Rejection details are not always `${field}=${value}`: a joint `requiredNonEmptyGroups` refusal is
spelled `${members.join("+")}=empty`. The existing `rejectedFields` helper in
`plan.write-path.test.ts` already splits on `+` left of the first `=`; the sweep reuses it rather
than re-deriving the parse. A missed rejection does not read as "no outcome" — it reads as the
preview ACCEPTING what it refused, which is the silent direction.

---

## Acceptance: the mutation, not the green run

The slice is certified by mutation, per entity that has a merge-site guard — **six mutants, six
fixtures**, because an earlier guard short-circuits a later one and a shared fixture would leave the
later mutant unreachable, surviving for the wrong reason.

For each of `dropUnacceptedStakeholderFields`, `dropUnacceptedRaidFields`,
`dropUnacceptedChangeFields`, `dropUnacceptedMilestoneFields`, `dropUnacceptedAbsenceFields` and
`dropUnacceptedCalendarEventFields`: delete the call at its site in `use-register-tools.ts`, on a
seeded row whose value is NOT the sanitizer's fallback, and require the new sweep to go **red**. The
stakeholder one is the exact probe §394 recorded staying green.

★★ **TWO SHAPES, NOT ONE, AND THEY FAIL DIFFERENT RELATIONS.** The four denylist guards fail
relation 1 — the write silently overwrites the stored value with a refused one. The two allowlist
guards fail relation 2 — the preview rejects a field and the write takes it anyway, because with
the call gone nothing filters the patch at all. A mutant that reds the wrong relation is a mutant
that landed somewhere other than where it was aimed; record which relation each one fired.

★★★ **MUTATE THE CALL SITE, NEVER THE GUARD TABLE — and for two entities this is the difference
between a proof and a fabricated one.** The preview reads `rawTypeGuards`, which for `absence` and
`calendarEvent` **is** `ABSENCE_FIELD_GUARDS` / `CALENDAR_EVENT_FIELD_GUARDS`, the same objects the
merge site reads. Editing a table therefore moves the preview and the writer together, the
differential stays green over changed behaviour, and the sweep certifies itself. Deleting the CALL
moves only the writer, which is the asymmetry the whole file is built on. This is the most likely
way to end this slice holding a confident and wrong "certified" claim.

Each mutant is recorded as `N failed / M passed`, and the sum must equal the file's runtime test
count. Every mutant is reverted by an anchored inverse write with a uniqueness assertion in both
directions, ending on an empty `git diff --stat`.

★ A surviving mutant is a question, not a licence: "equivalent mutant" and "missing test" look
identical from the harness, and separating them needs an input the suite does not have.

### Non-vacuity, asserted rather than assumed

- the junk-key probe must be **dropped** — if it lands, that is a finding, and if the assertion
  cannot distinguish the two the sweep proves nothing;
- accept-direction probes must actually **move** a field. A replay refused by a stale token leaves
  the row untouched and makes every comparison trivially true. The existing harness stamps
  `expectedToken` from the stored row exactly as `chat-proposal-apply.ts` does; the sweep asserts
  that guard held rather than trusting it.

---

## §405 tail — separate commit

`RAID_FIELD_GUARDS`' three enum rows (`category`, `status` via `statusSetForCategory`, `severity`)
restate `sanitizeRaidItem`'s predicate ~100 lines away in the same file. They share the SET, so the
residual drift is narrow — but narrow is not absent. Invert the dependency the way the other seven
predicates already were (`acceptsScheduleDays`, `acceptsCostAmount`, `acceptsRiskScale` ×2,
`acceptsStakeholderCategory`, `acceptsInfluenceInterest` ×2).

★★ `MILESTONE_FIELD_GUARDS.achievedDate` is explicitly **out of scope and must not be "completed"**:
`acceptsPatchDate` is deliberately wider than `sanitizeMilestone`'s own rule by exactly the clear
carve-out, and both sites carry a docstring saying so. Sharing it there would be a behaviour change.

---

## Stated limits — what this still cannot see

Written into the file's own limits block, not claimed away:

1. **A coupling no probe generates.** The sweep sets one field per replay, so raid's
   `category`→`status` drag is exercised only by the hand-written case that already covers it. The
   general case stays uncovered.
2. **A key on neither the row nor the descriptor.** Bounded — such a key cannot survive the
   sanitizer — but not zero.
3. **A field whose probe the schema refuses at the door.** A probe that never reaches the writer
   tests nothing; probe values are type-appropriate per field, and a field whose probe is refused
   upstream is recorded rather than counted as covered.
4. **Consumer behaviour.** Everything here is measured on the WRITER's output. "Nothing is written"
   is reasoning about a consumer, and it is the reasoning that shipped §384.
5. **The guard layer of `absence` and `calendarEvent` is shared, not independently verified.**
   Their preview reads the merge site's own table through `rawTypeGuards`, so at that layer the two
   sides agree by construction and the sweep's agreement there is worth nothing. What it does
   certify for those two is the layer BELOW (their sanitizers) and the wiring — which is where
   0.293.0's cold review actually found defects, so this is a narrowing, not a hole. Do not report
   those two entities as "fully parity-checked".
6. **The token is injected, not obtained.** The harness stamps `expectedToken` from the stored row
   itself, so the sweep proves the writer ACCEPTS a correct token and never that a model could
   obtain one. That second half is pinned by the `ROUND_TRIP` block in `chat-tools.test.ts`, whose
   own comment names this file as the one that cannot see it. Do not duplicate it here; do not
   claim it either.

---

## Out of scope

- **§391** — a record, not a defect.
- **§385** (`src:symbols:check` prints a remedy it does not implement) — different subsystem.
- **§360 · §362 · §364 · §365 · §366** — the insights-guardrail cluster. Out of scope on subject
  matter. ★ The peer session named here as holding §361 · §363 · §367 on
  `feat/insights-guardrail-bounds` has since moved to **§415**; the live coordination protocol is in
  Re-grounding above, and the binding constraint is now `i18n.ts` / `i18n.de.ts`, not
  `src/app/insights/`.
- **Widening `tool-input-coverage.test.ts`'s source scan.** §418 says why: a regex over
  `chat-tools.ts` cannot attribute a read to a tool — one switch covers create, delete and list — and
  for the seven pass-through tools there is nothing to attribute. Do not "fix" the gate to match a
  corrected register; its header comment is already correct.

---

## Verification plan

| what | command |
|---|---|
| the sweep | `npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts` |
| no regression in its complement | `npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` |
| types (tests are never typechecked by build or vitest) | `npx tsc --noEmit` |
| lint at CI strictness | `npx eslint --max-warnings=0 src` |
| test-order independence | `npm run test:shuffle` |
| file size | `node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)"` against LIMIT 1600 |

★ Never read a gate's exit code through a pipe — redirect, `echo "EXIT=$?"` unpiped, then grep the
file.

★ Register bookkeeping: §394 and §418 close with a `**Status:**` line naming an executed command;
§405 stays OPEN if only the RAID rows land, with its residue restated. `followups-index-check` and
`followups-status-check` are both BLOCKING.
