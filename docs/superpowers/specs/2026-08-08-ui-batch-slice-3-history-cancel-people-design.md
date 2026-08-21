# UI batch slice 3 — undo history, AI cancel, budget people rows

**Date:** 2026-08-08
**Status:** approved design, not yet planned
**Baseline:** `main` @ `59cd9489`, app 0.223.0 "Okorafor"
**Parent spec:** `docs/superpowers/specs/2026-08-07-ui-batch-undo-budget-people-dependencies-design.md`

Slice 3 of the twelve-item UI batch. The parent spec cut slice 3 as four features; §3.4
(dependency search + successor linking) is **split out into its own slice** — it is the only
item that writes to *other* tasks (staged draft links, reversed cycle guard, id-mint on the
create path, composite undo), and slices 1 and 2 each ran ~11 commits and three review rounds
carrying less than that.

| In this slice | |
|---|---|
| §1 | Undo/redo through-history dropdown |
| §2 | Cancellable AI triggers — all six sites |
| §3 | Budget bucket people rows |
| §4 | §112 settings-rail wrap fix (slice-2 debt) |
| §5 | `e2e/seed.ts` gains insight + timelog rows (slice-2 debt) |

Conventions follow `AGENTS.md`: **★** non-obvious, **★★** has caused a bug.

---

## Corrections to the parent spec

The parent spec's slice-3 section carries three claims that do not match the code at this
baseline. They are corrected here; the parent is not edited (its slices 1 and 2 have shipped
and its commit messages reference it as written).

1. **"All the AI trigger hooks already hold an `AbortController`" — false, but less false than
   a first grep suggests.** *Five* of six do. `use-ai-orchestration.ts` holds none itself; it
   delegates to `useActionAnalysis` (`use-action-analysis.ts:18,24,53`), which owns a
   controller and already exposes `cancel`. Only `use-insight-recommend` /
   `use-insight-recommend-runner` genuinely lack one — and `runInsightRecommendation` already
   accepts `args.signal` (`insights/recommend-call.ts`), so the gap is a controller ref, not a
   new call path. ★★ The first measurement here was wrong because it grepped the *named file*
   instead of tracing the call path; a per-file grep cannot see a hook that delegates.

2. **The undo stack entry type is `StackEntry { meta, run }`, not `UndoEntry { meta, restore }`.**
   `StackEntry` is declared **private** in `undo/use-undo-stack.ts:351`. The exported
   `UndoEntry` in `undo/undo-stack.ts:30` carries a `restore` field and is not what the live
   stacks hold. Anything added to the pure module must be generic over
   `E extends { meta: UndoMeta }` — which is exactly how the existing `pushUndo` / `popUndo` /
   `dropEntry` are already written — so the private type never has to be exported.

3. **`redo()` does not share `commitUndo`.** `undo()` and `undoById()` both route through
   `commitUndo` (`use-undo-stack.ts:371`); `redo()` has its own body (`:400`). `redoThrough`
   is therefore a second parallel function, not a parameterisation of one shared path.

Also re-measured at this baseline: `budget-panel.tsx` is **729** lines (parent said 718),
`dependencies-editor.tsx` **211**, `undo/undo-control.tsx` **148**, `undo/undo-stack.ts` **266**,
`UNDO_CAP = 25` (`use-undo-stack.ts:23`).

★ The size gate counts `readFileSync().split("\n").length`, which is `wc -l` **+1**. Read the
real number with:

```bash
node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
```

---

## §1 — Undo / redo through-history dropdown

Today the caret previews only the label of the next entry. It becomes an MS-Office style
history: activating entry *n* reverts entries 1..*n* in order, newest first. Redo is symmetric.

### 1.1 Engine — `undo/undo-stack.ts`

Two pure additions, both generic over `E extends { meta: UndoMeta }`:

```
takeThrough(stack, id)            -> { entries, rest } | null
pushUndoMany(stack, entries, cap) -> readonly E[]
```

`takeThrough` returns `entries` **newest-first** — that is the execution order, so no caller
has to remember to reverse — and `rest` as the untouched remainder. It returns `null` when the
id is absent, matching `popUndo`'s existing null-on-empty contract.

`pushUndoMany` folds N pushes and applies the cap once. `pushUndo` caps per call, which is
correct but re-slices N times; more importantly the through-path needs a single fold so the
commit is one `setState`.

★ Both are pure and live in the coverage-gated `.ts` module, so the ordering logic is testable
without React. The hook keeps only execution and commit.

### 1.2 Hook — `undo/use-undo-stack.ts`

`undoThrough(id)` and `redoThrough(id)` join `UndoStackApi`.

```
undoThrough(id):
  taken = takeThrough(stackRef.current, id)          // read the ref ONCE
  if (!taken) return
  inverses = taken.entries.map(e => ({ meta: e.meta, run: e.run() }))   // LIFO, outside any updater
  setStack(taken.rest)
  setRedoStack(rs => pushUndoMany(rs, inverses, UNDO_CAP))
  logActivity("undo", summedCount)                                     // ONE activity entry
  showToast("info", t(lang, "undoneNActions", inverses.length))         // ONE toast
```

★★ **This cannot be a loop over the existing `undo()`.** `stackRef` is refreshed by an effect
(`use-undo-stack.ts:359`), so N calls in one tick all read the same stale stack and undo the
top entry N times. Read the ref once and thread the list locally.

★★ **Every runner executes outside every `setState` updater.** `commitUndo`'s own comment
(`:367`) records why: StrictMode double-invokes updaters, so a `map` of `e.run()` inside a
`setRedoStack` updater would apply all N restores twice. This is the same defect class the
existing single-entry path was already written to avoid.

★ `summedCount` is the sum of `meta.count` across the taken entries, not the entry count —
`meta.count` is the *primary* op size (`use-undo-stack.ts:437` computes it as the rows the user
acted on, excluding incidental cascade captures), and the activity log's existing `undo` kind
takes that number.

★ A through-undo of a strict prefix leaves the redo stack coherent, so it pushes redo entries
normally — unlike the out-of-order `undoById`, which clears redo (`commitUndo`'s `pushRedo`
flag). `undoById` is **not** changed; it backs the toast Undo action.

★ `redoThrough` mirrors `redo()` (`:400`), which does not share `commitUndo`. Two parallel
functions, deliberately not unified in this slice.

### 1.3 UI — `undo/undo-control.tsx`

The caret's `PopoverPanel` keeps `role="dialog"` and gains an inner `<ul role="listbox">`.

★ `PopoverPanel`'s `role` prop is typed `"dialog" | "menu"` (`popover-panel.tsx:40`). The
union is **not** widened — the panel is a portaled dismissal container, and the listbox is its
content. Widening a shared primitive's role union to serve one caller would put a third
dismissal semantic into every consumer's type.

One `activeIndex` state drives everything:

```
band                  = rows 0..activeIndex
footer                = t(lang, "undoNActions", activeIndex + 1)
aria-activedescendant = opt-{activeIndex}

mouseenter row n  -> setActiveIndex(n)
ArrowDown / Up    -> setActiveIndex(±1), clamped
Home / End        -> first / last
Enter / click     -> undoThrough(entries[activeIndex].id)
Escape            -> close (existing usePopoverDismiss)
```

Single source of truth: the drawn band, the footer count and the announced active option can
never disagree, and one test input pins all three. One tab stop via `aria-activedescendant`.
Every entry on the stack renders (cap is `UNDO_CAP = 25`), scroll-capped at roughly 10 rows.

★★ **Each option's accessible name appends its stack position.** The top bar is axe-scanned in
every one of the 17 `A11Y_VIEWS`, and `buildUndoLabel` (`use-undo-stack.ts:92`) legitimately
produces two identical labels for two edits to the same named row — a WCAG 2.4.6 duplicate the
gate passes whenever the seed renders a single row of that entity.

★ The through-band is a visual grouping, not a selection. `aria-selected` belongs to the active
option alone; the footer text is what tells a screen-reader user how many entries Enter will
revert. Marking rows 0..n `aria-selected` would announce a multi-select the control does not
have.

★ New strings: `undoNActions`, `undoneNActions`, `redoNActions`, `redoneNActions` — EN + DE,
0-based positional placeholders.

---

## §2 — Cancellable AI triggers

The affordance is the whole ask: while a feature is busy, its trigger's visible label **and**
accessible name become "Stop" with a stop icon, and clicking aborts.

★ The label must flip *with the action*. A control reading "Asking Claude…" whose click aborts
is WCAG 2.5.3 (F96) — the same trap `use-raci-suggest.tsx` already documents for its own
thinking label.

### 2.1 `ai-trigger-button.tsx` — one contract for six call sites

```
<AiTriggerButton lang busy onRun onCancel idleLabelKey idleIcon />
```

Presentational, no internal state: the caller's existing busy flag drives it. Idle renders the
feature's own label and icon; busy renders `stop` + `StopIcon` and routes the click to
`onCancel`. Built on the shared `Button` primitive, so it inherits the `INTERACTIVE`
focus/motion atom and the hover token.

### 2.2 `use-abortable-ai.ts` — used by exactly one site

A small helper holding `abortRef`, `busy`, `cancel` and the `isAbortError` early-return. Its
only consumer is `use-insight-recommend`.

★ The five paths that already abort are **not** refactored onto it. They are working, tested
code with divergent surrounding logic, and AGENTS.md's shared-SSRF-core rule is explicit that
divergent-but-correct guard chains do not get parameterised into one factory. Uniformity here
would be bought by touching three files nobody asked to change.

### 2.3 The six sites

| Site | Abort today | Work |
|---|---|---|
| `use-raci-suggest.tsx` | yes (`:131`) | button only |
| `use-alloc-plan.tsx` | yes (`:86`) | button only |
| `use-tasks-dedup.tsx` | yes (`:82`) | button only |
| `use-inline-entity-edit.ts` (backs `inline-ai-edit-popover.tsx`) | yes (`:74`) | button only |
| `use-ai-orchestration.ts` → `useActionAnalysis` | yes (`use-action-analysis.ts:18`) | button only; `onCancel` is already on the bag at `use-ai-orchestration.ts:167` |
| `use-insight-recommend` / `-runner` | **no** | helper + thread `signal` into `runInsightRecommendation` |

★ **Read each of the six catch paths; do not assume.** Confirm `AbortError` returns to idle
with no toast and no error banner. Three route through the shared `isAbortError`
(`abort-error.ts`); `use-raci-suggest` and `use-alloc-plan` hand-roll `errName === "AbortError"`.
That divergence is noted here and left alone — folding it in is a separate, purely mechanical
change and does not belong in a feature slice.

★ `inline-ai-edit-popover.tsx` was touched by slice 2. Re-read it before editing rather than
working from the parent spec's description of it.

---

## §3 — Budget bucket people rows

Each role line in a bucket expands to the people behind it, showing Timelog bookings against
planned capacity. Collapsed by default, not persisted.

### 3.1 Engine — `budget-bucket-people.ts` (new, pure, i18n-free)

```
buildBucketPeopleRows({ allocation, resources, actualsByPeriod, plannedByResourcePeriod, periods })
  -> readonly PersonRow[]

PersonRow = {
  resourceId, name, hasPlanLine,
  booked:  Record<periodKey, number | null>,
  planned: Record<periodKey, number | null>,
  bookedTotal, plannedTotal,
}
```

Membership is the union of:

1. `allocation.resourceIds` (`types.ts:594`) — the planned people, `hasPlanLine: true`.
2. Anyone with bookings on this bucket whose `Resource.roleId` equals this allocation's
   `roleId` — `hasPlanLine: false`, `planned` all `null`.

Sort: plan-line members first, alphabetical; then the rest, alphabetical.

Planned capacity is **passed in** as `plannedByResourcePeriod`, not computed here. The caller
(`budget-panel.tsx`) builds it from `periodCapacityHours` (`resource-capacity.ts:147`) — the same
source the planning table uses, so the two surfaces cannot disagree.

★ The engine does not call `periodCapacityHours` itself. That function needs the holiday set,
`workdayHours` and the resource's filtered absences; taking them as engine inputs would drag
workspace-settings plumbing into a pure module whose job is membership and shape. Passing the
resolved map keeps it a pure fold over data the caller already has.

★★ **`booked` is `number | null`, never a bare `number`.** `BucketPeriodCell.byResource` is
**optional on purpose** (`timelog-actuals.ts:19`): the actuals cache can predate the breakdown,
and that file's own comment records what guessing costs — attributing every person to
`allocations[0]` charged them all at the first role's rate. A period whose cell has no
breakdown yields `null` and renders `—`. Rendering `0` would put a fabricated number on a cost
surface, which is worse than showing nothing.

★ Accepted, recorded gap (unchanged from the parent spec): a booking whose resource resolves to
no role line in this bucket — null `roleId`, or a role with no allocation here — appears under
no person row. Those hours stay in the existing `unattributed` total, which is where they are
today. Not dropped, not surfaced per-person. A known limit, not a defect.

### 3.2 Presentation — `budget-panel-people-rows.tsx` (new)

`budget-panel.tsx` is at **729** of the 800-line ratchet, so the rows land in their own file,
following the split precedent of `budget-panel-totals.tsx`.

Each period cell renders `booked / planned` — booked at `text-foreground`, the separator and
the planned figure at `text-muted-foreground`, `—` for planned when `hasPlanLine` is false and
for booked when the breakdown is absent. Read-only: no cell border, so they cannot be confused
with the editable budget cells above.

★★ **Booked is not tinted.** Small tinted text on these surfaces is this repo's documented AA
trap — `--rag-amber-text` measured 3.5–4.4:1 as small text on dark and mockup schemes. The
booked/planned distinction rides position and the `/` separator, so nothing here is
colour-alone either (WCAG 1.4.1).

★ Child rows live in a `<tbody hidden>` keyed `bucketId:roleId`, **not** conditionally-rendered
`<tr>`s. The disclosure's `aria-controls` must reference an id that stays in the DOM while
collapsed, and a `<tbody>` keeps the child cells in the same column grid as the role row.

★ The three pinned leading columns (`DOT_COL_PX`, role, Total) are unaffected — only period
columns gain rows, and the pinning arithmetic reads the role column's live width, not a period
width.

### 3.3 Disclosure

Trigger is `ToggleButton variant="disclosure"` on the role label, with a row-unique `ariaLabel`
naming the role. State is a `Set<string>` of `bucketId:roleId` held in `budget-panel.tsx`,
collapsed by default, not persisted across sessions.

★ This is the **first production consumer** of `variant="disclosure"`, which shipped with zero.
Slice 2 left an open question of whether to keep or delete it; shipping this resolves it as
**keep**. Recorded here so the answer is a decision rather than drift.

---

## §4 — §112: the settings rail's wrapped narrow-viewport layout

`settings-view.tsx:271` renders each rail branch as
`<div role="group" aria-label={…} className="flex flex-col gap-1">`, inside a nav that is
`flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col` (`:289`). On desktop this is
pixel-identical to the flat list it replaced. Below the `md` breakpoint the group becomes one
flex *item* among the rail's other entries, so the active parent pill stretches to the group's
full height — measured at 760px as a solid ~120px block beside its three stacked children.

Fix: **`max-md:basis-full`** on the group div.

★★ **Not an unqualified `basis-full`.** Above `md` the container is `flex-col`, where
`flex-basis` resolves against the **main axis — height**. An unqualified `basis-full` would set
the group to 100% height and break the desktop rail that is currently correct. The breakpoint
qualifier is the whole fix.

★ Nothing in the repo can test either direction: jsdom has no layout, and the axe gate scans one
desktop viewport and has no wrap-order rule. Verification is a narrow-viewport Playwright
measurement (the seeded eye-verify method), asserting the pill's measured height at 760px and
re-asserting the desktop rail is unchanged.

Close §112 in `docs/open-followups.md` in the same commit.

---

## §5 — e2e seed: insight and timelog rows

`e2e/seed.ts`'s `KV` map (`:103`) carries only `documents` + `documentVersions`; eight kv slices
go unseeded, so the views that read them render their empty state at scan time. AGENTS.md names
Insights as affected today, and seeding `documents` for the first time turned up a real serious
violation the empty state had been hiding.

Measured at this baseline — neither slice exists in the curated master:

```bash
node -e 'const m=JSON.parse(require("fs").readFileSync("sample-workspace-small.json","utf8"));
  for (const k of ["insights","timelogLinks"]) console.log(k, m[k]==null?"ABSENT":"present")'
# insights ABSENT
# timelogLinks ABSENT
```

So the rows are authored **in `e2e/seed.ts` only**, via the existing `SEED_WORKSPACE` override
(`:25`) that already augments `documents` with e2e-specific rows for exactly this reason.

★ **The master is deliberately not touched.** Authoring these into
`sample-workspace-small.json` would require regenerating `-big` / `-huge` via
`scripts/generate-sample-workspace.ts` **and** the `__fixtures__/golden-*` byte-stability
fixtures. Putting a golden-fixture regen inside a feature slice makes a real format change and
a fixture refresh indistinguishable in review — which is precisely the failure the byte-stable
serializer gate exists to prevent.

What this unblocks: axe now scans a populated Insights pane and a populated Timelog pane, and
the two eye-verifies slice 2 could not run — the timelog `danger` unlink and the dashboard
insight chips at narrow masonry width — become reachable.

★ Seed enough rows that per-row controls **collide**: N identical accessible names is a WCAG
2.4.6 failure the gate passes whenever one row renders. One row proves nothing.

---

## Cross-cutting

**i18n.** Every new string lands in `i18n.ts` (EN) and `i18n.de.ts` (DE); tsc enforces key
parity. DE uses real umlauts — the `i18n-encoding` test bans ASCII substitutions and
`\uXXXX` escapes. ★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there (and curls
double quotes); patch via a node utf8 write whose anchor matches `\r\n`, then re-verify the
bytes. Interpolated strings use 0-based positional placeholders.

**Coverage.** `undo/undo-stack.ts`'s additions, `budget-bucket-people.ts` and
`use-abortable-ai.ts` are coverage-gated and carry their own tests. New `.tsx` render glue falls
under the existing `coverage.exclude` globs.

**Test traps specific to this slice:**

- ★★ A through-undo test seeded with **one** entry passes whether the runners execute against
  the threaded list or the stale ref — the two implementations are indistinguishable at N=1.
  Seed ≥3 and assert the resulting workspace state, not the call count.
- ★★ A people-row test whose fixture has `byResource` present in every period cannot tell `—`
  from `0`. Give one period a cell with the breakdown **absent**.
- ★★ A StrictMode test for the double-invoke guard is vacuous in the composed-wrapper shape.
  Read `src/app/strictmode.meta.test.tsx` before writing one.
- Mutate and watch it fail: the LIFO execution order, the `null`-vs-`0` booked branch, the
  `max-md:` qualifier, and the summed activity count.

**Gates**, run **serially**, exit codes read **unpiped** (★★★ a pipe returns the pipe's status —
`npm run test:run | tail -8` exits 0 with tests failing):

```
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
npm run test:run
npm run test:shuffle
npm run size:check
npm run dup:check
npm run docs:symbols:check
```

**axe:** Budget · Settings · Insights · Time bookings, plus one view for the top-bar undo
listbox. ★★★ `--workers=1` whenever more than one view is matched — `playwright.config.ts` runs
CI at one worker and local at CPU count, and over-subscription produces `Test timeout` failures
that name no rule and are not violations. Warm the route first.

**Eye-verify** (jsdom- and axe-blind, all of it): the undo listbox band + footer + keyboard
walk · the §112 rail at 760px **and** at desktop · the people rows' alignment under the pinned
leading columns · the two slice-2 items the new seed rows make reachable.

**Release.** Bump `src/app/version.ts` (APP_VERSION, APP_BUILD_DATE, milestone), add a
`CHANGELOG.md` entry, append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN+DE
strings, and update the five ungated version sites: `package.json`, both `package-lock.json`
occurrences, the README shields badge (version **and** codename), and the generated header on
all five `docs/CODEMAPS/*.md`. Codename uniqueness is gated by nothing — grep `CHANGELOG.md`
for the ~148 already used.

**open-followups.md.** ★★ Numbering has collided on **both** prior slices, twice on slice 2.
Check the `## 1NN.` headings on both sides before resolving a merge, not after; main is the
trunk and the branch renumbers, and each entry keeps the number it was filed under because the
commit messages cannot be edited.

---

## Out of scope

- §3.4 dependency search + successor linking — its own slice, its own spec.
- Any change to `undo()`, `redo()`, `undoById`, the toast Undo action, or the undo capture
  contracts.
- Unifying the two hand-rolled `AbortError` checks onto the shared `isAbortError`.
- Refactoring the five working AI abort paths onto `use-abortable-ai.ts`.
- Authoring `insights` / `timelogLinks` into `sample-workspace-small.json`, and any
  `__fixtures__/golden-*` regeneration.
- Persisting the budget people-row disclosure across sessions.
- Surfacing bookings that resolve to no role line in a bucket.
