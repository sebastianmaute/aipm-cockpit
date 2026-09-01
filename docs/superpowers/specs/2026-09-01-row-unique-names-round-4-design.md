# Row-unique names, round 4 — design

**Branch:** `fix/row-unique-names-round-4`, off `main` at `fb66aeec` (0.273.0 "Goonan").
**Roadmap slice:** 6, from `docs/superpowers/specs/2026-08-31-followup-slice-roadmap.md`.
**Entries:** §309 · §315 · §305 · §324.

## Why this slice exists

Four surfaces render several controls that compute the SAME accessible name. A screen-reader
user hears N identical controls and cannot tell which row each belongs to (WCAG 2.4.6).

★★★ **No gate can catch any of it, and this is the premise of the whole slice.** Measured against
the installed axe-core 4.12.1: of its 105 rules, the 69 carrying one of the four tags
`e2e/a11y.spec.ts` requests flag two controls sharing an accessible name in NO view, at ANY seed
size. Reproduce with the command AGENTS.md carries for it (a `getRules()` filter over
`/identical|duplicate|unique/i`, printing each rule's tags).

The unit tests written here are therefore not additional coverage. They are the only detector that
will ever exist for these four surfaces.

## Scope, and what is deliberately excluded

★★★ **§314 is NOT in this slice, though the roadmap lists it.** It closed with the budget slice on
2026-08-31. Verify before briefing anyone against the roadmap row — grep its heading in
`docs/open-followups.md` and read the title, which ends `CLOSED 2026-08-31`.

★★★ **The repo-wide raw-interpolation population is EXCLUDED and that is a decision, not an
oversight.** A sweep for a raw interpolated `aria-label` template across non-test `.tsx` spans 56
files. Most are not defects: the discriminator is "can this value repeat in one rendered list",
never the call FORM, and many of those sites interpolate an already-tokenised `nameToken` or append
an id that cannot repeat. Adjudicating all 56 is §245 / §316 — roadmap slice 10, the scanner-harness
work — and no static report can decide a site; it needs a verdict recorded per site. Pulling it in
here would replace a four-fix slice with an audit.

★★ **EVERY COUNT IN THIS DOCUMENT WAS MEASURED AT `fb66aeec` AND IS PINNED TO IT, NOT TO ITS DATE.**
The 56, the 139 and the 327 below are all readings of one tree. Merging `origin/main` will move some
of them while this document still says 2026-09-01, and a date cannot distinguish two correct
readings taken hours apart — a peer branch hit exactly this on the same day, where one merge
re-staled three separately-correct figures at once. Re-measure after any merge and pin the new
reading to its own sha, or cut the number. No doc gate can see this: all of them stayed green over
both versions.

★ **What WAS enumerated, because the roadmap's rule demands it.** The rule is that an entry names
the INSTANCE its author hit, never the CLASS, and scoping a fix to what an entry names is the
recurring way a closure ships false. So each entry's own class was enumerated before this design,
at `fb66aeec`:

| § | claimed | enumerated | verdict |
|---|---|---|---|
| 309 | ACTIVE list raw-interpolates | 3 controls (`projectsSwitch` · `projectsArchive` · `projectsDelete`) | matches |
| 315 | button content-named | 2 sites, `weeklyHours` as content — managed AND unlinked tables | matches |
| 305 | `recordLabel` rendered bare | 2 sites, one per layout | matches |
| 324 | two bare `InfoTooltip` | 2 sites — and repo-wide, an interpolated `text` with no `label` returns EXACTLY these two of 139 mounts | class == instances |

The §324 sweep is the one worth re-running, because it is the only one that proves a class boundary
rather than confirming a count: scan every `InfoTooltip` mount for a `text` built by a positional
`t(lang, key, arg)` call and no `label` prop.

## Cross-cutting decisions

**Zero new i18n keys.** Every qualifier composes at the call site from keys that already exist. This
is not a convenience: it keeps `i18n.de.ts` untouched, and that file corrupts under the Edit tool
(umlauts, curled quotes) and is CRLF, so an anchored node write matching a CRLF sequence is the only
safe patch. Not touching it removes the hazard rather than managing it.

**Ordering: the distinguisher LEADS, the shared string follows, separated by an EN DASH (U+2013).**
This copies §314's fix, which is the live precedent in `budget-bucket-modal.tsx` and carries a
comment saying the field name leads deliberately. It also satisfies WCAG 2.5.3 the right way:
containment is the normative requirement (axe ends in a position-independent `includes` check), and
front-position is a best practice from the SC's own NOTE. Where the visible text is what leads, both
hold at once.

★★ **U+2013, not the em dash this document's own prose uses.** `rowLabel` in `src/app/row-tokens.ts`
returns its two segments joined by an EN DASH, and that is the character every row-named control in
the app already carries; the em dashes in these same source files are all prose and comments.
Verified by code-point count rather than by eye, because the two are visually near-identical in a
monospace terminal and a mismatch would be invisible in review while breaking any test that asserts
on the whole name.

★★★ **THE TOKEN GOES LAST IN EVERY NAME, AND THIS OVERRIDES "distinguisher leads" WHEREVER THE TWO
DISAGREE.** `requireCollisionSeed` strips the occurrence suffix with an END-ANCHORED regex
(`/ \(\d+\)$/` in `src/test/row-unique-names.ts`). A token-first name puts `(1)` mid-string, nothing
is stripped, the two seeded names no longer match, and the guard THROWS — against CORRECT code. So a
token-first ordering is not merely unconventional here, it is untestable by the only harness that can
certify these fixes. `rowLabel(verb, token)` already puts the token last; use it.

★ **What LEADS is then a per-site choice, and it differs legitimately.** §309 leads with the verb
(the ordinary `rowLabel` shape). §315 leads with the hours value, because that is the button's
VISIBLE text and leading with it makes WCAG 2.5.3 containment hold with front-position for free.
§324 leads with the shared tooltip string. All three still end with the token.

★ **§314's "the field name LEADS" precedent does not conflict with this.** That fix had no token at
all — its distinguisher was a field name, a value that cannot repeat, so a plain qualifier sufficed
and ordering was free. Where a token exists, the token's position is forced.

★ **Do NOT apply front-position as if it were the rule.** It is stricter than the SC and flags
conformant code — this repo's own dependency-type select passes 2.5.3 while failing a prefix test.

## The four fixes

### §309 — `projects-panel.tsx` carries two row-naming conventions

The ARCHIVED list was converted to `buildRowTokens` / `rowLabel` by `3abf5442`. The ACTIVE list still
builds each name by raw interpolation of the project name. Both halves are visible in one grep over
that file for `buildRowTokens`, `rowLabel(` and a raw interpolated `aria-label` — which is the point.

This is a CONDITIONAL collision — it needs two ACTIVE projects sharing a display name — where §276's
archived defect was UNCONDITIONAL. The condition is reachable, not theoretical: both lists are fed
from the same project registry, so if two archived projects can share a name, two active ones can.

**Change.** Mint a second `buildRowTokens` over the active `projects`, keyed `{ id, name }`, and
thread it through `rowLabel` at the three controls. The file ends carrying ONE convention, which is
the durable win — the next reader can rely on it without reading both lists.

### §315 — the weekly-hours button is named by its own content

The row's `weeklyHours` value is the CONTENT of its own `<button>` at two sites. Its `title`
(`resourcesEditShift` / `resourcesDefaultShift`) is the accessible DESCRIPTION and does not name it.

★★★ **BOTH TABLES, and the managed one matters more.** The button renders in the managed-resources
table AND the unlinked-rows table. The managed table is the main planning grid: a team on a standard
40-hour week gives it N buttons all named `40`. Fixing only the unlinked half — the half that
happened to sit beside the §276 control being fixed when this was found — would leave the larger
collision live and close the entry falsely.

**Change.** Name it as the hours value, an en dash, then the row's token, where the token is the
row's entry in the table's EXISTING `buildRowTokens` map (both tables already mint one). Riding the
token rather than a raw display name keeps the name unique even when two people share a display name.

★ The visible number leads, so 2.5.3 containment holds and front-position comes free. The `title`
keeps carrying the verb, so the name does not need one.

★★ **It is not narrowable by `scope`** — the unlinked rows are sibling `<tr>`s with no wrapping
element, so no container isolates one row's controls from another's.

### §305 — two version-diff rows can render identical visible text

`version-diff-view.tsx` renders the bare `recordLabel` in BOTH layouts while the occurrence-numbered
token reaches only the `aria-label`. While a slice had no working `nameField` its rows were unique BY
CONSTRUCTION, because the id fallback is unique; naming a slice by a real field makes it collidable.
A screen-reader user hears "(1)" and "(2)"; a sighted user gets nothing.

**Change.** Render the token, falling back to `recordLabel`, where the bare `recordLabel` renders
today, in both layouts. Unique rows are untouched, because `buildRowTokens` uses the bare name when
it does not collide; colliding rows read `(1)` / `(2)`. Visible text and accessible name become
identical.

★ **The obvious precedent does NOT cover this and copying it would ship the wrong fix.**
`documents-deleted-section.tsx`'s id suffix is in that row's `aria-label` ONLY — its VISIBLE row
disambiguates by rendering the version's `savedAt` timestamp. So it is precedent for the
accessible-name pattern this file already follows, and the visible half had no precedent. Rendering
the token was chosen over an id suffix (uuids read as character-salad aloud, and AGENTS.md's
row-tokens rule says not the id) and over a per-row secondary field (the diff's change shape carries
none, so it would mean enlarging the type and teaching every `COLLECTION_SPECS` entry its secondary
field).

### §324 — `actionScoreTooltip` is mounted bare by both Next-actions surfaces

`action-row.tsx` and `action-hero-card.tsx` each mount an `InfoTooltip` whose `text` is
`actionScoreTooltip` interpolated with the action's score, under `expertMode`, with no `label`.
`InfoTooltip` derives its trigger's name from `text` when none is given.

★★★ **The positional argument is NOT a disambiguator.** Interpolating the score proves the two names
DIFFER when the scores differ and proves NOTHING when they repeat — and a repeating value is the
entire premise of this defect class. Two actions tying on score is ordinary, not contrived.

★ **Two distinct collisions, not one.** The hero is the first group and is de-duped from its tier
list, so hero-vs-row is one pair; `action-row` renders once per row, so rows collide among
THEMSELVES as soon as any two visible actions share a score. One label closes both.

**Change.** `actions-panel.tsx` — the LIST OWNER — mints `buildRowTokens` over the rendered actions
and threads the row's token into `ActionRow` and `ActionHeroCard` as a prop. Each site then sets
`label={rowLabel(t(lang, "actionScoreTooltip", action.score), rowToken)}`, keeping the shared `text`
as the tooltip body.

★★★ **A RAW TITLE QUALIFIER WAS REJECTED, AND THE REASON IS THE RULE, NOT A PREFERENCE.** The
register prescribes qualifying by the action title, and an earlier revision of this spec said to do
that. An action title is FREE TEXT built from `action.title.key` plus params, so it can repeat — and
AGENTS.md's discriminator is "can this value repeat in one rendered list", never the call form: a
value that cannot repeat needs only a plain qualifier, free text ALWAYS needs a token. A title
qualifier would leave two actions sharing a title AND a score still colliding, closing the entry
narrower than its own class. It is also UNCERTIFIABLE: with no occurrence suffix to strip,
`requireCollisionSeed` throws against the corrected code, so the fix could not be pinned by the one
harness that can see this defect.

★★ **The hero and the rows are ONE naming population, not two.** The hero is the first group
de-duped from its tier list, so a single `buildRowTokens` over the rendered set covers both
collisions the entry names. Minting two maps — one per component — would number each population from
1 independently and reintroduce the hero-vs-row pair.

★ **A per-item component cannot disambiguate itself**, which is why the map is built by
`actions-panel.tsx` and threaded down rather than computed inside `ActionRow`. That is the same rule
that forced `TaskStatusSelect` and `TaskActionsImpl` to take their token as a prop from
`task-row.tsx` / `task-kanban-card.tsx`.

★★ **Neither gate can see it** — axe as above, and §276's per-row scanner looks for controls inside a
`.map()`, which the hero's is not.

## Testing

Each fix gets an assertion from the shared `src/test/row-unique-names.ts`, never a hand-rolled
enumeration: the helper THROWS when a key matches zero or several controls, where a hand-rolled
`findIndex` silently takes the first and can pass against the wrong control.

★★★ **`requireCollisionSeed: true` on every one of them.** Without it the fixture need not contain a
collision at all, and a one-row fixture passes and reads as coverage. Measured previously: a
documents-panel collision test with a `minControls` floor of 2 still PASSED with its fixture cut to
one document, and still passed cut to zero, because one row renders six buttons and the panel
toolbar five. `minControls` proves the scope is non-empty; it does not prove a collision was seeded.

★ **The `roles` list is load-bearing and nothing else checks it.** `requireCollisionSeed` is
satisfied by ANY two controls' names colliding, not necessarily the one under test, so an unrelated
real collision can mask a silently narrowed `roles` array. Keep `minControls` at its exact MEASURED
value for the scope.

★★★ **§305 IS NOT AN `expectRowUniqueNames` TEST AT ALL, and writing one would be false coverage.**
Its `aria-label`s ALREADY carry the token via `rowLabel` — the accessible names are unique before the
fix and after it. A name-uniqueness assertion therefore passes against the UNFIXED code, and a test
that cannot fail is worse than no test, because it reads as protection and stops the next audit.
§305's defect is VISIBLE text, so its test asserts on rendered text: two rows seeded with a shared
`recordLabel` must render two DIFFERENT visible strings, and the mutant is reverting the render back
to the bare `recordLabel`.

Seeds, one per fix:

| § | assertion | seed |
|---|---|---|
| 309 | `expectRowUniqueNames`, `requireCollisionSeed: true` | two ACTIVE projects sharing a display NAME |
| 315 | `expectRowUniqueNames`, `requireCollisionSeed: true` | two people sharing a display NAME **and** on equal hours, per table |
| 305 | visible-text assertion (see above) | two changes sharing a `recordLabel` |
| 324 | `expectRowUniqueNames`, `requireCollisionSeed: true` | two actions sharing a TITLE and tied on score |

★★★ **THE §315 SEED NEEDS A SHARED NAME, NOT MERELY EQUAL HOURS — an earlier revision of this spec
said equal hours alone.** After the fix the name is `40 – <token>`, so two people called Anna and Bob
both on 40h render `40 – Anna` and `40 – Bob`: nothing collides once the suffix is stripped, and
`requireCollisionSeed` THROWS against the CORRECT code. The seed must make the TOKEN fire, which
needs a shared display name. The same reasoning fixes §324's seed: the two actions must share a
TITLE, not merely a score.

★★ **One knock-on, and leaving it undone quietly weakens an existing test.**
`resource-workload.test.tsx`'s §276 test gives its two unlinked people DISTINCT part-time shifts
(32h / 24h) so that the hours buttons differ and its assertion fails only on the control it is about.
A ★★★ comment at the fixture says to drop the distinct shifts once §315 is closed. Dropping them IS
the §315 collision seed: the fixture returns to equal hours, and the new assertion is what makes that
safe.

★★★ **Every new test must be mutation-proved, and the mutant must be the MINIMAL revert** — the
one-token change that puts the old name back. A guard test has previously survived the one-token
revert of the line it guards. Record each as `N failed / M passed`, and the sum must equal the file's
RUNTIME test count (`test.each` expands, so a `grep -c` over test declarations undercounts).

★ **Revert the mutant with an inverse anchored write, then prove the diff is empty.**
`git checkout -- <file>` is deny-blocked here. A shorter revert anchor has previously matched a
different site, reported success, and left a live mutant with the suite still green — so assert
uniqueness in BOTH directions, and end on a `--stat`, never on the suite result.

## Reproduction probes come first

§309, §305 and §324 are all `never machine-verified`; §315's collision "was measured off a three-row
fixture rendering three named `40`; nothing pins it". So the first task per entry is a probe that
RENDERS the collision and reads the names back.

★★★ **An acceptable outcome of a probe is "this is not a defect — close it as such".** The fix must
not be forced to match the register. A probe that cannot produce the collision is a finding about the
entry, and the entry gets rewritten rather than the code changed.

## Risks and blast radius

Four source files. No persisted-workspace field, so none of the six write paths are touched; no
`status` / `completedDate` pair; no storage, no codec, no i18n dictionary.

- **§305 changes VISIBLE text.** Existing tests asserting on a bare `recordLabel` may go red. That is
  a real assertion about a real change, so each is to be read and adjudicated — never blanket-updated
  to green.
- **`docs/open-followups.md` will conflict.** A peer branch (`docs/tooltip-inventory-remeasure`, in
  the worktree at `C:/Projects/aipm-wt-a`) is editing the same register and will fold roadmap slice 9
  into it. Merge `origin/main` deliberately before release rather than discovering it at push time.
  ★ A register number is reserved only once it is on `origin/main` — two branches have already minted
  the same one. Re-derive the max AFTER merging, never before.
- **The peer's tooltip inventory is NOT invalidated by §324.** That document is a snapshot pinned to
  `95afb789`, and adding a `label` prop moves neither the `InfoTooltip` mount count nor the
  "without any name prop" tally — both sites were already named via the `text` fallback.

★★ **Closing an entry is a FOUR-PLACE edit:** heading marker · summary-table STATUS cell ·
summary-table ANCHOR (derived from the heading, so it changes when the heading does) · the
`**Status:**` witness line. `isClosed` reads the TITLE only.

## Release

Release is a SEPARATE final task and is gated on explicit user say-so. It is not folded into any
other task, and nothing is pushed, opened as an MR, or merged before that word is given.
