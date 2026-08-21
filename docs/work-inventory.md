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
| **Document images, end to end, Turso-gated** | documents roadmap; summarised in `docs/open-followups.md` section 113 | no image block kind exists; `document-model.ts` and `doc-render-html.ts` carry comments anticipating a later images slice |
| **`optimize_wbs`** | multi-surface roadmap, Release 4 | `docs/open-followups.md` section 3, "never built — owed from R4"; the name appears in no source file |
| **App-wide `@heroicons/react` → `lucide-react` icon migration** | decision recorded 2026-08-21 in `docs/tech-debt-register.md` TD-8 and `docs/open-followups.md` §145 (closed as a decision); **no spec yet** | 78 files still import `@heroicons/react` (`grep -rln "@heroicons/react" src/app`); nothing has been brainstormed or planned for the conversion itself — that is its own slice |

★★★ **THE "S3c" LABEL IS AMBIGUOUS AND THE AMBIGUITY HIDES THE IMAGES SLICE.** The documents
roadmap defines S3c as *images end to end*. What actually shipped under that label in 0.252.0 was
**structural blocks** (add, delete, reorder) — a different scope. Reading the release as closing S3c
retires the images design without anyone deciding to. The images work is open.

★ The rest of the documents roadmap **is** done: S3a, S4 and S3b all shipped. Its spec header still
reads "design approved, unimplemented" — stale, and stale in the dangerous direction, because it
makes finished work look pending while the genuinely pending images slice sits in the same file.

### Roadmaps and their true state

- **UX batch, 8 slices, order C → D → F → A → E → S6 → S7 → B.** C, D and F shipped and are marked
  so. A, E and B are marked "TBD" in the roadmap but **have shipped** (Manual % complete; project
  config in Settings → General plus the theme gallery; the dated note log and rich descriptions).
  Only **S6 and S7** remain. The roadmap's own status column is therefore wrong for three rows.
- **Documents roadmap (S3a, S4, S3b, S3c).** See above — images only.
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
cite still exist — re-run 2026-08-21 at `6c4e4162`: CLEAN 113, **SYMBOL_MISSING 13**, PATH_MISSING 3,
PATH_THIRD_PARTY 1, NO_MACHINE_CLAIM 1. It **exits 0 regardless**, runs in no CI job, and its own output says it rules
claims out but never in. Treat SYMBOL_MISSING and PATH_MISSING as *probe this first*, never as
*closed*.

★ It reports false positives on entries that quote filenames as prose rather than citing them.

★★ **And its resolver walks `src`/`scripts`/`e2e` ONLY, so every `docs/` path it meets is reported
PATH_MISSING whether or not the file exists** — §145 cites a `docs/superpowers/` spec that is
present and tracked, and is flagged anyway. That blind spot got worse on 2026-08-21: until the
planning corpus was tracked, a `docs/superpowers/` path genuinely was unresolvable for most readers;
now it resolves for everyone except this script. Two of §200's three flags are the same shape.

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

★ **TD-8 (recorded 2026-08-21, scheduled the same day):** heroicons and `lucide-react` ship side
by side — **78** files against **1** — and the app-wide migration is now owned and scheduled,
though not started; new code defaults to `lucide-react` effective now. Decision debt, not a
defect; `docs/open-followups.md` §145 (closed as a decision) is the long form, and §3 above carries
the still-unspecced migration itself as a backlog row.

★ Dependency rows: `eslint` 10 is **BLOCKED** upstream via `eslint-config-next`, confirmed by an
executed attempt. `@types/node` is deferred but its stated precondition — the runtime moving off
node 20 — is now met, so that is a pickable slice.

## 6. Code markers

**Zero** TODO, FIXME, HACK or XXX markers in `src`, `scripts` or `e2e`. The single grep hit is the
word TODO used as an example inside a gate's own docstring. Deferred work in this repo is tracked in
prose registers, never in code comments — so a marker sweep finds nothing and proves nothing.

## 7. Suggested sequence

1. **S6 then S7** — design is already done and verified, and they are the last two UX-batch slices.
2. **Document images** — a full design exists; settle the S3c label question first.
3. **`optimize_wbs`** — carries an open design question, so it needs a decision before a plan.
4. **Follow-up triage** — probe the SYMBOL_MISSING and PATH_MISSING entries; they are the cheapest
   closures available. Re-derive the count from `npm run followups:check` rather than quoting one:
   it was 16 at both compiles today, but the split behind it moved (SYMBOL_MISSING 12→13), and
   **three of the PATH_MISSING flags are the resolver's `docs/` blind spot, not real breakage** —
   see section 4.
5. **`@types/node`** — unblocked and self-contained.
6. **Icon-package decision (TD-8 / §145)** — not a slice, a call: schedule the heroicons →
   `lucide-react` migration or record that it is declined. Costs nothing today, and every new icon
   added meanwhile is written against whichever precedent the author happened to open.

★ The archive-the-planning-tree item that led this list is **done** — see section 1.
