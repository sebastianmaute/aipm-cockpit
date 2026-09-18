<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# Accessibility — the axe gate and what it cannot see

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

Owns the a11y hard constraint: accessible names, row-unique per-row names, WCAG 2.5.3
label-in-name, toggle-button state (colour, contrast, the pressed marker), and exactly what
the axe gate in `e2e/a11y.spec.ts` scans and what it is structurally silent on.

★ Moved VERBATIM out of `AGENTS.md`'s "Hard constraints" section on 2026-09-13 — only link targets changed. Positional words inside the moved text ("this file", "above", "below", "in Commands") still
describe where it sat in `AGENTS.md`, not this file; `AGENTS.md` keeps a short pointer bullet.

## The a11y (axe gate) hard constraint

- **a11y (axe gate):** every new interactive control (button/checkbox/input/drag handle) needs
  accessible name + keyboard operability — unlabeled form control is axe-critical FAIL.
  `placeholder` is NOT an accessible name — input needs `aria-label`/`<label>` (placeholder-only
  input fails axe gate even though looks labeled).
  In LIST of rows, per-row controls need row-UNIQUE accessible name (e.g.
  `aria-label={`${t(lang,"edit")} – ${row.name}`}`) — N identical "Edit"/"Enabled" labels is
  WCAG 2.4.6 fail. ★★★ **THE AXE GATE CANNOT CATCH THIS AT ALL — not "only when one row is seeded".**
  Measured 2026-08-08 against the installed axe-core 4.12.1, not reasoned: of its 105
  rules, **69** carry one of the four tags `e2e/a11y.spec.ts` requests (`wcag2a wcag2aa wcag21a
  wcag21aa`), and NOT ONE of them flags two controls sharing an accessible name. ★★ THAT SENTENCE IS
  THE CLAIM — "two CONTROLS" is load-bearing, and every weaker paraphrase of it here has been false.
  The command below returns TEN rules, and TWO of the ten DO carry a requested tag:
  `duplicate-id-aria` and `frame-title-unique` (both `wcag2a`, and the latter is literally two
  iframes sharing an accessible name). What keeps the conclusion true is that neither of those two
  examines two CONTROLS' names. The two nearest by WORDING are not requested at all: `identical-links-same-purpose` ("links
  with the same accessible name serve a similar purpose" — links ONLY, `wcag2aaa`) and
  `table-duplicate-name` (a `<caption>` repeating the `summary` attribute — `best-practice`), which
  is even less adjacent than its id suggests. READ THE OUTPUT, do not read any sentence above it.
  Reproduce:
  `node -e 'const a=require("axe-core");console.log(a.getRules().filter(r=>/identical|duplicate|unique/i.test(r.ruleId)).map(r=>r.ruleId+" ["+r.tags.join(",")+"]").join("\n"))'`
  So a green axe run is silent on duplicate names in EVERY view, at EVERY seed size, forever. Qualify
  the label at write time and pin it with a UNIT test rendering ≥2 rows — a test you write is the ONLY
  thing that can catch this, in either layer. ★ Two different tests are meant here and they are not
  interchangeable: a UNIT test rendering two same-type rows is the PREVENTION you write alongside a new
  per-row control, and it is what this bullet asks for. The e2e assertions in `e2e/seed-content.spec.ts`
  are the other, and they are no longer a CHARACTERIZATION: they used to pin the DEFECT
  (`toHaveCount(2)` on the bare colliding name, red-on-fix by design) and were FLIPPED when
  `docs/open-followups.md` §126 was fixed, so they now pin the FIXED shape — `toHaveCount(0)` on the
  bare `"Dismiss – Milestone at risk"` plus `toHaveCount(1)` on each of `"… (1)"` / `"… (2)"` (EN DASH
  U+2013). ★★ Read that as a NARROWER guarantee, not a stronger one: those three are pinned to the
  exact disambiguation FORMAT, so changing the suffix turns them red without anything colliding — go
  to the spec's own comment before touching the numbers. ★ Reproduce with
  `grep -n "toHaveCount" e2e/seed-content.spec.ts`, and do not conflate the trio with the
  `toHaveCount(4)` a few lines above it in the SAME test: that one counts every `Dismiss – ` button and
  asserts the SEED reached the app, which is a different claim and was true either way. Both call
  themselves "the only detector" in their own scope; neither is a gate. (Worked example, and the seed
  that renders the collision at all: §126 — CLOSED 2026-08-25, so read it as the record of what was
  fixed, not as a live defect.)
  ★★ ASSERT THIS WITH THE SHARED `src/test/row-unique-names.ts`, never a
  hand-rolled enumeration — but read which of its two guards buys what, because the
  first shipped promising the second’s job. `minControls` THROWS when the scope
  renders fewer controls than that, which proves only that the scope is NON-EMPTY:
  it counts CONTROLS of the requested `roles`, NOT rows, over the WHOLE DOCUMENT
  unless `scope` is passed — so a panel’s toolbar alone satisfies any plausible floor.
  ★★★ IT DOES NOT MAKE THE VACUOUS ONE-ROW FIXTURE UNREACHABLE, and this bullet
  claimed for a release that it did. Measured by mutation, not reasoned:
  `documents-panel.test.tsx`’s “keeps every per-row control distinct when two documents
  share a title” (floor 2) still PASSED with its fixture cut to ONE document, and still
  PASSED cut to ZERO — one row renders six buttons and the panel toolbar five.
  `requireCollisionSeed: true` is the guard that closes it — its exact predicate and its
  limitation live in the docstring in `src/test/row-unique-names.ts`, never in a
  paraphrase. Turn it ON for any test claiming to cover a collision; leave it OFF for a
  distinct-name regression pin, a legitimate but different assertion. ★ It cannot certify
  a surface disambiguating some OTHER way — `documents-deleted-section.tsx` appends
  ` · #id` — so those stay opted out. ★★ NO
  SURFACE COUNT IS QUOTED HERE, and restoring one is a regression: this line
  said "four surfaces", which counts neither the registered sections (§111 ·
  §126 · §243 — and §126 alone covers TWO surfaces) nor the files that needed
  naming. Further surfaces were fixed with no § at all, among them the RAID
  case this very bullet uses as its worked example.
  Name the row with `buildRowTokens`/`rowLabel` (`src/app/row-tokens.ts`):
  a name unique in the list is used BARE, colliding rows get a 1-based occurrence
  index, and ALL colliding rows are numbered including the first. NOT the id
  (uuids read as character-salad aloud); NOT a whole-list ordinal (shifts under
  sorting).
  ★ Two things this cost us that the rule above does not say. First, WCAG 2.4.6 permits two controls
  with the SAME purpose to carry the same name — the detector flags any repeat regardless, so a red
  is a question ("do these two rows actually differ?"), not an automatic fix. RAID's toolbar Add and
  its trailing row Add collided; the fix was justified only because `openNew()` (always a Risk) and
  `openNew(effectiveCategory)` (the filtered category) genuinely differ, so the name now carries the
  category — scope the assertion with a comment instead when they don't. Second, a per-item component
  cannot disambiguate itself — it has no sibling visibility, so the token map must be built by whoever
  renders the LIST and threaded down as a prop. That is why `raid-panel-rows` was fixable in place;
  `TaskStatusSelect`/`TaskActionsImpl` needed the same token threaded in from THEIR list owners
  (`task-row.tsx`/`task-kanban-card.tsx`) instead, which is the same rule, not an exception to it.
  ★★ **The discriminator is "can this value repeat in one rendered list," never the call FORM.**
  Interpolating a per-row field through a positional `t(lang, key, item.field)` argument proves the
  name DIFFERS when the field differs; it proves nothing when the field REPEATS, and a repeating
  field is the entire premise of this defect class (`docs/open-followups.md` §111, §126, §247, §248
  are all the same shape). A value that cannot repeat in the list (a React list `key`, a numeric id)
  needs only a plain qualifier; free text — a name, a title — always needs a token, regardless of
  whether the call site passes it positionally or via a template literal.
  ★★★ **Enumerate with three legs, not one grep — a field-name grep alone has repeatedly missed real
  collisions.** (1) Widen it: allow whitespace around `=` and the camelCase `ariaLabel=` spelling, not
  only `aria-label="`. (2) A control with **NO `aria-label` at all** falls back to its rendered
  CONTENT as its accessible name, and a raw-content name collides exactly like a repeated attribute
  would — and invisible to any attribute-matching grep by construction, because there is no attribute
  to match. ★★ NO SURFACE COUNT AND NO FILE LIST IS QUOTED HERE, deliberately, and restoring one is a
  regression: this line carried five file names and a tally, which the row-unique-names branch had
  just STRIPPED out of `src/app/use-row-tokens.ts` and replaced with a reproduce grep — re-inserting
  it into the ALWAYS-LOADED file puts it where nothing can ever see it rot. Read today's set instead:
  `grep -rln "aria-label={rowToken}\|aria-label={token}" src/app --include=*.tsx | grep -v test`
  ★★ And do NOT paraphrase that set as "all routed through the shared `useRowTokens` hook" — the two
  Tasks surfaces CANNOT call it, because a per-item component has no sibling visibility (the general
  cannot-disambiguate-itself rule), so they take the token as a PROP from whoever renders the list. A
  `grep -rln "useRowTokens" src/app --include=*.tsx` therefore does NOT enumerate this fix and returns
  a different set of files; `docs/open-followups.md` §247 carries the split. (3) A shared per-row component handed the WHOLE
  ENTITY, not a pre-built token, can compose a name from a raw field INSIDE ITS OWN FILE, where no
  grep over the panel that renders it will ever see the string.
  ★ **A collision test's `roles` list is load-bearing, and nothing else checks it.**
  `requireCollisionSeed` (`src/test/row-unique-names.ts`) is satisfied by ANY two controls' names
  colliding, not necessarily the one under test — an unrelated real collision can mask a silently
  narrowed `roles` array. The only automatic guard is `minControls`, and only when kept at its exact
  MEASURED value for that scope; a loose floor lets the same narrowing back in unnoticed.
  ★★★ THE GATE IS SILENT ON WCAG 2.5.3 (label-in-name) IN EVERY VIEW TOO — and here, unlike the case
  above, THE RULE DOES EXIST, which is what makes it dangerous. axe 4.12.1 ships
  `label-content-name-mismatch` and it DOES carry `wcag21a`, one of the four tags the spec requests, so
  a rule listing reads as coverage. It is ALSO tagged `experimental`, and axe's default tagExclude is
  `experimental,deprecated` — a tag-only runOnly never RUNS it, and `e2e/a11y.spec.ts` enables no rule
  explicitly. Measured 2026-08-09 under the gate's exact four tags, not reasoned: the rule lands in NO
  result bucket — not violations, passes, incomplete OR inapplicable — and appears only once
  `{"label-content-name-mismatch": {enabled: true}}` is passed as an explicit rule override. Reproduce:
  `node -e "const a=require('axe-core');const r=a.getRules(['wcag21a']).find(x=>x.ruleId==='label-content-name-mismatch');console.log(!!r, a._audit.tagExclude.join(','), r.tags.join(','))"`
  → `true experimental,deprecated cat.semantics,wcag21a,…`. ★★ So "does `getRules(tags)` list it?" is
  the WRONG question — ask whether it survives tagExclude. That mistake was made and corrected on
  2026-08-09: a listing probe was read as proof the gate ran the rule. A control whose VISIBLE label is
  not CONTAINED in its `aria-label` (2.5.3 is case-INSENSITIVE — Understanding SC 2.5.3, "Punctuation
  and capitalization") therefore needs a UNIT test, in every view, scanned or not.
  ★★★ CONTAINMENT, NOT PREFIX — an earlier revision of this bullet said "prefix-preserving substring"
  and that is a STRICTER rule than the SC, so applying it literally flags conformant code: axe ends in
  `curatedCompareWith.includes(curatedCompare)` (position-independent, punctuation- and unicode-
  stripped), and this repo's own dependency type select passes while failing a prefix test — visible
  "Type for next link" inside accessible "Predecessor type for next link". ★★ Front-position IS a real
  best practice and WCAG says so — but in a NOTE attached to the SC ("A best practice is to have the
  text of the label at the start of the name"), not in its normative text, so enforcing it as THE rule
  flags conformant code. An earlier revision of this very paragraph cited that best practice to G208 /
  G211 "for speech input, not 2.5.3", which is backwards twice over: those two ARE 2.5.3's own
  sufficient techniques, and neither one mentions ordering. 2.5.3 IS the speech-input criterion.
  ★★★ AND THE RULE CANNOT SEE A `<select>` AT ALL, so enabling it explicitly is not the fix it looks
  like. Its `matches` admits only roles supporting name-from-content; a `<select>` without `multiple`
  and size null-or-1 maps to `combobox`, which is not among them. Measured 2026-08-09, not reasoned:
  `node -e 'const s=require("axe-core").commons.standards.getAriaRolesSupportingNameFromContent();console.log(s.length, "combobox:", s.includes("combobox"), "button:", s.includes("button"))'`
  → `32 combobox: false button: true`. So for every `<select>` in the app the unit test is not merely
  the best detector, it is the ONLY possible one, at any gate configuration.
  ★★ TOGGLE-BUTTON name/state coherence: a `<button aria-pressed>` whose VISIBLE LABEL flips to the
  OPPOSITE action (e.g. "Comfortable view" while compact is active) announces "Comfortable view,
  pressed" — implying the WRONG mode is on (WCAG 4.1.2). axe PASSES it (a name exists). Fix: PIN the
  label to what the toggle ENABLES ("Compact view") and let `aria-pressed` track THAT state, so
  "Compact view, pressed" ⇒ compact is on. (The dashboard's own density + Trends toggles followed this
  before they were REMOVED — density moved to Settings → Appearance, Trends is now Turso-gated.) The
  pin-the-enabled-label + `aria-pressed` pattern remains the RULE for any new toggle button.
  ★★ THAT PIN CREATED A WCAG 1.4.1 PROBLEM IN THE DARK SCHEMES AND `ToggleButton` NOW CLOSES IT ON
  TWO SEPARATE CHANNELS. Because the label may not say which state is active, the ON state rode the
  accent border+tint alone.
  ★★★ SCOPE THE HISTORY CORRECTLY — an earlier revision here said "colour as the sole visual channel"
  flatly and that is FALSE for the three LIGHT schemes: Understanding 1.4.1 counts a lightness difference
  of ≥3:1 as the required additional distinction, and pressed-vs-unpressed border measured
  harbor-light 8.97:1 · meridian-light 7.71:1 · umber-light 9.30:1 (computed from `builtin-schemes.ts`).
  Those were already conformant. The DARK maps measured 1.22 / 1.16 / 1.03:1 — that was the real
  failure, and not merely a colour-perception one. ★★ READ THOSE FIGURES AS THE RECORD OF WHAT §56
  MEASURED, NOT A LIVE DEFECT: §55 · §56 · §101 · §325 are all CLOSED. The CONTRAST half (SC 1.4.11) is
  STRUCTURAL FOR THE PRIMITIVE'S OWN THREE ACCENTS — each rides a derived state-border token nudged to
  clear 3:1 against `--line`, which covers a user's imported scheme for free where editing the built-in
  maps would not. ★★★ THAT IS A PROPERTY OF THE ACCENTS, NOT OF EVERY `ToggleButton`: `className` is
  APPENDED to the primitive's own classes, so a consumer may deliberately override the border with a
  trailing `!` and some do — `task-health-chip-style.ts` pins the RAG hue on the health chips, because
  there the hue IS which health was picked. Where a consumer overrides, the derived floor does not
  apply and the non-colour marker below is what carries the state (§335 records the measurement).
  ★★★ A `dark:border-*` variant on this primitive OR on a consumer SILENTLY UNDOES
  THAT: `scheme-apply.ts` already sets the property per active scheme AND mode, so a `dark:` override
  re-pins the raw accent in exactly the schemes that failed. The derivations, the per-accent
  measurements, the three accents, the `card` size and the `pressHandlers` bag are all in
  [`docs/AGENTS/theming.md`](theming.md) — open it before touching either.
  The NON-COLOUR half (SC 1.4.1) is a trailing
  `data-pressed-marker` check glyph (`aria-hidden`, since `aria-pressed` already tells AT) — a SEPARATE
  guarantee, and reading it as the CONTRAST fix is the trap §56 records. ★ It is still rendered in
  BOTH states, but its WIDTH is now conditional — off collapses to zero and animates, and
  `reserveMarkerSpace` opts a consumer OUT and restores the old constant width. ★★ NO CONSUMER COUNT
  IS QUOTED HERE, and restoring one is a regression: this line said "two consumers do" while seven
  files passed the prop (measured 2026-09-13). List them with
  `git grep -lE "^\s*reserveMarkerSpace\s*$" -- src ':!*.test.*' ':!src/app/toggle-button.tsx'` —
  the last exclusion is load-bearing, because the primitive's own comment has a line that is exactly
  the prop name and would be counted as a consumer.
  The constant width used to be unconditional, because a resizing control moves its neighbouring
  controls under the pointer on every click (reasoned, not measured — jsdom has no layout, so
  nothing here can test it); that reason is exactly why the opt-out exists. The mechanics are in
  [`docs/AGENTS/theming.md`](theming.md), and each consumer's REASON for opting out is
  enumerated in `toggle-button.tsx`'s comment beside the marker — the reasons differ, so do not
  restate them as one rule.
  ★ `invisible` now appears ONLY on the opt-out path: on the animated path a zero width already
  clips the glyph, so `invisible` would leave nothing to animate. ★ `invisible` vs
  `opacity-0` is NOT load-bearing: the marker `CheckIcon` carries its own explicit `aria-hidden="true"`,
  so the glyph is out of the a11y tree either way. ★★ Do NOT restore the old reason ("heroicons defaults
  `aria-hidden`") — lucide sets it only when the icon has no children AND the caller passed no a11y
  prop (`node_modules/lucide-react/dist/esm/Icon.mjs`: `...!children && !hasA11yProp(rest) && {
  "aria-hidden": "true" }`), so a NEW glyph relying on the library default would be exposed.
  ★★ **`preventFocusSteal` is OPT-IN, and that is load-bearing.** It suppresses the `mousedown`
  default so the click cannot pull focus off whatever the toggle acts ON — needed by the rich-text
  toolbar, where stealing focus from the editor collapses the selection the command is about to
  apply. It is a prop rather than the primitive's behaviour because every OTHER toggle in the app
  relies on native focus-on-click, so making it unconditional would change all of them at once. Both
  branches are pinned by `toggle-button.test.tsx`; a new toggle that drives ANOTHER element's
  selection wants it, and a self-contained one must not have it.
  ★★ `disabled` was declared on this primitive from the start but styled NOTHING until 0.212.0 — no
  call site ever passed it, so an inoperable toggle was pixel-identical to a live one. It now carries
  `disabled:cursor-not-allowed disabled:opacity-60`. ★★ THE JUSTIFICATION IS THE MEASURED FLOOR, not
  the exemption: at 60% the disabled label lands at 4.16:1 worst case (umber-light; harbor-light 4.34,
  meridian-light 4.51, all three dark 5.7+), so it stays readable. WCAG 1.4.3's inactive-component
  exemption is the conformance BACKSTOP, not the reason — quoting it alone would license `opacity-30`
  on some other disabled control, which is formally conformant and unreadable. Do not read this as
  licence for the enabled-state alpha traps recorded elsewhere in this file. ★ The disabled BORDER
  drops to ~1.15:1 and effectively vanishes; the control reads as a control via its text, which is
  why the floor above is the number that matters. ★ Keep it a real `disabled` attribute — an
  `aria-disabled` lookalike still fires `onClick`, which for the Settings auto-sync row would arm
  background sync from a row the user had switched off (pinned by a test).
  ★★ axe 4.12.1's ONLY `wcag141` rule is `link-in-text-block` (links vs surrounding text) — nothing
  in axe evaluates whether a CONTROL's state is colour-only, so the gate is silent on this for every
  toggle in the app and the primitives' own unit tests are the only coverage — `toggle-button.test.tsx`,
  `segmented-control.test.tsx` for its `data-selected-marker`, and `scheme-state-contrast.test.ts` for
  the 3:1 floor across every built-in combo. (An earlier revision said
  "axe has NO rule for colour-as-sole-cue"; a contributor grepping the tag list finds one and stops
  trusting the bullet.) A hand-rolled `aria-pressed` button gets neither the cue nor the test — use
  `ToggleButton`, or `SegmentedControl` for a one-of-N choice.
  Moving/folding a control INTO an axe-scanned view re-scans it: gate scans `Settings`→General, so
  folding Storage/Appearance into General surfaced pre-existing unlabeled `<select>` (a visible
  `<span>` label is NOT an `aria-label`/`<label>`) as axe-critical.
  `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is **17** named views — Dashboard · Open Points · Gantt ·
  Resources · Budget · RAID · Settings · Stakeholders · Changes · Milestones · Reports · Activity ·
  Time bookings · AI Assistant · Next actions · Insights · Documents — so a passing run reports 7 scheme
  COMBOS (harbor/meridian/umber L+D, Beacon light-only) × 17 + 7 Kanban-board variants (one per combo)
  + 1 notes-window rich-text-toolbar scan + 1 Documents block-editor scan (both harbor-light only and
  hardcoded, so neither scales with the combo count) = **128** axe scans, plus ONE non-scan guard test
  (asserts the served app's `data-app-version` matches this checkout, open-followups §58) — **129**
  tests total in the spec file. ★ Don't derive these numbers, MEASURE them, in the same
  commit that changes the list: `npx playwright test e2e/a11y.spec.ts --list` prints the total (no
  browsers needed, and it also proves `e2e/seed.ts`'s module-level sample read still resolves), and
  `grep -c "a11y:"` over that output splits scans from the guard.
  ★★ A VIEW IN THE LIST IS NOT THE SAME AS A VIEW BEING COVERED — the scan only sees what the e2e seed
  put in IndexedDB, and `e2e/seed.ts` seeds from two HARDCODED lists. A slice absent from them renders
  its EMPTY STATE at scan time, so the run is green over a panel with no rows, no per-row controls and
  nothing to collide. Seeding `documents` for the first time immediately turned up a real serious
  violation the empty state had been hiding. Most of BrowserBackend's optional kv slices are still
  unseeded — Insights is in this list and affected today (`docs/open-followups.md`).
  It does NOT include Projects, Knowledge, or the
  Resources → **Calendar** sub-tab (Resources defaults to the directory), so controls only on those
  surfaces aren't scanned; anything in the always-present top bar IS (scanned via every view).
  ★★ Calendar being unscanned has already cost real bugs: 0.202.0 shipped an AA contrast failure
  there (`text-ui-pink` on `bg-surface-muted`, under the 4.5:1 AA threshold) that a fully green axe run said nothing
  about (the count at the time was lower than today's, which is why this sentence no longer quotes one). Check contrast BY HAND for anything styled on that surface.
  ★ **"Reports" in the list means the `reports` PARENT view, and a separate nav-child route genuinely
  isn't scanned — but an earlier revision here overclaimed from that fact.** `openView(page, "Reports")`
  (`e2e/seed.ts`) clicks the sidebar item whose accessible name is exactly "Reports", landing on the
  `reports` view; `budget-report` is ALSO a distinct nav child (`nav-config.ts`: `{ view: "reports",
  children: [{ view: "budget-report" }, ...] }`) that sets `activeTab === "budget-report"` and mounts a
  STANDALONE, non-`embedded` `BudgetReportPanel` (`workspace-section.tsx`'s `panel-budget-report`) — no
  scan ever sets that `activeTab` (`A11Y_VIEWS` has no "Budget report" entry; "Budget" there is the
  separate `budget` panel).
  ★★ **DISPROVED: the Forecast cards/banner/tooltips are NOT "covered by no axe run".**
  `budget-report-panel.tsx`'s `embedded` branch (`if (embedded) return <div
  className="space-y-6">{content}</div>;`) reuses the SAME `content` — `ForecastSection`/`ForecastCards`,
  the chart, the EVM tiles — as the standalone branch; only the `ReportCard`/`ViewCallout`
  title-and-callout wrapper differs. And `reports.tsx`'s default `extraReports` is
  `DEFAULT_EXTRA_REPORTS` (`addable-reports.ts`: `["raid-report", "budget-report"]`), so the composed
  `reports` view mounts that `embedded` `BudgetReportPanel` as `report-block-budget-report` with no
  settings change needed. Two `e2e/a11y.spec.ts` scans exploit exactly that block: "Reports (budget
  chart, cumulative)" switches its chart to cumulative orientation (where the recorded-change markers
  render) before scanning, and "Reports with the chart readout open has no axe violations" opens its
  keyboard readout before scanning — both run axe over the Forecast content. What is genuinely unscanned
  is only the standalone route's own wrapper (the `panel-budget-report` title bar and its
  `ViewCallout`) — eye-verify THAT, same class as the Calendar sub-tab above. Reproduce: `grep -n "if
  (embedded)" src/app/budget-report-panel.tsx` and `grep -n "DEFAULT_EXTRA_REPORTS =" src/app/addable-reports.ts`.
  Verify IA/UI/contrast changes with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16s, webServer auto-starts)
  BEFORE pushing — unit suite (`test:run` = vitest) never runs playwright, so axe regressions slip
  local gate and fail ONLY in CI.
  ★★★ ADD `--workers=1` WHENEVER YOU MATCH MORE THAN ONE VIEW. `playwright.config.ts` sets
  `workers: process.env.CI ? 1 : undefined`, so **CI runs axe SERIALLY and local runs it at CPU-count**
  — a local-only contention mode the gate itself can never exhibit. Over-subscribed, tests die on
  `Test timeout of 60000ms exceeded` inside `page.evaluate`, which prints as a FAILURE with a
  screenshot and zero violation text. Measured 2026-08-08: a 3-view × 5-scheme selection went
  **10 failed / 5 passed** in parallel and **15 passed** at `--workers=1`, same commit, same warm
  server, no code change between runs. ★★ Read the failure BODY, never the summary line: a real
  violation names a rule id and an impact; this names neither, and the only `axe-core` string in the
  log is the spec's own `.withTags(...)` source echoed into the error context. Recording a green
  branch as red is the expensive direction here.
  ★ The 60s per-test timeout also covers the FIRST navigation's one-time Turbopack compile (the
  config says so at its `timeout`), so a COLD server can blow it under load even at one worker. Warm
  the route first (`curl -o /dev/null http://localhost:3000/` until it returns in well under a second)
  and let `reuseExistingServer` attach to that.
  ★★ After ANY `globals.css` `@theme` edit or large class/token rename, run axe on a FRESH ISOLATED
  server (`PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`) — NEVER the reused long-running
  dev server. Playwright's `reuseExistingServer:!CI` will attach to a stale `:3000` whose Tailwind
  hasn't regenerated the new `bg-ui-*` utilities → phantom transparent-fill axe FAILS that a prod build
  + a fresh port both pass (cost ~5 debug cycles once). Also re-run after killing a `PORT=3100` axe
  server if `.next/dev/types/*` got corrupted (phantom tsc errors in GENERATED files → `Remove-Item
  -Recurse -Force .next`, not source).
