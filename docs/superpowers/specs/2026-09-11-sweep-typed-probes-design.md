# Typed probes for the offered-surface sweep

_Opened 2026-09-11 against 0.303.0 "Christie", on `feat/sweep-typed-probes` off `origin/main`
`1e437e7e` (main pipeline 6902 green). This is the follow-up slice that
`docs/superpowers/specs/2026-09-11-offered-surface-sweep-landing-design.md` names under "Probe fixes
deferred"._

## Why this exists

The offered-surface sweep (`src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`) landed on
main as a detector with known blind spots, recorded rather than fixed:

- **Relation A cannot see a guard on any field whose sanitizer rejects an arbitrary value** (§441).
  Its probe comes from `trespassProbeFor`, which is never a valid value, so the sanitizer drops it
  whether the guard runs or not, and the relation passes green either way. The sweep's own docstring
  names nine such fields; acceptance mutants 2 and 3 survive it on main.
- **Relation B sends two create probes the create cannot accept** (§459): `task.assigneeEmail` gets
  `"m.Jordan@example.com probed"`, and `absence.startDate` gets a date later than
  `CREATE_BASE.absence.endDate`, which the sanitizer swaps.
- **`calendarEvent.startTime`'s create probe equals what `CREATE_BASE` already sends** (§443), so it
  can never show a landing.
- **`validProbeFor` has no object branch** (§441), so `calendarEvent.recurrence` is sent `"probed"`,
  the guard refuses it, and the create arm reads it as landed.
- **A create card previews meeting attendees the create then stores none of** (§460), because
  `pushLinkDiffs` applies the link guard on updates only, and a `plan.test.ts` case pins that
  preview as correct.

Reproduce the starting state:

```bash
grep -nE "^function (trespassProbeFor|validProbeFor|probeAgainstControl)\(" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts   # three derivations
grep -n "A TRESPASS PROBE IS NEVER A VALID VALUE\|THERE IS NO OBJECT BRANCH" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
grep -n 'subject: "task.assigneeEmail"\|subject: "absence.startDate"' src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
grep -n 'target === "row" ? d.rawTypeGuards' src/app/inline-ai-edit/plan.ts                       # the §460 gate
grep -n "does NOT apply the guard to a create" src/app/inline-ai-edit/plan.test.ts                 # the case that pins it
```

## The insight the design rests on

`validProbeFor`'s docstring says "RELATION B NEEDS A VALID PROBE WHERE RELATION A NEEDS AN INVALID
ONE". The second half is wrong. Relation A asks whether the GUARD stops an undeclared value, so it
needs a value the sanitizer **would** store if nothing stopped it. An invalid value is stopped by the
sanitizer regardless, and that is the whole of §441's probe-shape blindness. Both relations need the
same thing: **a value the column can hold at rest, which the writer would not produce on its own.**
They differ only in which way they assert on it.

## Goal

One probe derivation, shared by both relations, whose every probe is checked against the writer's own
sanitizer before a relation may judge it. A field whose probe the check refuses is reported
`unmeasured`, and one with no derivable probe `dead`, by name, in the both-directions ledger. It no
longer passes green.

## Non-goals

- **The "destroys rather than stores" half of §441.** A trespass that coerces or clears a value
  never produces the probe, so Relation A still cannot see it. That class stays in
  `plan.write-path-sweep.test.ts`, which compares before and after. This slice does not add a
  movement clause to Relation A, because that needs an exemption list for writer-stamped fields,
  the shape that let §437's ratchet hide §438.
- **§440** (a create card has no channel to disclose a refusal), **§445**, **§446** and **§461**
  (whether an absence's assignee email is format-checked, a product-rule decision).
- **`calendarEvent.sendInvitations`.** It stays `dead` by mail-safety policy (§443).

## Design

### 1. One derivation: `probeFor`

`probeFor(entity, op, field, reference)` replaces `trespassProbeFor`, `validProbeFor` and
`probeAgainstControl`.

**Reference row per arm.** For the create arm it is the CONTROL row, the row `CREATE_BASE` produces on
its own. For the update arm it is the BEFORE row. A probe is derived against the row it will be judged
against. That removes §459's `absence.startDate` and §443's `startTime` defects by construction: both
came from deriving against the seed while the create arm judges against the control.

**Value source, most specific first:**

1. **Schema `enum`** (declared fields only): a member that differs from the reference value.
2. **A known-valid value, changed in kind.** The source is the reference row's value, or the seed row's
   value where the reference carries none. The seed row is what the fixture already proved the
   sanitizer accepts.
   - boolean: flipped;
   - number: +1;
   - `YYYY-MM-DD`: one day later;
   - `HH:MM`: one hour later, wrapping at midnight;
   - email-shaped string (`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`): `+probed` inserted before the `@`. This
     passes `isValidEmail` (`/^\S+@\S+\.\S+$/`, `sanitize-core.ts`);
   - any other non-empty string: suffixed ` probed`;
   - array: one element dropped. When the reference is empty or absent, the full seeded array is used;
   - **object (new):** one key of the seeded object set to a changed value of the same kind, applied
     recursively.
3. **Nothing.** The field is reported `dead`. No value is invented.

Email and time are recognised by the SHAPE of the value, as dates already are. There is still no
per-field override map, which `validProbeFor`'s docstring rejects as "one rename away from becoming an
exemption list".

### 2. The admission check

Before either relation judges a field, the reference row with the probe substituted into the field is
passed to that entity's **writer sanitizer** for the arm being judged, `ADMISSION_ORACLE[entity][arm]`
(`src/test/sweep-probes.ts`):

| entity | create | update |
|---|---|---|
| raid | `sanitizeRaidItem` | `sanitizeRaidItem` |
| change | `sanitizeModelChangeItem` | `sanitizeChangeItem` |
| milestone | `sanitizeMilestone` | `sanitizeMilestone` |
| stakeholder | `sanitizeStakeholder` | `sanitizeStakeholder` |
| resource | `sanitizeResource` | `sanitizeResource` |
| absence | `sanitizeAbsence` | `sanitizeAbsence` |
| calendarEvent | `sanitizeCalendarEvent` | `sanitizeCalendarEvent` |
| task | one-row `jsonToWorkspace` round trip | same |

★★ **WHY NOT `jsonToWorkspace` FOR ALL EIGHT, as this section first said.** `jsonToWorkspace`
(`src/app/workspace.ts`) CASTS raid rows (only `sanitizeRaidRichFields` runs) and task rows (only
`migrateTask` and `sanitizeNoteFields` run). As the oracle it would admit almost any probe on those two
entities, including one the writer's own sanitizer reshapes, which is the vacuity this slice removes.
Reproduce: `grep -n "tasks: (p.tasks\|raid: (p.raid" src/app/workspace.ts`.

★ **TASK IS THE ONE WEAK ORACLE, AND IT IS WEAK ON PURPOSE.** `create_task` has no row sanitizer: its
writer builds the row field by field. The oracle for task is therefore the at-rest store alone, which
admits nearly any value. That is recorded, and pinned by a unit test, rather than hidden. The sweep
already runs under jsdom (`vitest.config.ts`), which that round trip's JSON load path needs.

A field is **measured** only if:

- the admission oracle holds the probe unchanged, **and**
- the probe differs from the reference value.

Both comparisons use the comparison the judging relation itself uses: `same` for Relation A, and
`normalizedAs` for Relation B. ★★ This matters for objects: on an undeclared field `normalizedAs`
falls back to `String(value)`, which renders every object as `"[object Object]"`, so an object probe
would always compare equal to its reference and never be admitted.

The outcome has three kinds, and the two non-probe kinds want different repairs:

- **`dead`** — the harness cannot derive a distinguishable probe: nothing to derive from, the derived
  value equals the reference, or the mail-safety policy (`calendarEvent.sendInvitations`). The repair
  is a fixture or a probe shape. This is the existing kind, unchanged in meaning.
- **`unmeasured`** (new) — a probe was derived, but the writer's sanitizer will not hold it unchanged.
  The repair is a probe shape, or a product decision about what the column accepts.

### 3. What each relation asserts

- **Relation A (undeclared fields):** a measured probe must NOT land, on create or on update. The
  assertion stays `same(stored[field], probe)`, a presence-free check against the model's value, so it
  still needs no exemption list.
- **Relation B (declared fields):** a measured probe lands, or the card discloses why it did not.
  Unchanged.

### 4. Mail safety

`MAIL_UNSAFE_BOOLEANS` stays and `probeFor` consults it. The standalone mail guard is restated over
`probeFor` alone. With one derivation there is no hand-kept list of derivations for a third one to
escape, which is §443's durable concern.

### 5. Fixtures

Seed `calendarEvent.exceptions` with a valid two-element `EventException[]` on the sweep's
calendar-event seed (`seedGuardedCalendarEvent`, `src/test/inline-sweep-fixtures.ts`) ONLY.
★★ NOT on `CREATE_BASE.calendarEvent`: the sweep's floor "the create base names only declared fields"
forbids an undeclared key there, and `exceptions` is undeclared. It is not needed either — the create
arm's reference is the control row, which holds no `exceptions`, so `probeFor` falls back to the
seeded array.

The calendar-event seed already carries a `recurrence`, which `sanitizeCalendarEvent`
requires before it stores `exceptions`. The other object fields (`stakeholder.raci`,
`resource.utilization`, `resource.absenceOverride`, `calendarEvent.recurrence`) are already seeded as
objects, so the object branch reaches them.

### 6. Ledger

`EXPECTED_FINDINGS` stays checked in both directions, keyed by subject and kind, and gains the
`unmeasured` kind.

- **Deleted,** each in the commit that makes its field land: §459's `task.assigneeEmail` and
  `absence.startDate`, and §443's `calendarEvent.startTime`.
- **`calendarEvent.sendInvitations`** stays `dead`.
- **New `unmeasured` entries** name each field the admission check cannot admit. Expected (not yet
  measured): undeclared closed-set fields such as `resource.utilizationMode`, where no schema `enum`
  exists and the writer's sanitizer refuses a suffixed string.
- **Relation A gets a ledger of the same shape, `EXPECTED_UNDECLARED_FINDINGS`, checked in both
  directions.** It asserts `findings` is empty today, and typed probes may now expose a real undeclared
  write.
- **Citation.** Every new `unmeasured` or `dead` entry cites §463, the register entry Task 8 files for
  "fields the typed probes cannot measure" (reserved as 462+1: `origin/main` had already taken §462 for
  an unrelated entry — "There is no Linux installer…" — by the time Task 8 ran its register-max check).
  Reserve the number by re-running the register-max command against `origin/main` before writing any
  citation.

### 7. A real undeclared write that Relation A finds is FIXED in this slice

Each fix is the missing guard call at the merge site: the `dropUnaccepted*Fields` helper already used
by the sibling path, pinned in `plan.create-path-guards.test.ts` (create) or driven by
`plan.write-path-sweep.test.ts` (update). The fix must fail its pin first.

**Stop rule:** if a finding needs more than a missing guard call, or needs any line in
`src/app/sanitize-records.ts` (which sits at exactly the 1600-line limit), stop and bring it to the
user. Do not grow the slice to absorb it.

### 8. §460

Test first:

1. Add a pin that drives `create_calendar_event` with `attendeeResourceIds: [4, "4"]` through BOTH the
   card (`describeEntityCalls`) and the write, and asserts they agree: no attendee previewed, none
   stored. It must fail on the current code.
2. Remove the `target === "row"` condition in `pushLinkDiffs` (`src/app/inline-ai-edit/plan.ts`). The
   create call passes no `toolName`, so the `if (toolName)` beside it still keeps a create from
   pushing a `rejected` row. Disclosing the refusal stays §440's.
3. Rewrite the `plan.test.ts` case "does NOT apply the guard to a create, whose write never sees it",
   its comment, and the `(C3)` header over its `describe`. All three describe the create path as it
   was before `68486cd4`.

## Register (`docs/open-followups.md`, LF)

| Entry | Change |
|---|---|
| §459 | CLOSED |
| §460 | CLOSED |
| §443 | Narrowed: `startTime` closed, `sendInvitations` stays OPEN |
| §441 | Narrowed: the probe-shape half closed or reduced to named `unmeasured` fields; the "destroys" half stays OPEN |
| New | One entry per Relation A finding that the stop rule sends back, and per `unmeasured` field that needs a product decision |

Take numbers from `origin/main`'s maximum, never from a quoted count:
`grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1`. Every new or
changed entry carries a Status line with a command.

## Gates (only the necessary ones, no full suite)

- vitest, `--maxWorkers=1`, never backgrounded, never two at once:
  `plan.offered-surface-sweep.test.ts`, `plan.test.ts`, `plan.create-path-guards.test.ts`, and
  `plan.write-path-sweep.test.ts` whenever an update-path fix lands. Assert `Test Files N` against the
  list length.
- `npx tsc --noEmit`: read the `src/` error count, not the exit code.
- `npx eslint --max-warnings=0 <touched files>`.
- `npm run followups:index:check`, `followups:status:check`, `docs:claims:check`,
  `docs:symbols:check`, `size:check`.
- `npm run test:shuffle` is owed, because the slice adds and reorders tests. It runs at the end, and
  only on the user's say.

Read no exit code through a pipe.

## Acceptance

1. The sweep runs green against its ledger, and the ledger holds no §459 or §443-`startTime` entry.
2. **Measured, not promised:** acceptance mutant 2 (replace `...dropUnacceptedResourceFields(patch),`
   with `...patch,` in `updateResource`, `src/app/use-chat-dispatcher.ts`) and mutant 3 (replace
   `...dropUnacceptedCalendarEventFields(input)` with `...input` in `createCalendarEvent`,
   `src/app/use-register-tools.ts`) are each run against the sweep, and the spec's closing note
   records what failed. Expected: both red, through `resource.utilization` and the seeded
   `exceptions`. A survivor is recorded, not argued away.
3. **The admission check proves it fires, in both directions:** a mutant making it admit everything,
   and one making it admit nothing, each turn the ledger red. The first removes `unmeasured` findings
   the ledger expects; the second adds ones it does not. A mutant that leaves the ledger green means
   the check is not load-bearing, and is recorded as a finding against this design.
4. The §460 pin fails before the gate is removed and passes after; the rewritten `plan.test.ts` case
   passes.
5. The register gates exit 0, and every changed entry's reproduce command is re-run against the
   final tree.

## Constraints carried over

- `src/app/*.ts(x)` and `src/test/*.ts` are CRLF: Edit tool only. Docs are LF. Never touch
  `src/app/i18n.de.ts` with Edit or Write.
- `src/app/sanitize-records.ts` stays at exactly 1600 lines.
- Stage explicit paths only; `git commit --only <paths>`; never `--amend`; never `git add -A`.
- Subagent-driven, with scratch files in the session scratchpad only.
- No push, MR or merge without an explicit say; never `--auto-merge`; a review before release.

## Closing note (2026-09-11)

**Gate runs, final state:**

- Sweep alone (`plan.offered-surface-sweep.test.ts`, `--maxWorkers=1`): `Test Files 1 passed (1)` /
  `Tests 74 passed (74)`.
- Sweep plus `src/test/sweep-probes.test.ts` together: 119 passed.
- The five fixture consumers (the sweep, `plan.test.ts`, `plan.create-path-guards.test.ts`,
  `plan.write-path-sweep.test.ts` and `sweep-probes.test.ts`): `Test Files 5 passed (5)` /
  `Tests 212 passed (212)`.
- Task 8's doc/size gates, each run unpiped and read from a redirected log:
  `followups:index:check` — EXIT=0, "450 headings compared against 450 index rows... every entry has
  an index row, and every index row has an entry."
  `followups:status:check` — EXIT=0, "219 open entries scanned... all open entries carry a conforming
  Status line" (one violation surfaced and was fixed mid-task: §443's Status line used the bare word
  "CLOSED" while its heading stays OPEN, tripping the gate's `SAYS_CLOSED` check; reworded to "is now
  resolved").
  `docs:claims:check` — EXIT=0, "490 line citations across 11 docs, none added" (one violation
  surfaced and was fixed: a new `src/app/use-chat-dispatcher.ts:311,684` citation in §463 was rejected
  by the ratchet and replaced with a `grep -n "localModifiedAt: new Date"` symbol-shaped reproduce).
  `docs:symbols:check` — EXIT=0, "13 doc(s): 1650 named symbols all resolve".
  `size:check` — EXIT=0, "file-size ratchet ok".
  `sanitize-records.ts` line count: **1600** on this branch, **1600** on `origin/main` — equal, as the
  task required (not the plan's guessed "1601"; both counts happen to land at exactly 1600, which
  satisfies the equality check either way).

**Task 7 mutant table** (full detail, anchors and revert proofs in the slice's `tp7-results.md`):

| mutant | mechanism | Test Files / Tests | verdict |
|---|---|---|---|
| 1 (spec's "mutant 2") | `updateResource`: drop `dropUnacceptedResourceFields(patch)` → `...patch,` | 1 failed (1) / 1 failed \| 73 passed (74) | KILLED — new `[stored]` findings for `resource.absenceOverride`, `resource.birthday`, `resource.utilization` |
| 2 (spec's "mutant 3") | `createCalendarEvent`: drop `dropUnacceptedCalendarEventFields(input)` → `...input` | 1 failed (1) / 1 failed \| 73 passed (74) | KILLED — new `[stored]` finding for `calendarEvent.exceptions` |
| 3 | `admitProbe` forced to admit everything (`return undefined;`) | 1 failed (1) / 5 failed \| 69 passed (74) | KILLED — every `unmeasured` entry for the affected entities vanishes from the actual findings |
| 4 | `admitProbe` forced to admit nothing | 1 failed (1) / 32 failed \| 42 passed (74) | KILLED — nearly every arm turns `[unmeasured]` |

No mutant survived.

**Ledger counts, final:**

- Relation A (`EXPECTED_UNDECLARED_FINDINGS`): 12 entries — 6 `dead` (`task.jiraKey` ×2,
  `raid.noteLog` ×2, `change.noteLog` ×2) and 6 `unmeasured` (`task.resourceId` ×2,
  `stakeholder.raci`, `resource.utilizationMode` ×2, `resource.active`). Coverage rose from 20/92 to
  80/92 undeclared field-and-arm pairs over the slice (Task 5b).
- Relation B (`EXPECTED_FINDINGS`): 4 entries, all `dead` (`resource.name` ×2,
  `calendarEvent.sendInvitations` ×2). Down from `task.assigneeEmail` and `absence.startDate` also
  being invalid probes (§459, closed) and `calendarEvent.startTime` (§443, closed).

**Task 6:** none found — Relation A recorded zero `stored` findings across every run, both before
Task 5b's seeding (20/92 coverage) and after (80/92 coverage). No live undeclared write existed to
fix; the register (§463) and the mutant table above are the record that the check itself fires.

**What the plan got wrong, corrected during execution:**

1. **Step 1's expected register-max was wrong.** The plan expected `origin/main`'s max heading number
   to still be 461 by the time Task 8 ran. It had already advanced to 462 (an unrelated entry, "There
   is no Linux installer…"), so this task's new entry took 463 (max+1), and all 14 `§462` citations in
   the sweep test file's two ledgers, plus the one in this spec, were repointed to `§463` in the same
   commit, per the plan's own fallback instruction.
2. **§460's plan-supplied CLOSED reproduce witness would have been stale on arrival.** The entry as
   filed cited `grep -n 'target === "row" ? d.rawTypeGuards' src/app/inline-ai-edit/plan.ts` as its
   OPEN-state witness; by the time this task closed it, `047a60f5` had already lifted that exact
   condition, so the string no longer exists in `plan.ts` at all. Closed with
   `grep -n 'const guard = d.rawTypeGuards' src/app/inline-ai-edit/plan.ts` instead, and the stale
   witness was kept, explicitly marked stale, under "As filed" rather than deleted — deleting it would
   have erased the record of what the gate used to look like.
3. **§443's Status line tripped the status gate's own `SAYS_CLOSED` check by literal wording**, not by
   intent — see the gate-run note above. The gate reads any block containing the bare word `CLOSED`
   as a body claiming closure regardless of the heading, so "narrowed" entries that resolve one half
   while staying OPEN overall must avoid the word entirely in the Status paragraph.
4. **A citation in §463's own text tripped `docs:claims:check`'s ratchet** — see the gate-run note
   above. Corrected to a `grep`-shaped reproduce, per this repo's own standing rule to cite the symbol
   and a grep rather than a line number.
5. **The `resource.active` bullet's initial claim ("Not present on the CREATE arm — the create control
   row's own `active` default lets a probe be derived and measured there") was too vague to defend.**
   Traced through `probeFor`'s actual branches before publishing: `CREATE_BASE.resource` carries no
   `active` key at all (only `firstName`/`lastName`), so the create arm's reference differs from the
   seed's `false` on its own and a real, admitted probe is derived — the update arm's reference already
   IS that seeded `false`, leaving only the invalid `true` probe-shape violation. §463's final wording
   names the mechanism rather than asserting the conclusion alone.
