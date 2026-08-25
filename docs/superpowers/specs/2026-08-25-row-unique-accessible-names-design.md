# Row-unique accessible names — design

**Date:** 2026-08-25
**Closes:** `docs/open-followups.md` §111, §126, §243
**Deliberately excluded:** §42 (see "Out of scope")

## Goal

Give every per-row control an accessible name that cannot collide with another
row's, on the four surfaces where it does collide today; and add the only kind
of detector that can catch a regression, since no gate in this repo can.

## The defect class

Three register entries describe one defect: a per-row control whose accessible
name derives from something that is not unique to the row.

| entry | surface | controls per row | collides when |
|---|---|---|---|
| §111 | `documents-list.tsx` | 6 | two documents share a title |
| §126 | `insights-panel.tsx` (+ `insight-recommendation-controls.tsx`) | 7 | two insights share a `type` |
| §243 | `history-panel.tsx` | 2 per row, plus the compare header — N+1 | always, from N=2 |
| §126 (2nd surface) | `dashboard-sections/insights-card.tsx` | 3 | two insights share a `type` — found by the triage, named in no register entry |

This is WCAG 2.4.6. A speech-input user saying "click Delete Q3 report" gets no
resolution; a screen-reader user navigating by name cannot tell two rows apart.

### Why no gate catches it, and never will

Two independent reasons, either sufficient on its own:

1. **axe has no such rule.** Under the four tags `e2e/a11y.spec.ts` requests
   (`wcag2a wcag2aa wcag21a wcag21aa`), no rule flags two controls sharing an
   accessible name — at any seed size, in any view. The nearest rule,
   `identical-links-same-purpose`, is links-only and tagged `wcag2aaa`, which
   the gate never requests. Reproduce:

   ```bash
   node -e "const a=require('axe-core');const t=['wcag2a','wcag2aa','wcag21a','wcag21aa'];for(const r of a.getRules(t).filter(r=>/identical|duplicate|unique/i.test(r.ruleId)))console.log(r.ruleId,'|',r.description)"
   ```

   That prints two rules and neither is relevant — `duplicate-id-aria` is about
   `id` attributes, `frame-title-unique` about iframes. Read the descriptions,
   never the count: a bare tally here reads as coverage.

2. **Seeding does not help.** Documents *is* in `A11Y_VIEWS` and the e2e seed
   *does* seed two documents — with distinct titles, so the collision never
   renders at scan time. History is Turso-gated and is not scanned at all.

A unit test rendering two or more rows is therefore the only detector that can
exist, in either layer.

## Decisions

Each was a fork with a real alternative. The alternative and the reason for
rejecting it are recorded so a later reader does not re-litigate from scratch.

### D0 — SUPERSEDES D1 AND D2: adopt `asset-library`'s disambiguator

★★★ **D1 and D2 below are RETAINED FOR THE RECORD AND ARE NOT THE RULE.** They
were decided without knowing that `asset-library.tsx` already contains a
fully-worked, documented, tested solution to this exact problem — one whose own
rationale explicitly rejects **both** options D1 and D2 chose between. Its
`buildRowTokens` maps each row id to the display TOKEN used in every one of that
row's labels:

- a name unique in the rendered list is used **bare**;
- rows actually sharing a name get a **1-based occurrence index**, ranging only
  over the rows sharing that name;
- **all** colliding rows are numbered, the first included — a bare `image.png`
  would otherwise leave a user unable to tell "the only one" from "the first of
  several";
- an **escalation loop** handles a user literally naming a row `image.png (1)`,
  where the generated token for a genuine pair would collide with that bare one.

Its comment rejects the id: uuids read "36 characters of character-salad aloud
on every control — trading a 2.4.6 failure for a usability regression hitting
exactly the users 2.4.6 protects". And it rejects a whole-list positional
ordinal, "which shifts under sorting". It also settles a question this spec
never asked: cross-MOUNT uniqueness is not required, because the insert modal
sets `aria-modal`, hiding the background copy from AT.

★★ **D2 was provably wrong for History specifically.** `ProjectVersionMeta.id`
is a `string`, and version ids are uuids — so "meaningful value plus id" is
exactly the regression that comment describes.

★ **Why the error happened, recorded so it is not repeated:** the search was for
naming PRECEDENTS, and two were found (`documents-history-modal`,
`insight-digest-card`). It was never a search for a disambiguation ALGORITHM,
and there was one.

**Consequence for the work:** `buildRowTokens` is file-local and not exported.
The slice **moves** it to a shared module — `asset-library.tsx` then imports it,
since leaving a second copy would be a source-level clone — and adopts it on the
four defective surfaces. The residual cost is accepted knowingly: a control's
accessible name DOES change when a second same-named row appears. That is the
price of never announcing a uuid.

### D1 — SUPERSEDED by D0. Naming rule: always qualify

Every per-row control appends a qualifier. **Rejected:** qualify only on
collision, the pattern in `insights/insight-digest-card.tsx`, which computes the
colliding set per render and disambiguates only those. That keeps "Delete Q3
report" working as a speech target while a project has one Q3 report, but makes
a control's name a function of the whole list: adding a second same-titled
document silently renames six controls. A name that changes under the user is a
worse failure than a verbose one, and it is far harder to test.

**The counter-argument, recorded because it is in the repo.** That same file
argues against unconditional `aria-label`s: *"An aria-label that merely repeats
the visible text suppresses the natural accessible name and drifts silently if
the label shape changes."* Half of it does not apply — always-qualify never
merely repeats visible text, it appends a distinguishing value. The drift half
does apply, and D3 neutralises it.

### D2 — SUPERSEDED by D0. Qualifier: meaningful value plus id

`Restore this state – 14 Mar 2026 (#7)`, not `– 14 Mar 2026` and not `– 7`.

**Rejected: the meaningful value alone.** This is what §243 itself proposes
("append `labelOf(v)`, matching `historyDelete`"), and it is not sufficient.
`labelOf` is `v.label ?? formatDisplayTimestamp(v.capturedAt, …)`, and two
versions can carry the same label — which means `historyDelete`, listed in
§243's own table as *already correct*, is only usually unique. The repo reached
this conclusion once already, in a comment in `documents-history-modal.tsx`:
*"title+timestamp collides on real data. Only the version id cannot."*

**Rejected: the id alone.** Guaranteed distinct and needs no new i18n keys, but
a bare number tells a screen-reader user nothing about which row they are on. It
would buy conformance at the cost of the usability the criterion exists to
protect.

★ `ProjectDocument.id` is a **number**, not a UUID, so an id qualifier is
announceable here. Verify before assuming the same of another entity.

### D3 — The qualifier is composed, never copied (STILL HOLDS under D0)

The qualified name must be built from the same expression the visible text
renders from. This is what makes D1 safe against the drift objection in D2's
note, and `history-panel.tsx`'s delete button already does it via `labelOf(v)`.

A consequence for §243: the row's compare checkbox inlines
`v.label ?? formatDisplayTimestamp(…)` where `labelOf` exists — a duplicated
expression, and exactly the drift this rule forbids. Collapse it to `labelOf`.

### D4 — WCAG 2.5.3 holds by appending

Appending keeps the visible text a substring of the accessible name, which is
what 2.5.3 (label in name) requires. Do not replace visible text with a
different phrase. Note that 2.5.3 requires *containment*, not a prefix —
front-position is a best practice in a NOTE on the criterion, not its normative
text. Appending satisfies both anyway.

## The detector

★★★ **PRIOR ART EXISTS — promote it, do not invent it.** An earlier revision of
this section specified a new naming mechanism built on testing-library's
function `name` matcher. That was unnecessary and unproven (its probe never ran
— see "What was measured"). The repo already has both halves:

- `buttonNames()` is **already exported from `src/test/toolbar-order.ts`**. It
  returns the accessible name of every rendered button in DOM order via
  `aria-label || textContent`. ★ The `||` is load-bearing and documented at the
  source: `aria-label=""` returns `""`, not null, so `??` would let an empty
  name shadow the `textContent` fallback.
- `expectNoDuplicateButtonNames()` is defined locally in
  `documents-panel.test.tsx` and used six times in that one file. It is the
  assertion this slice generalises: `expect(new Set(names).size).toBe(names.length)`.

The deliverable is therefore to **relocate and generalise proven, in-use code**:

```ts
expectRowUniqueNames(opts: { minRows: number; scope?: HTMLElement; roles?: string[] }): void
```

★ `buttonNames()` reads `screen` document-wide and buttons only. Generalising it
to an optional `scope` and to roles beyond `button` (the radios in
`segmented-control`, the selects in `task-kanban-card`) is the actual work, and
it must not change `buttonNames()`' existing behaviour for its current callers.

★★ The naming convention stays `aria-label || textContent` rather than a real
accessible-name computation. That is a deliberate approximation, already trusted
repo-wide, and it sidesteps a real hazard: `dom-accessibility-api` is installed
**twice** — 0.6.3 under `@testing-library/jest-dom`, 0.5.16 under
`@testing-library/dom` — and is not declared in `package.json`. A bare import
resolves to whichever hoists, and testing-library's own `{name}` queries use
0.5.16, so a helper importing the other copy could disagree with every existing
test about what a name is. Reproduce: `npm ls dom-accessibility-api`.

Two properties a hand-rolled check does not have:

- **Vacuity is impossible by construction.** `minRows` is required and the
  helper **throws** — not fails — when the scope renders fewer. All three
  register entries warn that a one-row fixture passes against unfixed code; this
  makes that unreachable rather than something a reviewer must remember.
- **It catches unenumerated pairs.** The existing hand-rolled tests assert that
  *specific names exist*. Distinctness catches the collision nobody thought to
  list, which is why this class shipped three times.

**Its own test** sits beside it, as `label-binding.ts` and `toolbar-order.ts`
each have. It must include a mutation proof that the assertion goes red on a
planted collision, and that the `minRows` guard throws — a distinctness
assertion that never fires is precisely the failure mode it exists to prevent.

## The fixes

| entry | edit |
|---|---|
| §126 | All seven controls derive from a single `title` computed once in `insights-panel.tsx` (the four in-panel labels, plus `nameQualifier` and the Apply/Reject pair in `insight-recommendation-controls.tsx`). Qualifying that one value fixes all seven. Reuses the existing `insightDigestRowRef` frame. **★★★ AND A FOURTH SURFACE §126 NEVER MENTIONS** — `insightTitle` is `t(lang, TITLE_KEY[insight.type])`, type-driven and nothing else, and THREE call sites build control names from it: `insights-panel.tsx` (§126's known one), `insight-digest-card.tsx` (which already disambiguates on collision), and **`dashboard-sections/insights-card.tsx`, which does not**. Fixing only the panel leaves the dashboard defective. Found by the triage, not by §126. Reproduce: `grep -rn "insightTitle(" src/app --include=*.tsx --include=*.ts \| grep -v "\.test\." \| grep -v "insight-text.ts"` |
| §111 | Five `aria-label`s in `documents-list.tsx` swap `doc.title` for the qualified form; the selection button — whose accessible name *is* the title text — gains one. **Delete the comment asserting the title is "row-unique by construction".** §111's position is that the comment is the defect: a false invariant in a comment outlives the code, because the next reader stops checking. |
| §243 | The two unqualified row controls gain a qualifier. The compare-header restore button, the one place that sets an `aria-label`, currently sets it to the bare `historyRestoreState` and so collides with every row; it needs a name distinguishing it *from* the rows. Plus the `labelOf` collapse from D3. |

### The e2e characterization flip (§126)

`e2e/seed-content.spec.ts` asserts a count of 2 on the accessible name
`"Dismiss – Milestone at risk"`. That assertion **characterizes the defect** —
it pins the bug, not the wanted behaviour — so a correct fix turns it red, and
the red run is the fix working. The spec already anticipates this in a comment
telling the reader to change the expectation when the name gains a suffix.

Flip it to 0 plus positive assertions for the two now-distinct names. **Do not
loosen it to a range and do not delete it**: it is the only detector in the repo
for that surface, so a loosened form is equivalent to no detector.

## The sweep

29 test files carry an `it(…)`/`test(…)` block naming a row-unique assertion;
7 more mention the phrase only in prose. Enumerate both:

```bash
grep -rlE '^\s*(it|test)\(.*row-unique' src/app --include=*.test.tsx | wc -l
grep -rl "row-unique\|rowUnique" src/app --include=*.test.tsx | wc -l
```

**The triage has been run.** 41 blocks across the 29 files:

| bucket | blocks | meaning |
|---|---|---|
| **Convert** | 30 | fixture already renders 2+ sibling rows — swap the enumeration for the helper |
| **Extend, then convert** | 9 | a row surface whose fixture renders one row; needs a second row before the helper will run at all |
| **Leave** | 2 | `task-status-select`, `notes-badge-button` — primitive tests asserting a component forwards a qualifier its caller supplies. No sibling set, so converting is a category error |

**Two reds, both in the Extend bucket** — exactly where the structural argument
predicted, because a fixture that has never rendered two rows has never been
checked:

- `budget-panel-people-rows` — the disclosure name is
  `budgetShowPeople – roleLabel(discipline+grade)`, carrying no bucket or role
  id, so two buckets sharing a discipline+grade combo collide. The source file's
  own docstring already says "the axe gate cannot protect this".
- `dashboard-sections/insights-card` — the fourth §126 surface above.

★★★ **CORRECTION — `segmented-control` is NOT a Leave case**, and an earlier
revision of this spec named it as the exemplar. It renders three radios whose
names interpolate the option value (`optionAriaLabel={(v) => …${v}}`), so it is
a Convert. Leave is two blocks, not three.

★★ **One block sits outside the model.** `task-kanban-swimlanes.test.tsx`'s
row-unique block renders **zero** controls of the kind in question — both its
assertions are `.not.toBeInTheDocument()`. It is a visibility-gating test, not a
distinctness one, and may not convert at all.

### Why the sweep is bounded here, and what is deferred

The 29-file population came from grepping test NAMES, and that is **provably
incomplete**: tests asserting this exact property exist under other nouns —
`task-row.test.tsx`'s "two open rows get DIFFERENT Send inquiry accessible
names" (whose own comment says "one row cannot express a name collision… this is
the only possible detector"), `budget-panel.test.tsx`'s "bucket-unique", and
`task-kanban-card.test.tsx`'s "card-unique".

Enumerating on the PROPERTY instead was measured and is a programme, not a
branch:

| | |
|---|---|
| candidate components (a `.map` rendering a control) | 127 |
| unique un-interpolated `aria-label` sites inside those maps | 103 |
| control tags inside a map with **no `aria-label`** — named by text | ~254 |

★★★ **And it cannot be classified mechanically, in either direction.** The scan
false-positives on `t(lang, "selectItem", item.title)` (interpolation through a
positional argument, not `${…}`) and on `qualify(t(lang, …))` wrappers. Worse,
the **text-named class is invisible to label-based scanning entirely — and that
is the class §243's two defective controls belong to.** Neither "Compared with
current" nor "Restore this state" carries an `aria-label`; both are named by
their text. So the scan misses the exact shape that motivated the slice.

**Decision: this branch ships the measured, finite work** — the helper, all four
defective surfaces, the two reds, the 41 blocks, the docs and the register
closures. The widened sweep becomes its own programme, and the measurement above
plus the three off-name tests are recorded as a new register entry so the gap is
documented rather than quietly dropped. Once the helper exists and is adopted,
widening is mechanical for whoever picks up a surface.

Every red found inside that bounded scope is fixed before merge, using D1–D4.

## Gates

- **`npx tsc --noEmit`** — enforces EN/DE key parity, and typechecks the test
  files (`next build` does not, and vitest never typechecks, so a test-only type
  error passes the suite and fails CI).
- **`npm run test:run`**, then **`npm run test:shuffle`** at the pinned seed —
  the only local reproduction of `unit-tests-shuffled`, and the only thing that
  catches intra-file order dependence.
- **`npm run e2e`** — `seed-content.spec.ts` goes red first, by design.
- **`npm run size:check`** — **a non-issue here, measured.** The four touched
  components are 226 / 294 / 403 / 110 gate-lines against an 800 limit and none
  carries a baseline entry. ★ Recorded because an earlier revision of this spec
  listed it as a risk. It still counts `wc -l` **+ 1**, so budget from the gate's
  own arithmetic if a later change approaches the limit:
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`
- **coverage** — unaffected. `src/test/**` is already in `coverage.exclude`.
- **`npm run docs:claims:check`** — register edits must cite symbols, never
  `path:LINE`.

★ Never read a gate's exit code through a pipe — you get the pipe's status.
Redirect, check unpiped, then read the file.

## i18n

Insights reuses `insightDigestRowRef` (`"item {0}"` / `"Eintrag {0}"`), the
digest card's localized id frame, already present in both dictionaries.
Documents and History need one new key each, in both. `tsc` enforces parity, so
a missed DE key fails the typecheck rather than shipping.

★★ **`i18n.de.ts` must not be edited with the Edit tool** — the file is CRLF and
the tool corrupts umlauts and curls double quotes, including in umlaut-free
strings. Patch via an anchored node utf8 write whose anchor matches `\r\n`; a
`\n` anchor silently no-ops. The chosen German strings need no umlauts, which
reduces that exposure without removing it.

## Docs and release

**AGENTS.md.** The a11y hard-constraint bullet says a unit test is the only
possible detector and leaves writing it to the reader. It should name the
helper, the way it already mandates `src/test/toolbar-order.ts`, and for the
identical reason: the hand-rolled form passes for the wrong reason.

**Register.** §111, §126 and §243 close. Anything the triage files gets a new
number, minted only after checking `origin/main` — a number is reserved only
once it is there, and two branches have already minted the same one.

**Release.** User-visible accessible names change on three surfaces, so this is
a minor bump, not refactor-only: `version.ts` plus the five ungated locations
(`package.json`, `package-lock.json` — two occurrences, README shields badge,
the five `docs/CODEMAPS/*.md` headers) and a `CHANGELOG.md` entry.

## What was measured, and what was not

Everything in this spec that carries a number was run. Two things were **not**,
and neither may be cited as established:

- **The testing-library function `name` matcher.** An earlier revision specified
  the helper around it. Its probe died on `Failed to start forks worker` after
  60s under machine contention from three concurrent agents — which is
  contention, not a result, so the idea is neither confirmed nor refuted. It is
  moot regardless: the helper now reuses `buttonNames()`.
- **Whether any qualified name is pleasant to hear.** See below.

★ The one gate claim carried over from the register entries rather than re-run
here is §126's e2e count assertion; its line and wording were read, its
behaviour under the fix was not, because that requires the fix.

## What this does not prove

The detector proves **distinctness, not usability**. jsdom has no speech and no
screen reader; nothing in the suite can tell whether a qualified name is
pleasant to hear. An eye-verify against a real Turso project is owed for History
specifically, since it is Turso-gated and no e2e seed reaches it.

## Out of scope

- **§42** (`CalendarSyncControls` push/pull). Its own entry says not to fix it
  in isolation: it is Task 11 of the unexecuted S6 plan, which has a sharper
  reason for the same edit — the Calendar sub-tab is about to render a second
  `CalendarSyncControls`, at which point the two Push buttons collide inside a
  single view rather than only across the classic dual-mount.
- **§111's title-uniqueness half.** `uniqueDocumentTitle` runs at two of the
  four title-writing paths; `commitRename` and the AI `createDocument` bypass
  it. Under D1 the accessible names are distinct regardless, so closing that
  bypass is not needed for a11y. It is a separate defect about human-facing
  duplicate titles and stays filed.
- **The 7 prose-only mentions** and the 2-block "Leave" bucket. Neither is a
  row-distinctness assertion.
- **The property-based sweep** — 127 candidate components, 103 un-interpolated
  label sites, ~254 text-named control sites. Deferred to its own programme and
  recorded as a register entry, with the three off-name tests named, because it
  cannot be classified mechanically and cannot be reviewed as one diff.
