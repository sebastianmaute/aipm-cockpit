# Offered-surface sweep — design

> **Landing note, 2026-09-11 — execution split.** The fixes this detector found shipped in
> 0.297.0 "Gentle" (MR !460) on a rebased branch. The detector, its axis module and its register
> rows landed separately via `docs/superpowers/specs/2026-09-11-offered-surface-sweep-landing-design.md`,
> re-measured against main. Everything below is the dated record of the branch as executed and is not
> rewritten: branch SHAs cited below never reached main, and figures below are the branch's, not main's.

**Date:** 2026-09-08
**Branch:** `feat/offered-surface-sweep`, based on `origin/main` = `754e8129` (0.294.0 "Jimenez")
**Closes:** `docs/open-followups.md` §439 (the sweep has no create-path relation) and §436 (the sweep
cannot see a guard table narrowed, because the preview reads the same table)
**Follow-up numbers available to this slice:** 440–449 only. Register max on `origin/main` is 451;
verify before minting with

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

---

## The problem

`plan.write-path-sweep.test.ts` enforces one relation: what the review card discloses must be what
the writer stores. It drives `update_*` tools only, and it derives its field axis from registries the
guard tables control. Two consequences, each already a numbered defect.

**§439 — half the write surface is unswept.** `sweepPlumbing` reads
`INLINE_DESCRIPTORS[entity].updateTool` and nothing else, so a `create_*` call is compared against
nothing. §438 is what that cost: seven entities had guards on editing and none on creating, and every
one of those guards was mutation-proved and watched by a green sweep. Fixing the call sites closed
the instances; it did not give any detector the ability to have found them.

**§436 — a narrowed guard table is invisible.** For `absence` and `calendarEvent` the preview reads
the write path's own allowlist table through `INLINE_DESCRIPTORS.<entity>.rawTypeGuards` — the same
object, not a copy. Narrow a row and both sides move together. Measured in that entry: narrowing
`ABSENCE_FIELD_GUARDS.note` to `() => false` leaves the sweep GREEN with per-entity violation counts
*byte-identical* to the unmutated run, while the model loses the ability to write an absence note at
all. §436 also prescribes its own fix, and this design is that prescription: *"something that asserts
each allow-list still ADMITS the fields the tool schema advertises."*

### Why the existing axes cannot close either

`sweptFields` derives the axis from `[...descriptor.diffFields, ...Object.keys(rawTypeGuards ?? {}),
...Object.keys(linkFields)]` unioned with the seed row's stored keys, minus `RICH_FIELDS`. Every term
is downstream of the thing under test.

`plan.model-writable-surface.test.ts` (§437) subtracts `AXIS_FIELDS`, which has the same lineage. It
is also the file whose hand-written `UNSWEPT_BY_DESIGN` list carried an exemption for
`calendarEvent.exceptions` that was true of update and false of create — a suppression that hid a live
undisclosed write inside the ratchet built to stop suppressions.

`plan.create-path-guards.test.ts` pins seven specific guards, one field each. It cannot see a field
no guard names, which is the entire class.

---

## The axis: what the model is offered

`TOOL_DEFS` (exported from `src/app/chat-tool-defs.ts`, 47 `input_schema` blocks) is the array the
API is actually sent. It has no part in guarding, so it is independent of every registry above.

**Read it at runtime as a real import. Never regex-scrape the source.** A regex over
`chat-tool-defs.ts` is the fragile shape this repo has been bitten by repeatedly; the sizing probe
below used one and it is not what ships.

Two facts settled by measurement rather than reading:

**Create and update share one field bag per entity, for all eight.** `create_raid_item` declares
`properties: raidFields`; `update_raid_item` declares `{ id, ...expectedTokenField, ...raidFields }`.
So `create_X` offers exactly `update_X` minus `id` and `expectedToken`. Reproduce:

```bash
node -e 'const s=require("fs").readFileSync("src/app/chat-tool-defs.ts","utf8");
const re=/name: "(create|update)_([a-z_]+)",[\s\S]{0,600}?properties: ([^\n]+)/g;let m;
while((m=re.exec(s))) console.log(m[1].padEnd(6), m[2].padEnd(16), m[3].trim());'
```

**The axis rediscovers §438's field set from a source that had no part in finding it.** Every field
§438 fixed is undeclared by any schema: `stakeholder.resourceId`, `stakeholder.raci`,
`resource.birthday`, `resource.utilization`, `resource.utilizationMode`, `resource.absenceOverride`,
`resource.active`, `calendarEvent.exceptions`. That is the validation for choosing this axis, and it
is worth more than the argument for it.

Measured 2026-09-08 against `origin/main` = `754e8129`, persisted columns from `csv-codecs-core.ts`:

| entity | columns | declared | undeclared |
|---|---|---|---|
| task | 29 | 11 | 17 |
| raid | 23 | 16 | 6 |
| change | 21 | 16 | 4 |
| milestone | 9 | 5 | 3 |
| stakeholder | 13 | 8 | 4 |
| resource | 19 | 13 | 6 |
| absence | 10 | 7 | 2 |
| calendarEvent | 13 | 9 | 3 |

**45 undeclared, 85 declared.** Both numbers move the moment a schema or a CSV column changes, so the
implementation asserts them against a recorded baseline rather than quoting them — see *Anti-vacuity*.

---

## Relation A — undeclared ⇒ must not land

For each entity, for each field in `persistedColumns − declaredProperties − {id}`:

- **create:** `create_X({ ...validBase, [field]: probe })` → the created row must not carry `probe`.
- **update:** `update_X({ id, [field]: probe, expectedToken })` → `stored[field]` must equal
  `before[field]`.

**The assertion is on the probe VALUE, never on field presence.** This is the property that keeps
Relation A free of an exemption list. `localModifiedAt` appears in all eight rows of the table above,
`outlookEventId` in five, `noteLog` in three — every one of them is legitimately written by the
writer, and none of them is ever written to *the model's value*. A presence-based assertion would
need all three exempted; a value-based one needs nothing.

**If a field turns out to need an exemption, that is a finding, not an exemption.** Recording it as
an exemption is precisely how §437's ratchet came to hide §438.

## Relation B — declared ⇒ must land, or be visibly refused

For each entity, for each field in `declaredProperties`:

- probe derived from the schema's own `type` / `enum` for that property;
- **create:** the created row must carry the probe's normalised value, **or** the card must disclose
  a rejection;
- **update:** `stored[field]` must move, **or** the card must disclose a rejection.

A field the model is told it may set, which silently does nothing, is a defect in the direction a
capability disappears in — and it is the direction §436 measured as producing a byte-identical clean
scorecard. The disjunction is what keeps a legitimate guard from reading as a failure: refusing an
invalid value is the guard working, and the card says so.

**★★★ THE DISJUNCTION IS UPDATE-ONLY. THE CREATE ARM HAS NO SECOND BRANCH, AND THIS MUST NOT BE
WRITTEN AS THOUGH IT HAD.** The create branch of `describeEntityCalls` pushes link diffs and a
`plan.creates` entry and emits **no `rejected` entries whatever** — `plan.rejected` is populated on
the update path alone. So on create there is no rejection channel for the assertion to fall through
to, and Relation B's create arm asserts landing *only*.

Two consequences the implementation has to carry:

- **The create probe must be VALID for its field**, derived from the property's own `type` / `enum`,
  because a guard correctly refusing a bad value would otherwise read as a lost capability. The
  update arm may probe more loosely; the create arm may not.
- **The comparison is against the normalised value, not the raw probe.** Push the stored value
  through `previewNormalizerFor(INLINE_DESCRIPTORS[entity], field)` — the production resolution order
  — exactly as `shownForStored` does in the existing sweep. Comparing a raw probe against a
  normalised stored value reports a violation on every correct write.

★ That a create card cannot disclose a refusal at all is arguably a finding in its own right: a
create whose fields are silently dropped has no channel to say so, and the user approved a card that
could not have told them. It is the same surface as the out-of-scope card-enumeration item below and
belongs in the same follow-up, not in this relation.

Together the two relations state one property: **offered ⟺ writable**, in both directions, on both
paths.

---

## Module layout

**New: `src/test/tool-schema-axis.ts`.** Exports `declaredProperties(entity)` and
`undeclaredColumns(entity)`, both computed from the runtime `TOOL_DEFS` import and the entity's
`*_CSV_COLUMNS` array. Also carries the per-entity valid base payloads for `create_*`.

The seven base payloads already exist as the `valid` member of each `CreateCase` in
`plan.create-path-guards.test.ts` (`raid: { title: "A risk" }`, `milestone: { name, date }`,
`absence: { assignee, startDate, endDate }`, and so on). They move into the shared module and that
file imports them back, so the two detectors cannot disagree about what a valid create is. Task has
no case there today and needs one added.

**New: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`.** Both relations.

Not an extension of `plan.write-path-sweep.test.ts`: its `replayOneField` helper is update-shaped
(it reads a `before` row, stamps `expectedToken` from it, and returns a before/stored pair), and that
file is already 713 lines against a 1600 LIMIT that counts `wc -l` **plus one**. Budget any file in
this slice from

```bash
node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
```

**Touched: `docs/open-followups.md`.** §436 and §439 move to CLOSED with the measurement; §437 gains
a cross-reference to the new detector.

---

## Hazards this design must carry

**`calendarEvent.sendInvitations` is declared, boolean, and Relation B drives it.** A strict `true`
trips `shouldStage` in `chat-proposal.ts`, which in production mails the attendees. Whether a
unit-test replay can send that mail has never been established — it is UNKNOWN, not known-safe.
`plan.write-path-sweep.test.ts` already carries a guard asserting no probe reaches `true`, sited
**outside** its replay loop because that loop breaks early and a guard inside it protects only the
runs that did not need protecting. Relation B needs the same guard on the same terms. Do not make a
red run here green by narrowing the probe for this field — that un-sweeps it.

**Acceptance mutants go at the call site in `use-register-tools.ts`, never in a guard table.** §436
is itself the proof: for `absence` and `calendarEvent` the preview reads the same table object via
`rawTypeGuards`, so a table mutant moves both sides and the sweep certifies itself. This is recorded
in §418 as the reason its six acceptance mutants are sited where they are.

**`src/app/**` and `src/test/**` are CRLF.** Edit tool only, never `sed -i`. `docs/**` is LF-only.
Verify with `git ls-files --eol <file>` — `i/lf w/crlf` is healthy for sources.

**Never read a gate's exit code through a pipe.** Redirect, `echo "EXIT=$?"` unpiped, then grep the
log. Never run two vitest processes at once.

---

## Anti-vacuity

Every assertion in Relation A is a non-appearance and every one in Relation B is a subtraction from a
derived set. Both pass for free over an empty axis. Three floors, each tied to a measured value
rather than to `> 0`:

1. **Axis size per entity, per relation**, asserted against a recorded baseline. A schema change that
   silently emptied `declaredProperties` for one entity would otherwise make that entity's whole
   Relation B green.
2. **A positive observable per entity** — some declared field, driven by some probe, actually landed.
   Without it a harness that writes nothing (a missing `expectedToken`, a wrapper that never mounts
   the provider) satisfies Relation A perfectly.
3. **The union check** — `declared ∪ undeclared` must equal the persisted columns minus `id`, per
   entity. This is what makes the two relations jointly exhaustive rather than merely both green.

Floor 3 is the one that would catch a field falling out of *both* sets, which is the failure mode
neither relation can see on its own.

---

## Acceptance

Six mutants across the two relations and the two guard shapes, each a separate fixture, each recorded
as **`N failed / M passed` with the sum equal to the file's runtime test count**. A `failed`-only
tally has no sum check and has previously masked a mutant that never landed.

- Relation A, denylist entity, create path (`use-register-tools.ts` — drop the
  `dropUnaccepted*Fields` call from one create site).
- Relation A, denylist entity, update path.
- Relation A, allowlist entity (`absence` or `calendarEvent`), create path.
- Relation B, allowlist entity — narrow one row of `ABSENCE_FIELD_GUARDS` to `() => false`. **This is
  §436's own reproduce**, and it is the mutant the whole slice exists for: it must turn the new
  detector RED where the existing sweep stays byte-identically green. Run both files in the same
  invocation so the contrast is recorded, not asserted.
- Relation B, denylist entity — narrow one row of `RAID_FIELD_GUARDS`.
- The axis itself — force `declaredProperties` to return `[]` for one entity and confirm floor 1 and
  floor 3 both fire. Mutating the fix without mutating the detector proves only half.

Each mutant reverted by an anchored inverse write with a uniqueness assertion in **both** directions,
ending on an empty `git diff --stat`. `git checkout -- <file>` is deny-blocked in this worktree and
`git stash` must never be run in it.

---

## The measurement gate

The finding count is unknown until the detector runs, and §436's existence says at least one more
class is already open. **The slice ends at the measurement.**

Build both relations, run them, report the per-entity finding count and the field names, then stop
for a go/cut decision before any fixing begins. This is the gate the §438 slice used; it is what
caught that the artifact produced by its own first three review rounds contained a Critical.

Findings are expected in both directions. A Relation A finding is an undisclosed write of §438's
shape. A Relation B finding is a capability the model is offered and does not have, which is a defect
nobody has looked for yet.

---

## Out of scope, deliberately

**Making the create card enumerate its fields.** `plan.creates` pushes `{ entity, title, toolName,
input }` and `pushLinkDiffs(..., "create", title)` — so a create card discloses a title and link
diffs, and nothing per-field. A user approving "create RAID item: Payment timeout" is approving a row
with a dozen fields set. That is a real question and it is a product change with its own review
surface; a literal preview⟺write relation for create would fire on nearly every field for that single
designed reason, and closing it with an exemption list is the §437 trap again. **File it as a new
follow-up in the 440–449 range; do not build it here.**

**Re-basing §437's ratchet on this axis.** `plan.model-writable-surface.test.ts` asks a static
accounting question at zero runtime cost; this detector asks a behavioural one. They are complementary,
not redundant. Each gains a comment naming the other. Its `UNSWEPT_BY_DESIGN.task` list is long
because `update_task` uses a genuine whitelist (`buildPatch`), reasoning the schema axis does not
reproduce — so a re-base would not simply shrink the list.

**`i18n.ts` / `i18n.de.ts`.** No key is expected. If a fix in a later phase needs one, hand the key
plus EN and DE to the owning session rather than editing either file.

---

## Correction owed to §439's own text

§439 states: *"`sweepPlumbing` reads `INLINE_DESCRIPTORS[entity].updateTool`; there is no `createTool`
to read."* The first clause is true and the second is false. `createTool` is a declared member of
`InlineEntityDescriptor` (`entity-descriptor.ts`, the `createTool: string` field) and **all eight
entities declare it** — `chat-proposal-describe.ts` indexes `toolEntity[d.createTool]` off exactly
that. What is true is that `sweepPlumbing` hardcodes `updateTool` and never reads it: the plumbing
exists and the sweep declines to use it.

Reproduce:

```bash
grep -c 'createTool: "create_' src/app/inline-ai-edit/entity-descriptor.ts   # 8
```

Correct the entry in the same commit that closes it. The error matters because it overstates the
work — a reader budgets for adding a descriptor member that has been there all along.
