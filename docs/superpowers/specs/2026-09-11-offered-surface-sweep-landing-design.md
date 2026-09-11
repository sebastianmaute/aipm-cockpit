# Landing the offered-surface sweep on main

_Opened 2026-09-11 against 0.302.0 "Blaylock". Lands the DETECTOR half of
`feat/offered-surface-sweep` (local only, never pushed, last commit 2026-09-09). The FIX half already
shipped in 0.297.0 "Gentle" (MR !460)._

## Why this exists

`feat/offered-surface-sweep` executed its own plan
(`docs/superpowers/plans/2026-09-08-offered-surface-sweep.md`) through the Task 10 go/cut gate, then
fixed what the detector found. The fixes were carried onto a rebased branch and released; the
detector was not. Main therefore carries the fixes with nothing guarding them against a regression of
the class that found them.

Reproduce the split — nothing below is to be trusted without it:

```bash
MB=$(git merge-base origin/main feat/offered-surface-sweep)        # 754e8129 today
git log --format='%h %s' $MB..feat/offered-surface-sweep            # 20 commits
git log --format='%h %s' 71a75cee^2 --not 71a75cee^1               # what 0.297.0 took
for f in src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/test/offered-surface-axis.ts \
         docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md \
         docs/superpowers/plans/2026-09-08-offered-surface-sweep.md; do
  git cat-file -e origin/main:$f 2>/dev/null && echo "ON MAIN $f" || echo "missing $f"; done   # all four missing
```

## Goal

The sweep, its axis module and its register bookkeeping on `main`, **green against main's code as it
stands today**, with its acceptance mutants re-proved there.

## Non-goals

- Fixing anything §440 · §441 · §443 · §445 · §446 describe. They stay OPEN.
- Any production-code change. The one `src/app/*.ts` edit allowed is a comment (see "The one comment").
- A version bump or CHANGELOG entry — this is tests and docs only, so the refactor-only rule applies.

## The partition — which commits port and which already landed

Five branch commits are FIX commits. Main has each of them in a later, review-corrected form, so they
are NOT ported; their code on main wins.

| Branch commit | Main twin | How matched |
|---|---|---|
| `57da39f6` strip token-excluded fields from every pass-through create | `29744af1` | identical subject |
| `4c28d3fd` correct the prose and types that outlived the decisionDate withdrawal | `8162aa91` | identical subject |
| `6db1ea93` stop offering change.decisionDate, and make it unwritable | `eca6312d` withdraw change.decisionDate from every model-writable surface | same change folded into one commit — **verify by diff before relying on it** |
| `7e91855d` withdraw change.decisionDate from the inline-edit descriptor | `eca6312d` (as above) | as above |
| `040c24f6` record which two create-strip sites a mutant cannot kill | **none** | deliberately absent — it cites the sweep test, which main lacks. See "The one comment". |

The other fifteen commits touch only the four missing files, `docs/open-followups.md`, and two
existing test files. They are the port.

★★ Two FIX commits also edit `src/test/offered-surface-axis.ts` (`6db1ea93`, 14 changed lines;
`4c28d3fd`, 16 — `git show --stat --format= <sha> -- src/test/offered-surface-axis.ts`). That file exists only on the branch, so those hunks travel with it — porting the branch's
FINAL version of the axis carries them. Dropping the fix commits must not drop those hunks.

## Port method

1. **Spec and plan** (`dbc74e01`, `fc3ca56f`, plus `681c6c07`'s 10-line plan correction) come across
   as the branch's final files, each given a dated banner saying execution split: fixes shipped in
   0.297.0, detector landed here. The body is a dated record and is not rewritten.
2. **The axis and the sweep** come across as the branch's final files.
3. **`plan.create-path-guards.test.ts`** — `5f0de0de` lifted its create base payloads into the axis
   (`CREATE_BASE`). Main has since changed this file twice (`3ca1a9d9`, `ee6a7ef7`), so the lift is
   re-done by hand against MAIN's version, never by taking the branch's copy.
4. **`plan.model-writable-surface.test.ts`** — `f99aa51a` + `799ae26c` repoint the §437 ratchet at
   the shared `PERSISTED_COLUMNS`. Main has not touched this file since the fork, so these should
   apply cleanly; confirm with `git log $MB..origin/main -- <file>` returning nothing.
5. Everything is written against main's CRLF `src/app` files with Edit, never Write or `sed -i`.

## The measurement gate — the real work

The axis reads `TOOL_DEFS` at runtime, and main gained declarations after the fork (`599a87bf`
`raid.ownerEmail`, `43ae5cab` `stakeholders.email`, `6a068ebb` RAID owner on the seed schema,
`2645debb` the proposal seed-schema strip). So the sweep's case set and every figure it recorded may
have moved. Nothing measured on the branch transfers.

1. **Run the sweep and its neighbours against main**, serially, exit code read unpiped.
2. **It must be GREEN to land** — `unit-tests` is blocking. The branch landed red by design at its
   baseline ("73 tests, 11 failing, 15 findings", §439's closure text); its tip state was never
   recorded. So "green" is measured here, not inherited.
3. **A red case is a FINDING, not a test to fix.** Stop and put it to the user as go/cut, exactly as
   the original Task 10 did. Never make the sweep green by exempting a field, narrowing a probe or
   weakening a floor — the branch plan's executor notes record a precedent for each of those hiding a
   live defect.
4. **Re-prove the six acceptance mutants** (branch plan, Task 8) against main. The fixtures and the
   code under them changed, and a fixture change can unpin a property with the suite still green.
   Compare per-case finding COUNTS, never pass/fail tallies. Revert each mutant with a
   uniqueness-asserted anchor and end on an empty `git diff --stat`.

## The one comment

`040c24f6` added a ★★ note to `src/app/chat-tools-updates.ts`: two of the seven create-strip call
sites are defence in depth, measured because reverting the strip at `create_absence` or
`create_calendar_event` leaves the sweep unchanged. It was correct to leave it out while the sweep was
absent. Once the sweep lands it is re-applied **only if re-measured against main** — main's `ee6a7ef7`
("enumerate every create tool") may have changed the call-site count, so "two of the seven" is a
claim to re-derive, not to copy. If the measurement disagrees, the comment carries main's numbers.

## Register (`docs/open-followups.md`, LF)

Every row's TEXT was written against branch code. Each is re-checked against main before it is
copied, and corrected in the same commit where main disagrees.

| § | Action |
|---|---|
| 436 · 439 | CLOSE — by the sweep, with main's measured figures, not the branch's |
| 440 · 441 · 443 · 446 | MINT, OPEN, text verified against main |
| 442 | MINT as CLOSED by 0.297.0 (the fix is on main; the register never recorded the finding) |
| 444 | `test:shuffle` owed — MINT, and close it on the MR's green `unit-tests-shuffled` job, citing the pipeline |
| 445 | `propose_project` unreachable by both relations — re-check against `2645debb` first; mint OPEN only if still true |

★ Numbers are reserved only once they are on `origin/main`. §440–446 are free on main and on every
other branch today (`git show <ref>:docs/open-followups.md | grep -oE '^## 44[0-9]\.'` over each);
re-check immediately before the commit that mints them. `followups:index:check` and
`followups:status:check` gate the result.

## Constraints

- `src/app/sanitize-records.ts` is untouched — it sits at the 1600-line LIMIT with no headroom (§447).
- `src/app/i18n.ts` / `i18n.de.ts` are untouched; nothing here needs a key.
- New files follow whatever line endings their directory already uses — check `git ls-files --eol`
  after staging, against a neighbour in the same directory.
- Never `git add -A`. Stage explicit paths; commit with `git commit --only <paths>`.

## Gates

Only those this slice can move: the sweep and the test files it touches, `npx tsc --noEmit` (read the
`src/` error count), `npx eslint --max-warnings=0` over the touched files, `size:check`,
`docs:symbols:check`, `docs:claims:check`, `followups:index:check`, `followups:status:check`. The full
suite and the shuffled suite run in CI.

## Release

Cold review before release. No bump, no CHANGELOG. Push, MR (`--auto-merge=false`), poll, merge on
green — each only on the user's say-so.

## As executed (2026-09-11)

Added after execution; everything above is the spec as committed in `07805104` "docs(spec): land the
offered-surface sweep's detector, which 0.297.0 left behind" and is not rewritten. This section covers
only the departures that change a decision this spec made, up to `32769326` "docs(followups): close
436 and 439, file 440-446 and 459-461, and correct the create-path gate comment". Every other
departure (the commit map, corrected counts, mutant outcomes, the create-strip note's shape, the
Task 9 split) is recorded in the plan,
`docs/superpowers/plans/2026-09-11-offered-surface-sweep-landing.md`, section "As executed
(2026-09-11)".

- **Green to land, by a ledger ("The measurement gate", points 2 and 3).** The first run on main gave
  73 tests with 5 failing cases and 6 finding lines, all in Relation B and none a write-path defect.
  The go/cut decision taken at that stop was to hold those findings in `EXPECTED_FINDINGS`, checked in
  both directions: a new finding turns its case red, and so does a ledgered finding that stops firing
  (`eef92310` "test(ai): hold the sweep's six known findings in a ledger checked both ways"). No field
  was exempted, no probe narrowed and no floor weakened. The sweep landed at 74 tests, 0 failing.
- **The ledger compares field and kind, not text.** In the first fix round the entries were re-keyed
  from exact finding strings to `{ subject, kind }` over one `FINDING_KINDS` array, compared as sorted
  `subject:kind` tokens in both directions, so rewording a production error message no longer turns
  the sweep red (`70615677` "test(ai): key the sweep's findings ledger by field and kind, and correct
  the comments a review disproved").
- **Register ("Register" table).** Its rows landed as decided: §436 and §439 CLOSED 2026-09-11;
  §440, §441, §443, §446 OPEN; §442 CLOSED 2026-09-09; §444 OPEN until the merge request's
  `unit-tests-shuffled` job; §445 OPEN, because its reachability claim still holds although
  `2645debb` fixed the write defect. Three entries the table does not list were also filed OPEN in
  `32769326`: §459 (two create-arm probes invalid by construction, `task.assigneeEmail` and
  `absence.startDate`, first seen on the local-only original branch), §460 (a create card can preview meeting attendees the
  create then stores none of; suspected, not runtime-verified) and §461 (an absence stores an assignee
  email that is not an address, where a task refuses it).
- **"The one `src/app/*.ts` edit allowed is a comment" ("Non-goals").** Two such files carry comment
  edits, not one: `src/app/chat-tools-updates.ts` ("The one comment", `78569052`, adjusted by
  `70615677`) and `src/app/inline-ai-edit/plan.ts` (`32769326`, a comment false since `68486cd4`,
  released in 0.294.0). Neither changes behaviour, and this command lists exactly those two files:
  `git diff --stat fe82d1db 32769326 -- 'src/app/*.ts' ':(exclude)*.test.ts'`
- **Probe fixes deferred.** The sweep's probe blind spots found during execution (Relation A's trespass
  probe is never a valid value; `validProbeFor` has no object branch; two create-arm probes derived
  from seeded values; no fixture seeds `exceptions`) are recorded in the sweep's comments, in §441 and,
  for the two create-arm probes, in §459, not fixed. Fixing them, and fixing §460 together with the `plan.test.ts` case "does NOT apply the
  guard to a create, whose write never sees it", is a follow-up slice. This keeps to "Non-goals":
  nothing §440, §441, §443, §445 or §446 describes was fixed here.
