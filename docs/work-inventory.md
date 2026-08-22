# Work inventory — open, planned and sketched

> Compiled 2026-08-21 against `main` at 0.252.0 "Brust"; sections 4, 5 and 7 re-measured later the
> same day against `6c4e4162` (0.253.0 "Schroeder"). **Every number here rots.** Each claim carries
> the command that reproduces it — run the command, never quote the number.
>
> ★★ It rotted inside one day: the register gained §201, `followups:check` moved by one, and a whole
> tech-debt row was resolved while another was opened. That is the intended failure mode of this
> file, not a defect in it — but it means a reader arriving a week from now should re-run before
> believing any figure below.

## 1. Where the planning corpus lives — recovered, and now tracked

★★★ **This section describes a state that was CHANGED on 2026-08-21.** Until then
`docs/superpowers/` was gitignored, the corpus was split across two checkouts plus seven zip
archives, and no single location held all of it. The ignore rule has been dropped and the full union
committed. What follows records the recovery, because the recovery is the only reason the older
material still exists.

The tree now holds **218 specs + 238 plans**, spanning 2026-05-19 to 2026-08-20, assembled from
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

Four items have approved designs and no implementation, plus one item below that is the opposite
shape: a decision with no design yet. These are the roadmap.

| Item | Design lives in | Evidence it is unbuilt |
|---|---|---|
| **S6 — Outlook push for calendar events** (incl. invitations + confirm) | UX-batch roadmap plus its own spec/plan pair | no `CHANGELOG.md` match for calendar-event push |
| **S7 — Outlook pull + exception reconciliation** | same roadmap | same |
| **S3c-2 — OOXML media parts for document images** | documents roadmap; `docs/open-followups.md` §202 | DOCX/PPTX still disclose a visible placeholder naming the asset instead of embedding it; no OOXML media-part code exists anywhere in the renderers |
| **`optimize_wbs`** | multi-surface roadmap, Release 4 | `docs/open-followups.md` section 3, "never built — owed from R4"; the name appears in no source file |
| **App-wide `@heroicons/react` → `lucide-react` icon migration** | decision recorded 2026-08-21 in `docs/tech-debt-register.md` TD-8 and `docs/open-followups.md` §145 (closed as a decision); **no spec yet** | 78 files still import `@heroicons/react` (`grep -rln "@heroicons/react" src/app`); nothing has been brainstormed or planned for the conversion itself — that is its own slice |

★★★ **THE "S3c" LABEL AMBIGUITY IS DISCHARGED — corrected 2026-08-21.** The documents roadmap
originally defined "S3c" as *images end to end*, and 0.252.0 shipped **structural blocks** (add,
delete, reorder) under that same plain label — a scope collision that would have retired the images
design by accident. That slice is now retagged **S3b-2** in the design document and in
`docs/open-followups.md` §113. Images shipped as **S3c-1** in 0.253.0 (metadata slice on all six
write paths + `document_asset_data`, a `TABLE_NAMES`-excluded side table for the bytes) — see
`docs/AGENTS/documents.md`'s "Asset images (S3c-1)" section for the as-built architecture. Only
**S3c-2** (OOXML media parts, the table row above) remains open.

★ The rest of the documents roadmap is now fully shipped: S3a, S4, S3b, S3b-2 and S3c-1. Its own
spec header used to read "design approved, unimplemented" for the whole file, unchanged since
2026-08-08 — that has been corrected in place.

### Roadmaps and their true state

- **UX batch, 8 slices, order C → D → F → A → E → S6 → S7 → B.** C, D and F shipped and are marked
  so. A, E and B are marked "TBD" in the roadmap but **have shipped** (Manual % complete; project
  config in Settings → General plus the theme gallery; the dated note log and rich descriptions).
  Only **S6 and S7** remain. The roadmap's own status column is therefore wrong for three rows.
- **Documents roadmap (S3a, S4, S3b, S3b-2, S3c-1, S3c-2).** See above — only S3c-2 (OOXML media
  parts) is open.
- **Multi-surface roadmap, Releases 1–5.** R4 left `optimize_wbs` unbuilt; R5 is where S6 and S7 are
  owed from.

★ Corrected while compiling this: the insights-action-loop sp2 branch **is** in the merged-branch
list, along with sp3 and sp4. A memory note calling it unmerged was stale. Do not re-open it.

## 4. `docs/open-followups.md`

**193 sections, numbered 1–201**, no duplicates, 8 gaps (17–20, 23, 25–27) left by the consolidation
slice. Re-measure with
`grep -oE "^## [0-9]+." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1` for the max
and `grep -cE "^## [0-9]+." docs/open-followups.md` for the count.

★ The hand-classified status split recorded at first compile — **118 open, 57 closed, 9 unmarked,
7 unclear, 1 partial**, so **135 not closed** — covered 192 sections and has NOT been redone.
§201 carries **no status suffix at all**, so on that same self-declared measure it joins *unmarked*
(9→10) and *not closed* (135→136) while *open* stays at 118. It is substantively open, but saying
that here would mix the two measures this paragraph exists to keep apart. Nothing checked whether
anything else moved. ★★ Do not re-derive that split with a heading regex and call it a correction: a crude
`open|CLOSED` match over the headings today returns **106 / 55 / 32-neither**, which disagrees with
the hand count by twelve. That gap is not drift — it is the two incompatible status conventions
below, and it is the measurement this file's own warning predicts.

★★ Status is recorded two incompatible ways: older entries put it in the heading (a struck-through
title means closed), newer ones use a bolded Status line. Only 17 entries have the latter. Any
script that reads one form silently mis-classifies the other.

★★★ **A self-declared "open" is an upper bound, not a fact.** An entry can describe behaviour fixed
two releases ago. `npm run followups:check` classifies entries by whether the symbols and paths they
cite still exist — re-run 2026-08-21 at `73461ca4`: **CLEAN 125**, NO_MACHINE_CLAIM 1,
SYMBOL_THIRD_PARTY 2, PATH_THIRD_PARTY 1, SYMBOL_SELF_EXCLUDED 1 — **130 open entries and
SYMBOL_MISSING/PATH_MISSING both zero** (13 and 3 at this slice's branch point). It **exits 0
regardless**, runs in no CI job, and its own output says it rules claims out but never in. Each of
the four survivors is deliberately non-actionable (upstream/third-party symbol or path, a
self-excluded-by-design symbol, one claim with nothing machine-checkable) — none is a *probe this
first* candidate the way SYMBOL_MISSING/PATH_MISSING used to be.

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

`docs/tech-debt-register.md` — **TD-1, TD-2, TD-3, TD-5, TD-7 and TD-8 open**; TD-4 and TD-6
resolved. The next quarterly sweep is dated **2026-10-03**; owners are role placeholders, never
assigned. Re-derive with `grep -n "^| TD-" docs/tech-debt-register.md`.

★★★ **TD-6 IS RESOLVED — the goal was already met and nobody had measured.** This file first
recorded it as "stale numbers" (about 1.92% total against a 2.4% gate). Both figures were wrong and
so was the framing: `npm run dup:check` reports **1.20%**, the Phase 1 baseline
(`docs/baselines/jscpd-2026-07.json`) is **3.065%**, and 1.20/3.065 is **39%** against a ≤50%
target. ★★ Two things got it there and neither alone would have: duplicated lines fell 2701→1833
*and* the denominator grew 88k→153k — at the baseline's absolute line count today's tree would read
1.77%, over the threshold. ★★ The row's whole "binding format" theory was also refuted: the gate
compares ONE number, the total duplicated-LINE percentage, per `AGENTS.md`'s exit-code bisection.
The deferred structural tail it had been saving for the last stretch was never needed.

★ **TD-8 (recorded and decided 2026-08-21, still unscheduled):** heroicons and `lucide-react` ship
side by side — **78** files against **1** — and the app-wide migration is owned and decided but has
no spec and no date; new code defaults to `lucide-react` effective now. ★★ The register said
"scheduled" and this line agreed with it; §3 below, in the same file, said **no spec yet**. §3 was
the accurate one — a decision to do the work is not a schedule for it. Decision debt, not a
defect; `docs/open-followups.md` §145 (closed as a decision) is the long form, and §3 above carries
the still-unspecced migration itself as a backlog row.

★ Dependency rows: `eslint` 10 is **BLOCKED** upstream via `eslint-config-next`, confirmed by an
executed attempt. `@types/node` **landed in this slice** — bumped `^20` → `^24` with zero `tsc`
errors (`a698eac2` / `da9695d0`); it is no longer deferred or pending.

## 6. Code markers

**Zero** TODO, FIXME, HACK or XXX markers in `src`, `scripts` or `e2e`. The single grep hit is the
word TODO used as an example inside a gate's own docstring. Deferred work in this repo is tracked in
prose registers, never in code comments — so a marker sweep finds nothing and proves nothing.

## 7. Suggested sequence

1. **S6 then S7** — design is already done and verified, and they are the last two UX-batch slices.
2. **S3c-2 — OOXML media parts** — the S3c label question is settled (2026-08-21, see section 3);
   images (S3c-1) shipped and only the OOXML embedding half remains, with a design already sketched
   in the documents roadmap's S3c-1 section under "OOXML media machinery".
3. **`optimize_wbs`** — carries an open design question, so it needs a decision before a plan.
4. **Follow-up triage** — done in this slice. `npm run followups:check` now reads **CLEAN 125**,
   NO_MACHINE_CLAIM 1, SYMBOL_THIRD_PARTY 2, PATH_THIRD_PARTY 1, SYMBOL_SELF_EXCLUDED 1 —
   SYMBOL_MISSING and PATH_MISSING both **zero**, down from 13 and 3 at this slice's branch point.
   The four survivors are deliberately non-actionable; see section 4 for what caused the flags and
   where each was fixed. Nothing here is a pickable slice any more.
5. **`@types/node`** — done, `^24` (`a698eac2` / `da9695d0`); no longer a pickable slice.
6. **Icon-package decision (TD-8 / §145)** — not a slice, a call: schedule the heroicons →
   `lucide-react` migration or record that it is declined. Costs nothing today, and every new icon
   added meanwhile is written against whichever precedent the author happened to open.

★ The archive-the-planning-tree item that led this list is **done** — see section 1.
