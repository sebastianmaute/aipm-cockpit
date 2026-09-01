# Work inventory — open, planned and sketched

> Compiled 2026-08-21 against `main` at 0.252.0 "Brust"; sections 4, 5 and 7 re-measured later the
> same day against `6c4e4162` (0.253.0 "Schroeder"). **Every number here rots.** Each claim carries
> the command that reproduces it — run the command, never quote the number.
>
> ★★ It rotted inside one day: the register gained §201, `followups:check` moved by one, and a whole
> tech-debt row was resolved while another was opened. That is the intended failure mode of this
> file, not a defect in it — but it means a reader arriving a week from now should re-run before
> believing any figure below.
>
> ★★★ **RE-MEASURED 2026-09-01 against `main` at 0.272.1 "Zoline" — every JUDGEMENT here held and
> every NUMBER had moved.** §3's backlog and §7's sequence were both still right, §5's open/resolved
> split still matched the register row for row, and §6's substance was unchanged; §1, §4, §5's
> duplication figure and §6's hit count were all wrong, and two reproduce commands had been falsified
> outright (both recorded at their sites). Eleven days. That ratio — judgements durable, counts
> perishable — is the argument for the rule in the paragraph above, and the reason this file leads
> with a command rather than a table.

## 1. Where the planning corpus lives — recovered, and now tracked

★★★ **This section describes a state that was CHANGED on 2026-08-21.** Until then
`docs/superpowers/` was gitignored, the corpus was split across two checkouts plus seven zip
archives, and no single location held all of it. The ignore rule has been dropped and the full union
committed. What follows records the recovery, because the recovery is the only reason the older
material still exists.

The tree held **218 specs + 238 plans** at compile time, spanning 2026-05-19 to 2026-08-20 — on
2026-09-01 it holds **252 + 270**. It was assembled from
three sources that each held a different subset:

| Source | Contributed |
|---|---|
| the working worktree | the newest slices (Aug 5–20) |
| the main checkout | the May–Aug 13 body |
| `_archive-slice-docs-*.zip` | **298 documents that existed nowhere else** |

★★ **Those 298 were one directory deletion from gone.** They lived only inside zip archives in a
single checkout, unreferenced by git. The UX-batch roadmap had mandated a cumulative re-archive at
every slice close, with an asserted superset check, precisely because a predecessor document had
already been lost this way — and that rule stopped being followed after 2026-07-29 while releases
kept shipping. Re-derive the corpus size rather than trusting the numbers above:

```bash
ls -1 docs/superpowers/specs | wc -l ; ls -1 docs/superpowers/plans | wc -l
```

★ The recovery asserted the property the roadmap asked for — every entry of all seven zips is
present in the tree. Assert it again before trusting any future archive:

```python
missing = {basename(n) for n in ZipFile(z).namelist()} - set(tree)
assert not missing
```

★★ **Eight recovered files were sanitized before landing.** They carried an internal GitLab host, a
group path, a numeric project id, a second internal repository name, and one work email alongside a
phone number and birthday. Those became `gitlab.example.com`, `<group>/<subgroup>`, `<PROJECT_ID>`
and `@example.com`. Branding-token mentions (`AIPM`, `Acme`, `AIPM-consult`) were deliberately
LEFT — they are token names, the same class already tracked in `docs/AGENTS/theming.md`. This
matters because the repository is push-mirrored to GitHub; the entry in `docs/open-followups.md`
about flipping that mirror public owns the wider question.

★ The zips are NOT tracked. They are redundant once the superset holds, and they are ~17 MB of
binaries. They remain in the main checkout as a second copy.

## 2. What the plan checkboxes tell you: nothing

Plans are written with task checkboxes and **never ticked during execution**. Measured across the
full corpus: of the 233 plans that carry checkboxes, **231 have zero ticked** — including plans
whose work demonstrably shipped (dictation-position-hygiene, tiptap-lazy-bundle and ai-recall-b2a
all released).

★★ Do **not** use checkbox state as a completion signal — it reads every shipped slice as
untouched. Ground truth is the merge history and `CHANGELOG.md`:

```bash
git log origin/main --merges --pretty=%s | grep -oE "Merge branch '[^']+'" | sort -u
```

★ Slug-to-branch fuzzy matching was tried and is also unreliable — it scored shipped slices
(ui-batch-slice-2, activity-log-workspace-data) as weak-evidence. Verify per item, by name.

## 3. Designed but NOT built — the real backlog

Three items have approved designs and no implementation. These are the roadmap.

★ A fifth row sat here until 2026-08-22 — the app-wide icon migration, which was the opposite shape
(a decision with no design yet). It has since been specced, built and shipped in 0.255.0 "Bisson",
so it is no longer backlog; `docs/tech-debt-register.md` TD-8 carries it under Resolved.

★★★ **A SIXTH ROW — S3c-2, OOXML media parts for document images — WAS STILL HERE ON 2026-08-25, AND
IT HAD SHIPPED TWO DAYS AFTER THIS FILE WAS COMPILED.** Its evidence cell read "no OOXML media-part
code exists anywhere in the renderers", which is exactly the kind of claim that stops being true
without anything editing the sentence. 0.256.0 "Khaw" (2026-08-23) shipped it:
`grep -rln "EMU_PER_TWIP" src/app` returns `doc-render-docx.ts`, `ooxml-media.test.ts` and
`ooxml-media.ts`; `ls src/app/ooxml-media.ts` resolves. The as-built architecture is in
`docs/AGENTS/documents.md`'s "Image bytes in every export format (S3c-2)" section. What it opened instead is a **manual verification debt** — nothing in this
repo can open a `.docx` or a `.pptx`, so the eye-verify is owed (`docs/open-followups.md` §219),
which is a different item from an unbuilt slice and does not belong in this table.

| Item | Design lives in | Evidence it is unbuilt |
|---|---|---|
| **S6 — Outlook push for calendar events** (incl. invitations + confirm) | UX-batch roadmap plus its own spec/plan pair | no `CHANGELOG.md` match for calendar-event push |
| **S7 — Outlook pull + exception reconciliation** | same roadmap | same |
| **`optimize_wbs`** | multi-surface roadmap, Release 4 | `docs/open-followups.md` section 3, "never built — owed from R4"; the name appears in no source file |

★★★ **THE "S3c" LABEL AMBIGUITY IS DISCHARGED — corrected 2026-08-21.** The documents roadmap
originally defined "S3c" as *images end to end*, and 0.252.0 shipped **structural blocks** (add,
delete, reorder) under that same plain label — a scope collision that would have retired the images
design by accident. That slice is now retagged **S3b-2** in the design document and in
`docs/open-followups.md` §113. Images shipped as **S3c-1** in 0.254.0 "Yoshinaga" (metadata slice on all six
write paths + `document_asset_data`, a `TABLE_NAMES`-excluded side table for the bytes) — see
`docs/AGENTS/documents.md`'s "Asset images (S3c-1)" section for the as-built architecture. **S3c-2**
(OOXML media parts) then shipped in 0.256.0 "Khaw", so the whole S3c question is now closed as built.

★ The documents roadmap is now fully shipped: S3a, S4, S3b, S3b-2, S3c-1 and S3c-2. Its own
spec header used to read "design approved, unimplemented" for the whole file, unchanged since
2026-08-08 — that has been corrected in place.

### Roadmaps and their true state

- **UX batch, 8 slices, order C → D → F → A → E → S6 → S7 → B.** C, D and F shipped and are marked
  so. A, E and B are marked "TBD" in the roadmap but **have shipped** (Manual % complete; project
  config in Settings → General plus the theme gallery; the dated note log and rich descriptions).
  Only **S6 and S7** remain. The roadmap's own status column is therefore wrong for three rows.
- **Documents roadmap (S3a, S4, S3b, S3b-2, S3c-1, S3c-2).** See above — **every slice has shipped**,
  S3c-2 last, in 0.256.0. Nothing on this roadmap is open; the only residue is the owed manual
  `.docx`/`.pptx` eye-verify (`docs/open-followups.md` §219).
- **Multi-surface roadmap, Releases 1–5.** R4 left `optimize_wbs` unbuilt; R5 is where S6 and S7 are
  owed from.

★ Corrected while compiling this: the insights-action-loop sp2 branch **is** in the merged-branch
list, along with sp3 and sp4. A memory note calling it unmerged was stale. Do not re-open it.

## 4. `docs/open-followups.md`

**193 sections, numbered 1–201** at compile time, no duplicates, 8 gaps (17–20, 23, 25–27) left by
the consolidation slice. ★★★ **On 2026-09-01 it is 315 sections, numbered 1–324, still no
duplicates, 9 gaps — the eight above plus 323.** That is **+122 sections in eleven days**, and it
is the single fastest-rotting figure in this file. Re-measure with
`grep -oE "^## [0-9]+." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1` for the max
and `grep -cE "^## [0-9]+." docs/open-followups.md` for the count.

★ The hand-classified status split recorded at first compile — **118 open, 57 closed, 9 unmarked,
7 unclear, 1 partial**, so **135 not closed** — covered 192 sections and has NOT been redone.
§201 carries **no status suffix at all**, so on that same self-declared measure it joins *unmarked*
(9→10) and *not closed* (135→136) while *open* stays at 118. It is substantively open, but saying
that here would mix the two measures this paragraph exists to keep apart. Nothing checked whether
anything else moved. ★★★ **AND ON 2026-09-01 THAT SPLIT NO LONGER DESCRIBES MOST OF THE REGISTER.**
It covered 192 of 193 sections when compiled — effectively a census. Against today's 315 it is a
**minority sample of roughly 61%**, and `npm run followups:status:check` scans **174 open entries**
against its 118. A stale census reads like a census; re-derive or ignore it, but do not reconcile
today's numbers against it. ★★ Do not re-derive that split with a heading regex and call it a correction: a crude
`open|CLOSED` match over the headings today returns **106 / 55 / 32-neither**, which disagrees with
the hand count by twelve. That gap is not drift — it is the two incompatible status conventions
below, and it is the measurement this file's own warning predicts.

★★★ **THIS NO LONGER DESCRIBES THE REGISTER — corrected 2026-08-25.** It read: "Status is recorded
two incompatible ways: older entries put it in the heading (a struck-through title means closed),
newer ones use a bolded Status line. Only 17 entries have the latter. Any script that reads one form
silently mis-classifies the other." `docs/open-followups.md` now states ONE convention in its own
header — closure lives in the `##` HEADING as the literal marker `— CLOSED`, a `**Status:**` body
line may repeat it but is never the only marker, and a PARTIALLY closed entry stays open and says
`FIXED` (never `CLOSED`). It also carries a generated index table with a status column per entry.
★★ So the count is a command now, and this file quotes none of it: read the register's own header,
which prints three independent spellings that agree by construction. Struck-through titles survive on
older entries and are cosmetic; they no longer carry the status.

★★★ **A self-declared "open" is an upper bound, not a fact.** An entry can describe behaviour fixed
two releases ago. `npm run followups:check` classifies entries by whether the symbols and paths they
cite still exist. It **exits 0 regardless**, runs in no CI job, and its own output says it rules
claims out but never in.
★★ **No tally is quoted here, deliberately — this paragraph froze one and it was wrong four days
later.** It said "**CLEAN 125** … **130 open entries** and SYMBOL_MISSING/PATH_MISSING both zero",
measured 2026-08-21 at `73461ca4`. On 2026-08-25 the same command reported CLEAN 151,
SYMBOL_MISSING 5 and PATH_MISSING 1, and the register held 232 entries. Run
`npm run followups:check` and read its own summary line; take the entry/open/closed split from the
register's header commands.
★★ **A flag is a QUESTION, not a defect, and every one of the SIX flagged entries is a DELIBERATE
absence the entry itself spells out.** Name them rather than counting them — §7 says "still no
`src/app/form-field.tsx`"; §204 says "neither name exists in the code today"; §58 names a browser
API (`MutationObserver`); §213's `wroteBytesRef` comes from its own **Candidate fix** block and is
explicitly not built; §214 names `noUnusedLocals` and `noUnusedParameters` precisely because
`tsconfig.json` sets NEITHER, which is that entry's whole point; §215's `resource_group` is a
GitLab CI keyword in a proposed remedy. ★★ An earlier revision here said "every one of the three"
while the script flagged six: the PROPERTY survived and the COUNT did not, which is why the list is
written out and the number is not. Read it off the script — `npm run followups:check`. ★★ The script DOES carry
absence vocabulary — `followup-claims-lib.mjs` builds `REGISTER_ABSENCE_PATTERNS` from the same
`ABSENCE_MARKERS` the symbols gate uses — so "it has no such notion" would be the wrong lesson. The
patterns are phrase-shaped and simply did not match these wordings. ★★★ That said "these THREE
wordings" until 2026-08-25 — in the same paragraph as a sentence corrected in the SAME edit from three to
six, so the stale noun sat inside its own correction and read as freshly verified. When a count
changes, re-read the WHOLE paragraph for every clause that agreed with the old value; the number and
the noun rot independently. Read the entry before treating a flag as work; a miss here is a pattern
gap, not a rotted claim.

★ It reports false positives on entries that quote filenames as prose rather than citing them —
two such fragments were the actual cause of two of the flags corrected below, not the resolver gap
this section used to claim.

★★ **The claim that used to sit here — "its resolver walks `src`/`scripts`/`e2e` ONLY, so every
`docs/` path it meets is reported PATH_MISSING" — was already false when it was written: `docs/**`
was indexed by `collectDocs()` at this slice's own branch point, `98ee220a`.** Acting on it would
have rewritten already-correct code and left every real cause standing. The real causes, all fixed
in this slice:
1. `SKIP_DIRS` excluded `docs/superpowers` inside `collectDocs()`, so the whole planning corpus read
   as deleted (§145) — fixed by `d501c200` + `da725bff`, which gave `collectDocs` a skip-list
   parameter and added `collectResolutionSources()` to separate "does this path exist" from "is this
   a citable code file".
2. `SOURCE_EXT` carried no `md`, so the one markdown fixture tracked under the code tree
   (`src/app/__fixtures__/golden-workspace.md`) was in no index and read as deleted (§200) — fixed by
   `da725bff`.
3. The sweep's own `SWEEP_SELF_FILES` exclusion produced a `SYMBOL_MISSING` no probe could ever
   discharge (§138) — fixed by `86cb4116`, adding a distinct `SYMBOL_SELF_EXCLUDED` verdict.
4. Two prose fragments parsed as citations (§131, §200) — fixed by `96f5b44d`.

Two more causes turned up *during* the slice, past what triggered it:
5. Symbols living in `node_modules` had no classification, so §51 and §53 read `SYMBOL_MISSING`
   forever despite being correct — fixed by `4afeb4a7`, adding a `SYMBOL_THIRD_PARTY` verdict.
6. The symbol sweep never scanned the repo root, so `globalIgnores` in `eslint.config.mjs` (§189)
   was missing forever — fixed by the same `4afeb4a7`, which widened the walk to cover root-level
   config (deliberately excluding `.json`, so `package-lock.json` cannot inject every dependency name
   as a phantom symbol).

Rough thematic split of the 135, by heading keyword only — indicative, not authoritative:
a11y and WCAG 21, rich text 14, doc accuracy 13, documents 8, tests and gates 8, AI and chat 7,
perf and bundle 7, integrations 6, UI panels 6, storage and codecs 3, security 1, unclassified 41.

## 5. Tech debt register

`docs/tech-debt-register.md` — **TD-1, TD-2, TD-3, TD-5 and TD-7 open**; TD-4, TD-6 and TD-8
resolved. The next quarterly sweep is dated **2026-10-03**; owners are role placeholders, never
assigned. Re-derive with `grep -n "^| TD-" docs/tech-debt-register.md`.

★★★ **TD-6 IS RESOLVED — the goal was already met and nobody had measured.** This file first
recorded it as "stale numbers" (about 1.92% total against a 2.4% gate). Both figures were wrong and
so was the framing: `npm run dup:check` reported **1.20%** on 2026-08-21 (**1.17%** on 2026-09-01 —
the resolution below is unaffected, and the figure is dated rather than overwritten because it is
part of a decision record), the Phase 1 baseline
(`docs/baselines/jscpd-2026-07.json`) is **3.065%**, and 1.20/3.065 is **39%** against a ≤50%
target. ★★ Two things got it there and neither alone would have: duplicated lines fell 2701→1833
*and* the denominator grew 88k→153k — at the baseline's absolute line count today's tree would read
1.77%, over the threshold. ★★ The row's whole "binding format" theory was also refuted: the gate
compares ONE number, the total duplicated-LINE percentage, per `AGENTS.md`'s exit-code bisection.
The deferred structural tail it had been saving for the last stretch was never needed.

★★ **TD-8 is RESOLVED — the migration shipped in 0.255.0 "Bisson" (2026-08-22).** `@heroicons/react`
is gone from `package.json`, every former call site imports the `src/app/icons.ts` barrel, and an
ESLint rule blocks the package's return. Re-derive rather than quoting:
`grep -rn "from \"@heroicons/react" src/app | wc -l` returns **0**, as does
`grep -c "@heroicons/react" package.json`.

★★★ **THE COMMAND THIS LINE USED TO CARRY IS NOW FALSIFIED BY ITS OWN FIX, AND THAT IS THE POINT.**
It read `grep -rln "@heroicons/react" src/app | wc -l` returns **0**. On 2026-09-01 it returns
**1** — `src/app/icons.ts`, whose comment explains that the package is no longer used. Nothing
regressed: there is still no import and no dependency. The bare package name was matched by the
DOCUMENTATION of its own removal, which is this repo's `self-referential-grep` landmine reaching a
prose register. **Anchor an absence grep on the syntax that would constitute the presence** — an
`import`/`from` clause, a manifest key — never on the bare name, which prose will reintroduce.

★ What this row said before is worth keeping as a record of how the entry read while it was open:
heroicons and `lucide-react` shipped side by side, 78 files against 1, owned and decided but with no
spec and no date. The register at that time said "scheduled" while §3 of this same file said **no
spec yet** — §3 was the accurate one, because a decision to do the work is not a schedule for it.
That distinction is the reason the slice got a spec of its own instead of being folded into the
decision that authorised it.

★ Dependency rows: `eslint` 10 is **BLOCKED** upstream via `eslint-config-next`, confirmed by an
executed attempt. `@types/node` **landed in this slice** — bumped `^20` → `^24` with zero `tsc`
errors (`a698eac2` / `da9695d0`); it is no longer deferred or pending.

## 6. Code markers

**Zero** TODO, FIXME, HACK or XXX markers in `src`, `scripts` or `e2e`. The bare word-boundary grep
returned **one** hit at compile time and returns **two** on 2026-09-01, neither of them a marker:
`scripts/agents-symbols-lib.mjs` uses TODO as an example inside a gate's own docstring, and
`src/app/jira-projects.test.ts` passes `"XXX-1"` as a Jira **issue key**. ★★ The count is the thing
that moved; the finding did not. A marker sweep on a codebase that does not use markers measures how
often those four letters occur for other reasons, which grows with the tree. Deferred work in this repo is tracked in
prose registers, never in code comments — so a marker sweep finds nothing and proves nothing.

## 7. Suggested sequence

1. **S6 then S7** — design is already done and verified, and they are the last two UX-batch slices.
2. **S3c-2 — OOXML media parts** — **done**, shipped 0.256.0 "Khaw" (2026-08-23). Not a pickable
   slice. What it left behind is the manual `.docx`/`.pptx` open-in-Word eye-verify nothing in this
   repo can perform (`docs/open-followups.md` §219) — a verification owed, not a slice to plan.
3. **`optimize_wbs`** — carries an open design question, so it needs a decision before a plan.
4. **Follow-up triage** — done in that slice. It drove SYMBOL_MISSING 13 → 0 and PATH_MISSING 3 → 0.
   ★★ **No tally is quoted here any more, deliberately.** This line froze one ("CLEAN 125 … both
   **zero**") and every subsequent edit to `docs/open-followups.md` moved it: on 2026-08-25 the same
   command reported CLEAN 151, SYMBOL_MISSING 5, PATH_MISSING 1. Run `npm run followups:check` and
   read its own summary line. ★★ And read the flags as questions, not defects — the SIX flagged
   entries are all DELIBERATE absences the entries themselves spell out; the script names them
   (§7, §58, §204, §213, §214, §215) and the paragraph above carries the reading of each. ★★ It
   exits 0 regardless, which is why it is a report and not a gate — that is the half of this
   sentence that was true. It DOES carry absence vocabulary (`REGISTER_ABSENCE_PATTERNS` in
   `scripts/followup-claims-lib.mjs`); the patterns are phrase-shaped and simply did not match these
   wordings, so "it has no such notion" would be the wrong lesson. Nothing here is a pickable slice
   any more.
5. **`@types/node`** — done, `^24` (`a698eac2` / `da9695d0`); no longer a pickable slice.
6. **Icon migration (TD-8 / §145)** — **done**, shipped 0.255.0 "Bisson". No longer a pickable
   slice, and no longer a decision to make.

★ The archive-the-planning-tree item that led this list is **done** — see section 1.
