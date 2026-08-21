# R5 follow-ups batch 3 — calendar/link-picker a11y + purple hover AA

_Plan written 2026-07-27. Source: `docs/superpowers/r5-calendar-followups.md` item 4
(the batch-2 accessibility review's deferred findings). Target release **0.202.3**._

Branch: `feature/r5-followups-batch-3` off `main` (currently `6db0d9d6`).

## Scope

All eight bullets of follow-up item 4. Two are already-resolved or need restating —
see §0.

**Not in scope:** follow-up items 1 (band lane stickiness), 2 (`use-resource-planner`
size) and 3 (`ResourcesPanel` memo). Those are decision-first and are being settled
separately.

---

## 0. Corrections to the follow-up doc, established before planning

- **`package.json` / `version.ts` drift is GONE.** Both read `0.202.2` today; the
  drift the doc records was fixed during the 0.202.2 release. Nothing to do —
  delete the bullet.
- **The `-strong`-on-hover-tint "sweep" the doc asks for was run, and it found
  nothing else.** A repo-wide scan of every `.tsx`/`.ts` line carrying both a
  `-strong`/`-text` colour token and a `hover:bg-*` tint returns **16 sites**;
  15 are the `ui-pink-strong` family and every one of them clears AA in all six
  built-in scheme/theme combos (worst case **4.71:1**, `pink-strong` on
  `bg-ui-pink/10` composited over `--surface-muted`). The RAID chip is the only
  failure. So this is a **point fix plus a guard**, not a sweep — and the guard is
  the part that makes it stay fixed.

Measured ratios for the failing site (`--ui-purple-strong` on the chip's hover
tint, computed with the repo's own `relLuminance`/`ratio`/`nudgeToAa` from
`scheme-tokens.ts`):

| scheme | resting | hover | verdict |
|---|---|---|---|
| harbor light | 5.34 | **4.60** | passes, no margin |
| harbor dark | 5.34 | 4.73 | passes |
| meridian light | 4.91 | **4.22** | **FAIL** |
| meridian dark | 5.20 | 4.60 | passes |
| umber light | 5.04 | **4.35** | **FAIL** |
| umber dark | 5.12 | 4.56 | passes |
| AIPM / Mockup light | — | 6.49 | passes (purple-strong is PINNED there) |
| AIPM dark | — | 5.82 | passes (pinned) |

The pattern is exactly the one AGENTS.md documents: `deriveAaVariants` targets
`--surface-muted`, which is *not* the hardest background this text actually sits
on once a translucent tint re-composites on hover. AIPM and Mockup escape it only
because they pin the token by hand.

---

## Task list

### T1 — `SortResizeTh` announces sort state (`aria-sort`)

`report-table.tsx`. The sort direction reaches AT only as a bare `↑`/`↓` glued
into the button's accessible name. `change-panel.tsx` and `raid-panel-rows.tsx`
already do this correctly on their raw `<th>`s, so this closes the gap for the
shared component.

- Add `aria-sort` to the `<th>` in `SortResizeTh`: `"ascending"` / `"descending"`
  when `sortKey === sortCol && sortDir !== "off"`, else `"none"`.
- Mark the `↑`/`↓` indicator `aria-hidden` inside `SortHeaderButton` so the state
  is announced once (via `aria-sort`) instead of twice, in two different
  vocabularies.
- ★ `aria-hidden` does not change `textContent`, so the three existing glyph
  assertions (`report-table.test.tsx:24,38-39`,
  `calendar-series-list.test.tsx:168,187-191`) keep passing unchanged. Verify
  that rather than assume it.
- Lifts every consumer at once: budget · budget-report · change-report ·
  milestones · raid-report · reports-tables · resources-panel-rows ·
  resources-report · calendar-series-list · tasks-section.
- Tests: `report-table.test.tsx` — asserts all three `aria-sort` values, and that
  the glyph is hidden from the accessible name while remaining in `textContent`.

### T2 — `EntityLinkPicker` becomes a real combobox

`entity-link-picker.tsx`. Today the dropdown appears with no `aria-expanded`, no
`role=listbox`/`option`, no result count, no Escape-to-dismiss and no arrow path
from the input into the list (WCAG 4.1.3). Pre-existing in both original pickers;
the extraction makes it one fix for all four call sites (RAID linked tasks, RAID
"caused by", Change, Budget bucket, Knowledge).

Mirror `global-search-box.tsx` — it already does this properly and is the
in-repo convention:

- `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
  `aria-autocomplete="list"` on the input; `role="listbox"` + `role="option"` +
  `aria-selected` on the list, ids from `useId()`.
- Local `highlight` state; ArrowDown/ArrowUp move it (wrapping), Enter adds the
  highlighted option, Escape closes the dropdown.
- ★ The component currently owns **no** state at all and takes `query` from the
  caller. Highlight state is internal (it is view state, not link state) — keep
  `query` a controlled prop; do not migrate it inward.
- ★ The caller filters `options`, so the highlight must reset when `options`
  changes — use the render-time reconcile pattern (`set-state-in-effect` is
  fatal), same shape as `useCombobox`'s `prevKey` reconcile.
- ★ `onMouseDown={e => e.preventDefault()}` on option buttons, so a click does not
  blur the input before the add lands (the ResourcePicker precedent).
- Announce the result count via a polite live region so the list appearing is
  perceivable — text arrives translated from the caller (this component calls no
  `t()`), so this needs a new **optional** `resultsLabel?: (count: number) =>
  string` prop, threaded from `task-link-picker.tsx` and `raid-edit-fields.tsx`
  with new EN/DE strings.
- Tests: extend `entity-link-picker.test.tsx` (roles/attrs, arrow+Enter, Escape,
  highlight reset on options change). Keep `raid-edit-fields.test.tsx` green.

### T3 — chip accessible name includes the entity in the non-click-through branch

`entity-link-picker.tsx`, the `onOpen`-less branch. The only focusable thing in
that chip is the remove button, named `"Unlink #42"` — a screen-reader user is
never told *which* task. The click-through branch already pins a full name.

- Give the inert branch's text an `id` and point the remove button's
  `aria-labelledby`/`aria-label` at the entity, i.e. name it
  `` `${removeLabel} ${entry.code} ${entry.label}` ``.
- ★ Keep the `title` short (`removeLabel`) — the visible tooltip should not grow.
- ★ Row-uniqueness already rides `entry.code`; the label only adds the *what*.
- Test: assert the remove button's accessible name contains the entity label in
  the no-`onOpen` render.

### T4 — band chips get a keyboard reschedule

`resource-calendar-band.tsx`. Drag is the only way to move an occurrence
(WCAG 2.1.1). The day grid immediately below already has the full model, so mirror
it rather than inventing one.

- Mirror `resource-calendar.tsx`'s `pendingMove`: **Alt+Left/Right** arms a move
  and accumulates a day delta in state (there is NO visual preview and the
  announcement does not report the delta — same gap as the day grid),
  **Enter** commits it as ONE `onMoveOccurrence` call
  (one undo entry per intent, not one per keypress), **Escape** cancels.
- ★ Occurrences are single-day, so there is no row axis and no resize gesture —
  only the day delta. Alt+Up/Down are silently ignored (the grid's own precedent
  for an axis a gesture does not use), not `preventDefault`ed.
- ★ Commit resolves through the SAME `resolveOccurrenceDrag` the drop handler
  uses, keyed on `(eventId, originalDate)` — never on the rendered date. Read
  `occurrence-drag.ts`'s doc comment before writing this; both of its documented
  bugs are reachable from a keyboard path too.
- ★ A `pendingMove` must block the plain-arrow roving walk while armed (the grid
  returns early for exactly this reason), or the preview and the focus cursor
  drift apart.
- Add an `aria-live="polite"` `sr-only` region for armed/cancelled, mirroring
  `DRAG_MODE_KEYS` — with only one gesture this is two new i18n keys, not a
  `Record`.
- ★ Gate the whole path on `onMoveOccurrence` (read-only popout must stay
  read-only), same as `draggable`.
- Tests: `resource-calendar-band.test.tsx` — arm/preview/commit calls
  `onMoveOccurrence` exactly once with the right occurrence; Escape cancels and
  commits nothing; plain arrows do not rove while armed; no handler ⇒ no arming.

### T5 — focus survives a chip unmounting

`resource-calendar-band.tsx`. After a reschedule (drag today, keyboard after T4)
or an edit that relocates the occurrence, the focused chip unmounts and focus
falls to `<body>`.

- Track "the band had focus" in a ref (set on chip `onFocus`, cleared when focus
  leaves the band). When `chips` changes and the ref is set and
  `document.activeElement` is `body`, focus the chip at the clamped `focusIndex`.
- ★ Effect-driven **side effect only** (a `.focus()` call), not `setState` —
  `set-state-in-effect` is fatal.
- ★ Must never steal focus from a user who was never in the band, nor from a
  modal opened by the edit click. Guard on both the ref and `activeElement ===
  document.body`.
- ★ jsdom has no layout but does track `activeElement`, so this IS unit-testable.

### T6 — chip names stay unique for a duplicated series

`resource-calendar-band.tsx`. The label is
`` `${title} – ${date} ${time}` ``, so two series with the same title at the same
date AND time announce identically (WCAG 2.4.6). Reachable by duplicating a series.

- Build the labels inside the existing `chips` `useMemo` (which already walks every
  rendered chip in order) and append a ` (#eventId)` discriminator **only** to
  labels that collide.
- ★ Unconditional suffixing was considered and rejected: it makes every
  announcement noisier to fix a case that is rare. The collision test must
  therefore use a fixture with two genuinely same-title/date/time series, or it
  proves nothing.
- ★ The label expression must stay in lockstep with the renderer's `occ && event`
  condition — the memo's existing comment explains why; extend it, do not weaken it.

### T7 — RAID "caused this" chips clear AA on hover

Two coordinated changes:

1. **Pin `--ui-purple-strong` in the three built-in LIGHT maps**
   (`builtin-schemes.ts`), replacing the derived value:

   | scheme | base `--ui-purple` | derived today | **pin** | hover ratio after |
   |---|---|---|---|---|
   | harbor | `#5f57a8` | `#5f57a8` | `#59519f` | 5.07 |
   | meridian | `#7c3aed` | `#7c3aed` | `#6e33ce` | 5.13 |
   | umber | `#7a5a8a` | `#7a5a8a` | `#70507b` | 5.10 |

   ★ Harbor is pinned too even though it currently passes at 4.60 — a 0.10 margin
   is not a margin, and a uniform treatment is what makes the guard meaningful.
   ★ `resolveSchemeColors` is **base-wins**, so a pin in the map survives
   derivation. That is the documented Phase-2 landmine #1 and is exactly what makes
   this work; do not touch the derivation order.
   ★ Dark maps are left derived (4.56–4.73, all passing). Pinning them means
   *lightening*, a visible change to every purple-strong text in dark mode, for no
   failure.
   ★ Only raises contrast everywhere the token is used — no other site regresses.

2. **A guard test** (`scheme-contrast` or a new `scheme-purple-hover.test.ts`)
   asserting, for every built-in scheme AND every shipped `public/themes/*.json`,
   that the RESOLVED `--ui-purple-strong` clears 4.5:1 against
   `composite(--ui-purple, --surface, 0.20)` in light and `0.25` in dark. This is
   the durable half: it is what makes the *next* built-in scheme safe, and the axe
   gate can never catch it (it scans the resting state, and the RAID chip only
   exists inside an edit modal the gate never opens).

★ Do **not** lower the hover alpha instead. `/15` does clear AA, but only at
4.53 in Meridian — a 0.03 margin — and it weakens the hover affordance to work
around a token that is wrong at the source.

---

## Verification

Per-task tests above, then the full gate:

```
npm run lint            # --max-warnings=0; unused import/var is FATAL
npx tsc --noEmit        # run after ANY test edit — vitest never typechecks
npm run test:run
npm run test:coverage   # floors are BLOCKING; new .ts files are coverage-gated
npm run dup:check
npm run size:check
npx playwright test e2e/a11y.spec.ts --project=chromium
```

★ **Run the axe gate on a FRESH isolated server** (`PORT=3100 npm run dev`, stop
with `PORT=3100 npm run stop`) because T7 edits scheme token maps — Playwright's
`reuseExistingServer` will otherwise attach to a stale `:3000` whose Tailwind has
not regenerated, producing phantom failures. This is a documented ~5-cycle trap.

★ **None of this batch is covered by the axe gate.** Resources defaults to the
directory sub-tab so Calendar is never scanned, and the link picker lives inside
edit modals the gate only ever sees closed. The vitest suites are the only
automated coverage — write them as if they are, because they are.

★ Eye-verify by hand: the RAID edit modal's "caused this" chips on hover in
Meridian light and Umber light; band keyboard move in the Resources → Calendar
sub-tab.

## Deliberately NOT fixed here — follow-ups with a known shape

## ⬅ EXTRACTED to `feature/escape-dismissal-protocol` (2026-07-27)

The document-level half of the Escape protocol was BUILT during round 6 and then deliberately PULLED
OUT of this batch: it had grown from "a picker dropdown should not close its modal" into app-wide
keyboard infrastructure, which does not belong in an a11y follow-up release. What was extracted:
`popover-panel.tsx`, `use-popover-dismiss.ts`, `notes-window.tsx`, `use-focus-trap.ts`, the
capture-phase move, and the tests `popover-in-modal.test.tsx` + `use-popover-dismiss.test.tsx`.
The working patch is preserved — see that branch.

★★ What STAYS here is only what 0.202.3's own feature requires: `Modal`'s `defaultPrevented` bail, the
pickers' `preventDefault`, and the removal of `useEscapeKey` from the stakeholder/change modals (that
hook's `window` listener bypassed the bail). Without those three, T2's combobox work would SHIP a new
draft-loss bug and its CHANGELOG claim would be false — which is why they are not separable.

★★★ Two findings from the extracted work worth keeping regardless, because they cost real time:
1. A bubble-phase `preventDefault` CANNOT protect a modal from a document-level popover — native
   listeners on one node fire in REGISTRATION order and the modal opened first. Capture fixes
   modal-vs-popover but NOT peer ordering (capture is also registration-ordered, i.e. outermost-first),
   so capture is a half-measure; the right shape is a **dismissal stack** mirroring `modalStack`.
2. `popover-in-modal.test.tsx` was the only test that could tell the two phases apart. All five
   popover unit tests passed under a capture→bubble mutation, because they dispatch on `document`
   (at-target, where phase is invisible). Fire from a focused ELEMENT.

## Still open here — the gap as first identified

★ **The Escape protocol is not honoured by the popover layer, and that is reachable in EVERY edit
modal.** `popover-panel.tsx` and `use-popover-dismiss.ts` call `onClose()` on Escape with neither a
`preventDefault` (so they are not producers) nor a `defaultPrevented` check (so they are not
consumers). `EditModalShell` renders `ModalFieldControls`, which renders a `PopoverPanel` behind the
⚙ button, in every edit modal — so: open the Change modal, type a title, click ⚙, press Escape, and
the popover closes AND the modal closes, discarding the draft. Identical defect class to the one this
batch fixes one component over, and **pre-existing and unchanged by this work**, which is the only
reason it is not in scope. One edit closes it: make both preventDefault when they consume Escape and
bail on `defaultPrevented`. ★ Same hook backs `ResourcePicker`'s own dropdown, so the stakeholder
scenario this batch cites is only fixed while focus is IN the picker input.

★ **A user who binds Escape as the dictation push-to-talk key loses Escape-to-close** while a prose
field has focus (`use-dictation-hotkey.ts` preventDefaults the configured combo; the recorder in
`dictation-section.tsx` does not exclude Escape). Genuinely new — the removed window listener used to
close the modal anyway. Cheap fix: reject Escape in the hotkey recorder.

★ The grid has no Space guard while a gesture is armed (the band does). Degrades gracefully:
`onGridBlur` cancels and announces when the editor takes focus.

## Deviations from this plan, as built

- **T2 dropped the `resultsLabel` live region.** Proper combobox semantics
  (`aria-expanded` + `aria-controls` + `aria-activedescendant` + `role=option`) already announce
  that results appeared, and `global-search-box.tsx` — the in-repo reference for doing this right —
  carries no live region either. Adding one would have meant a new prop threaded to two callers plus
  EN/DE strings, for a second announcement of the same fact.
- **T2 moved the click handler onto the `<li role="option">`** instead of keeping the inner
  `<button>`. A `<button>` inside `role="option"` is an axe nested-interactive violation and the
  keyboard path is activedescendant, so it bought nothing. Cost: four existing tests that queried
  options by the `button` role.
- **T7 fixed the DERIVATION rather than pinning hexes.** Pinning was written, tried, and reverted:
  `builtin-schemes.test.ts` requires built-in maps to hold exactly the 21 editable tokens, so a pinned
  AA variant is a test failure by construction. (An earlier draft of this line also claimed
  `cleanColors` would drop such a pin on "save as new" — that is FALSE, `--ui-purple-strong` is in
  `DERIVED_TOKENS` ⊂ `VALID_TOKENS` and is kept; the 21-token argument stands alone.) Deriving
  `--ui-purple-strong` against the composited purple tint is the accurate reference (verified: all
  three consumer sites put that text on a purple tint, none on a plain surface), fixes user schemes
  too, and needed no invariant relaxed. `globals.css`'s no-JS fallback was re-synced to match.
- **The `package.json` bullet was already fixed** before this batch started — see §0.
- **`addIsoDays` was hoisted into `calendar-window.ts`** and `resource-calendar.tsx`'s private copy
  deleted, so the band's keyboard move and the grid's step dates identically instead of duplicating.
- **T7 also lightened `--ui-purple-strong` in all three built-in DARK maps** (`#a990ff`→`#c7a9ff`,
  `#ad83ff`→`#cc9bff`, `#b786db`→`#d79eff`). Not intended, not stated above, and worth naming: this
  plan explicitly declined to touch the darks ("Pinning them means *lightening*… for no failure"),
  and changing the derivation's reference does it anyway, because the reference is the harder
  surface. Kept — it matches the module's existing rule for every other AA variant and keeps the
  token safe if a purple chip is ever placed on a muted card — but it IS a visible change to three
  shipped dark themes for sites that were already passing.

## Fixes applied after code review

Three reviewers ran read-only over the finished batch. Two independently found the same two defects.

1. **The band's armed move outlived the chip it was armed on.** Nothing outside the band's own
   handler cleared `pendingMove`, and the entry guard only required that *some* chip had focus — so
   arming chip A, clicking away, tabbing back onto chip B and pressing Enter silently rescheduled A.
   Commit now re-resolves the FOCUSED chip and requires it to be the armed one, else abandons and
   announces the cancellation (a silent drop would be nearly as bad).
2. **The two gestures clobbered the shared live region.** Both cancellation states were sticky past
   their gesture, so cancelling a grid move then arming a band one announced nothing (grid branch has
   priority), and cancelling a band move then committing a grid one announced "Meeting move
   cancelled" right after a successful edit — a false report of lost work. Each gesture now clears the
   other's stale state on arm.
3. **The 0.202.3 AA claim was false as first written.** `chat-panel.tsx`'s consent link used
   `hover:text-ui-purple-strong/80`, which computes 4.04–4.25:1 on its own tint in the three light
   schemes — the same trap as a tint deepening on hover, applied to the TEXT. The §0 sweep grepped
   `-strong` + `hover:bg-` and so structurally could not see it. The hover cue is now the underline
   thickness, which makes the shipped claim true.
4. The contrast guard composited over `--surface` while the derivation composites over
   `--surface-muted`, so it could not actually pin the derivation (a revert slipped through 4 of 6
   combos). Aligned to the code.
5. Smaller: Space no longer activates a chip mid-gesture; the highlight-clamp comment no longer
   claims a property the clamp does not have.

## Second review round — the fixes themselves

An adversarial pass over the four fixes above found three of them incomplete and one that had
introduced a NEW defect. All confirmed and closed:

6. **The armed-move guard revalidated identity but not POSITION.** `(eventId, originalDate)` is
   invariant under a move — that is what a move exception *is* — so an occurrence rescheduled by
   another path (drag, editor, undo) while a gesture was armed still matched, and the delta was then
   applied to `originDate`, i.e. where it used to be. A +1 on a chip the user sees on the 3rd would
   commit it to the 2nd. Now also requires `focused.date === pendingMove.originDate`.
7. **Root cause closed:** the gesture is now abandoned when focus leaves the band at all
   (`onBandBlur`). An armed move surviving the user walking away is what made every later
   revalidation necessary in the first place, and it let the grid's gesture overwrite the shared
   region while a band move was still committable. The in-band identity/position checks stay for
   focus moving *between* chips, which does not blur out of the band.
8. **The live-region mirror was too broad and too narrow at once.** Too broad: the grid arm sites
   cleared `bandMoveMode` unconditionally, erasing a *live* armed state along with a stale cancelled
   one — now `m === "cancelled" ? null : m`. Too narrow: `if (mode) setJustCancelled(null)` skipped
   the commit path (`mode === null`), leaving "Absence move cancelled" on screen right after a
   successful meeting reschedule — now unconditional.
9. **NEW defect I introduced in T7.** `nudgeToAa` picks its direction from `bg`'s luminance, and T7
   changed `bg` from the surface to a composited tint while the *alpha* is still chosen from the
   surface. Two mode decisions from two different values: a light scheme with a mid-grey
   `--surface-muted` flips the direction, the loop lightens to its cap, and `--ui-purple-strong`
   comes out `#ffffff` — white on a light card, ~1.7:1. Reachable for custom schemes (both inputs are
   editable, user schemes are light-only). Direction is now passed explicitly from the same `isDark`
   that picks the alpha, with custom-scheme regression cases — the built-in sweep could never have
   caught this.

Also fixed two vacuous assertions the same pass found: the "different chip" test used two
occurrences of ONE series, so dropping the `eventId` comparison survived it; and the live-region
mirror test asserted while a grid gesture was still armed, where the ternary's first branch masks
whatever is stale behind it — it now asserts after the gesture completes, and only then does deleting
the resize-site mirror fail it.

## Third review round — the round-2 fixes

Same pattern again, at lower severity. One Critical (found by a cold-read reviewer), and a set of
gaps in the round-2 fixes themselves.

10. **CRITICAL — the dropdown's new active-option cue was invisible in dark themes.** It used
    `bg-surface-muted text-ui-dark-blue`; that navy on a dark card measures **1.01 / 1.04 / 1.17:1** —
    the arrowed-to option was marked by its own text disappearing. The row background cannot carry
    the state either (~1.1:1 against the dropdown, and it is the inactive rows' hover colour). The
    same line existed in `global-search-box.tsx`, which this diff had copied it from; both fixed.
11. **My first replacement was also wrong**, in the other direction: `ring-ui-green` is 6.0–7.9:1 on
    the dark row fills but **1.7–2.1:1** on the light ones, under 1.4.11's 3:1. A brand accent is
    tuned for one mode and cannot carry a cue that must work in both. Now `ring-foreground`.
12. **And the comment justifying THAT was wrong too** — it claimed `--foreground` is "12–15:1 in every
    shipped scheme by construction". AIPM and Mockup light use a mid-grey `#636362` foreground:
    **4.79:1**. The conclusion held, the number did not, and no test could tell the difference.
    `scheme-contrast-cues.test.ts` now pins the ratio per scheme, and also records the rejected
    accent as an executable comparison so the reasoning cannot rot.
13. **The grid's Enter commit revalidated nothing.** A day cell is draggable, and an HTML5 drag fires
    no click and no focus change — so `onGridBlur` never sees it and an armed gesture survives a
    MOUSE drag that already relocated the absence. Enter then applied the delta to the dropped date
    (a silent extra day-shift) and, having preventDefault'd, did not open the editor either. The grid
    now revalidates its origin exactly as the band does.
14. **The band-mode mirror had to go back to unconditional.** Round 2 narrowed it to `"cancelled"`
    only, to avoid erasing a live armed state; round 3 showed a chip removed without a blur leaves it
    stuck on `"armed"`, which then describes a *successful absence move* as "Move meeting…". Both
    reviewers were right for their moment — `onBandBlur`, added between them, removed the case the
    narrowing protected. Worth remembering that a fix can be correct and then stop being correct
    because of a later fix.
15. **Escape stopped sticking.** The `onFocus` reopen meant tabbing away and back popped a dismissed
    list open again over the form, with no way to close it but clearing the query — the dead end this
    release exists to remove. Moved to `onClick`; ArrowDown still reopens (the APG affordance).

★ One reviewer suggestion REJECTED: replacing the Trends button's hover with a solid
`bg-ui-pink-strong` + white text. Computed at **2.40–3.23:1 in all four dark schemes** — it would
have traded a subtle hover for a fresh contrast failure. The button keeps the shared `Button`
destructive variant's own `hover:bg-ui-pink/10` (so the subtlety is a system-wide choice, not one
button drifting) and gained `disabled:hover:bg-transparent`. Migrating it onto that primitive is the
real follow-up.

## Fourth review round — the round-3 fixes

16. **The Escape containment never worked in production.** `stopPropagation` cannot suppress the
    modal's handler: React 19 delegates on `document` (Next passes `document` to `hydrateRoot`) — the
    same node `Modal` listens on — and stopPropagation does not stop a listener co-registered there.
    The test passed only because React Testing Library renders into a div under `body`, putting
    React's listener on a DESCENDANT: **a topology the real app never has, so the test was
    structurally incapable of failing.** `Modal` now bails on `e.defaultPrevented`, scoped to the
    Escape branch (bailing for Tab too would buy nothing — a preventDefaulted Tab cannot move focus —
    while permanently exposing the focus trap to any future descendant that preventDefaults Tab and
    moves focus itself).
17. **The batch's own benefit was not delivered in the Stakeholder modal.** `useEscapeKey` listens on
    `window` and ignored `defaultPrevented`, so Escape closed the ResourcePicker dropdown AND the
    modal, discarding the draft — while `modal.tsx` claimed it fixed exactly that. Both callers
    removed (`Modal` already owns Escape), and with no production callers left the hook AND its test
    were DELETED — a hook whose docstring warns against its only plausible use is a name-shaped trap
    for the next person grepping "escape key". Removing it also fixed two latent bugs nobody had
    reported: `onCancel` fired TWICE per Escape, and Escape over the delete-confirm dialog dismissed
    the confirm AND the edit modal beneath it.
    ★ The Change modal had escaped this only because the picker ALSO calls `stopPropagation`, cutting
    propagation to `window` — a line my own comment had called "harmless". It was load-bearing by
    accident. Comment corrected so nobody deletes it as dead code.
18. **The drag marker leaked indefinitely.** Set-site keyed on the DRAGGED chip, consume-site on the
    LAST-FOCUSED one, with an early return in between — so a mouse-only user (and every Safari user,
    since Safari does not focus a `<button>` on mousedown) left it armed forever, and their first
    keyboard reschedule had its focus restore eaten. Now consumed unconditionally at the top of the
    effect. Two earlier attempts at this same flag were each wrong in a different way.
19. **The grid guard ignored the reassign axis.** A drag can move an absence to another person on the
    same date, changing neither date — so the date-only guard passed and Enter re-applied the armed
    `rowDelta`, silently undoing the drag. Now compares `assignee` too.
20. **A guard test that could not fail.** Mutating the grid guard to read `endDate` for both gestures
    SURVIVED: the move gesture arms on `startDate`, so the mutant differs immediately and bails for
    the WRONG reason — passing every bail test while making every multi-day move impossible. Only a
    SUCCESSFUL multi-day move exposes it. ★ Same lesson as #16: **a test that exercises only the
    failure path cannot distinguish a correct guard from one broken in the safe direction.** Both the
    band's drag mechanism and the band's Space guard also had zero tests and were deletable whole.

Coverage added for each, every one mutation-verified (apply the revert, watch that test and only that
test fail). Also closed three test-quality gaps: the band keyboard fixtures all had
`originalDate === date` so the identity claim was untested; the "drops the active option" case was
vacuous because Escape already clears the highlight; and the `onMoveModeChange` → live-region chain
had no test at all — deleting both new ternary arms left every suite green.

## Release

Version bump `0.202.2 → 0.202.3` (`src/app/version.ts` + `package.json` together —
they are in sync today, keep them that way), `CHANGELOG.md` entry, and a
`versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` with EN/DE strings.
