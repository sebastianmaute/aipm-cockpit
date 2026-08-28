# Row-unique accessible names, round 3 — design

**Date:** 2026-08-27
**Branch base:** `main` at `adacc564` (0.262.1 "Swainston")
**Target release:** 0.263.0 "Okorafor" (spare codename: "Robson")

**Goal.** Buy file-size headroom by extraction, then close the remaining
row-unique-accessible-name defects that rounds 1 and 2 left open, plus two data
defects found hiding behind them — and replace the enumeration METHOD that made
three rounds necessary.

**Closes:** §261 · §262 · §266 · §267 · §268 · §269 · §270 · §272
**Narrows:** §229 (to one file, with evidence)
**Files new entries for:** §267's bar-drag residual · whatever the §245 scanner finds
**Also fixes:** the §250 index/heading status desync in the register

> ★★★ **THIS IS A DATED PRE-IMPLEMENTATION DESIGN RECORD, NOT A LIVE DOCUMENT.** Every measurement
> below was taken on `adacc564`, BEFORE any of the work it describes; the slice then changed the code
> those measurements describe, so a number here that disagrees with today's tree is the record working,
> not a defect in it. **Do not update it to match HEAD** — same treatment as
> `docs/security/findings-2026-07.md`. What a design record is good for is saying what was believed and
> measured before the work, which is the only way the outcome can be reviewed against the intent; a
> spec silently rewritten to agree with the implementation can never disagree with it.
>
> ★★ Two things in particular have moved and are worth naming because a reader will hit them first.
> (1) The scanner this spec designs shipped and was then CORRECTED — `5aa07575` fixed three defects in
> it (a destructured-map blind spot, self-closing controls inside a `<label>`, and `scanOpenTag`
> mis-reading an apostrophe in a comment as a string opener), so every figure the scan produced before
> that commit is superseded. (2) Register entries this spec lists under **Closes** are closed, so their
> present-tense descriptions of live defects no longer hold. Today's numbers live in
> `docs/open-followups.md` §276 and, better, in a fresh `node scripts/check-rowname-surfaces.mjs`.
>
> Re-verify any claim here against HEAD before acting on it; if a claim still matters, restate it in a
> live doc. (Nothing gates this file — see the same note on the plan.)

---

## 0. Provenance of every number in this spec

Every measurement below was produced by a read-only investigation on `adacc564`
and is re-runnable. Three register entries were found WRONG by re-running their
own reproduce commands; those corrections are called out inline and must be
written back into the register as part of this slice.

★★ Line counts use the ratchet's own arithmetic, which is ONE MORE than `wc -l`:

```bash
node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
```

---

## Phase B — extraction (refactor-only, NO behaviour change)

Each B task is its own commit and must be independently green before Phase A
starts. A red gate must never be ambiguous about which half caused it.

| # | File | Extract to | Δ | Result | Convention |
|---|---|---|---|---|---|
| B1 | `src/app/task-manager.tsx` | `src/app/use-insight-recommendations.ts` | −217 | ~2830 (headroom ~190) | deps-object `use*` hook |
| B2 | `src/app/use-chat-dispatcher.ts` | `src/app/use-register-tools.ts` | −~221 | ~578 | deps-object `use*` hook |
| B3 | `src/app/budget-panel.tsx` | `src/app/budget-panel-cards.tsx` | −88 | ~710 | presentational leaf |

### ★★★ The prohibition that governs Phase B

**NEVER run `node scripts/check-file-sizes.mjs --update` in this slice.**

`--update` rewrites `docs/baselines/file-sizes.json` to CURRENT sizes for every
file over `LIMIT`. Running it after B1 would re-ratchet `task-manager.tsx` from
3020 down to its new ~2830 and hand back **zero headroom**, silently undoing the
entire point of the phase. The stale-high 3020 entry IS the headroom.

Verified by reading the `--update` branch of the script, not by report.

### Gate semantics (verified by reading `scripts/check-file-sizes.mjs`)

- `if (n <= LIMIT) continue` — a file at or under 800 is never examined.
- Over 800 with no baseline entry → `NEW file over 800` violation.
- Over 800 with a baseline entry → violation only if it GREW.

Consequence: `budget-panel.tsx` (795) is under a FLAT CAP, not a ratchet. It is
not in the baseline; the baseline holds exactly four keys (`chat-panel.tsx` 996,
`task-manager.tsx` 3020, `tasks-section.tsx` 1081, `workspace-section.tsx` 1000).

### B1 — `task-manager.tsx` → `use-insight-recommendations.ts`

Moves the self-delimited Insights→Action-Loop block: its own banner comment
through `confirmInsightRecommendation`, terminated by the unrelated
`cacheFxRates`. 204 lines, plus an orphaned module const `ENTITY_DIGEST_TEXT_CAP`
and 8 import lines each verified to have zero use outside the range. **−217
measured.** Interface: ~23 deps in / 7 returns out; nine names leave the
orchestrator's scope entirely.

Returned names (`insightActions`, `insightGeneratingId`,
`cancelInsightRecommendation`, `confirmInsightRecommendation`, `reviewInsight`,
`reviewPlan`, `setReviewInsightId`) are consumed ONLY inside `task-manager.tsx`.
Hits elsewhere (`dashboard-panel.tsx`, `dashboard-tile-bodies.tsx`,
`workspace-section.tsx`, `workspace-section-types.ts`) are prop names on the
receiving side, not imports. **Nothing outside `task-manager.tsx` changes.**

**Coverage.** No `use-*.ts` glob exists in `vitest.config.ts` `coverage.exclude`
— thirteen `.ts` files are listed BY NAME. A new `.ts` is coverage-GATED unless
named. The block contains no JSX, so `.ts` is correct and an exclude entry is
required. This is coverage-NEUTRAL: `task-manager.tsx` is already excluded via
`src/app/**/*.tsx`, so the code is unmeasured today either way.

★ AGENTS.md says "exclude glue, not logic", and `resolveInsightEntity` and
`confirmInsightRecommendation` are real logic, not glue. Honest resolution:
exclude the hook, and lift `resolveInsightEntity` + `buildInsightRecommendContext`
into `src/app/insights/` (existing directory of pure engines that stay gated)
with unit tests. If that proves awkward, file it rather than forcing it — but do
not silently leave logic excluded while citing the glue rule.

**Hidden coupling — all five must survive the move:**

1. **Placement is load-bearing and the code says so.** The block's own comment
   states it lives after `dispatcher` exists; `confirmInsightRecommendation`
   replays tool calls through the `useChatDispatcher` result. The new hook call
   must sit exactly where the block was — after `useChatDispatcher`, before
   `useFxRates`.
2. `useInsightRecommendRunner` is a SIDE-EFFECTING hook, not a value. It must
   move with the block or the background recommendation runner silently stops.
3. `reviewInsight` is deliberately NOT memoized — a bare `.find()` recomputed
   each render, and `reviewPlan`'s `useMemo` depends on that fresh identity.
   "Tidying" it into a `useMemo` changes recompute behaviour.
4. `confirmInsightRecommendation`'s re-entrancy guard is ORDER-dependent:
   `setReviewInsightId(null)` runs before any `await` and is documented as the
   double-click guard. Do not reorder.
5. The `RecommendationReviewModal` mount sits OUTSIDE `modalsBlock` — easy to
   miss when rewiring consumers.

**Unverified, resolve against `tsc` during implementation:** the ~23 dep count is
an identifier scan with ~2 known false positives; the call-site line estimate is
a formatting judgement; and whether deleting the TYPE-ONLY import line
(`Insight`/`InsightActions`/`InsightRecommendation`) is safe — type positions are
where an identifier scan is weakest.

### B2 — `use-chat-dispatcher.ts` → `use-register-tools.ts`

Moves the register-CRUD tools (`listRaid` → `deleteStakeholder`), 197 lines
measured, plus 4 refs, 4 sync effects, 8 exclusive imports and 8 destructure
names. **~221 net.** All eight moved imports (`sanitizeRaidItem`,
`sanitizeChangeItem`, `sanitizeMilestone`, `sanitizeStakeholder`,
`toRaidSummary`, `toChangeSummary`, `toMilestoneSummary`, `toStakeholderSummary`)
verified to have ZERO occurrences outside the block.

**Coverage: no new exclude entry and no new test file.** Verified precedent:
`use-document-tools.ts` (455 lines) was extracted from this same hook, is NOT
coverage-excluded, has no test file of its own, and stays covered through the
existing dispatcher harness because it is still reached via the same dispatcher
object. No test reads this file as source text.

★★ **The dep-array trap.** The `useMemo` building the dispatcher has deliberately
narrow deps, with a comment explaining that a memo'd tool object captured by the
spread MUST be a dep or the first render's tools freeze into every later
dispatcher. A new `registerTools` object is the same shape and needs the same
dep. Getting it wrong serves stale tools after a read-only toggle — **no gate
catches this, and the existing suite may not either.**

Consumers: `task-manager.tsx` import + call site. Neither needs changing — the
dispatcher's public shape is unchanged.

Two comments go stale and must be fixed in the SAME commit: a
`logActivityAs?.("ai"` count in `use-chat-dispatcher.test.tsx` (23 today, 11
after) and a `grep -c logActivity` count in `chat-tool-defs.ts` (28 today, 16
after).

### B3 — `budget-panel.tsx` → `budget-panel-cards.tsx`

Moves `ManualPercentCell` and `Cci` — both already standalone, fully prop-driven,
explicitly prop-typed, with zero render-scope capture — plus five import lines
verified unused afterwards. **−88 measured.** `.tsx`, so coverage-excluded by
class; no `vitest.config.ts` edit. No consumers outside the file: both are
module-private today, and the three budget test files reach them through rendered
output, never by import.

★★ **This extraction is INSURANCE, not a prerequisite.** §262's claim that
`budget-panel.tsx` has "no headroom" for the fix does not survive counting: the
fix DELETES ~20 lines of deferral comments that it replaces, so its net line
delta is negative. B3 is worth doing so the a11y fix is not line-budgeted, but it
is not load-bearing and may be dropped if it fights.

★ Keep two comments attached during the move: `ManualPercentCell`'s note that
clearing must write `undefined` and never `0` (or `bucketPercentComplete` treats
it as a real override pinning the bucket at 0% forever), and its note that
`budget-bucket-modal.tsx` renders a SECOND control with the same
`budgetPercentComplete` label — a §262 fix must not assume the two are one
control.

### B4 — `use-storage-backend.ts` is DROPPED from scope

★★★ **Do not extract from this file, and record why so nobody re-proposes it.**

**Four tests read `use-storage-backend.ts` as raw SOURCE TEXT** and assert on the
autosave effect's contents. They are the anti-vacuity guards for the "new
`Workspace` field → six write paths" invariant; `insights-autosave.test.ts`'s own
comment calls a source scan "the honest guard here". Simulating the extraction by
re-running each test's own matcher against an in-memory copy with the effect
removed:

| Test | Metric | Today | After | Floor | Verdict |
|---|---|---|---|---|---|
| `insights-autosave.test.ts` | knowledgeItems+settingsOverrides tuple lines | 6 | 3 | `>=5` | FAILS |
| `timelog-links-persistence.test.ts` | same matcher | 6 | 3 | `>=5` | FAILS |
| `calendar-events-persistence.test.ts` | deps-array lines | 1 | 0 | `>0` | FAILS |
| `use-load-truncation.test.ts` | hardcodes the path in a file list | — | — | — | needs review |

Rewriting those guards to point at a new file is precisely the operation that
leaves a guard GREEN while making it VACUOUS — on the app's persistence choke
point, carrying the data-loss invariants and the §103 truncation gate. 130 lines
does not buy that risk.

The seam itself is clean (114 cohesive lines, three exclusive refs, two
well-defined interface constraints). **This is a decision on cost, not on seam
quality.** §229 stays open, narrowed to this file, with this table recorded.

★★ §229's own prohibition stands: do NOT close it by adding a baseline entry.

---

## Phase A — round 3

### A1 — §261, toolbar-filter vs sortable-header vs column-config (option 1)

★★★ **REGISTER CORRECTION: the entry says "six of the seven" are 3-way. It is
SEVEN of seven** — the entry contradicts its own preceding clause ("a
`ColumnConfigPopover` checkbox shares EACH OF THESE same keys too"). Verified:

```bash
grep -n 'labelKey: "changeField\|labelKey: "raid\|labelKey: "stakeholderFieldName"' \
  src/app/change-panel.tsx src/app/raid-panel-columns.ts src/app/stakeholders-panel.tsx
```

returns an entry for all seven keys, and all three panels mount the popover.
`ColumnConfigPopover` renders a `<Checkbox>` inside a `<label>` whose text is the
same translation, so the checkbox's accessible name IS that string.

**The decision, recorded.** The three colliding controls have THREE DIFFERENT
ROLES (combobox/searchbox · button · checkbox), so AT announces "Type, combo
box" / "Type, button" / "Type, check box". That is materially weaker than a
same-role collision, and this codebase twice concluded in writing that it was
acceptable (`change-panel.test.tsx` scopes to `<tbody>` calling it "a real but
cross-ROLE, pre-existing naming overlap"; `stakeholders-panel.test.tsx`
documents the same). **We are fixing it anyway** — the qualifier is a
readability win independent of the collision argument, and one extra key closes
the third leg everywhere. Both test comments must be REWRITTEN to point at the
fix rather than at an open entry.

**8 new key names / 16 dictionary entries.** Seven filter keys, each verified
absent today: `changeFilterType`, `changeFilterStatus`, `raidFilterCategory`,
`raidFilterSeverity`, `raidFilterStatus`, `raidFilterOwner`,
`stakeholderFilterName`. Precedent for the split is `milestones-panel.tsx`
(`milestonesFilterName` "Filter by name" vs `milestonesColName` "Milestone").

Plus one `colConfigToggleColumn` qualifier inside `ColumnConfigPopover` →
"Show column – Type". It CONTAINS the visible label, so WCAG 2.5.3 stays
satisfied. This single key closes the third leg in ALL FIVE consumers at once,
including `milestones-panel` and `tasks-section`, which §261 never named.

★ EN (`i18n.ts`) and DE (`i18n.de.ts`) must stay at exact key parity — tsc
enforces it. DE must use real umlauts; the `i18n-encoding` test bans ASCII
substitutions. ★★ Do NOT edit `i18n.de.ts` with the Edit tool (CRLF + umlaut
corruption); patch via an anchored node utf8 write matching CRLF.

★ Methodology warning so nobody chases a ghost: a naive `^  key:` regex over the
two dictionaries reports EN 3784 / DE 3782. That is NOT parity drift — the two
EN extras are `lang` and `key`, the parameter names in the `t(lang, key, …)`
signature, which the regex matches.

### A2 — §262, budget bucket controls

Both the reorder `DragHandle` (`ariaLabel`/`title`) and `ManualPercentCell`'s
input key on the raw bucket name, and nothing enforces bucket-name uniqueness.
Measured: two buckets both named "PAM" produce two byte-identical labels.

**Build the token map with `buildRowTokens` DIRECTLY**, in a `useMemo` in the
orchestrator body, over the ORDERED `br` rows mapped to `{id: br.bucketId, name:
br.name}`. ★ Do NOT use `useRowTokens` over `buckets`: tokens number by RENDERED
order, and the rendered list is reordered by `bucketOrder`, not storage order.
(Bucket ids are `number`, so the hook is type-compatible — which is exactly what
makes this the tempting wrong answer.)

- `DragHandle` — no prop change; swap `br.name` for the token in the existing label.
- `ManualPercentCell` — NEW REQUIRED PROP `rowToken: string`. As a per-item
  component it has no sibling visibility and cannot disambiguate itself.

### A3 — §266, swimlane lanes

★★ **REGISTER CORRECTION: the fix shape must build the token map from the
COMPUTED `laneLabel`, not from `lane.label`.** The unassigned lane's raw label is
empty (it is substituted with `t(lang,"swimlaneUnassigned")` at render), so
tokenising the raw field names that lane off an empty string. The entry does not
say this.

Lane ids are strings, so use `buildRowTokens` directly (`useRowTokens` is
constrained to a numeric `id`).

Tokenising `laneLabel` once fixes all three consumers at zero extra cost — the
`<section>` (role `region`, two identical region names), the remove button (the
filed defect), and the `swimlaneCell` on a role-less div. Take all three.

★★ **The gating claim is exactly right and drives the fixture:** `canRemove`
requires a non-null `resourceId` AND `isEmptyLane`, so the detector MUST seed two
same-named resources via `extraLaneIds` with ZERO tasks on either. A lane holding
a task renders no remove button and the test observes nothing.

### A4 — §267, Gantt name buttons + the unreported bar-drag defect

Confirmed: `grep -n "aria-label" src/app/gantt-rows.tsx` returns three lines, all
bar-drag handles. Neither name button has the attribute — the task row renders
the task name and the milestone row the milestone name as CONTENT, so each takes
its accessible name from that. The `#id` disambiguates neither: on the task row
it sits in a SIBLING `<span>` outside the button, and the milestone row renders
no id at all.

**Prop path (verified):** `gantt.tsx` builds `visible` and `visibleMilestones`,
then `rows = buildGanttRows(...)`, passed to `GanttChart`, which renders
`GanttTaskRow` and `GanttMilestoneRow`. Two new props on `GanttChart`, one each on
the row components.

★★ **REGISTER CORRECTION: build the maps from `rows`, split by `row.kind` — NOT
from `visible`/`visibleMilestones`.** `row-tokens.ts` states the rule: callers
pass rows in the order the USER navigates, as rendered. `buildGanttRows`
interleaves and reorders, and `gantt-chart.tsx` DROPS any task with no bar.
Numbering against the pre-filter arrays can emit a "(2)" whose "(1)" is not on
screen. `rows` is already a `useMemo`.

★ A residual remains — the no-bar drop can still hide a numbered sibling.
**Comment it; do not claim it closed.** File it as a new register entry.

★★★ **NEW DEFECT, not in §267 and not filed anywhere.** The three bar-drag
controls are `role="button"` with an `aria-label` of `ganttBarResizeStart` /
`ganttBarMove` / `ganttBarResizeEnd` and NO row qualifier. Two tasks render SIX
identically-named buttons. Same 2.4.6 class, and it will fail any two-task
`roles:["button"]` scan independently of the name-button fix. Fix it in this pass
— the token map is right there.

### A5 — §269, RAID badge WCAG 2.5.3

Visible content is the mix string ("2R · 1A · 0I · 0D"); the accessible name is
"Referenced by 2 RAID item(s) – Alpha". The visible label is not CONTAINED in the
accessible name. ★ 2.5.3 holds by CONTAINMENT — case-insensitive,
position-independent — never by prefix.

**Minimal fix, zero new keys**, nesting the existing helper:

```
aria-label={rowLabel(rowLabel(mix, t(lang, "raidReferencedBy", refs.length)), rowToken)}
```

→ "2R · 1A · 0I · 0D – Referenced by 2 RAID item(s) – Alpha". Containment
satisfied verbatim; round 2's 2.4.6 `rowToken` untouched; only existing keys and
the existing separator, so no untranslated literal. `title` stays the bare count
and is unaffected (`aria-label` wins the name).

★ The branch did NOT create this — both halves pre-date it. Round 2 wrapped the
count in `rowLabel` to close a 2.4.6 collision and left the 2.5.3 relationship as
it found it.

### A6 — §270, contact removal (DATA DEFECT)

`ContactPersonsControl` removes by comparing names, so for two contacts sharing a
name **either button deletes BOTH**. That is silent data loss, and renaming the
buttons would have hidden it behind a nicer label.

**Fix: remove by index/identity, not by name.** That also carries the genuine
2.4.6 half — `"Bob  Jones"` and `"Bob Jones"` are two entries with ONE accessible
name (accessible-name computation collapses internal whitespace; the add path's
`hasName` guard trims but does not collapse), addable through the form itself.
Exact duplicates additionally arrive via `sanitizeProjectMeta`, which does not
dedupe an imported project.

### A7 — §268, resource mailbox copy buttons (DATA DEFECT + recorded answer)

**Recorded answer:** cross-row sharing of a mailbox is genuinely SAME-PURPOSE —
both buttons copy the identical string — so WCAG 2.4.6 permits the shared name.
**No qualifier.** This is the recorded ANSWER the entry asks for, not a deferral.

**But the within-row repeat is a real bug:** the address list is built from the
primary email spread with the secondary list and no dedupe, so one address
present in both fields renders the same button TWICE IN ONE ROW —
indistinguishable by position too. **Fix: dedupe the list.** That is a data fix,
not a naming one.

### A8 — §245, the enumeration scanner

Rounds 1 and 2 drew their population by grepping test NAMES. That bound is
provably incomplete — at least three tests assert this exact property under other
nouns and were missed. That method is why there is a round 3.

Build a **report, not a gate**, following the existing
`check-followup-claims.mjs` / `followup-claims-lib.mjs` /
`followup-claims-lib.test.mjs` triple. Wire it as `npm run rownames:check` with a
`scriptsDescriptions` entry, or `docs:scripts:check` fails.

★★★ **Built LAST, and whatever new surface it finds is FILED, NOT FIXED.** That
bound is the only thing keeping this slice from becoming round 4 inside round 3.

★ It cannot be a blocking gate: a real gate would have to render every panel with
a collision fixture, which is precisely the thing the register keeps recording
that only a unit test can do. Do not overclaim it.

---

## Testing

**Hosts:** `change-panel.test.tsx` · `raid-panel.test.tsx` ·
`stakeholders-panel.test.tsx` · `budget-panel.test.tsx` ·
`task-kanban-swimlanes.test.tsx` · `gantt.test.tsx` · NEW
`task-raid-badge.test.tsx`.

★★ **§267 goes in `gantt.test.tsx`, NOT `gantt-rows.test.tsx`.** The latter is 72
lines and imports only `GanttMilestoneRow`; `GanttTaskRow` has no test at all and
needs a synthetic bar to render in isolation. More importantly the DEFECT is that
the map must REACH the row — an isolated row test passes with the threading
broken.

### The four traps, each of which yields a GREEN but WRONG test

1. ★★★ **§261 must set `requireCollisionSeed: false`.** The helper throws unless
   two names collide after stripping the occurrence suffix. §261's fix is
   DISTINCT NAMES, not occurrence indexing, so post-fix nothing collides and the
   guard **fires on correct code**. Anti-vacuity must instead come from a
   positive assertion that the three expected distinct strings are present.
2. ★★★ **§261's existing tests could never have seen this defect** — each narrows
   `roles` to a single family (`["combobox"]`, default `["button"]`,
   `["button","checkbox"]` with no searchbox). That is exactly the narrowed-roles
   masking the helper's docstring warns about. The new tests must use the FULL
   colliding role set and must NOT scope to `<tbody>`.
3. ★★ **§262's input is `type="number"` → role `spinbutton`**, not textbox. A
   `roles:["button"]` scan silently misses half the fix. Use
   `["button","spinbutton"]`, and scope to the bucket-card container —
   `budget-panel.test.tsx` already records that document-wide scope is unusable
   here because of pre-existing unqualified "Edit/Close/Remove bucket" buttons
   and CCI tooltip collisions.
4. ★★ **§266 needs two EMPTY twin lanes** seeded via `extraLaneIds`. See A3.

### `minControls` and `requireCollisionSeed`

★★★ **Every floor is MEASURED against the real fixture at implementation time.
Never guess one.** `minControls` guarantees only that the scope is NON-EMPTY — it
counts CONTROLS, not rows, over the whole document unless scoped, so a panel
toolbar alone satisfies any plausible floor. A loose floor re-admits a narrowed
`roles` array unnoticed. Calibration from existing adopters spans 2–21.

`requireCollisionSeed: true` is appropriate for §262, §266, §267 (all
occurrence-indexing fixes). It must be **false** for §261 (trap 1).

★ **§269 needs a direct containment assertion** — `expectRowUniqueNames` checks
2.4.6 UNIQUENESS and does not fit 2.5.3, and the repo has no 2.5.3 helper:

```
expect(btn.getAttribute("aria-label")!.toLowerCase())
  .toContain(btn.textContent!.trim().toLowerCase())
```

If round 3 ends up taking more 2.5.3 work, a shared containment helper beside
`row-unique-names.ts` is worth the same investment.

### Gates

Necessary gates only, per task; the full suite at the end if at all.
`npx tsc --noEmit` after ANY test edit (vitest never typechecks). `npm run
test:shuffle` before pushing, since this slice adds tests. Axe locally with
`--workers=1` for any multi-view selection. Never read a gate's exit code
through a pipe.

---

## Version and register

**0.263.0 "Okorafor"** (spare: "Robson"). Minor, not patch: 8 new i18n keys and
real behaviour changes. Per the codename convention, a new minor takes a new
author name; a patch reuses its minor's.

Release checklist: `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE +
APP_MILESTONE together), `CHANGELOG.md` entry, then `npm run version:sync` for
the six satellites — never hand-edit them.

**Register work:** close §261, §262, §266, §267, §268, §269, §270, §272. Narrow
§229 with the B4 table. File the §267 bar-drag residual and the scanner's
findings. Fix the §250 index/heading desync.

★★ An open-followups heading edit is a FOUR-place edit: heading, table status,
table anchor, and the `isClosed` witness. ★ Renumber DESCENDING if renumbering.
★ A register number is reserved only once it is on `origin/main`.

---

## Explicitly OUT of scope

- `use-storage-backend.ts` extraction (B4 — declined on evidence).
- §246's `InfoTooltip` collisions beyond the two controls §262 names — 13
  collision groups in `budget-panel.tsx` and an unsettled `roles-editor.tsx`
  question the entry itself records as "an open question, not a settled defect".
- `budget-panel.tsx`'s 303-line bucket-card map extraction — the change the
  panel-split convention prescribes, deferred deliberately. **File it explicitly
  rather than leaving it implicit**: a 34-prop leaf extracted under time pressure
  alongside an a11y fix, in a panel NOT in `A11Y_VIEWS`, is how a regression
  ships.
- Fixing anything the A8 scanner finds.
- §245's own closure — the scanner addresses it; closing it is a judgement for
  after the scanner has actually run.
