# Project key facts, completeness nudges, and shell polish — design

**Date:** 2026-09-12
**Source:** GitLab work item [#64](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/work_items/64) (`O-1: Project creation from a name alone`), plus four requirements raised alongside it.
**Status:** approved in brainstorming (three sections, each approved separately). Not yet planned.

---

## 1. Goal

Let a project be created from a name alone, then replace the mandatory-field gate that
disappears with two softer mechanisms — actionable nudges in the Next actions engine and a
completeness indicator in the Projects list. Three unrelated shell items ride along: a fix for
the top-bar search box clipping the "Ask Claude" button, the `ToggleButton` pressed-marker
animation, and a startup rule that lands the app on the Dashboard.

## 2. Scope

Six slices across three merge requests. **Ship order is C → A → B** (see §9).

| MR | Slices | Why grouped |
|---|---|---|
| **C** | Search-box clipping fix; `ToggleButton` marker animation; startup view rule | Independent of A and B and of each other; all small. Ships **first** because the clipping fix is a visible defect in window chrome and nothing blocks it. |
| **A** | O-1 optionality | Must land before B — B presumes incomplete projects can exist. Carries the only data-loss risk, so it gets its own review and its own pipeline. |
| **B** | Key-fact model + Next-actions provider; Projects list indicator | Share one pure model and are meaningless apart (a provider with no indicator, or an indicator with no nudges). |

### Non-goals

- No change to `SegmentedControl`'s `data-selected-marker` (different primitive).
- No TimeLog project-key *field*. The work item notes the key is a PMO artefact that often
  does not exist yet; `code` is the existing free-text stand-in and stays that.
- No eager reading of every project's backend to populate the indicator. Rejected in
  brainstorming: file-mode projects sit behind FS-access handles needing a user gesture, so
  some rows would read as unknown regardless, and the cost is N backend loads per render.
- No `PerformanceNavigationTiming`-based discrimination between reload and fresh navigation
  in the startup rule (considered and rejected — see §6.2).

## 3. Decisions taken in brainstorming

Each of these was a fork with live alternatives; recorded so the plan does not relitigate them.

1. **Nudges live in the Next actions engine**, as a new provider — not in `insights/detect.ts`.
   "Field is empty" has no trend to reconcile, and the `InsightType` union is closed at nine
   members. The provider route buys score, tier, snooze, grouping and the hero card for free.
2. **One action per missing fact, auto-grouped.** They share a CTA target, so
   `groupNextActions` collapses them to one row whose primary is the highest-weighted fact and
   whose `+N more reasons` expander lists the rest. No grouping code changes.
3. **The key-fact set is the eleven fields O-1 de-mandates** — `name`, `code`,
   `projectManager`, `customer`, `products`, `profitCenter`, `naceSection`, `deployment`,
   ≥1 `contactPersons`, ≥1 `regulatory`, `startDate`. Chosen over the ~30-field
   `ProjectMeta` because 11/11 is genuinely reachable, so the indicator can actually go green.
4. **Indicator = meter on every row + banner on the current project only**, with the customer
   meta line above the meter and **no** count chip. Four row states, including *unknown*.
5. **The marker animation is default-on in the primitive with an opt-out prop**, opting out
   `gantt-view-menu.tsx` and `budget-panel-people-rows.tsx`.
6. **Startup lands on Dashboard unless the hash deep-links an item.**

## 4. MR A — project creation from a name alone (O-1)

### 4.1 The finding that shapes this slice

`validateProjectMeta` is not the only gate. `sanitizeProjectMeta` (`sanitize-records.ts`) has
nine hard `return null` guards on the same fields — `code`, `projectManager`, `customer`,
`products`, `profitCenter`, `naceSection` (set membership), `deployment` (set membership),
`startDate`, and `regulatory` (behind the existing `lenientRequiredArrays` option).

`return null` discards **the entire project meta**, not the offending field. So relaxing only
the form would let a name-only project save once and then lose its whole record on the next
strict decode from any text backend. This slice is therefore form **and** validation **and**
sanitizer **and** type **and** the consumers that fall back on a blank value.

The sanitizer is reached from five production paths, and every one of them becomes more
permissive with this slice: `buildProjectFromObj` (the CSV and Markdown project decoders,
`csv-codecs-config.ts` / `markdown-codecs-core.ts`), `buildProjectFromObjLenient` (the Turso
tenant project list, `rowsToProjectList` in `turso-tenant-schema.ts`), the JSON workspace load in
`workspace.ts`, the IndexedDB load in `browser-backend.ts`, and the form submit in
`project-form.tsx`. Reproduce with
`git grep -n "sanitizeProjectMeta(\|buildProjectFromObj" -- src ':!*.test.*'` and read past the
definitions and the import lines.

### 4.2 Type shape

Widen in place; do not make fields optional.

- `code`, `projectManager`, `customer`, `products`, `profitCenter`, `naceSection`,
  `startDate`: stay `string`, with `""` meaning not-set.
- `deployment`: `Deployment` → `Deployment | ""`.
- `regulatory`, `contactPersons`: empty arrays become valid.

Rationale: `ProjectDraft` already models `deployment` as `Deployment | ""`; every text codec
already round-trips blanks; `?`-optionality would push roughly thirty call sites through
`?.`/`??` for no behavioural gain. `""` is safe here **because there is no third state to
conflate** — a field is set or it is not. That safety is conditional on §4.4.

Blast radius is small and was measured, not assumed: `deployment` has seven non-test reads, of
which only `template-suggest.ts` consumes it semantically, and it already handles blank
correctly (`DEPLOYMENT_POINTS[meta.deployment] ?? 0`, guarded by `dep > 0` before a reason is
pushed).

★ **That file still needs a type edit, which the paragraph above used to hide.**
`DEPLOYMENT_POINTS` is declared `Record<ProjectMeta["deployment"], number>`, so widening the field
adds `""` to the record's KEY set and the three-key literal stops satisfying it — a `tsc` error,
not a runtime one. Give the literal a `"": 0` member; that keeps the key type derived from
`ProjectMeta` rather than hard-coding `Deployment` a second time. (Corrected 2026-09-13 against
`origin/main` `c3598637`.)

### 4.3 Sanitizer

`sanitizeProjectMeta` keeps exactly two rejections: input is not a plain object, and `name` is
blank. The function holds eleven `return null`s in total; the other **nine** are removed, with
one refinement: the two
set-membership guards are **narrowed, not deleted** —

```
if (raw && !SET.has(raw)) return null;   // blank accepted; a typo'd value still rejects
```

so the garbage guard survives for `naceSection` and `deployment`. `lenientRequiredArrays`
becomes redundant for `regulatory` and is folded in rather than left as a dead option.

★ **Folding it in makes a whole builder dead, not just an option.** The option has ONE production
caller, `buildProjectFromObjLenient` (`csv-codecs-config.ts`), whose body differs from
`buildProjectFromObj` by that option alone. Once the option is gone the two are identical, so the
lenient builder is deleted and `rowsToProjectList` calls `buildProjectFromObj`. Its docstring was
already wrong before this slice — it says the flag skips "the three empty-required-array
rejections" including both key-stakeholder arrays, while the sanitizer rejects an empty
`regulatory` alone — so nothing true is lost with it.

★★ **A comment in `e2e/` states the old rule as fact and must be rewritten in the same MR.** The
docstring on `PROJECT_ROW` in `e2e/version-history-documents.spec.ts` says a Turso row decodes to
null unless code, project manager, customer, products and profit center are non-empty and
`startDate` parses. After this slice only `name` is load-bearing; the row itself can stay a full
one. No gate reads e2e comments.

### 4.4 Blank-value consumers

Widening to `""` is only safe if every fallback is audited, because `??` does not catch the
empty string. ★★ **The two sites this section first named were BOTH mis-described** (corrected
2026-09-13 against `origin/main` `c3598637`, by reading the call sites rather than the fallback):

- `timelog-panel.tsx` — `ws.project?.code ?? "default"` does **not** reach TimeLog. The value is
  passed as `projectId` to `useTimelogPickerScope`, which only compares it against the last value
  it saw to reset its one-shots on an in-place project switch; the actuals cache is keyed on
  `projectKey`, as the comment beside it says. So a blank code sends nothing wrong anywhere. What
  O-1 does change is that two code-less projects now produce the SAME signal, so an in-place
  switch between them does not reset the picker. A `||` fallback does **not** fix that — both
  would collapse to `"default"` instead of `""` — and two projects sharing a code already had the
  same flaw before O-1. It is out of MR A's scope and is filed as a follow-up rather than
  patched with an idiom that only looks like a fix.
- The Outlook event-category id (`use-calendar-integrations.ts`) is already
  `portfolioCurrentId || project?.code || "default"`. `||` catches the blank, so it needs no change.
  The `tasks-section.tsx` mentions are comments only.

The sweep over the widened fields returns exactly three `??`/`||` fallbacks today — the two above
and one this section missed, which **is** a real O-1 defect:

- `timelog-panel.tsx` `fetchWindow` — `ws.project?.startDate ?? <90 days ago>`. Before O-1 a loaded
  project always had a start date; after it, a blank one yields `start: ""`, which is passed
  straight to `fetchBookingsForProjects`. Needs `||`.

Reproduce the sweep with
`git grep -n -E '(project|meta|p\.meta|p)\??\.(code|projectManager|customer|products|profitCenter|naceSection|startDate|deployment)\s*(\?\?|\|\|)' -- src ':!*.test.*'`.
It matches property reads followed directly by a fallback operator, so the plan must also read
every non-test consumer of the widened fields for a non-operator blank hazard (a `.length`, an
equality against a known value, a string template); the grep bounds the operator class only.

**The safe idiom is not `??`.** Widening a field to `""` inverts the usual advice: the empty
string is falsy but not nullish, so `??` passes a blank straight through while `||` catches it.
An audit that mechanically rewrites `||` to `??` would therefore make this slice **worse**, not
safer. Over the nine widened fields use a truthiness test or an explicit `.trim() === ""` check,
and treat every surviving `??` on one of them as a defect until shown otherwise.

**Grep discriminator for the sweep.** `report.project.*` is the budget engine's `ProjectReport`
(revenue, cost, margin — `budget-report.ts`), a different entity from the `ProjectMeta` this
slice widens, and as of 2026-09-12 the unmerged `feat/budget-currency-boundary` branch adds many
call sites of it. A bare `grep -rn "project\." src` will therefore drown the audit in matches
that cannot carry an empty-string hazard. Discriminate on the binding, not the word:
`ws.project` / `workspace.project` is in scope; a `.project` read off a
`computeBudgetReport(...)` result is not.

### 4.5 Form and strings

- `validateProjectMeta` retains `name` required, `endDate >= startDate`, and the four URL
  checks — three of sixteen error keys stay live.
- `ProjectErrorKey` and `ProjectErrorField` shrink accordingly.
- The thirteen dead error keys are deleted from EN **and** DE in the same commit, since `tsc`
  enforces key-set parity. Three of the thirteen —
  `errorStakeholdersInternalRequired`, `errorStakeholdersExternalRequired` and
  `errorEndDateRequired` — are **already** dead today: they sit in the union with no
  assignment anywhere, left behind when key stakeholders and the end date became optional. So
  this is partly a tidy-up of pre-existing residue, not purely a consequence of O-1. `i18n.de.ts` must be patched by a node utf8 write against `\r\n`
  anchors — never the Edit or Write tool, which corrupts umlauts and curls double quotes.
  Before deleting each key, grep for remaining references; those keys appear in
  `docs/superpowers/plans/2026-06-09-multi-project-portfolio-phase1.md`, which is a dated
  record and is **left alone** (it is outside both `agents-symbol-check`'s universe and
  `doc-claims-check`'s scan, so no gate is affected).
- The `required` markers come off every de-mandated field in `project-form-fields.tsx`. That is
  **ten**, not the eight this line said: nine `<Field ... required>` (code, project manager,
  customer, NACE section, products, deployment, start date, profit center, regulatory) plus the
  `required` prop on `ContactPersonsControl`, which draws its own asterisk. Project name keeps
  its asterisk. Reproduce with `grep -n "required" src/app/project-form-fields.tsx`.
- Two comments state the old rule and are corrected in the same MR: the header docstring in
  `ai-project-proposal.ts` ("remaining required fields (code, NACE, deployment, …)") and the
  `proposalToDraftPatch` docstring ("its own validation forces the user to complete required
  fields"), plus the "Required …" comments inside `sanitizeProjectMeta` itself.
- `project-form.tsx` needs no logic change: `saveDisabled` already derives from the validator.

### 4.6 Display

A blank `code` currently renders as empty text in the Projects list and in
`turso-project-picker.tsx`. There are **three** such sites, not two: two in `projects-panel.tsx`
(the active project list and the archived list beneath it) and one in `turso-project-picker.tsx`.
All three render an explicit `—` instead. A fourth site, the header's `project-switcher.tsx`,
already wraps its code line in `{p.code && (…)}` and simply omits it when blank — that is right for
a secondary line in a menu item and is left alone. Reproduce with
`git grep -n "{p.code}\|{p.meta.code}" -- src ':!*.test.*'`, which returns all four.

### 4.7 Testing

Additions:

- A name-only object decodes to a real `ProjectMeta` — the data-loss regression pin.
- A non-blank invalid `deployment` still rejects the record.
- A non-blank invalid `naceSection` still rejects the record.
- Save is enabled with a name alone.
- A blank code does not reach TimeLog as `""`.
- A blank code renders as `—` in both surfaces.

Invalidations — and these are the ones a plan normally omits, because `tsc` will not enumerate
them: every existing case in `project-validation.test.ts` and the sanitize project tests whose
*subject* is "rejects when `<field>` is missing" must be labelled **DELETE** or **MIGRATE**
explicitly, per task, found by repo-wide grep rather than by running the suite.

Enumerated 2026-09-13 against `origin/main` `c3598637` — the files this section named are not the
only ones, and two of the invalidated cases live elsewhere:

| File | Test | Label |
|---|---|---|
| `project-validation.test.ts` | "flags every missing required field" | MIGRATE — only `name` still errors |
| `project-validation.test.ts` | "requires at least one contact person" | DELETE — replaced by its opposite |
| `sanitize.project.test.ts` | "returns null when a required field is missing" | MIGRATE — keep blank name, `"ZZ"` NACE and `"Quantum"` deployment; the blank-customer line inverts |
| `sanitize-branches.test.ts` | "returns null when code / projectManager / products / profitCenter is blank" | DELETE — replaced by an accepts-blank case |
| `sanitize-branches.test.ts` | "treats a missing/blank endDate as '' and tolerates non-array …" | MIGRATE — non-array `regulatory` now yields `[]`, and the `lenientRequiredArrays` line goes with the option |
| `sanitize.test.ts` | "accepts a blank end date (optional since 0.74) → endDate ''" | MIGRATE — its trailing `startDate: ""` → null assertion inverts |
| `turso-tenant-schema.test.ts` | "rowsToProjectList keeps a project with empty required arrays that the STRICT decoder would reject" | MIGRATE — the strict decoder no longer rejects, and the lenient one is deleted |

Reproduce: `git grep -n -E "sanitizeProjectMeta|buildProjectFromObj|validateProjectMeta" -- 'src/**/*.test.*'`,
then read each hit's assertion. `project-form.test.tsx` and `create-project-wizard.test.tsx` both
fill every field through a `fillRequired` helper and stay valid; they need an addition, not a
migration.

Golden fixtures must **not** move: the sample workspace keeps full values. If a fixture diff
appears, that is a real format change to investigate, never something to regenerate.

### 4.8 Risk

This slice can lose data in both directions — too lenient and garbage decodes, too strict and a
name-only project evaporates on the next load. It ships alone for that reason.

## 5. MR B — key-fact model, provider, indicator

### 5.1 Pure core — `project-key-facts.ts`

i18n-free, no clock, no React. Exports:

- `KEY_FACT_IDS` — frozen, the eleven in declaration order.
- `KeyFactId` — the union.
- `keyFactCompleteness(meta)` → `{ filled, total, missing }`, `missing` in declaration order so
  the banner's list is stable between renders.

The emptiness test **mirrors** the form and the sanitizer exactly: `.trim()` for strings,
`length > 0` for the two arrays. A model that disagrees with the form would render a meter
contradicting the Save button — the same defect class `resolveEffectiveFilters` exists to
prevent. Id → label key is an exhaustive `Record<KeyFactId, TranslationKey>` held at the
surface, which is exhaustive with no branch to fill and therefore needs no `never` default.

### 5.2 Provider — `next-actions/providers/project-meta.ts`

- New `ActionSource` `"project-meta"`, which forces a row in the exhaustive
  `ACTION_SOURCE_LABEL` map plus an `actionSourceProjectMeta` string pair.
- One `SuggestedAction` per missing fact, `id: "project-meta:<projectId>:<factId>"`, matching
  the established `${source}:${entityId}:${reason}` convention.
- `cta: { kind: "open", view: "projects", id: projectId }`. A string id is permitted by
  `ActionCta`.
- `ActionInput` gains the project meta and project id **additively**; the provider returns `[]`
  when they are absent, so no caller is forced to supply them at once.
- `moduleId` stays undefined — Projects is core, always-on.

Scoring carries no date math, so per-fact weights exist to make the group's primary
deterministic rather than arbitrary: identity facts (`code`, `projectManager`, `customer`)
lead, then `startDate`, then the remainder. The weights themselves are adjustable; two
properties are not, and are pinned by test:

- No `project-meta` action may ever reach tier `now`. A blank profit centre must not outrank an
  overdue milestone.
- No task verb may attach. `next-actions/types.ts` warns that consumers do `Number(cta.id)` for
  `open-points` targets; our view is `projects`, so `onPoints()` must stay false.

### 5.3 Per-device cache — `project-key-facts-cache.ts`

`ProjectRegistryEntry` holds only `{id, name, code, storageConfig}`; the eleven facts and the
customer live inside each project's own backend. Non-current rows therefore need a cache,
modelled directly on `landing-state.ts`: one `device-store` key, shape
`Record<projectId, { filled, missing, customer, at }>`, bounded at 50 entries, written when a
project's workspace loads or saves, never exported, never in Turso, swept by `app-reset`'s
`aipm-cockpit:*` pass.

Two contract points, both load-bearing:

- **Absence reads as `null` meaning *unknown*, never as zero.** Rendering a never-opened
  project as `0 of 11` would be a fabricated measurement; rendering it green would hide a real
  gap. This is the per-device asymmetry AGENTS.md records for `overdueTrend`, where treating
  absence as a measurement was a shipped defect.
- **The current project never reads the cache.** It computes live from the in-memory meta, so
  it cannot be stale.

Caching the customer string is what makes the approved layout renderable on non-current rows at
all. Staleness is bounded by reopening the project.

### 5.4 Indicator — `projects-panel.tsx`

Per row, in order: the customer meta line (live for the current project, cached for others,
omitted when unknown), then the meter, then — current project only — the banner.

Both use existing primitives, per the no-hand-rolling rule:

- `ProgressTrack` (`progress-track.tsx`) supplies the rail. The fill is the caller's by design;
  ours is RAG-thresholded, with `UsageBar` as the documented sibling for that pattern. The
  *unknown* state renders the bare muted track with **no fill child** — distinguished by its
  `— / 11` text and `?` glyph, never by a hatch or pattern, because the palette constraint
  bans gradients outright.
- `Banner` (`banner.tsx`) with `severity="warn"` naming the missing facts and a "Complete them"
  action, switching to `severity="success"` at 11/11. Non-error banners default to
  `role="status"`, which is wanted here: filling the last fact announces the change.

Label pair per row: a sentence (`"3 key facts missing"` / `"Key facts complete"` /
`"Key facts not measured here"`) on the left, the count (`8 of 11`, `— / 11`) on the right.

### 5.5 Accessibility — no safety net on this surface

Projects is deliberately **not** in `A11Y_VIEWS`, so no axe run will ever scan this. Contrast
is checked by hand and unit tests are the only coverage. Consequences:

- The bar is `aria-hidden` decoration; the visible count text carries the state, so colour is
  never the sole cue.
- The banner's action renders once (current project only), so it needs no row token. If it is
  ever extended to every row it needs `buildRowTokens`, since a repeated "Complete them" is a
  WCAG 2.4.6 failure that no gate in this repo can detect.

### 5.6 Testing

- **Model:** completeness at empty / partial / full; and a mirror test asserting the model and
  `validateProjectMeta` agree on what "set" means.
- **Provider:** one action per missing fact; N facts collapse to one group with N−1 extras;
  never tier `now`; no task verbs attach; absent input yields `[]`.
- **Cache:** absence reads unknown rather than zero; eviction at the cap; the current project
  bypasses it.
- **Panel:** all four row states render; the banner appears on the current project only.

## 6. MR C — shell polish

### 6.1 `ToggleButton` pressed-marker animation

Today `toggle-button.tsx` renders the `CheckIcon` in both states and merely marks it
`invisible` when off, so the button keeps one width. The comment gives the reason: conditional
rendering makes the button about 20px narrower when off, and "a repeatedly-clicked control that
resizes moves its neighbours under the pointer". **This slice reverses that deliberate
decision**, which is recorded here so nobody reads it as closing a gap. Animating the collapse
answers the original objection in part: the icon is leftmost, so the pointer never leaves it,
and growth displaces only rightward neighbours.

Design:

- New opt-out prop `reserveMarkerSpace?: boolean`. Unset (the default) animates; `true`
  restores today's constant width.
- `true` is passed by `gantt-view-menu.tsx` (its eight view toggles) and
  `budget-panel-people-rows.tsx`. The budget one is not taste: its `<td>` is width-clamped and
  truncating against a user-resizable column, sitting beside sticky-column arithmetic derived
  from that declared width, and an animating child is the one thing that arithmetic cannot
  absorb. It also already carries a documented ellipsis defect (open-followups §123).
- The remaining 27 of 36 non-test call sites animate. The marker renders for **both** variants,
  `variant="disclosure"` included, which is why the budget disclosure button is in scope at all.
- The `CheckIcon` **stays rendered in both states**: it carries
  `data-pressed-marker="on"|"off"` which existing tests query, and it is the WCAG 1.4.1
  non-colour cue. What changes is a new `overflow-hidden` wrapper animating between zero width
  and the glyph's width, with the button's flex gap moved *inside* that wrapper so a collapsed
  marker leaves no orphan gap.
- `motion-reduce:transition-none`, so reduced motion snaps instead of animating. The cue
  survives either way, because presence — not motion — is the cue.

The top-bar `VoiceCommandButton` is window chrome and its footprint changes. That would
normally need separate sign-off under the confirm-before-window-changes rule; the instruction
was explicitly "all buttons", which is recorded here as covering it.

Testing: jsdom has no layout, so nothing here can see the motion, the widths, or whether the
budget cell's ellipsis still lands. Tests pin the classes, the prop plumbing, both opt-out
sites, and that the marker element is still present when off. Mutation check: flipping the
default must redden a test, and so must deleting either opt-out. Everything else is eye-verify
(§7).

### 6.2 Startup view

Three paths behave differently today, measured rather than assumed:

| Path | Today | Cause |
|---|---|---|
| Desktop cold start | Already Dashboard | `loadURL(APP_ORIGIN)` carries no hash, so `useHashView` takes its blank branch |
| Desktop relaunch while running | Last view | `second-instance` only restores and focuses; the renderer never reloads |
| Web reload / restored tab | Last view | `useHashView` writes `#<view>` on every view change, then honours it on load |

Renderer change: `useHashView`'s mount path gains a cold-load argument — `apply(true)` at
mount, listeners call `apply(false)`. On a cold load, a hash carrying **no item id** is treated
as stale and routed to the Dashboard, keeping the existing never-stranded fallback to
`open-points` when the dashboard module is disabled. `#raid/123` is honoured in full,
`requestOpen` included. Every later `hashchange`/`popstate` keeps today's behaviour, so
back/forward are untouched, and the MSAL auth-fragment guard stays first in the function. No
new write path is needed: the existing view→hash effect rewrites `#raid` to `#dashboard` itself.

Desktop change: the `second-instance` handler sets the fragment on the already-loaded page via
the **existing** `helpHashScript(hash)` in `desktop/src/lib/menu-model.ts`, which already takes an
optional hash parameter — so this adds a `DASHBOARD_VIEW_HASH` constant beside `HELP_VIEW_HASH` and
no new function. (An earlier draft of this section called for a `dashboardHashScript()`; that would
have duplicated a helper that is already general.) Note the helper clears the fragment before
setting it, so the clear alone already lands on the Dashboard via the blank branch, and the
subsequent set is idempotent. Assigning `location.hash` is
deliberate — unlike the app's own `replaceState` writes it *does* fire `hashchange`, which is
the navigation. No reload, so unsaved work survives; no preload and no IPC channel, so the Node
surface that shell deliberately does not expose stays closed.

Two accepted costs:

- `desktop/src/main.ts` is excluded from root `tsc` and compiled only by the **manual**
  `desktop-package` job, so the desktop half of this slice is untypechecked by a normal
  pipeline. A tag build or that manual job is the only thing that compiles it.
- A shared view-only link such as `#budget` now lands on the Dashboard. Item-bearing links —
  what people actually share to point at a thing — still work. Discriminating on
  `PerformanceNavigationTiming.type` would preserve `#budget` links but makes behaviour depend
  invisibly on how the page was reached; rejected as worse to reason about and worse to support.

Testing: cold `#raid` → Dashboard; cold `#raid/123` → RAID with the item; post-mount
`hashchange` to `#raid` → RAID; MSAL fragment untouched; dashboard module disabled →
`open-points`. The desktop handler is main-process and not unit-testable here (§7).

### 6.3 Top-bar search box clipping the "Ask Claude" button

**Observed** (screenshot, packaged Electron window ≈1420 CSS px wide, sidebar expanded): the
"Ask Claude" trigger's label wraps to two lines and the word `Claude` is clipped mid-word by
the left edge of the global search field, which paints over it.

**Candidate cause — to be confirmed by measuring in Chromium at the failing width before any
fix is written.** jsdom has no layout, so nothing in the unit suite can see this, and the
repo's standing rule is to measure rather than reason about geometry. The candidate:

- `TopBar` (`top-bar.tsx`) is a two-cluster flex row. The **left** cluster carries `min-w-0`,
  so it may shrink below its content. The **right** cluster does not, and it holds the search
  wrapper at `w-44 max-w-[55vw] sm:w-72 lg:w-96` — a fixed 384px at `lg`, which never yields.
- All space pressure therefore lands on the left cluster, which holds `AskClaudeMenu`
  (`ask-claude-menu.tsx`). Its trigger sits in a bare `<div className="relative">` with no
  `shrink-0`, and the label `<span>` has no `whitespace-nowrap`.
- Squeezed, the label wraps; `Claude` still exceeds the box and overflows into the adjacent
  opaque search field.

**Fix shape** (final form decided by the measurement):

- Make the search wrapper shrinkable — `min-w-0` with a maximum rather than a fixed width — so
  it yields before the left cluster overflows.
- Pin the `AskClaudeMenu` trigger with `shrink-0` and `whitespace-nowrap` so it can never wrap
  or be compressed below its label.
- Below a breakpoint, render the Ask Claude trigger icon-only, keeping its accessible name on
  the button so the label's disappearance costs nothing to assistive tech.

**Both top bars must change.** `shell-chrome.tsx` (classic `AppHeader`) and `task-manager.tsx`
(modern `ModernShell` `search` slot) wrap the search in the *identical* class string, so fixing
one leaves the other broken — the dual-top-bar trap AGENTS.md records. A new top-bar control
that lands in only one of them is invisible in the other layout.

**Testing.** Unit tests can pin the class strings in both mounts and the icon-only branch's
accessible name, and nothing more — the geometry is eye-verify (§7). Because the fix is
class-only, a test asserting the classes is the only thing that can detect a regression, so
both mounts get one.

## 7. Owed by eye-verify

Nothing in CI can reach these. They are owed, not done, and must not be reported as verified:

1. The clipping defect reproduced at ≈1420px with the sidebar expanded **before** the fix, then
   confirmed gone after — in **both** the modern and the classic top bar, and swept across
   widths from ~900px up, since the fix moves where the space pressure lands rather than
   removing it.
2. The marker animation itself — motion, timing, and that no toolbar jumps unpleasantly.
3. The budget people-rows `<td>` still ellipsises correctly with the opt-out in place.
4. The Gantt View menu is visually unchanged.
5. The Projects list indicator's contrast in all seven scheme combinations (Projects is not
   axe-scanned).
6. Desktop relaunch while running lands on the Dashboard without losing unsaved work.
7. A never-opened project renders the unknown state rather than `0 of 11`.

## 8. Cross-cutting constraints the plan must respect

- Gates run in CI only; the push is the first check. No local `tsc`, `eslint`, vitest or docs
  gate runs are part of the workflow.
- `src/app/*.ts(x)` is CRLF except where `.gitattributes` says otherwise. `sed -i` re-lines a
  CRLF file invisibly to `git diff`; use the Edit tool.
- `i18n.de.ts` is never touched with Edit or Write — node utf8 write, `\r\n` anchors, real
  umlauts.
- Adding a new `ActionSource` forces the exhaustive `ACTION_SOURCE_LABEL` row; adding a new
  coverage-gated `.ts` file can fail the unit job on the per-engine coverage globs, so a new
  pure engine needs its own tests or a considered `coverage.exclude` entry (exclude glue, not
  logic — `project-key-facts.ts` is logic and stays gated).
- Any new follow-up register entry takes the next free number verified against `origin/main`,
  not a number quoted from memory or from this document.

## 9. Sequencing

C → A → B, as §2 states. ★ This section said A → B → C while §2 said C → A → B; §2 was the
decision and C has shipped (merged 2026-09-13 as 1.0.3, `c3598637`), so the contradiction is
resolved in §2's favour. B must not start before A is merged: its model, its provider and its
indicator all assume a project can legitimately be incomplete, and against pre-A code every
fixture would have to fake that state.
